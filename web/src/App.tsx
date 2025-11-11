import { useState, useEffect } from 'react';
import './App.css';
import axios from 'axios';

interface BTCPayStatus {
  connected: boolean;
  authenticated: boolean;
  serverInfo?: {
    version: string;
    onion?: string;
  };
  error?: string;
}

interface ConfigStatus {
  btcpayConfigured: boolean;
  quickbooksConfigured: boolean;
  setupComplete: boolean;
}

interface ApiKeyStatus {
  configured: boolean;
  key: string | null;
}

interface WebhookData {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

interface WebhookResponse {
  webhooks: WebhookData[];
}

interface SettledInvoice {
  id: string;
  invoiceId: string;
  storeId: string;
  settledAt: string;
  quickbooksStatus: 'pending' | 'sent_to_quickbooks';
  quickbooksTransactionId: string | null;
  amount: string | number;
  currency: string;
  customerInfo: string;
  quickbooksData: {
    amount: number;
    currency: string;
    date: string;
    description: string;
    customer: string;
  } | null;
}

interface SettledInvoicesResponse {
  invoices: SettledInvoice[];
  error?: string;
}

function App() {
  const [btcpayStatus, setBtcpayStatus] = useState<BTCPayStatus | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookData[]>([]);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [settledInvoices, setSettledInvoices] = useState<SettledInvoice[]>([]);
  const [settledInvoicesError, setSettledInvoicesError] = useState<string | null>(null);
  const [settledInvoicesLoading, setSettledInvoicesLoading] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    // Check API key status first
    const keyStatus = await checkApiKeyStatus();

    // Only check BTCPayServer if API key is configured
    if (keyStatus?.configured) {
      await checkBtcpayStatus();
      await checkConfigStatus();
      await fetchWebhooks();
      await fetchSettledInvoices();
    } else {
      // Set default states when no API key is configured
      setBtcpayStatus({ connected: false, authenticated: false });
      setConfigStatus({
        btcpayConfigured: false,
        quickbooksConfigured: false,
        setupComplete: false,
      });
      setWebhooks([]);
      setWebhookError(null);
      setSettledInvoices([]);
      setSettledInvoicesError(null);
    }

    setLoading(false);
  };

  const checkBtcpayStatus = async () => {
    try {
      const btcpayResponse = await axios.get('/api/btcpay/status');
      setBtcpayStatus(btcpayResponse.data);
    } catch (error) {
      console.error('Failed to check BTCPayServer status:', error);
      setBtcpayStatus({ connected: false, authenticated: false });
    }
  };

  const checkConfigStatus = async () => {
    try {
      const configResponse = await axios.get('/api/config');
      setConfigStatus(configResponse.data);
    } catch (error) {
      console.error('Failed to check config status:', error);
      setConfigStatus({
        btcpayConfigured: false,
        quickbooksConfigured: false,
        setupComplete: false,
      });
    }
  };

  const checkApiKeyStatus = async (): Promise<ApiKeyStatus | null> => {
    try {
      const response = await axios.get('/api/btcpay/api-key');
      setApiKeyStatus(response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to check API key status:', error);
      const defaultStatus = { configured: false, key: null };
      setApiKeyStatus(defaultStatus);
      return defaultStatus;
    }
  };

  const fetchWebhooks = async () => {
    setWebhookLoading(true);
    setWebhookError(null);
    try {
      const response = await axios.get<WebhookResponse>('/api/btcpay/webhooks');
      setWebhooks(response.data.webhooks);
    } catch (error) {
      console.error('Failed to fetch webhooks:', error);
      let errorMessage = 'Failed to fetch webhooks';

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          errorMessage = 'API key does not have permission to view webhooks. Please check your API key permissions.';
        } else if (error.response?.status === 401) {
          errorMessage = 'API key is invalid or expired.';
        } else if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        }
      }

