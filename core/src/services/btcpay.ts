import axios, { AxiosInstance, AxiosError } from 'axios';
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

export interface WebhookCreationData {
  enabled: boolean;
  automaticRedelivery: boolean;
  url: string;
  authorizedEvents: {
    everything: boolean;
    specificEvents: string[];
  };
  secret?: string;
}

export interface WebhookStatus {
  webhooks: WebhookData[];
  requiredEvents: string[];
  missingEvents: string[];
  setupComplete: boolean;
  errors: string[];
}

export class BTCPayServer {
  private static readonly REQUIRED_WEBHOOK_EVENTS = [
    'InvoiceCreated',
    'InvoiceReceivedPayment',
    'InvoiceProcessing',
    'InvoiceExpired',
    'InvoiceSettled',
    'InvoiceInvalid',
    'InvoicePaymentSettled',
  ] as const;

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
      console.log('🔍 Fetching stores from BTCPayServer API...');
      const response = await this.client!.get('/api/v1/stores');
      console.log('📋 API response received, status:', response.status);
      console.log(
        '📋 Response type:',
        Array.isArray(response.data) ? 'array' : typeof response.data
      );
      console.log('📋 Response size:', JSON.stringify(response.data).length, 'characters');

      // Ensure we return an array
      let stores: unknown[] = [];
      if (Array.isArray(response.data)) {
        stores = response.data;
        console.log(`📊 Successfully parsed ${stores.length} stores from API response`);
      } else if (response.data && typeof response.data === 'object') {
        // Sometimes APIs return { data: [...] } format
        if (Array.isArray(response.data.data)) {
          stores = response.data.data;
          console.log(`📊 Found ${stores.length} stores in nested data array`);
        } else {
          console.warn('⚠️ API response is an object but not in expected array format');
          stores = [];
        }
      } else {
        console.error('❌ API response is not in expected format (not an array or object)');
        stores = [];
      }

      console.log(`📊 Final result: ${stores.length} stores available`);
      return stores;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to get BTCPayServer stores:', errorMessage);

      // Log additional error details for Axios errors
      if (axios.isAxiosError(error)) {
        console.error('❌ API Error Response Status:', error.response?.status);
        console.error('❌ API Error Response Data:', JSON.stringify(error.response?.data, null, 2));
      }

