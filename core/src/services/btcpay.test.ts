import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { BTCPayServer } from './btcpay';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock axios client interface
interface MockAxiosClient {
  get?: ReturnType<typeof vi.fn>;
  post?: ReturnType<typeof vi.fn>;
}

// Mock the database module
vi.mock('../models/database', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => null), // No API key stored
      run: vi.fn(),
    })),
  })),
}));

describe('BTCPayServer', () => {
  let btcpayClient: BTCPayServer;

  beforeEach(() => {
    vi.clearAllMocks();
    btcpayClient = new BTCPayServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isConnected', () => {
    it('should return true when BTCPayServer is accessible', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValue(mockClient as MockAxiosClient);

      const result = await btcpayClient.isConnected();
      expect(result).toBe(true);
      expect(mockClient.get).toHaveBeenCalledWith('/api/v1/server/info');
    });

    it('should return false when BTCPayServer is not accessible', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };
      mockedAxios.create.mockReturnValue(mockClient as MockAxiosClient);

      const result = await btcpayClient.isConnected();
      expect(result).toBe(false);
    });
  });

  describe('getServerInfo', () => {
    it('should return server information when successful', async () => {
      const mockServerInfo = {
        version: '1.9.8',
        onion: 'btcpayserver.onion',
      };

      // First mock connection success
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValueOnce(mockConnectionClient as MockAxiosClient);

      // Then mock the main client
      const mockMainClient = {
        get: vi.fn().mockResolvedValue({ data: mockServerInfo }),
      };
      mockedAxios.create.mockReturnValueOnce(mockMainClient as MockAxiosClient);

      const result = await btcpayClient.getServerInfo();
      expect(result).toEqual(mockServerInfo);
    });

    it('should throw error when server info request fails', async () => {
      // Mock connection success first
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValueOnce(mockConnectionClient as MockAxiosClient);

      // Then mock server info failure
      const mockMainClient = {
        get: vi.fn().mockRejectedValue(new Error('Request failed')),
      };
      mockedAxios.create.mockReturnValueOnce(mockMainClient as MockAxiosClient);

      await expect(btcpayClient.getServerInfo()).rejects.toThrow('Request failed');
    });
  });

  describe('registerWebhook', () => {
    it('should successfully register a webhook', async () => {
      // Mock connection success first
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValueOnce(mockConnectionClient as MockAxiosClient);

      // Then mock the main client for webhook registration
      const mockMainClient = {
        post: vi.fn().mockResolvedValue({
          data: {
            id: 'webhook_123',
            url: 'http://localhost:4001/api/webhooks/btcpay',
            events: ['invoice_created', 'invoice_paid'],
            active: true,
          },
        }),
      };
      mockedAxios.create.mockReturnValueOnce(mockMainClient as MockAxiosClient);

      const result = await btcpayClient.registerWebhook(
        'http://localhost:4001/api/webhooks/btcpay'
      );

      expect(result).toEqual({
        id: 'webhook_123',
        url: 'http://localhost:4001/api/webhooks/btcpay',
        events: ['invoice_created', 'invoice_paid', 'invoice_expired'],
        active: true,
        secret: expect.any(String),
      });
    });

    it('should return null when webhook registration fails', async () => {
      // Mock connection success first
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValueOnce(mockConnectionClient as MockAxiosClient);

      // Then mock the main client to fail
      const mockMainClient = {
        post: vi.fn().mockRejectedValue(new Error('Registration failed')),
      };
      mockedAxios.create.mockReturnValueOnce(mockMainClient as MockAxiosClient);

      const result = await btcpayClient.registerWebhook(
        'http://localhost:4001/api/webhooks/btcpay'
      );
      expect(result).toBeNull();
    });
  });

  describe('getWebhooks', () => {
    it('should return list of webhooks', async () => {
      const mockWebhooks = [
        {
          id: 'webhook_123',
          url: 'http://localhost:4001/api/webhooks/btcpay',
          events: ['invoice_created'],
          active: true,
        },
      ];

      // Mock connection success first
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValueOnce(mockConnectionClient as MockAxiosClient);

      // Then mock the main client for webhooks fetch
      const mockMainClient = {
        get: vi.fn().mockResolvedValue({ data: mockWebhooks }),
      };
      mockedAxios.create.mockReturnValueOnce(mockMainClient as MockAxiosClient);

      const result = await btcpayClient.getWebhooks();
      expect(result).toEqual(mockWebhooks);
    });

    it('should return empty array when webhook fetch fails', async () => {
      // Mock connection success first
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxios.create.mockReturnValueOnce(mockConnectionClient as MockAxiosClient);

      // Then mock the main client to fail
      const mockMainClient = {
        get: vi.fn().mockRejectedValue(new Error('Fetch failed')),
      };
      mockedAxios.create.mockReturnValueOnce(mockMainClient as MockAxiosClient);

      const result = await btcpayClient.getWebhooks();
      expect(result).toEqual([]);
    });
  });

  describe('generateWebhookSecret', () => {
    it('should generate a non-empty secret', () => {
      // Access private method for testing
      const secret1 = (btcpayClient as unknown as { generateWebhookSecret: () => string }).generateWebhookSecret();
      const secret2 = (btcpayClient as unknown as { generateWebhookSecret: () => string }).generateWebhookSecret();

      expect(secret1).toBeDefined();
      expect(secret1.length).toBeGreaterThan(0);
      expect(typeof secret1).toBe('string');
      // Should generate different secrets
      expect(secret1).not.toBe(secret2);
    });
  });
});