      setWebhookError(errorMessage);
      setWebhooks([]);
    } finally {
      setWebhookLoading(false);
    }
  };

  const fetchSettledInvoices = async () => {
    setSettledInvoicesLoading(true);
    setSettledInvoicesError(null);
    try {
      const response = await axios.get<SettledInvoicesResponse>('/api/settled-invoices');
      setSettledInvoices(response.data.invoices);
    } catch (error) {
      console.error('Failed to fetch settled invoices:', error);
      let errorMessage = 'Failed to fetch settled invoices';

      if (axios.isAxiosError(error)) {
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        }
      }

      setSettledInvoicesError(errorMessage);
      setSettledInvoices([]);
    } finally {
      setSettledInvoicesLoading(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) {
      alert('Please enter a valid API key');
      return;
    }

    try {
      await axios.post('/api/btcpay/api-key', { apiKey: apiKeyInput.trim() });
      setApiKeyInput('');
      setShowApiKeyForm(false);
      setShowSuccessModal(true);
      // Refresh all statuses
      await initializeApp();
    } catch (error) {
      console.error('Failed to save API key:', error);
      alert('Failed to save API key. Check console for details.');
    }
  };


  return (
    <div className="App">
      <header className="App-header">
        <h1>⚡ Sovereign Merchant</h1>
        <p>A plug-and-play reconciliation bridge between BTCPayServer and QuickBooks</p>

        {/* Settings gear icon */}
        <div className="settings-header">
          <button
            onClick={() => setShowApiKeyForm(true)}
            className="settings-button"
            title="Settings"
            aria-label="Open settings to configure BTCPayServer API key"
          >
            ⚙️
          </button>
        </div>

        {/* Main content based on configuration state */}
        {!apiKeyStatus?.configured ? (
          /* Setup screen for new users */
          <div className="setup-screen">
            <div className="setup-card">
              <h2>Welcome to Sovereign Merchant</h2>
              <p>Connect your BTCPayServer to start automating your bookkeeping.</p>

              <div className="setup-steps">
                <div className="step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h3>Create BTCPayServer API Key</h3>
                    <p>Generate an API key in your BTCPayServer with the required permissions.</p>
                  </div>
                </div>

                <div className="step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h3>Enter API Key</h3>
                    <p>Paste your API key below to connect Sovereign Merchant.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowApiKeyForm(true)}
                className="primary-setup-button"
                aria-label="Start BTCPayServer setup process"
              >
                Set Up BTCPayServer Connection
              </button>
            </div>
          </div>
        ) : (
          /* Dashboard for configured users */
          <div className="dashboard">
            {/* Connection status indicator */}
            <div
              className={`connection-status ${btcpayStatus?.authenticated ? 'connected' : btcpayStatus?.connected ? 'error' : 'disconnected'}`}
            >
              {btcpayStatus?.authenticated ? (
                <div className="status-connected">
                  <span className="status-dot connected"></span>
                  Connected to BTCPayServer
                </div>
              ) : btcpayStatus?.connected ? (
                <div className="status-error">
                  <span className="status-dot error"></span>
                  BTCPayServer connection error -{' '}
                  <button onClick={() => setShowApiKeyForm(true)} className="link-button">
                    update API key
                  </button>
                </div>
              ) : (
                <div className="status-disconnected">
                  <span className="status-dot disconnected"></span>
                  Not connected to BTCPayServer
                </div>
              )}
            </div>

            <div className="dashboard-content">
              <div className="status-grid">
                <div className="status-card">
                  <h3>Setup Status</h3>
                  {configStatus ? (
                    <div>
                      <p
                        className={
                          configStatus.setupComplete && configStatus.quickbooksConfigured
                            ? 'status-good'
                            : btcpayStatus?.authenticated
                              ? 'status-warning'
                              : 'status-error'
                        }
                      >
                        {configStatus.setupComplete && configStatus.quickbooksConfigured
                          ? '✅ Fully Configured'
                          : btcpayStatus?.authenticated
                            ? '⚠️ Authenticated with BTCPayServer, connect QuickBooks'
                            : !apiKeyStatus?.configured
                              ? '❌ Set up BTCPayServer connection'
                              : btcpayStatus?.connected
                                ? '❌ Update BTCPayServer API key'
                                : '❌ BTCPayServer connection issue'}
                      </p>
                      <small>
                        BTCPay Server: {btcpayStatus?.connected ? '✅' : '❌'} | API Key:{' '}
                        {btcpayStatus?.authenticated ? '✅' : '❌'} | QuickBooks:{' '}
                        {configStatus.quickbooksConfigured ? '✅' : '❌'}
                      </small>
                    </div>
                  ) : (
                    <p>Loading...</p>
                  )}
                </div>

                <div className="status-card">
                  <h3>
                    Webhooks
                    <button
                      onClick={fetchWebhooks}
                      disabled={webhookLoading}
                      className="refresh-webhooks-btn"
                      title="Refresh webhooks"
                      aria-label="Refresh webhook list"
                    >
                      🔄
                    </button>
                  </h3>
                  {webhookLoading ? (
                    <p>Loading webhooks...</p>
                  ) : webhookError ? (
                    <div className="webhook-error">
                      <p className="status-error">❌ {webhookError}</p>
                    </div>
                  ) : webhooks.length === 0 ? (
                    <p>No webhooks configured yet.</p>
                  ) : (
                    <div className="webhook-list">
                      {webhooks.map((webhook) => (
                        <div key={webhook.id} className="webhook-item">
                          <div className="webhook-header">
                            <span className={`webhook-status ${webhook.active ? 'active' : 'inactive'}`}>
                              {webhook.active ? '🟢' : '🔴'}
                            </span>
                            <strong>{webhook.url}</strong>
                          </div>
                          <div className="webhook-events">
                            Events: {webhook.events.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="status-card">
                  <h3>
                    Settled Invoices
                    <button
                      onClick={fetchSettledInvoices}
                      disabled={settledInvoicesLoading}
                      className="refresh-webhooks-btn"
                      title="Refresh settled invoices"
                      aria-label="Refresh settled invoices list"
                    >
                      🔄
                    </button>
                  </h3>
                  {settledInvoicesLoading ? (
                    <p>Loading settled invoices...</p>
                  ) : settledInvoicesError ? (
                    <div className="webhook-error">
                      <p className="status-error">❌ {settledInvoicesError}</p>
                    </div>
                  ) : settledInvoices.length === 0 ? (
                    <p>No settled invoices yet.</p>
                  ) : (
                    <div className="settled-invoices-list">
                      {settledInvoices.map((invoice) => (
                        <div key={invoice.id} className="invoice-item">
                          <div className="invoice-header">
                            <span className={`invoice-status ${invoice.quickbooksStatus === 'sent_to_quickbooks' ? 'sent' : 'pending'}`}>
                              {invoice.quickbooksStatus === 'sent_to_quickbooks' ? '✅' : '⏳'}
                            </span>
                            <strong>{invoice.invoiceId}</strong>
                            <span className="invoice-amount">
                              {typeof invoice.amount === 'number' ? `$${invoice.amount.toFixed(2)}` : invoice.amount} {invoice.currency}
                            </span>
                          </div>
                          <div className="invoice-details">
                            <div className="invoice-info">
                              <span>Customer: {invoice.customerInfo}</span>
                              <span>Settled: {new Date(invoice.settledAt).toLocaleString()}</span>
                            </div>
                            {invoice.quickbooksData && (
                              <div className="quickbooks-preview">
                                <h5>📊 QuickBooks Data:</h5>
                                <div className="qb-data">
                                  <span>Amount: ${invoice.quickbooksData.amount.toFixed(2)}</span>
                                  <span>Date: {invoice.quickbooksData.date}</span>
                                  <span>Description: {invoice.quickbooksData.description}</span>
                                  <span>Customer: {invoice.quickbooksData.customer}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Status Help Section */}
              <div className="status-help">
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  className="help-toggle"
                  aria-label={
                    showHelp
                      ? 'Hide status explanations'
                      : 'Show explanations for status indicators'
                  }
                  aria-expanded={showHelp}
                >
                  {showHelp ? '🙈 Hide Status Help' : '💡 What do these statuses mean?'}
                </button>

                <div className={`help-content ${showHelp ? 'show' : ''}`}>
                  <div className="help-inner">
                    <div className="help-item">
                      <div className="help-label">
                        <span className="status-dot connected"></span>
                        <strong>BTCPay Server: ✅</strong>
                      </div>
                      <p>BTCPayServer is reachable and responding to network requests.</p>
                    </div>

                    <div className="help-item">
                      <div className="help-label">
                        <span className="status-dot error"></span>
                        <strong>BTCPay Server: ❌</strong>
                      </div>
                      <p>
                        BTCPayServer is not reachable. Check network connection, firewall, or
                        BTCPayServer status.
                      </p>
                    </div>

                    <div className="help-item">
                      <div className="help-label">
                        <span className="status-dot connected"></span>
                        <strong>API Key: ✅</strong>
                      </div>
                      <p>Your API key is valid and can access BTCPayServer data.</p>
                    </div>

                    <div className="help-item">
                      <div className="help-label">
                        <span className="status-dot error"></span>
                        <strong>API Key: ❌</strong>
                      </div>
                      <p>
                        API key is invalid, expired, or missing. Click settings (⚙️) to update your
                        API key.
                      </p>
                    </div>

                    <div className="help-item">
                      <div className="help-label">
                        <span className="status-dot disconnected"></span>
                        <strong>API Key: ❌</strong>
                      </div>
                      <p>
                        No API key configured yet. Click "Set Up BTCPayServer Connection" to get
                        started.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="actions">
                <button
                  onClick={initializeApp}
                  disabled={loading}
                  aria-label="Refresh status of all connections and services"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </div>
        )}

        {showApiKeyForm && (
          <div className="modal-overlay">
            <div className="modal">
              <h3>BTCPayServer Settings</h3>
              <div className="modal-content">
                <p>
                  To connect Sovereign Merchant to your BTCPayServer, you need to create an API key
                  with the following permissions:
                </p>
                <ul className="permissions-list">
                  <li>
                    Modify stores webhooks
                    <div className="permission-code">
                      <strong>btcpay.store.webhooks.canmodifywebhooks</strong>
                    </div>
                  </li>
                  <li>
                    View invoices
                    <div className="permission-code">
                      <strong>btcpay.store.canviewinvoices</strong>
                    </div>
                  </li>
                </ul>

                <div className="instructions">
                  <h4>How to create an API key:</h4>
                  <ol>
                    <li>Open BTCPayServer → API Keys</li>
                    <li>Click "Generate Key"</li>
                    <li>Select the permissions above</li>
                    <li>Copy the generated key</li>
                  </ol>
                </div>

                <div className="form-group">
                  <label htmlFor="apiKey">API Key:</label>
                  <input
                    type="password"
                    id="apiKey"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Enter your BTCPayServer API key"
                    autoComplete="off"
                    aria-label="BTCPayServer API key input"
                    aria-describedby="api-key-description"
                  />
                  <div id="api-key-description" className="sr-only">
                    Enter the API key you generated from your BTCPayServer settings. This key will
                    be securely stored and encrypted.
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    onClick={() => {
                      setShowApiKeyForm(false);
                      setApiKeyInput('');
                    }}
                    aria-label="Cancel API key configuration and close modal"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveApiKey}
                    className="primary"
                    aria-label="Save and validate the entered BTCPayServer API key"
                  >
                    Save API Key
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showSuccessModal && (
          <div className="modal-overlay">
            <div className="modal success-modal">
              <h3>✅ Success!</h3>
              <div className="modal-content">
                <p>BTCPayServer API key saved successfully!</p>
                <div className="modal-actions">
                  <button onClick={() => setShowSuccessModal(false)} className="primary">
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
