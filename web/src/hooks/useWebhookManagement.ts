import { useState } from 'react';
import axios from 'axios';

interface WebhookData {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

interface WebhookStatus {
  webhooks: WebhookData[];
  requiredEvents: string[];
  missingEvents: string[];
  setupComplete: boolean;
  errors: string[];
}

interface WebhookStatusResponse {
  success: boolean;
  status: WebhookStatus;
  message?: string;
  userMessage?: string;
}

interface WebhookEstablishResponse {
  success: boolean;
  message: string;
  status?: WebhookStatus;
  userMessage?: string;
}

interface WebhookResult {
  success: boolean;
  status?: WebhookStatus;
  error?: string;
}

interface SuccessModalCallbacks {
  showSuccessModal: (message: string) => void;
}

export const useWebhookManagement = (callbacks?: SuccessModalCallbacks) => {
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const [webhookStatusLoading, setWebhookStatusLoading] = useState(false);
  const [webhookEstablishError, setWebhookEstablishError] = useState<string | null>(null);

  /**
   * Core webhook establishment logic
   */
  const establishWebhooks = async (): Promise<WebhookResult> => {
    setWebhookEstablishError(null);

    try {
      const response = await axios.post<WebhookEstablishResponse>('/api/btcpay/webhooks/establish');

      if (response.data.success) {
        console.log('Webhooks established successfully');
        setWebhookStatus(response.data.status || null);
        return { success: true, status: response.data.status };
      } else {
        console.error('Failed to establish webhooks:', response.data);
        const errorMessage =
          response.data.userMessage || response.data.message || 'Failed to establish webhooks';
        setWebhookEstablishError(errorMessage);
        return { success: false, error: errorMessage };
      }
    } catch (error) {
      console.error('Failed to establish webhooks:', error);
      let errorMessage = 'Failed to establish webhooks';

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          errorMessage =
            'API key does not have permission to create webhooks. Please check your API key permissions.';
        } else if (error.response?.status === 401) {
          errorMessage = 'API key is invalid or expired.';
        } else if (error.response?.data?.userMessage) {
          errorMessage = error.response.data.userMessage;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
      }

      setWebhookEstablishError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Establish webhooks with user feedback (alerts)
   */
  const establishWebhooksWithFeedback = async (): Promise<void> => {
    const result = await establishWebhooks();
    if (result.success) {
      if (callbacks?.showSuccessModal) {
        callbacks.showSuccessModal(
          'Webhooks established successfully! Your BTCPayServer will now automatically send payment notifications.'
        );
      } else {
        // Fallback to alert if no callback provided
        alert(
          'Webhooks established successfully! Your BTCPayServer will now automatically send payment notifications.'
        );
      }
    }
  };

  /**
   * Check current webhook status
   */
  const checkWebhookStatus = async () => {
    setWebhookStatusLoading(true);
    try {
      // First sync webhook secrets to ensure they're available for validation
      console.log('🔄 Syncing webhook secrets before status check...');
      await axios.post('/api/btcpay/webhooks/sync-secrets');

      const response = await axios.get<WebhookStatusResponse>('/api/btcpay/webhooks/status');
      if (response.data.success) {
        setWebhookStatus(response.data.status);
      } else {
        console.error('Failed to get webhook status:', response.data);
        setWebhookStatus(null);
      }
    } catch (error) {
      console.error('Failed to check webhook status:', error);
      setWebhookStatus(null);
    } finally {
      setWebhookStatusLoading(false);
    }
  };

  /**
   * Clear webhook status (useful when API key changes)
   */
  const clearWebhookStatus = () => {
    setWebhookStatus(null);
    setWebhookEstablishError(null);
  };

  return {
    webhookStatus,
    webhookStatusLoading,
    webhookEstablishError,
    establishWebhooks,
    establishWebhooksWithFeedback,
    checkWebhookStatus,
    clearWebhookStatus,
  };
};
