import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { type AxiosInstance } from 'axios';
import { BTCPayServer } from './btcpay';

// Mock axios
vi.mock('axios');
const mockedAxiosCreate = vi.mocked(axios.create);

// Create a consistent mock client that can be reused
const createMockClient = () => ({
  get: vi.fn(),
  post: vi.fn(),
});

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
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.isConnected();
      expect(result).toBe(true);
      expect(mockClient.get).toHaveBeenCalledWith('/api/v1/server/info');
    });

    it('should return false when BTCPayServer is not accessible', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

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
      mockedAxiosCreate.mockReturnValueOnce(mockConnectionClient as unknown as AxiosInstance);

      // Then mock the main client
      const mockMainClient = {
        get: vi.fn().mockResolvedValue({ data: mockServerInfo }),
      };
      mockedAxiosCreate.mockReturnValueOnce(mockMainClient as unknown as AxiosInstance);

      const result = await btcpayClient.getServerInfo();
      expect(result).toEqual(mockServerInfo);
    });

    it('should throw error when server info request fails', async () => {
      // Mock connection success first
      const mockConnectionClient = {
        get: vi.fn().mockResolvedValue({ status: 200 }),
      };
      mockedAxiosCreate.mockReturnValueOnce(mockConnectionClient as unknown as AxiosInstance);

      // Then mock server info failure
      const mockMainClient = {
        get: vi.fn().mockRejectedValue(new Error('Request failed')),
      };
      mockedAxiosCreate.mockReturnValueOnce(mockMainClient as unknown as AxiosInstance);

      await expect(btcpayClient.getServerInfo()).rejects.toThrow('Request failed');
    });
  });

  describe('registerWebhook', () => {
    it('should successfully register a webhook', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] }); // Stores fetch
      mockClient.post!.mockResolvedValueOnce({ data: { id: 'webhook_123' } }); // Webhook registration

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.registerWebhook(
        'http://localhost:4001/api/webhooks/btcpay'
      );

      expect(result).toEqual({
        id: 'webhook_123',
        url: 'http://localhost:4001/api/webhooks/btcpay',
        events: ['InvoiceSettled', 'InvoiceReceivedPayment', 'InvoiceProcessing'],
        active: true,
        secret: expect.any(String),
      });
    });

    it('should return null when webhook registration fails', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] }); // Stores fetch
      mockClient.post!.mockRejectedValueOnce(new Error('Registration failed')); // Webhook registration fails

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.registerWebhook(
        'http://localhost:4001/api/webhooks/btcpay'
      );
      expect(result).toBeNull();
    });
  });

  describe('getWebhooks', () => {
    it('should return list of webhooks', async () => {
      const mockClient = createMockClient();

      // Mock connection check
      mockClient.get!.mockResolvedValueOnce({ status: 200 });

      // Mock stores fetch
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] });

      // Mock BTCPay webhook response (different format than our interface)
      const mockBTCPayWebhooks = [
        {
          id: 'webhook_123',
          url: 'http://localhost:4001/api/webhooks/btcpay',
          enabled: true,
          authorizedEvents: {
            everything: false,
            specificEvents: ['InvoiceSettled', 'InvoiceReceivedPayment'],
          },
        },
      ];

      // Mock webhooks fetch
      mockClient.get!.mockResolvedValueOnce({ data: mockBTCPayWebhooks });

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getWebhooks();

      // Should transform BTCPay response to our interface
      expect(result).toEqual([
        {
          id: 'webhook_123',
          url: 'http://localhost:4001/api/webhooks/btcpay',
          events: ['InvoiceSettled', 'InvoiceReceivedPayment'],
          active: true,
          secret: undefined,
        },
      ]);
    });

    it('should return empty array when webhook fetch fails', async () => {
      const mockClient = createMockClient();

      // Mock connection check
      mockClient.get!.mockResolvedValueOnce({ status: 200 });

      // Mock stores fetch
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] });

      // Mock webhooks fetch to fail
      mockClient.get!.mockRejectedValueOnce(new Error('Fetch failed'));

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getWebhooks();
      expect(result).toEqual([]);
    });
  });

  describe('getStores', () => {
    it('should return list of stores when successful', async () => {
      const mockStores = [
        {
          id: 'store_123',
          name: 'Test Store',
          url: 'https://btcpay.example.com/stores/store_123',
        },
      ];

      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: mockStores }); // Stores fetch

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getStores();
      expect(result).toEqual(mockStores);
    });

    it('should return empty array when stores fetch fails', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockRejectedValueOnce(new Error('Stores fetch failed')); // Stores fetch fails

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      await expect(btcpayClient.getStores()).rejects.toThrow('Stores fetch failed');
    });

    it('should throw error when not connected', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockRejectedValueOnce(new Error('Connection failed')); // Connection fails

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      await expect(btcpayClient.getStores()).rejects.toThrow('BTCPayServer not connected');
    });
  });

  describe('generateWebhookSecret', () => {
    it('should generate a non-empty secret', () => {
      // Access private method for testing
      const secret1 = (
        btcpayClient as unknown as { generateWebhookSecret: () => string }
      ).generateWebhookSecret();
      const secret2 = (
        btcpayClient as unknown as { generateWebhookSecret: () => string }
      ).generateWebhookSecret();

      expect(secret1).toBeDefined();
      expect(secret1.length).toBeGreaterThan(0);
      expect(typeof secret1).toBe('string');
      // Should generate different secrets
      expect(secret1).not.toBe(secret2);
    });
  });
});
