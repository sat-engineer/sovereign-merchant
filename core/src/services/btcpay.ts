import axios, { AxiosInstance } from 'axios';
import dns from 'dns';
import { getDatabase } from '../models/database';

// Constants
const BTCPAY_PORT = 3003;
const CONNECTION_TIMEOUT = 10000;
const TEST_CONNECTION_TIMEOUT = 5000;
const WEBHOOK_SECRET_LENGTH = 32;

// Default fallback IPs for Umbrel environment
const DEFAULT_FALLBACK_IPS = [
  'host.docker.internal', // Docker host networking (Docker Desktop)
  '172.17.0.1', // Docker bridge gateway IP
  '192.168.65.1', // Alternative host IP (Docker Desktop)
  '192.168.1.168', // Umbrel host IP (from ping umbrel.local)
  'localhost', // Localhost if running on same host
  'btcpayserver', // Docker service name (if networks connected)
  'umbrel.local', // External access
];

export interface BTCPayInvoice {
  id: string;
  status: string;
  amount: string;
  currency: string;
  checkoutLink: string;
  createdTime: number;
  monitoringExpiration: number;
}

export interface WebhookData {
  id: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
}

export class BTCPayServer {
  private client: AxiosInstance | null;
  private baseUrl: string;
  private fallbackUrls: string[];
  private apiKey: string | undefined;
  private isFullyAuthenticated: boolean = false;

  constructor() {
    // Build list of possible BTCPayServer URLs
    const possibleUrls = this.buildConnectionUrls();

    this.baseUrl = possibleUrls[0] || `http://host.docker.internal:${BTCPAY_PORT}`;
    this.fallbackUrls = possibleUrls.slice(1);

    console.log('🔗 BTCPayServer primary URL:', this.baseUrl);
    console.log('🔗 BTCPayServer fallback URLs:', this.fallbackUrls);

    // Check for environment variable API key (for backwards compatibility)
    const envApiKey = process.env.BTCPAY_API_KEY || process.env.BTC_PAY_API_KEY;
    if (envApiKey) {
      console.log('🔑 BTCPayServer API key found in environment variables');
      // We'll load this into the apiKey property when needed
    }

    // Debug network connectivity
    this.debugNetworkConnectivity();

    // Don't create client yet - will be created when first connection is established
    this.client = null;
    this.apiKey = envApiKey; // Start with env var if available
  }

  /**
   * Build list of possible BTCPayServer connection URLs
   */
  private buildConnectionUrls(): string[] {
    const urls: string[] = [];

    // Add custom URL from environment if provided
    if (process.env.BTCPAY_URL) {
      urls.push(process.env.BTCPAY_URL);
    }

    // Add fallback IPs from environment or use defaults
    const fallbackIps = process.env.BTCPAY_FALLBACK_IPS
      ? process.env.BTCPAY_FALLBACK_IPS.split(',')
      : DEFAULT_FALLBACK_IPS;

    // Convert IPs to full URLs
    const fallbackUrls = fallbackIps.map((ip) => `http://${ip}:${BTCPAY_PORT}`);
    urls.push(...fallbackUrls);

    return urls;
  }

