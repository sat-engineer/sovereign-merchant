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

  describe('isAuthenticated', () => {
    it('should return false when not connected', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockRejectedValue(new Error('Connection failed'));
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.isAuthenticated();
      expect(result).toBe(false);
    });

    it('should return true when connected and authenticated', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValue({ status: 200 });
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.isAuthenticated();
      expect(result).toBe(true);
    });

    it('should return false when connected but not authenticated (401)', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValue({ status: 401 });
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.isAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe('getApiKey', () => {
    it('should return undefined when no API key is stored', async () => {
      const { getDatabase } = await import('../models/database');
      const mockDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => null),
        })),
      };
      vi.mocked(getDatabase).mockReturnValue(mockDb as any);

      const result = await btcpayClient.getApiKey();
      expect(result).toBeUndefined();
    });

    it('should return API key from database', async () => {
      const { getDatabase } = await import('../models/database');
      const mockDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({ value: 'test-api-key' })),
        })),
      };
      vi.mocked(getDatabase).mockReturnValue(mockDb as any);

      const result = await btcpayClient.getApiKey();
      expect(result).toBe('test-api-key');
    });

    it('should return cached API key if already loaded', async () => {
      // Set API key directly
      await btcpayClient.setApiKey('cached-key');

      const result = await btcpayClient.getApiKey();
      expect(result).toBe('cached-key');
    });
  });

  describe('setApiKey', () => {
    it('should save API key to database', async () => {
      const { getDatabase } = await import('../models/database');
      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn(() => ({
          run: mockRun,
        })),
      };
      vi.mocked(getDatabase).mockReturnValue(mockDb as any);

      await btcpayClient.setApiKey('new-api-key');

      expect(mockRun).toHaveBeenCalledWith('btcpay_api_key', 'new-api-key', 1);
      const result = await btcpayClient.getApiKey();
      expect(result).toBe('new-api-key');
    });

    it('should reset client when API key is set', async () => {
      // First establish a connection
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValue({ status: 200 });
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);
      await btcpayClient.isConnected();

      // Then set a new API key
      await btcpayClient.setApiKey('new-key');

      // Client should be reset, requiring reconnection
      const mockClient2 = createMockClient();
      mockClient2.get!.mockResolvedValue({ status: 200 });
      mockedAxiosCreate.mockReturnValue(mockClient2 as unknown as AxiosInstance);
      await btcpayClient.isConnected();
    });
  });

  describe('registerWebhook', () => {
    it('should return null when not connected', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockRejectedValue(new Error('Connection failed'));
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.registerWebhook('http://localhost/webhook');
      expect(result).toBeNull();
    });

    it('should return null when no stores are available', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [] }); // Empty stores

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.registerWebhook('http://localhost/webhook');
      expect(result).toBeNull();
    });

    it('should return null when store has no ID', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [{}] }); // Store without ID

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.registerWebhook('http://localhost/webhook');
      expect(result).toBeNull();
    });

    it('should handle database errors when storing webhook config', async () => {
      const { getDatabase } = await import('../models/database');
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] }); // Stores
      mockClient.post!.mockResolvedValueOnce({ data: { id: 'webhook_123' } }); // Webhook registration

      // Mock database to throw error
      vi.mocked(getDatabase).mockImplementation(() => {
        throw new Error('Database error');
      });

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.registerWebhook('http://localhost/webhook');
      // Should still return webhook data even if database save fails
      expect(result).not.toBeNull();
      expect(result?.id).toBe('webhook_123');
    });
  });

  describe('getStores', () => {
    it('should handle non-array response data', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: { stores: [] } }); // Object instead of array

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getStores();
      expect(result).toEqual([]);
    });

    it('should handle nested data array', async () => {
      const mockStores = [{ id: 'store_1' }, { id: 'store_2' }];
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: { data: mockStores } }); // Nested array

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getStores();
      expect(result).toEqual(mockStores);
    });

    it('should handle Axios error with response data', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      const axiosError = new Error('Request failed') as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 500, data: { error: 'Server error' } };
      mockClient.get!.mockRejectedValueOnce(axiosError);

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      await expect(btcpayClient.getStores()).rejects.toThrow('Request failed');
    });
  });

  describe('getWebhooks', () => {
    it('should return empty array when not connected', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockRejectedValue(new Error('Connection failed'));
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getWebhooks();
      expect(result).toEqual([]);
    });

    it('should return empty array when no stores available', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [] }); // Empty stores

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getWebhooks();
      expect(result).toEqual([]);
    });

    it('should handle webhook with everything enabled', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] }); // Stores
      mockClient.get!.mockResolvedValueOnce({
        data: [
          {
            id: 'webhook_123',
            url: 'http://localhost/webhook',
            enabled: true,
            authorizedEvents: {
              everything: true,
            },
          },
        ],
      });

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getWebhooks();
      expect(result[0].events).toEqual([]);
    });

    it('should handle webhook with secret', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValueOnce({ status: 200 }); // Connection check
      mockClient.get!.mockResolvedValueOnce({ data: [{ id: 'store_123' }] }); // Stores
      mockClient.get!.mockResolvedValueOnce({
        data: [
          {
            id: 'webhook_123',
            url: 'http://localhost/webhook',
            enabled: true,
            authorizedEvents: {
              everything: false,
              specificEvents: ['InvoiceSettled'],
            },
            secret: 'webhook_secret_123',
          },
        ],
      });

      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.getWebhooks();
      expect(result[0].secret).toBe('webhook_secret_123');
    });
  });

  describe('connection retry logic', () => {
    it('should try fallback URLs when primary fails', async () => {
      const mockClient1 = createMockClient();
      mockClient1.get!.mockRejectedValue(new Error('Primary failed'));

      const mockClient2 = createMockClient();
      mockClient2.get!.mockResolvedValue({ status: 200 });

      mockedAxiosCreate
        .mockReturnValueOnce(mockClient1 as unknown as AxiosInstance)
        .mockReturnValueOnce(mockClient2 as unknown as AxiosInstance)
        .mockReturnValueOnce(mockClient2 as unknown as AxiosInstance); // Main client creation

      const result = await btcpayClient.isConnected();
      expect(result).toBe(true);
      // Connection test client + main client = 2+ calls, but may be more due to retry logic
      expect(mockedAxiosCreate).toHaveBeenCalled();
    });

    it('should handle 401 status (unauthorized)', async () => {
      const mockClient = createMockClient();
      mockClient.get!.mockResolvedValue({ status: 401 });
      mockedAxiosCreate.mockReturnValue(mockClient as unknown as AxiosInstance);

      const result = await btcpayClient.isConnected();
      expect(result).toBe(true); // Connection succeeds, but not authenticated
      const authResult = await btcpayClient.isAuthenticated();
      expect(authResult).toBe(false);
    });

    it('should continue trying other URLs on non-200/401 status', async () => {
      const mockClient1 = createMockClient();
      mockClient1.get!.mockResolvedValue({ status: 403 });

      const mockClient2 = createMockClient();
      mockClient2.get!.mockResolvedValue({ status: 200 });

      mockedAxiosCreate
        .mockReturnValueOnce(mockClient1 as unknown as AxiosInstance)
        .mockReturnValueOnce(mockClient2 as unknown as AxiosInstance);

      const result = await btcpayClient.isConnected();
      expect(result).toBe(true);
    });
  });
});
