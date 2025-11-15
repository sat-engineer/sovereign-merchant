import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { useWebhookManagement } from './useWebhookManagement';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('useWebhookManagement', () => {
  let showSuccessModalMock: vi.MockedFunction<(message: string) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    showSuccessModalMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with null webhook status and no loading', () => {
      const { result } = renderHook(() => useWebhookManagement());

      expect(result.current.webhookStatus).toBeNull();
      expect(result.current.webhookStatusLoading).toBe(false);
      expect(result.current.webhookEstablishError).toBeNull();
    });
  });

  describe('establishWebhooks', () => {
    it('should successfully establish webhooks and update status', async () => {
      const mockWebhookStatus = {
        webhooks: [
          {
            id: 'webhook-1',
            url: 'https://example.com/webhook',
            events: ['invoice/created', 'invoice/settled'],
            active: true,
          },
        ],
        requiredEvents: ['invoice/created', 'invoice/settled'],
        missingEvents: [],
        setupComplete: true,
        errors: [],
      };

      const mockResponse = {
        data: {
          success: true,
          status: mockWebhookStatus,
          message: 'Webhooks established successfully',
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useWebhookManagement());

      const establishResult = await result.current.establishWebhooks();

      expect(establishResult.success).toBe(true);
      expect(establishResult.status).toEqual(mockWebhookStatus);

      // Wait for state update
      await waitFor(() => {
        expect(result.current.webhookStatus).toEqual(mockWebhookStatus);
      });

      expect(result.current.webhookEstablishError).toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/btcpay/webhooks/establish');
    });

    it('should handle webhook establishment failure with user message', async () => {
      const mockResponse = {
        data: {
          success: false,
          message: 'Webhook creation failed',
          userMessage: 'Unable to create webhook due to permission issues',
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useWebhookManagement());

      const establishResult = await result.current.establishWebhooks();

      expect(establishResult.success).toBe(false);
      expect(establishResult.error).toBe('Unable to create webhook due to permission issues');

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe(
          'Unable to create webhook due to permission issues'
        );
      });

      expect(result.current.webhookStatus).toBeNull();
    });

    it('should handle 403 Forbidden error with specific message', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        response: {
          status: 403,
          data: {},
        },
      };

      // Mock axios.isAxiosError to return true for our mock error
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(axiosError);

      const { result } = renderHook(() => useWebhookManagement());

      const establishResult = await result.current.establishWebhooks();

      expect(establishResult.success).toBe(false);
      expect(establishResult.error).toBe(
        'API key does not have permission to create webhooks. Please check your API key permissions.'
      );

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe(
          'API key does not have permission to create webhooks. Please check your API key permissions.'
        );
      });
    });

    it('should handle 401 Unauthorized error with specific message', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        response: {
          status: 401,
          data: {},
        },
      };

      // Mock axios.isAxiosError to return true for our mock error
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(axiosError);

      const { result } = renderHook(() => useWebhookManagement());

      const establishResult = await result.current.establishWebhooks();

      expect(establishResult.success).toBe(false);
      expect(establishResult.error).toBe('API key is invalid or expired.');

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe('API key is invalid or expired.');
      });
    });

    it('should handle network errors gracefully', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network Error'));

      const { result } = renderHook(() => useWebhookManagement());

      const establishResult = await result.current.establishWebhooks();

      expect(establishResult.success).toBe(false);
      expect(establishResult.error).toBe('Failed to establish webhooks');

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe('Failed to establish webhooks');
      });
    });

    it('should handle axios error with custom userMessage from response', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        response: {
          data: {
            userMessage: 'Custom error message from server',
            message: 'Technical error details',
          },
        },
      };

      // Mock axios.isAxiosError to return true for our mock error
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(axiosError);

      const { result } = renderHook(() => useWebhookManagement());

      const establishResult = await result.current.establishWebhooks();

      expect(establishResult.success).toBe(false);
      expect(establishResult.error).toBe('Custom error message from server');

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe('Custom error message from server');
      });
    });

    it('should clear previous errors before attempting establishment', async () => {
      // Mock failure response that sets an error first
      const firstError = {
        data: {
          success: false,
          message: 'First error',
          userMessage: 'Previous error',
        },
      };

      const secondError = {
        data: {
          success: false,
          message: 'New error',
          userMessage: 'New error',
        },
      };

      const { result } = renderHook(() => useWebhookManagement());

      // First call - set initial error
      mockedAxios.post.mockResolvedValueOnce(firstError);
      await result.current.establishWebhooks();

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe('Previous error');
      });

      // Second call - error should be cleared first, then new error set
      mockedAxios.post.mockResolvedValueOnce(secondError);
      await result.current.establishWebhooks();

      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe('New error');
      });
    });
  });

  describe('establishWebhooksWithFeedback', () => {
    it('should show success modal when webhooks are established successfully', async () => {
      const mockResponse = {
        data: {
          success: true,
          status: {
            webhooks: [],
            requiredEvents: [],
            missingEvents: [],
            setupComplete: true,
            errors: [],
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const { result } = renderHook(() =>
        useWebhookManagement({ showSuccessModal: showSuccessModalMock })
      );

      await result.current.establishWebhooksWithFeedback();

      expect(showSuccessModalMock).toHaveBeenCalledWith(
        'Webhooks established successfully! Your BTCPayServer will now automatically send payment notifications.'
      );
    });

    it('should not show success modal when webhook establishment fails', async () => {
      const mockResponse = {
        data: {
          success: false,
          message: 'Webhook creation failed',
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const { result } = renderHook(() =>
        useWebhookManagement({ showSuccessModal: showSuccessModalMock })
      );

      await result.current.establishWebhooksWithFeedback();

      expect(showSuccessModalMock).not.toHaveBeenCalled();
    });

    it('should fallback to alert when no callback is provided', async () => {
      const mockResponse = {
        data: {
          success: true,
          status: {
            webhooks: [],
            requiredEvents: [],
            missingEvents: [],
            setupComplete: true,
            errors: [],
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      // Mock window.alert
      const alertMock = vi.fn();
      Object.defineProperty(window, 'alert', {
        writable: true,
        value: alertMock,
      });

      const { result } = renderHook(() => useWebhookManagement());

      await result.current.establishWebhooksWithFeedback();

      expect(alertMock).toHaveBeenCalledWith(
        'Webhooks established successfully! Your BTCPayServer will now automatically send payment notifications.'
      );
    });
  });

  describe('checkWebhookStatus', () => {
    it('should fetch webhook status successfully', async () => {
      const mockWebhookStatus = {
        webhooks: [
          {
            id: 'webhook-1',
            url: 'https://example.com/webhook',
            events: ['invoice/created'],
            active: true,
          },
        ],
        requiredEvents: ['invoice/created', 'invoice/settled'],
        missingEvents: ['invoice/settled'],
        setupComplete: false,
        errors: [],
      };

      const mockResponse = {
        data: {
          success: true,
          status: mockWebhookStatus,
        },
      };

      mockedAxios.post.mockResolvedValue({ data: { success: true } }); // sync-secrets
      mockedAxios.get.mockResolvedValue(mockResponse); // status check

      const { result } = renderHook(() => useWebhookManagement());

      await result.current.checkWebhookStatus();

      await waitFor(() => {
        expect(result.current.webhookStatus).toEqual(mockWebhookStatus);
      });

      expect(mockedAxios.post).toHaveBeenCalledWith('/api/btcpay/webhooks/sync-secrets');
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/btcpay/webhooks/status');
    });

    it('should handle webhook status fetch failure', async () => {
      mockedAxios.post.mockResolvedValue({ data: { success: true } });
      mockedAxios.get.mockResolvedValue({
        data: {
          success: false,
          message: 'Status check failed',
        },
      });

      const { result } = renderHook(() => useWebhookManagement());

      result.current.checkWebhookStatus();

      await waitFor(() => {
        expect(result.current.webhookStatusLoading).toBe(false);
      });

      expect(result.current.webhookStatus).toBeNull();
    });

    it('should handle API errors during status check', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Sync failed'));

      const { result } = renderHook(() => useWebhookManagement());

      result.current.checkWebhookStatus();

      await waitFor(() => {
        expect(result.current.webhookStatusLoading).toBe(false);
      });

      expect(result.current.webhookStatus).toBeNull();
    });

    it('should set loading state correctly during status check', async () => {
      // Add a delay to the mock responses so we can capture the loading state
      mockedAxios.post.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ data: { success: true } }), 50))
      );
      mockedAxios.get.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: { success: true, status: null } }), 50)
          )
      );

      const { result } = renderHook(() => useWebhookManagement());

      expect(result.current.webhookStatusLoading).toBe(false);

      const promise = result.current.checkWebhookStatus();

      // Wait for loading to become true
      await waitFor(() => {
        expect(result.current.webhookStatusLoading).toBe(true);
      });

      // Wait for the promise to resolve
      await promise;

      // Wait for loading to become false
      await waitFor(() => {
        expect(result.current.webhookStatusLoading).toBe(false);
      });
    });
  });

  describe('clearWebhookStatus', () => {
    it('should clear webhook status and error state', async () => {
      const { result } = renderHook(() => useWebhookManagement());

      // First, simulate setting some state by calling establishWebhooks with a failure
      const mockResponse = {
        data: {
          success: false,
          message: 'Some error',
          userMessage: 'Some error',
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);
      await result.current.establishWebhooks();

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.webhookEstablishError).toBe('Some error');
      });

      // Now call clearWebhookStatus
      result.current.clearWebhookStatus();

      // Wait for state to be cleared
      await waitFor(() => {
        expect(result.current.webhookStatus).toBeNull();
        expect(result.current.webhookEstablishError).toBeNull();
      });
    });
  });

  describe('hook with callbacks', () => {
    it('should accept and use callback functions', () => {
      const { result } = renderHook(() =>
        useWebhookManagement({ showSuccessModal: showSuccessModalMock })
      );

      // The hook should be initialized properly with callbacks
      expect(result.current.establishWebhooks).toBeInstanceOf(Function);
      expect(result.current.establishWebhooksWithFeedback).toBeInstanceOf(Function);
      expect(result.current.checkWebhookStatus).toBeInstanceOf(Function);
      expect(result.current.clearWebhookStatus).toBeInstanceOf(Function);
    });
  });

  describe('return values', () => {
    it('should return all expected functions and state', () => {
      const { result } = renderHook(() => useWebhookManagement());

      expect(result.current).toHaveProperty('webhookStatus');
      expect(result.current).toHaveProperty('webhookStatusLoading');
      expect(result.current).toHaveProperty('webhookEstablishError');
      expect(result.current).toHaveProperty('establishWebhooks');
      expect(result.current).toHaveProperty('establishWebhooksWithFeedback');
      expect(result.current).toHaveProperty('checkWebhookStatus');
      expect(result.current).toHaveProperty('clearWebhookStatus');

      expect(typeof result.current.establishWebhooks).toBe('function');
      expect(typeof result.current.establishWebhooksWithFeedback).toBe('function');
      expect(typeof result.current.checkWebhookStatus).toBe('function');
      expect(typeof result.current.clearWebhookStatus).toBe('function');
    });
  });
});