  /**
   * Debug network connectivity to help troubleshoot connection issues
   */
  private async debugNetworkConnectivity(): Promise<void> {
    console.log('🌐 Network debugging:');

    // Test umbrel.local resolution
    try {
      const address = await new Promise<string>((resolve, reject) => {
        dns.lookup('umbrel.local', (err: Error | null, address: string) => {
          if (err) reject(err);
          else resolve(address);
        });
      });
      console.log('🌐 umbrel.local resolves to:', address);
    } catch (err: unknown) {
      console.log(
        '🌐 umbrel.local DNS lookup failed:',
        err instanceof Error ? err.message : String(err)
      );
    }

    // Test localhost resolution
    try {
      const localhostAddress = await new Promise<string>((resolve, reject) => {
        dns.lookup('localhost', (err: Error | null, address: string) => {
          if (err) reject(err);
          else resolve(address);
        });
      });
      console.log('🌐 localhost resolves to:', localhostAddress);
    } catch (err: unknown) {
      console.log(
        '🌐 localhost DNS lookup failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Load BTCPayServer API key from database
   */
  private async loadApiKeyFromDatabase(): Promise<string | undefined> {
    try {
      const db = getDatabase();
      const result = db.prepare('SELECT value FROM config WHERE key = ?').get('btcpay_api_key') as
        | { value: string }
        | undefined;
      return result?.value;
    } catch (error) {
      console.error('Failed to load BTCPayServer API key from database:', error);
      return undefined;
    }
  }

  /**
   * Save BTCPayServer API key to database
   */
  private async saveApiKeyToDatabase(apiKey: string): Promise<void> {
    try {
      const db = getDatabase();
      db.prepare(
        `
        INSERT OR REPLACE INTO config (key, value, encrypted, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `
      ).run('btcpay_api_key', apiKey, 1); // Use 1 for true in SQLite
      console.log('✅ BTCPayServer API key saved to database');
    } catch (error) {
      console.error('Failed to save BTCPayServer API key to database:', error);
    }
  }

  /**
   * Ensure we have a working client connection
   */
  private async ensureConnection(): Promise<boolean> {
    if (this.client) {
      return true; // Already have a client
    }

    // First, ensure we have the API key loaded
    if (!this.apiKey) {
      const dbApiKey = await this.loadApiKeyFromDatabase();
      if (dbApiKey) {
        this.apiKey = dbApiKey;
        console.log('🔑 BTCPayServer API key loaded from database');
      }
    }

    // Build complete list of URLs to try
    const allUrls = [this.baseUrl, ...this.fallbackUrls];

    console.log('🔄 BTCPayServer will try URLs in this order:', allUrls);

    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      try {
        console.log(`🔍 [${i + 1}/${allUrls.length}] Testing BTCPayServer connection to: ${url}`);
        const headers: Record<string, string> = {};
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const testClient = axios.create({
          baseURL: url,
          timeout: TEST_CONNECTION_TIMEOUT,
          headers: headers,
        });

        const response = await testClient.get('/api/v1/server/info');
        if (response.status === 200) {
          console.log(`✅ BTCPayServer fully connected at: ${url} (${i + 1}/${allUrls.length})`);
          this.isFullyAuthenticated = true;
        } else if (response.status === 401) {
          console.log(
            `🔓 BTCPayServer reachable but API key invalid at: ${url} (${i + 1}/${allUrls.length})`
          );
          this.isFullyAuthenticated = false;
        } else {
          // Other status codes (403, 404, etc.) - continue trying other URLs
          continue;
        }

        // Create the main client to use the working URL
        const clientHeaders: Record<string, string> = {};
        if (this.apiKey) {
          clientHeaders['Authorization'] = `Bearer ${this.apiKey}`;
        }

        this.client = axios.create({
          baseURL: url,
          timeout: CONNECTION_TIMEOUT,
          headers: clientHeaders,
        });
        this.baseUrl = url;
        return true;
      } catch (error) {
        console.warn(
          `❌ [${i + 1}/${allUrls.length}] BTCPayServer connection failed for ${url}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.error('❌ All BTCPayServer connection attempts failed');
    return false;
  }

  /**
   * Check if BTCPayServer is accessible (network connection)
   */
  async isConnected(): Promise<boolean> {
    return await this.ensureConnection();
  }

  /**
   * Check if BTCPayServer API key is valid (fully authenticated)
   */
  async isAuthenticated(): Promise<boolean> {
    // Ensure we have a connection first
    if (!(await this.ensureConnection())) {
      return false;
    }
    return this.isFullyAuthenticated;
  }

  /**
   * Get the current API key (for checking if configured)
   */
  async getApiKey(): Promise<string | undefined> {
    // First check if we already have it loaded
    if (this.apiKey) {
      return this.apiKey;
    }

    // Otherwise load from database
    const dbApiKey = await this.loadApiKeyFromDatabase();
    if (dbApiKey) {
      this.apiKey = dbApiKey;
    }
    return this.apiKey;
  }

  /**
   * Set a new API key
   */
  async setApiKey(apiKey: string): Promise<void> {
    await this.saveApiKeyToDatabase(apiKey);
    // Update the current apiKey property
    this.apiKey = apiKey;
    // Reset client and authentication status
    this.client = null;
    this.isFullyAuthenticated = false;
    console.log('🔄 BTCPayServer client reset with new API key');
  }

  /**
   * Get server information
   */
  async getServerInfo(): Promise<unknown> {
    if (!(await this.ensureConnection())) {
      throw new Error('BTCPayServer not connected');
    }

    try {
      const response = await this.client!.get('/api/v1/server/info');
      return response.data;
    } catch (error) {
      console.error('Failed to get BTCPayServer info:', error);
      throw error;
    }
  }

  /**
   * Get list of stores
   */
  async getStores(): Promise<unknown[]> {
    if (!(await this.ensureConnection())) {
      throw new Error('BTCPayServer not connected');
    }

    try {
      const response = await this.client!.get('/api/v1/stores');
      return response.data;
    } catch (error) {
      console.error('Failed to get BTCPayServer stores:', error);
      throw error;
    }
  }

  /**
   * Register a webhook for payment notifications
   * Default events: InvoiceSettled (payment fully confirmed), InvoiceReceivedPayment (payment received), InvoiceProcessing (payment confirmed, waiting for blockchain confirmations)
   */
  async registerWebhook(
    webhookUrl: string,
    events: string[] = ['InvoiceSettled', 'InvoiceReceivedPayment', 'InvoiceProcessing']
  ): Promise<WebhookData | null> {
    if (!(await this.ensureConnection())) {
      console.error('Cannot register webhook: BTCPayServer not connected');
      return null;
    }

    try {
      // Get the first available store
      const stores = await this.getStores();
      if (!stores || stores.length === 0) {
        console.error('No stores found in BTCPayServer');
        return null;
      }

      const storeId = (stores[0] as { id: string })?.id;
      if (!storeId) {
        console.error('Store does not have a valid ID field');
        return null;
      }
      console.log(`📍 Registering webhook for store: ${storeId}`);

      const webhookData = {
        enabled: true,
        automaticRedelivery: true,
        url: webhookUrl,
        authorizedEvents: {
          everything: false,
          specificEvents: events
        },
        secret: this.generateWebhookSecret(),
      };

      const response = await this.client!.post(`/api/v1/stores/${storeId}/webhooks`, webhookData);

      return {
        id: response.data.id,
        url: webhookData.url,
        events: events,
        active: webhookData.enabled,
        secret: webhookData.secret,
      };
    } catch (error) {
      console.error('Failed to register webhook:', error);
      return null;
    }
  }

  /**
   * Generate a random webhook secret
   */
  private generateWebhookSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < WEBHOOK_SECRET_LENGTH; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Get registered webhooks
   */
  async getWebhooks(): Promise<WebhookData[]> {
    if (!(await this.ensureConnection())) {
      console.error('Cannot get webhooks: BTCPayServer not connected');
      return [];
    }

    try {
      // Get the first available store
      const stores = await this.getStores();
      if (!stores || stores.length === 0) {
        console.error('No stores found in BTCPayServer');
        return [];
      }

      const storeId = (stores[0] as { id: string })?.id;
      if (!storeId) {
        console.error('Store does not have a valid ID field');
        return [];
      }
      const response = await this.client!.get(`/api/v1/stores/${storeId}/webhooks`);

      // Transform the response to match our WebhookData interface
      return response.data.map((webhook: {
        id: string;
        url: string;
        enabled: boolean;
        authorizedEvents?: { specificEvents?: string[] };
        secret?: string;
      }) => ({
        id: webhook.id,
        url: webhook.url,
        events: webhook.authorizedEvents?.specificEvents || [],
        active: webhook.enabled,
        secret: webhook.secret,
      }));
    } catch (error) {
      console.error('Failed to get webhooks:', error);
      return [];
    }
  }
}

// Singleton instance
export const btcpayClient = new BTCPayServer();
