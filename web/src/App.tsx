import { useState, useEffect } from 'react';
import './App.css';
import axios from 'axios';
import { useWebhookManagement } from './hooks/useWebhookManagement';

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

interface WebhookEvent {
  id: string;
  event_type: string;
  invoice_id: string | null;
  store_id: string | null;
  processed: number;
  created_at: string;
}

interface WebhookEventsResponse {
  events: WebhookEvent[];
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
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [webhookEventsError, setWebhookEventsError] = useState<string | null>(null);
  const [webhookEventsLoading, setWebhookEventsLoading] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('BTCPayServer API key saved successfully!');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  // Success modal callback function
  const showSuccessModalWithMessage = (message: string) => {
    setSuccessMessage(message);
    setShowSuccessModal(true);
  };

  // Webhook management hook
  const {
    webhookStatus,
    webhookStatusLoading,
    webhookEstablishError,
    establishWebhooks,
    establishWebhooksWithFeedback,
    checkWebhookStatus,
    clearWebhookStatus,
  } = useWebhookManagement({ showSuccessModal: showSuccessModalWithMessage });

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
      await checkWebhookStatus();
      await fetchSettledInvoices();
      await fetchWebhookEvents();

      // Automatically establish webhooks if BTCPayServer is available and authenticated
      // Use the status we already fetched in checkBtcpayStatus
      if (btcpayStatus?.authenticated && !webhookStatus?.setupComplete) {
        const result = await establishWebhooks();
        if (result.success) {
          // Immediately refresh webhook status to update UI
          await checkWebhookStatus();
        }
      }
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
          errorMessage =
            'API key does not have permission to view webhooks. Please check your API key permissions.';
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