      throw error;
    }
  }

  /**
   * Register a webhook for payment notifications
   * Default events: InvoiceSettled (payment fully confirmed),
   * InvoiceReceivedPayment (payment received), InvoiceProcessing (payment
   * confirmed, waiting for blockchain confirmations)
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
          specificEvents: events,
        },
        secret: this.generateWebhookSecret(),
      };

      const response = await this.client!.post(`/api/v1/stores/${storeId}/webhooks`, webhookData);

      // Store webhook configuration in database for signature validation
      try {
        const db = getDatabase();
        const insertStmt = db.prepare(`
          INSERT OR REPLACE INTO webhook_configs (id, url, secret, events, active, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        insertStmt.run(
          response.data.id,
          webhookData.url,
          response.data.secret || webhookData.secret,
          JSON.stringify(events),
          webhookData.enabled ? 1 : 0
        );

        console.log(`💾 Stored webhook config for validation: ${response.data.id}`);
      } catch (error) {
        console.error('Failed to store webhook config:', error);
        // Don't fail the webhook creation if we can't store the config
      }

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
      const webhooks = response.data.map(
        (webhook: {
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
        })
      );

      // Sync webhook secrets to our database for validation
      await this.syncWebhookSecretsToDatabase(webhooks);

      return webhooks;
    } catch (error) {
      console.error('Failed to get webhooks:', error);
      return [];
    }
  }

  /**
   * Sync existing webhook secrets from BTCPayServer to our local database
   * This ensures we have secrets for validation even if webhooks were created before we added database storage
   */
  async syncExistingWebhookSecrets(): Promise<void> {
    try {
      console.log('🔄 Fetching existing webhooks from BTCPayServer for secret sync...');
      const webhooks = await this.getWebhooks();
      console.log(`📊 Found ${webhooks.length} existing webhooks to sync`);

      await this.syncWebhookSecretsToDatabase(webhooks);
      console.log('✅ Webhook secret sync completed');
    } catch (error) {
      console.error('❌ Failed to sync existing webhook secrets:', error);
    }
  }

  /**
   * Sync webhook secrets from BTCPayServer to our local database
   */
  private async syncWebhookSecretsToDatabase(webhooks: WebhookData[]): Promise<void> {
    try {
      const db = getDatabase();

      console.log(`🔄 Syncing ${webhooks.length} webhooks to database:`);
      for (const webhook of webhooks) {
        console.log(
          `  - Webhook ${webhook.id}: active=${webhook.active}, hasSecret=${!!webhook.secret}, url=${webhook.url}`
        );

        if (webhook.secret) {
          // Store or update webhook config in database
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO webhook_configs (id, url, secret, events, active, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);

          insertStmt.run(
            webhook.id,
            webhook.url,
            webhook.secret,
            JSON.stringify(webhook.events),
            webhook.active ? 1 : 0
          );

          console.log(
            `💾 Stored webhook config for: ${webhook.id} (secret length: ${webhook.secret.length})`
          );
        } else {
          console.log(`⚠️  Skipping webhook ${webhook.id} - no secret`);
        }
      }

      // Verify what was stored
      const storedConfigs = db
        .prepare('SELECT id, active, LENGTH(secret) as secret_length FROM webhook_configs')
        .all();
      console.log('📊 Stored webhook configs:', storedConfigs);
    } catch (error) {
      console.error('Failed to sync webhook secrets to database:', error);
    }
  }

  /**
   * Get the first available store ID with proper validation
   */
  private async getFirstStoreId(): Promise<string | null> {
    try {
      const stores = await this.getStores();
      console.log('🔍 Analyzing store data:', JSON.stringify(stores, null, 2));

      if (!stores || stores.length === 0) {
        console.error('❌ No stores found in BTCPayServer');
        console.error('💡 This usually means:');
        console.error('   1. The API key lacks permission to view stores');
        console.error(
          '   2. The API key was created without "btcpay.store.canviewstoresettings" permission'
        );
        console.error('   3. No stores exist in BTCPayServer');
        console.error('🔧 Solution: Check your BTCPayServer API key permissions');
        return null;
      }

      console.log('📋 First store object:', JSON.stringify(stores[0], null, 2));

      const storeId = (stores[0] as { id: string })?.id;
      console.log('🔑 Extracted storeId:', storeId, 'Type:', typeof storeId);

      if (!storeId || typeof storeId !== 'string' || storeId.trim().length === 0) {
        console.error('❌ Store does not have a valid ID field');
        console.error('💡 The store object structure may be different than expected');
        return null;
      }

      console.log('✅ Valid store ID found:', storeId.trim());
      return storeId.trim();
    } catch (error) {
      console.error('❌ Failed to get store ID:', error);
      return null;
    }
  }

  /**
   * Automatically establish webhooks for all required events
   * This is the main entry point for webhook setup
   */
  async ensureWebhooksEstablished(webhookUrl?: string): Promise<WebhookStatus> {
    console.log('🔄 Starting automatic webhook establishment...');

    const validation = await this.validatePrerequisites();
    if (!validation.valid) {
      return this.createErrorStatus(validation.errors);
    }

    const urlResult = await this.getTargetWebhookUrl(webhookUrl);
    if (!urlResult.url) {
      return this.createErrorStatus(urlResult.errors);
    }

    console.log(`📍 Target webhook URL: ${urlResult.url}`);

    // Always sync webhook secrets first to ensure they're available for validation
    console.log('🔄 Syncing webhook secrets to database...');
    await this.syncExistingWebhookSecrets();

    console.log('🔍 Checking existing webhook configuration...');

    // Get current webhook status
    const currentStatus = await this.getWebhookStatus(urlResult.url);

    // If setup is already complete, return current status
    if (currentStatus.setupComplete) {
      console.log('✅ Webhook setup is already complete');
      return currentStatus;
    }

    // Create missing webhooks
    if (currentStatus.missingEvents.length > 0) {
      console.log(
        `📝 Creating webhooks for missing events: ${currentStatus.missingEvents.join(', ')}`
      );

      const createResult = await this.createWebhookForEvents(
        urlResult.url,
        currentStatus.missingEvents
      );
      if (createResult.errors.length > 0) {
        // Refresh status to get updated state after creation attempt
        const updatedStatus = await this.getWebhookStatus(urlResult.url);
        return {
          ...updatedStatus,
          errors: [...updatedStatus.errors, ...createResult.errors],
        };
      }

      // Refresh status after successful creation
      const updatedStatus = await this.getWebhookStatus(urlResult.url);
      return updatedStatus;
    }

    return currentStatus;
  }

  /**
   * Validate prerequisites for webhook establishment
   */
  private async validatePrerequisites(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!(await this.ensureConnection())) {
      errors.push('BTCPayServer not connected - cannot establish webhooks');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get the target webhook URL with validation
   */
  private async getTargetWebhookUrl(
    providedUrl?: string
  ): Promise<{ url: string | null; errors: string[] }> {
    const errors: string[] = [];

    const targetUrl = providedUrl || this.buildWebhookUrl();
    if (!targetUrl) {
      errors.push('No webhook URL available - cannot establish webhooks');
    }

    return { url: targetUrl, errors };
  }

  /**
   * Create an error status with all required events marked as missing
   */
  private createErrorStatus(errors: string[]): WebhookStatus {
    return {
      webhooks: [],
      requiredEvents: [...BTCPayServer.REQUIRED_WEBHOOK_EVENTS],
      missingEvents: [...BTCPayServer.REQUIRED_WEBHOOK_EVENTS],
      setupComplete: false,
      errors,
    };
  }

  /**
   * Get current webhook status for a specific URL
   */
  async getWebhookStatus(webhookUrl: string): Promise<WebhookStatus> {
    const errors: string[] = [];
    const requiredEvents = [...BTCPayServer.REQUIRED_WEBHOOK_EVENTS];

    try {
      const existingWebhooks = await this.getWebhooks();
      if (existingWebhooks.length === 0) {
        console.log('ℹ️  No existing webhooks found');
        return {
          webhooks: [],
          requiredEvents,
          missingEvents: requiredEvents,
          setupComplete: false,
          errors,
        };
      }

      // Find webhooks that match our URL
      const ourWebhooks = existingWebhooks.filter((webhook) => webhook.url === webhookUrl);

      if (ourWebhooks.length === 0) {
        console.log(`ℹ️  No webhooks found for URL: ${webhookUrl}`);
        return {
          webhooks: existingWebhooks,
          requiredEvents,
          missingEvents: requiredEvents,
          setupComplete: false,
          errors,
        };
      }

      // Check which events are covered by existing webhooks
      const coveredEvents = new Set<string>();
      ourWebhooks.forEach((webhook) => {
        if (webhook.active) {
          webhook.events.forEach((event) => coveredEvents.add(event));
        }
      });

      const missingEvents = requiredEvents.filter((event) => !coveredEvents.has(event));

      console.log(
        `📊 Webhook status: ${coveredEvents.size}/${requiredEvents.length} events covered`
      );
      if (missingEvents.length > 0) {
        console.log(`⚠️  Missing events: ${missingEvents.join(', ')}`);
      }

      return {
        webhooks: existingWebhooks,
        requiredEvents,
        missingEvents,
        setupComplete: missingEvents.length === 0,
        errors,
      };
    } catch (error) {
      const errorMsg = `Failed to check webhook status: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      return {
        webhooks: [],
        requiredEvents,
        missingEvents: requiredEvents,
        setupComplete: false,
        errors,
      };
    }
  }

  /**
   * Create a webhook for specific events
   */
  private async createWebhookForEvents(
    webhookUrl: string,
    events: string[]
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (events.length === 0) {
      console.log('ℹ️  No events to create webhook for');
      return { success: true, errors };
    }

    try {
      const storeId = await this.getFirstStoreId();
      if (!storeId) {
        const errorMsg = 'Cannot create webhook: no valid store ID available';
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        return { success: false, errors };
      }

      const webhookData: WebhookCreationData = {
        enabled: true,
        automaticRedelivery: true,
        url: webhookUrl,
        authorizedEvents: {
          everything: false,
          specificEvents: events,
        },
        secret: this.generateWebhookSecret(),
      };

      console.log(`📡 Creating webhook for events: ${events.join(', ')}`);
      const response = await this.client!.post(`/api/v1/stores/${storeId}/webhooks`, webhookData);

      if (response.status === 200) {
        console.log(`✅ Successfully created webhook for events: ${events.join(', ')}`);

        // Store webhook configuration in database for signature validation
        try {
          const db = getDatabase();
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO webhook_configs (id, url, secret, events, active, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);

          insertStmt.run(
            response.data.id,
            webhookData.url,
            webhookData.secret,
            JSON.stringify(events),
            webhookData.enabled ? 1 : 0 // Convert boolean to integer for SQLite
          );

          console.log(`💾 Stored webhook config for validation: ${response.data.id}`);
        } catch (error) {
          console.error('Failed to store webhook config:', error);
          // Don't fail the webhook creation if we can't store the config
        }

        return { success: true, errors };
      } else {
        const errorMsg = `Unexpected response status when creating webhook: ${response.status}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        return { success: false, errors };
      }
    } catch (error) {
      const errorMsg = `Failed to create webhook for events ${events.join(', ')}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      return { success: false, errors };
    }
  }

  /**
   * Update an existing webhook
   */
  async updateWebhook(webhookId: string, updates: Partial<WebhookCreationData>): Promise<boolean> {
    try {
      const storeId = await this.getFirstStoreId();
      if (!storeId) {
        console.error('Cannot update webhook: no valid store ID available');
        return false;
      }

      console.log(`📝 Updating webhook: ${webhookId}`);
      const response = await this.client!.put(
        `/api/v1/stores/${storeId}/webhooks/${webhookId}`,
        updates
      );

      if (response.status === 200) {
        console.log(`✅ Successfully updated webhook: ${webhookId}`);
        return true;
      } else {
        console.error(`❌ Unexpected response status when updating webhook: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to update webhook ${webhookId}:`, error);
      return false;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: string): Promise<boolean> {
    try {
      const storeId = await this.getFirstStoreId();
      if (!storeId) {
        console.error('Cannot delete webhook: no valid store ID available');
        return false;
      }

      console.log(`🗑️  Deleting webhook: ${webhookId}`);
      const response = await this.client!.delete(`/api/v1/stores/${storeId}/webhooks/${webhookId}`);

      if (response.status === 200) {
        console.log(`✅ Successfully deleted webhook: ${webhookId}`);
        return true;
      } else {
        console.error(`❌ Unexpected response status when deleting webhook: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to delete webhook ${webhookId}:`, error);
      return false;
    }
  }

  /**
   * Build the webhook URL for this application
   */
  buildWebhookUrl(): string | null {
    try {
      // For BTCPayServer webhooks, we need to use an internal network URL
      // since BTCPayServer runs in Docker and can't reach onion URLs directly
      let baseUrl: string;

      // Check if we're in a Docker environment (detect by common Docker network patterns)
      const isDockerEnvironment =
        process.env.BTCPAY_SERVER_URL?.includes('umbrel.local') ||
        process.env.BTCPAY_SERVER_URL?.includes('172.17.') ||
        process.env.BTCPAY_SERVER_URL?.includes('192.168.') ||
        process.env.BTCPAY_SERVER_URL?.includes('10.') ||
        process.env.HOSTNAME?.includes('docker') ||
        process.env.NODE_ENV === 'production';

      if (isDockerEnvironment) {
        // In Umbrel environment, use the full container name since Docker containers can reach each other by full name
        // Our container is typically named 'sovereign-merchant_web_1'
        baseUrl = `http://sovereign-merchant_web_1:${process.env.PORT || 4001}`;
        console.log('🐳 Umbrel environment detected, using full container name for webhooks');
      } else {
        // Fall back to external URLs for non-Docker environments
        baseUrl =
          process.env.APP_HIDDEN_SERVICE ||
          process.env.APP_DOMAIN ||
          `http://localhost:${process.env.PORT || 3000}`;

        // If APP_HIDDEN_SERVICE is a placeholder (like "not-enabled.onion"), don't use it
        if (baseUrl.includes('not-enabled') || baseUrl.includes('placeholder')) {
          baseUrl = `http://localhost:${process.env.PORT || 3000}`;
          console.warn(
            '⚠️ APP_HIDDEN_SERVICE appears to be a placeholder, falling back to localhost'
          );
        }
      }

      // Ensure we have a valid protocol
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = `http://${baseUrl}`;
      }

      const webhookUrl = `${baseUrl}/api/webhooks/btcpay`;
      console.log(`🔗 Built webhook URL: ${webhookUrl}`);
      return webhookUrl;
    } catch (error) {
      console.error('Failed to build webhook URL:', error);
      return null;
    }
  }
}

// Singleton instance
export const btcpayClient = new BTCPayServer();
