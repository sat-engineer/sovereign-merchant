import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { apiRoutes } from './routes';
import { btcpayClient } from '../services/btcpay';

// Mock the BTCPayServer client
vi.mock('../services/btcpay', () => ({
  btcpayClient: {
    isConnected: vi.fn(),
    isAuthenticated: vi.fn(),
    getServerInfo: vi.fn(),
    registerWebhook: vi.fn(),
    getWebhooks: vi.fn(),
    getApiKey: vi.fn(),
    setApiKey: vi.fn(),
  },
}));

const mockedBTCPayClient = vi.mocked(btcpayClient);

describe('API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Create a test Fastify instance
    const fastify = (await import('fastify')).default();
    await apiRoutes(fastify, {});
    await fastify.ready();
    app = fastify;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.clearAllMocks();
  });

  describe('GET /status', () => {
    it('should return API status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('ok');
      expect(body.message).toContain('Sovereign Merchant API');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /btcpay/status', () => {
    it('should return connected status when BTCPayServer is accessible and authenticated', async () => {
      mockedBTCPayClient.isConnected.mockResolvedValue(true);
      mockedBTCPayClient.isAuthenticated.mockResolvedValue(true);
      mockedBTCPayClient.getServerInfo.mockResolvedValue({
        version: '1.9.8',
        onion: 'btcpayserver.onion',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/btcpay/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.connected).toBe(true);
      expect(body.authenticated).toBe(true);
      expect(body.serverInfo.version).toBe('1.9.8');
      expect(body.serverInfo.onion).toBe('btcpayserver.onion');
    });

    it('should return connected but not authenticated when API key is invalid', async () => {
      mockedBTCPayClient.isConnected.mockResolvedValue(true);
      mockedBTCPayClient.isAuthenticated.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/btcpay/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.connected).toBe(true);
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('Connected but API key is invalid');
    });

    it('should return disconnected status when BTCPayServer is not accessible', async () => {
      mockedBTCPayClient.isConnected.mockResolvedValue(false);
      mockedBTCPayClient.isAuthenticated.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/btcpay/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.connected).toBe(false);
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('BTCPayServer not accessible');
    });

    it('should handle server info fetch errors gracefully', async () => {
      mockedBTCPayClient.isConnected.mockResolvedValue(true);
      mockedBTCPayClient.isAuthenticated.mockResolvedValue(true);
      mockedBTCPayClient.getServerInfo.mockRejectedValue(new Error('Server error'));

      const response = await app.inject({
        method: 'GET',
        url: '/btcpay/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.connected).toBe(true);
      expect(body.authenticated).toBe(false);
      expect(body.serverInfo).toBeNull();
      expect(body.error).toContain('unable to get server info');
    });
  });

  describe('POST /btcpay/webhook/register', () => {
    it('should successfully register webhook', async () => {
      const mockWebhook = {
        id: 'webhook_123',
        url: 'http://umbrel.local/api/webhooks/btcpay',
        events: ['invoice_created', 'invoice_paid'],
        active: true,
        secret: 'webhook_secret_123',
      };

      mockedBTCPayClient.registerWebhook.mockResolvedValue(mockWebhook);

      const response = await app.inject({
        method: 'POST',
        url: '/btcpay/webhook/register',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.webhook).toEqual(mockWebhook);
    });

    it('should handle webhook registration failure', async () => {
      mockedBTCPayClient.registerWebhook.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/btcpay/webhook/register',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to register webhook');
    });
  });

  describe('GET /btcpay/webhooks', () => {
    it('should return list of webhooks', async () => {
      const mockWebhooks = [
        {
          id: 'webhook_123',
          url: 'http://umbrel.local/api/webhooks/btcpay',
          events: ['invoice_created'],
          active: true,
        },
      ];

      mockedBTCPayClient.getWebhooks.mockResolvedValue(mockWebhooks);

      const response = await app.inject({
        method: 'GET',
        url: '/btcpay/webhooks',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.webhooks).toEqual(mockWebhooks);
    });
  });

  describe('GET /config', () => {
    it('should return configuration status', async () => {
      mockedBTCPayClient.isConnected.mockResolvedValue(true);

      const response = await app.inject({
        method: 'GET',
        url: '/config',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.btcpayConfigured).toBe(true);
      expect(body.quickbooksConfigured).toBe(false);
      expect(body.setupComplete).toBe(true);
    });

    it('should show incomplete setup when BTCPayServer is not connected', async () => {
      mockedBTCPayClient.isConnected.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/config',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.btcpayConfigured).toBe(false);
      expect(body.setupComplete).toBe(false);
    });
  });
});
