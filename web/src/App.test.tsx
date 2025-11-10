import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock window.alert
Object.defineProperty(window, 'alert', {
  writable: true,
  value: vi.fn(),
});

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Setup Screen (No API Key)', () => {
    beforeEach(() => {
      // Mock no API key configured
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/api/btcpay/api-key') {
          return Promise.resolve({ data: { configured: false, key: null } });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should render the main title', () => {
      render(<App />);
      expect(screen.getByText('⚡ Sovereign Merchant')).toBeInTheDocument();
    });

    it('should show setup screen when no API key is configured', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Welcome to Sovereign Merchant')).toBeInTheDocument();
        expect(screen.getByText('Set Up BTCPayServer Connection')).toBeInTheDocument();
      });
    });

    it('should open API key modal when setup button is clicked', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Set Up BTCPayServer Connection')).toBeInTheDocument();
      });

      const setupButton = screen.getByText('Set Up BTCPayServer Connection');
      fireEvent.click(setupButton);

      expect(screen.getByText('BTCPayServer Settings')).toBeInTheDocument();
    });

    it('should open API key modal when settings gear is clicked', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Set Up BTCPayServer Connection')).toBeInTheDocument();
      });

      const settingsButton = screen.getByLabelText(
        'Open settings to configure BTCPayServer API key'
      );
      fireEvent.click(settingsButton);

      expect(screen.getByText('BTCPayServer Settings')).toBeInTheDocument();
    });
  });

  describe('Dashboard (API Key Configured)', () => {
    beforeEach(() => {
      // Mock API key configured and successful BTCPay connection
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/api/btcpay/api-key') {
          return Promise.resolve({ data: { configured: true, key: 'configured' } });
        }
        if (url === '/api/btcpay/status') {
          return Promise.resolve({
            data: {
              connected: true,
              authenticated: true,
              serverInfo: { version: '1.9.8', onion: 'btcpayserver.onion' },
            },
          });
        }
        if (url === '/api/config') {
          return Promise.resolve({
            data: { btcpayConfigured: true, quickbooksConfigured: false, setupComplete: true },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should show dashboard when API key is configured', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Connected to BTCPayServer')).toBeInTheDocument();
      });
    });

    it('should display connected status', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Connected to BTCPayServer')).toBeInTheDocument();
      });
    });

    it('should display setup status', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Setup Status')).toBeInTheDocument();
        expect(
          screen.getByText('⚠️ Authenticated with BTCPayServer, connect QuickBooks')
        ).toBeInTheDocument();
      });
    });

    it('should open settings modal when settings gear is clicked', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Connected to BTCPayServer')).toBeInTheDocument();
      });

      const settingsButton = screen.getByLabelText(
        'Open settings to configure BTCPayServer API key'
      );
      fireEvent.click(settingsButton);

      expect(screen.getByText('BTCPayServer Settings')).toBeInTheDocument();
    });

    it('should handle refresh status button click', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Connected to BTCPayServer')).toBeInTheDocument();
      });

      const refreshButton = screen.getByText('Refresh Status');
      fireEvent.click(refreshButton);

      // Should call APIs again
      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(6); // Initial + refresh calls
      });
    });

    it('should handle register webhook button click', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Connected to BTCPayServer')).toBeInTheDocument();
      });

      const registerButton = screen.getByText('Register Webhook');
      fireEvent.click(registerButton);

      await waitFor(() => {
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/btcpay/webhook/register');
      });
    });
  });

  describe('API Key Modal', () => {
    beforeEach(() => {
      // Mock no API key configured
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/api/btcpay/api-key') {
          return Promise.resolve({ data: { configured: false, key: null } });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should save API key successfully', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { success: true, message: 'API key saved successfully' },
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Set Up BTCPayServer Connection')).toBeInTheDocument();
      });

      // Open modal
      const setupButton = screen.getByText('Set Up BTCPayServer Connection');
      fireEvent.click(setupButton);

      // Enter API key
      const apiKeyInput = screen.getByLabelText('BTCPayServer API key input');
      fireEvent.change(apiKeyInput, { target: { value: 'test-api-key' } });

      // Save API key
      const saveButton = screen.getByText('Save API Key');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/btcpay/api-key', {
          apiKey: 'test-api-key',
        });
      });

      // Should show success modal
      expect(screen.getByText('✅ Success!')).toBeInTheDocument();
      expect(screen.getByText('BTCPayServer API key saved successfully!')).toBeInTheDocument();
    });

    it('should show error for empty API key', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Set Up BTCPayServer Connection')).toBeInTheDocument();
      });

      // Open modal
      const setupButton = screen.getByText('Set Up BTCPayServer Connection');
      fireEvent.click(setupButton);

      // Try to save empty API key
      const saveButton = screen.getByText('Save API Key');
      fireEvent.click(saveButton);

      // Should show alert (we'll test the behavior by checking axios wasn't called)
      await waitFor(() => {
        expect(mockedAxios.post).not.toHaveBeenCalled();
      });
    });

    it('should handle API key save error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Save failed'));

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Set Up BTCPayServer Connection')).toBeInTheDocument();
      });

      // Open modal
      const setupButton = screen.getByText('Set Up BTCPayServer Connection');
      fireEvent.click(setupButton);

      // Enter API key
      const apiKeyInput = screen.getByLabelText('BTCPayServer API key input');
      fireEvent.change(apiKeyInput, { target: { value: 'test-api-key' } });

      // Save API key
      const saveButton = screen.getByText('Save API Key');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/btcpay/api-key', {
          apiKey: 'test-api-key',
        });
      });
    });
  });

  describe('Error States', () => {
    it('should show disconnected status when BTCPayServer is not reachable', async () => {
      // Mock API key configured but BTCPay not connected
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/api/btcpay/api-key') {
          return Promise.resolve({ data: { configured: true, key: 'configured' } });
        }
        if (url === '/api/btcpay/status') {
          return Promise.resolve({
            data: {
              connected: false,
              authenticated: false,
              error: 'BTCPayServer not accessible',
            },
          });
        }
        if (url === '/api/config') {
          return Promise.resolve({
            data: { btcpayConfigured: false, quickbooksConfigured: false, setupComplete: false },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Not connected to BTCPayServer')).toBeInTheDocument();
      });
    });

    it('should show error status when API key is invalid', async () => {
      // Mock API key configured but invalid
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/api/btcpay/api-key') {
          return Promise.resolve({ data: { configured: true, key: 'configured' } });
        }
        if (url === '/api/btcpay/status') {
          return Promise.resolve({
            data: {
              connected: true,
              authenticated: false,
              error: 'API key is invalid',
            },
          });
        }
        if (url === '/api/config') {
          return Promise.resolve({
            data: { btcpayConfigured: false, quickbooksConfigured: false, setupComplete: false },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/BTCPayServer connection error/)).toBeInTheDocument();
        expect(screen.getByText('update API key')).toBeInTheDocument();
      });
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API Error'));

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Welcome to Sovereign Merchant')).toBeInTheDocument();
      });
    });
  });

  describe('Status Help', () => {
    beforeEach(() => {
      // Mock API key configured and connected
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/api/btcpay/api-key') {
          return Promise.resolve({ data: { configured: true, key: 'configured' } });
        }
        if (url === '/api/btcpay/status') {
          return Promise.resolve({
            data: {
              connected: true,
              authenticated: true,
              serverInfo: { version: '1.9.8', onion: 'btcpayserver.onion' },
            },
          });
        }
        if (url === '/api/config') {
          return Promise.resolve({
            data: { btcpayConfigured: true, quickbooksConfigured: false, setupComplete: true },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should toggle status help section', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Connected to BTCPayServer')).toBeInTheDocument();
      });

      const helpButton = screen.getByText('💡 What do these statuses mean?');

      // Help content should be visible initially
      expect(screen.getByText('BTCPay Server: ✅')).toBeInTheDocument();
      expect(screen.getByText('API Key: ✅')).toBeInTheDocument();

      // Click to hide
      fireEvent.click(helpButton);

      // Check that the button text changed
      expect(screen.getByText('🙈 Hide Status Help')).toBeInTheDocument();

      // Click again to show
      fireEvent.click(helpButton);
      expect(screen.getByText('💡 What do these statuses mean?')).toBeInTheDocument();
    });
  });
});