  const fetchWebhookEvents = async () => {
    setWebhookEventsLoading(true);
    setWebhookEventsError(null);
    try {
      const response = await axios.get<WebhookEventsResponse>('/api/webhook-events');
      setWebhookEvents(response.data.events || []);
    } catch (error) {
      console.error('Failed to fetch webhook events:', error);
      let errorMessage = 'Failed to fetch webhook events';
      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.error || errorMessage;
      }
      setWebhookEventsError(errorMessage);
    } finally {
      setWebhookEventsLoading(false);
    }
  };

  const saveBtcpayApiKey = async () => {
    if (!apiKeyInput.trim()) {
      alert('Please enter a valid API key');
      return;
    }

    try {
      await axios.post('/api/btcpay/api-key', { apiKey: apiKeyInput.trim() });
      setApiKeyInput('');
      setShowApiKeyForm(false);
      showSuccessModalWithMessage('BTCPayServer API key saved successfully!');

      // Clear webhook status since API key changed (old webhooks are invalid)
      clearWebhookStatus();

      // Refresh all statuses and automatically establish webhooks
      await initializeApp();
      // Automatically establish webhooks after API key is set
      await establishWebhooksWithFeedback();
      // Refresh webhook status one final time to ensure UI is up-to-date
      await checkWebhookStatus();
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
                          configStatus.setupComplete &&
                          configStatus.quickbooksConfigured &&
                          webhookStatus?.setupComplete
                            ? 'status-good'
                            : btcpayStatus?.authenticated && webhookStatus?.setupComplete
                              ? 'status-warning'
                              : btcpayStatus?.authenticated
                                ? 'status-error'
                                : 'status-error'
                        }
                      >
                        {configStatus.setupComplete &&
                        configStatus.quickbooksConfigured &&
                        webhookStatus?.setupComplete
                          ? '✅ Fully Configured'
                          : btcpayStatus?.authenticated && webhookStatus?.setupComplete
                            ? '⚠️ Authenticated with BTCPayServer, connect QuickBooks'
                            : btcpayStatus?.authenticated &&
                                webhookStatus?.errors?.some(
                                  (error) =>
                                    error.includes('permission') || error.includes('view stores')
                                )
                              ? '❌ API key missing required permissions'
                              : btcpayStatus?.authenticated
                                ? '❌ Webhooks not configured'
                                : !apiKeyStatus?.configured
                                  ? '❌ Set up BTCPayServer connection'
                                  : btcpayStatus?.connected
                                    ? '❌ Update BTCPayServer API key'
                                    : '❌ BTCPayServer connection issue'}
                      </p>
                      <small>
                        BTCPay Server: {btcpayStatus?.connected ? '✅' : '❌'} | API Key:{' '}
                        {btcpayStatus?.authenticated ? '✅' : '❌'} | Webhooks:{' '}
                        {webhookStatus?.setupComplete ? '✅' : webhookStatus ? '❌' : '?'} |
                        QuickBooks: {configStatus.quickbooksConfigured ? '✅' : '❌'}
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
                      onClick={async () => {
                        await fetchWebhooks();
                        await checkWebhookStatus();
                      }}
                      disabled={webhookLoading || webhookStatusLoading}
                      className="refresh-webhooks-btn"
                      title="Refresh webhooks"
                      aria-label="Refresh webhook list"
                    >
                      🔄
                    </button>
                  </h3>

                  {/* Webhook Status */}
                  {webhookStatusLoading ? (
                    <p>Loading webhook status...</p>
                  ) : webhookStatus ? (
                    <div className="webhook-status-info">
                      <p className={webhookStatus.setupComplete ? 'status-good' : 'status-warning'}>
                        {webhookStatus.setupComplete ? '✅' : '⚠️'} Webhook Setup:{' '}
                        {webhookStatus.setupComplete ? 'Complete' : 'Incomplete'}
                      </p>
                      <small>
                        Events:{' '}
                        {webhookStatus.requiredEvents.length - webhookStatus.missingEvents.length}/
                        {webhookStatus.requiredEvents.length} configured
                        {webhookStatus.missingEvents.length > 0 && (
                          <span className="status-error">
                            {' '}
                            ({webhookStatus.missingEvents.length} missing)
                          </span>
                        )}
                      </small>

                      {webhookStatus.errors.length > 0 && (
                        <div className="webhook-errors">
                          <small className="status-error">
                            Errors: {webhookStatus.errors.join('; ')}
                          </small>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="status-warning">⚠️ Unable to check webhook status</p>
                  )}

                  {/* Permission Error Warning */}
                  {btcpayStatus?.authenticated &&
                    webhookStatus?.errors?.some(
                      (error) =>
                        error.includes('permission') ||
                        error.includes('view stores') ||
                        error.includes('store')
                    ) && (
                      <div className="permission-warning">
                        <p className="status-error">⚠️ API Key Missing Required Permissions</p>
                        <small>
                          Your API key needs <code>btcpay.store.canviewstoresettings</code>{' '}
                          permission to access stores.
                          <br />
                          Please update your API key in BTCPayServer settings with all required
                          permissions.
                          <button
                            onClick={() => setShowApiKeyForm(true)}
                            className="link-button"
                            style={{ marginLeft: '8px' }}
                          >
                            Update API Key
                          </button>
                        </small>
                      </div>
                    )}

                  {/* Automatic Webhook Status */}
                  {webhookEstablishError && btcpayStatus?.authenticated && (
                    <div className="webhook-establish-error">
                      <p className="status-error">
                        ❌ Webhook setup failed: {webhookEstablishError}
                      </p>
                    </div>
                  )}

                  {/* Webhook List */}
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
                            <span
                              className={`webhook-status ${webhook.active ? 'active' : 'inactive'}`}
                            >
                              {webhook.active ? '🟢' : '🔴'}
                            </span>
                            <strong>{webhook.url}</strong>
                          </div>
                          <div className="webhook-events">Events: {webhook.events.join(', ')}</div>
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
                            <span
                              className={`invoice-status ${invoice.quickbooksStatus === 'sent_to_quickbooks' ? 'sent' : 'pending'}`}
                            >
                              {invoice.quickbooksStatus === 'sent_to_quickbooks' ? '✅' : '⏳'}
                            </span>
                            <strong>{invoice.invoiceId}</strong>
                            <span className="invoice-amount">
                              {typeof invoice.amount === 'number'
                                ? `$${invoice.amount.toFixed(2)}`
                                : invoice.amount}{' '}
                              {invoice.currency}
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

                {/* Webhook Events */}
                <div className="status-card">
                  <h3>
                    Recent Webhook Events
                    <button
                      onClick={fetchWebhookEvents}
                      disabled={webhookEventsLoading}
                      className="refresh-webhooks-btn"
                      title="Refresh webhook events"
                      aria-label="Refresh webhook events list"
                    >
                      🔄
                    </button>
                  </h3>
                  {webhookEventsLoading ? (
                    <p>Loading webhook events...</p>
                  ) : webhookEventsError ? (
                    <div className="webhook-error">
                      <p className="status-error">❌ {webhookEventsError}</p>
                    </div>
                  ) : webhookEvents.length === 0 ? (
                    <p>
                      No webhook events received yet. Try sending a test webhook from BTCPayServer.
                    </p>
                  ) : (
                    <div className="webhook-events-list">
                      {webhookEvents.slice(0, 10).map((event) => (
                        <div key={event.id} className="webhook-event-item">
                          <div className="webhook-event-header">
                            <span
                              className={`webhook-event-type ${event.event_type.toLowerCase()}`}
                            >
                              {event.event_type}
                            </span>
                            <span className="webhook-event-time">
                              {new Date(event.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="webhook-event-details">
                            <span>Invoice: {event.invoice_id || 'N/A'}</span>
                            <span>Store: {event.store_id || 'N/A'}</span>
                            <span>Processed: {event.processed ? '✅' : '⏳'}</span>
                          </div>
                        </div>
                      ))}
                      {webhookEvents.length > 10 && (
                        <p className="webhook-more-indicator">
                          ... and {webhookEvents.length - 10} more events
                        </p>
                      )}
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
                    View your stores
                    <div className="permission-code">
                      <strong>btcpay.store.canviewstoresettings</strong>
                    </div>
                  </li>
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
                  <p>
                    <strong>Option 1 (Recommended):</strong> Create an API key with "Unrestricted
                    access" for full functionality.
                  </p>
                  <p>
                    <strong>Option 2 (Minimal):</strong> Create an API key with these specific
                    permissions:
                  </p>
                  <ol>
                    <li>Open BTCPayServer → API Keys</li>
                    <li>Click "Generate Key"</li>
                    <li>Select all permissions listed above, or choose "Unrestricted access"</li>
                    <li>Copy the generated key</li>
                  </ol>
                  <div className="warning-box">
                    <strong>⚠️ Important:</strong> Without proper permissions, Sovereign Merchant
                    cannot access your stores or create webhooks.
                  </div>
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
                    onClick={saveBtcpayApiKey}
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
                <p>{successMessage}</p>
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
