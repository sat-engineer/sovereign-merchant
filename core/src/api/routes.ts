import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { btcpayClient, WebhookStatus } from '../services/btcpay';
import { getDatabase } from '../models/database';

interface BTCPayWebhookPayload {
  type?: string;
  invoiceId?: string;
  storeId?: string;
  [key: string]: unknown;
}

// Health and status routes
const statusRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/status', async () => {
    return {
      status: 'ok',
      message: 'Sovereign Merchant API is running',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/config', async () => {
    const btcpayConnected = await btcpayClient.isConnected();

    return {
      btcpayConfigured: btcpayConnected,
      quickbooksConfigured: false, // TODO: Implement QuickBooks connection check
      setupComplete: btcpayConnected, // For now, just require BTCPay connection
    };
  });
};

// BTCPayServer management routes
const btcpayRoutes: FastifyPluginAsync = async (fastify) => {
  // Connection status
  fastify.get('/status', async () => {
    const isConnected = await btcpayClient.isConnected();
    const isAuthenticated = await btcpayClient.isAuthenticated();

    if (isConnected && isAuthenticated) {
      try {
        const serverInfo = await btcpayClient.getServerInfo();
        const serverInfoData = serverInfo as { version?: string; onion?: string };
        return {
          connected: true,
          authenticated: true,
          serverInfo: {
            version: serverInfoData.version,
            onion: serverInfoData.onion,
          },
        };
      } catch (error) {
        return {
          connected: true,
          authenticated: false,
          serverInfo: null,
          error: 'Connected but unable to get server info (API key may be invalid)',
        };
      }
    } else if (isConnected && !isAuthenticated) {
      return {
        connected: true,
        authenticated: false,
        serverInfo: null,
        error: 'Connected but API key is invalid',
      };
    }

    return {
      connected: false,
      authenticated: false,
      error: 'BTCPayServer not accessible',
    };
  });

  // API Key management
  fastify.get('/api-key', async () => {
    // Check if API key exists (don't return the actual key for security)
    const apiKey = await btcpayClient.getApiKey();
    return {
      configured: !!apiKey,
      key: apiKey ? 'configured' : null, // Mask the actual key
    };
  });

  fastify.post('/api-key', async (request, reply) => {
    const { apiKey } = request.body as { apiKey: string };

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return reply.code(400).send({
        error: 'Valid API key is required',
      });
    }

    try {
      await btcpayClient.setApiKey(apiKey.trim());
      return reply.code(200).send({
        success: true,
        message: 'BTCPayServer API key saved successfully',
      });
    } catch (error) {
      console.error('Failed to save API key:', error);
      return reply.code(500).send({
        error: 'Failed to save API key',
      });
    }
  });

  // Webhook management
  fastify.post('/webhook/register', async (request, reply) => {
    const baseUrl =
      process.env.APP_HIDDEN_SERVICE || `http://localhost:${process.env.PORT || 3000}`;
    const webhookUrl = `${baseUrl}/api/webhooks/btcpay`;

    const webhook = await btcpayClient.registerWebhook(webhookUrl);

    if (webhook) {
      reply.code(200).send({
        success: true,
        webhook: webhook,
      });
    } else {
      reply.code(500).send({
        success: false,
        error: 'Failed to register webhook',
      });
    }
  });

  fastify.get('/webhooks', async () => {
    const webhooks = await btcpayClient.getWebhooks();
    return {
      webhooks: webhooks,
    };
  });

  // Automatic webhook establishment
  fastify.post('/webhooks/establish', async (request, reply) => {
    try {
      console.log('🔄 Starting automatic webhook establishment via API');

      const status: WebhookStatus = await btcpayClient.ensureWebhooksEstablished();

      if (status.setupComplete) {
        console.log('✅ Webhook establishment completed successfully');
        return reply.code(200).send({
          success: true,
          message: 'Webhooks established successfully',
          status: status,
        });
      } else if (status.errors.length > 0) {
        console.error('❌ Webhook establishment failed with errors:', status.errors);
        return reply.code(500).send({
          success: false,
          message: 'Failed to establish webhooks',
          status: status,
          userMessage: status.errors.join('; '),
        });
      } else {
        // Setup not complete but no errors - this shouldn't happen but handle gracefully
        console.warn('⚠️  Webhook setup incomplete but no errors reported');
        return reply.code(200).send({
          success: false,
          message: 'Webhook setup incomplete',
          status: status,
          userMessage: `Missing ${status.missingEvents.length} webhook events. Please try again or check BTCPayServer configuration.`,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Unexpected error during webhook establishment:', errorMessage);
      return reply.code(500).send({
        success: false,
        message: 'Unexpected error during webhook establishment',
        userMessage: 'An unexpected error occurred. Please check the server logs for details.',
      });
    }
  });

  // Sync existing webhook secrets
  fastify.post('/webhooks/sync-secrets', async (request, reply) => {
    try {
      console.log('🔄 Syncing webhook secrets...');
      await btcpayClient.syncExistingWebhookSecrets();
      console.log('✅ Webhook secrets synced successfully');

      return reply.code(200).send({
        success: true,
        message: 'Webhook secrets synced successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to sync webhook secrets:', errorMessage);
      return reply.code(500).send({
        success: false,
        message: 'Failed to sync webhook secrets',
        userMessage: 'Unable to sync webhook secrets. Please try again.',
      });
    }
  });

  // Get webhook status
  fastify.get('/webhooks/status', async (request, reply) => {
    try {
      const { webhookUrl } = request.query as { webhookUrl?: string };
      const targetUrl = webhookUrl || btcpayClient.buildWebhookUrl();

      if (!targetUrl) {
        return reply.code(500).send({
          success: false,
          message: 'No webhook URL available',
          userMessage: 'Cannot check webhook status - no webhook URL configured.',
        });
      }

      console.log(`📊 Checking webhook status for URL: ${targetUrl}`);

      const status: WebhookStatus = await btcpayClient.getWebhookStatus(targetUrl);

      return reply.code(200).send({
        success: true,
        status: status,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to get webhook status:', errorMessage);
      return reply.code(500).send({
        success: false,
        message: 'Failed to get webhook status',
        userMessage: 'Unable to check webhook status. Please try again.',
      });
    }
  });

  // Manual webhook management
  fastify.delete('/webhooks/:webhookId', async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };

    try {
      console.log(`🗑️  Deleting webhook via API: ${webhookId}`);

      const success = await btcpayClient.deleteWebhook(webhookId);

      if (success) {
        return reply.code(200).send({
          success: true,
          message: 'Webhook deleted successfully',
        });
      } else {
        return reply.code(500).send({
          success: false,
          message: 'Failed to delete webhook',
          userMessage: 'Unable to delete the webhook. Please check BTCPayServer configuration.',
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to delete webhook ${webhookId}:`, errorMessage);
      return reply.code(500).send({
        success: false,
        message: 'Unexpected error deleting webhook',
        userMessage: 'An unexpected error occurred while deleting the webhook.',
      });
    }
  });
};

// Webhook processing routes
const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Disable JSON parsing for webhook endpoint to access raw body
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function (req, body, done) {
      done(null, body);
    }
  );

  fastify.post('/btcpay', async (request, reply) => {
    console.log(`🔥 WEBHOOK RECEIVED: ${request.method} ${request.url}`);

    // Log only safe headers (exclude sensitive ones)
    const safeHeaders = { ...request.headers };
    delete safeHeaders.authorization;
    delete safeHeaders.cookie;
    delete safeHeaders['x-api-key'];
    delete safeHeaders['btcpay-sig']; // Signature is safe but we'll log it separately
    console.log(`🔥 Safe headers:`, JSON.stringify(safeHeaders, null, 2));
    if (request.headers['btcpay-sig']) {
      const sig = Array.isArray(request.headers['btcpay-sig'])
        ? request.headers['btcpay-sig'][0]
        : request.headers['btcpay-sig'];
      console.log(`🔥 BTCPay signature present: ${sig!.substring(0, 20)}...`);
    }

    const rawBody = request.body as string;
    // Don't log raw body for security - only log parsed payload later

    // Validate BTCPayServer webhook signature
    const signature = request.headers['btcpay-sig'] as string;
    if (!signature) {
      console.error('❌ Missing BTCPay-Sig header');
      return reply.code(400).send({
        error: 'Missing BTCPay-Sig header',
      });
    }

    // Get the webhook secret from our database
    const db = getDatabase();
    let webhookSecret: string | null = null;

    try {
      // Find the webhook secret from our stored configurations
      const allConfigs = db
        .prepare('SELECT id, secret, active FROM webhook_configs')
        .all() as Array<{ id: string; secret: string; active: number }>;
      console.log(
        '🔍 Available webhook configs in database:',
        allConfigs.map((c) => ({ id: c.id, hasSecret: !!c.secret, active: c.active }))
      );

      const configResult = db
        .prepare('SELECT id, secret FROM webhook_configs WHERE active = 1 LIMIT 1')
        .get() as { id: string; secret: string } | undefined;
      if (configResult) {
        webhookSecret = configResult.secret;
        console.log(
          `✅ Found active webhook config: ${configResult.id}, has secret: ${!!webhookSecret}`
        );
      } else {
        console.log('❌ No active webhook configs found');
      }
    } catch (error) {
      console.error('Failed to get webhook secret from database:', error);
    }

    if (!webhookSecret) {
      console.error('❌ No webhook secret found in database');
      return reply.code(500).send({
        error: 'Webhook secret not configured',
      });
    }

    // Validate the signature
    const expectedSignature = `sha256=${crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      console.error('❌ Invalid webhook signature');
      console.error('Expected:', expectedSignature.substring(0, 20) + '...');
      console.error('Received:', signature.substring(0, 20) + '...');
      return reply.code(401).send({
        error: 'Invalid signature',
      });
    }

    console.log('✅ Webhook signature validated');

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error('❌ Failed to parse webhook payload as JSON:', error);
      return reply.code(400).send({
        error: 'Invalid JSON payload',
      });
    }

    console.log(`🔥 Parsed payload:`, JSON.stringify(payload, null, 2));

    // Basic validation - check if it's a valid webhook payload
    if (!payload || typeof payload !== 'object') {
      console.error('❌ Invalid webhook payload - not an object');
      return reply.code(400).send({
        error: 'Invalid webhook payload',
      });
    }

    const webhookPayload = payload as BTCPayWebhookPayload;
    console.log(
      `📨 Processing BTCPay webhook: ${webhookPayload.type} for invoice ${webhookPayload.invoiceId}`
    );

    try {
      const db = getDatabase();

      // Generate a unique ID for this webhook event
      const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Store the webhook event in database
      const insertStmt = db.prepare(`
        INSERT INTO webhook_events (id, event_type, invoice_id, store_id, payload)
        VALUES (?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        webhookId,
        webhookPayload.type || 'unknown',
        webhookPayload.invoiceId || null,
        webhookPayload.storeId || null,
        JSON.stringify(payload)
      );

      console.log(
        `✅ Stored BTCPay webhook event: ${webhookId} (${webhookPayload.type}) for invoice ${webhookPayload.invoiceId}`
      );

      reply.code(200).send({
        received: true,
        eventType: webhookPayload.type || 'unknown',
        invoiceId: webhookPayload.invoiceId || null,
        stored: true,
        webhookId: webhookId,
      });
    } catch (error) {
      console.error('❌ Failed to store webhook event:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      reply.code(500).send({
        error: 'Failed to process webhook',
        details: errorMessage,
      });
    }
  });
};

// Main API routes - register all route groups
export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(statusRoutes);

  // Get recent webhook events (must be registered before btcpayRoutes to avoid path conflict)
  fastify.get('/webhook-events', async () => {
    try {
      const db = getDatabase();
      const events = db
        .prepare(
          `
        SELECT id, event_type, invoice_id, store_id, processed, created_at
        FROM webhook_events
        ORDER BY created_at DESC
        LIMIT 50
      `
        )
        .all();

      return {
        events: events,
      };
    } catch (error) {
      console.error('Failed to fetch webhook events:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        events: [],
        error: errorMessage,
      };
    }
  });

  await fastify.register(btcpayRoutes, { prefix: '/btcpay' });
  await fastify.register(webhookRoutes, { prefix: '/webhooks' });

  // Get settled invoices (InvoiceSettled events)
  fastify.get('/settled-invoices', async () => {
    try {
      const db = getDatabase();
      const settledInvoices = db
        .prepare(
          `
        SELECT
          we.id,
          we.invoice_id,
          we.store_id,
          we.payload,
          we.created_at as settled_at,
          CASE WHEN r.id IS NOT NULL THEN 'sent_to_quickbooks' ELSE 'pending' END as quickbooks_status,
          r.quickbooks_transaction_id
        FROM webhook_events we
        LEFT JOIN reconciliations r ON we.invoice_id = r.btcpay_invoice_id
        WHERE we.event_type = 'InvoiceSettled'
        ORDER BY we.created_at DESC
        LIMIT 100
      `
        )
        .all();

      // Database row interface
      interface SettledInvoiceRow {
        id: number;
        invoice_id: string;
        store_id: string;
        payload: string;
        settled_at: string;
        quickbooks_status: 'sent_to_quickbooks' | 'pending';
        quickbooks_transaction_id: string | null;
      }

      // Parse the payload to extract relevant invoice info
      const formattedInvoices = (settledInvoices as SettledInvoiceRow[]).map((invoice) => {
        try {
          const payload = JSON.parse(invoice.payload);

          // Extract relevant info from the webhook payload
          // Note: The exact structure depends on BTCPayServer's webhook format
          return {
            id: invoice.id,
            invoiceId: invoice.invoice_id,
            storeId: invoice.store_id,
            settledAt: invoice.settled_at,
            quickbooksStatus: invoice.quickbooks_status,
            quickbooksTransactionId: invoice.quickbooks_transaction_id,
            // Extract what we can from the payload - may need to adjust based on actual BTCPay webhook format
            amount: payload?.metadata?.amount || 'Unknown',
            currency: payload?.metadata?.currency || 'Unknown',
            customerInfo: payload?.metadata?.buyerEmail || 'Unknown',
            // This would be what we send to QuickBooks
            quickbooksData: {
              amount: payload?.metadata?.amount || 0,
              currency: payload?.metadata?.currency || 'USD',
              date: new Date(invoice.settled_at).toISOString().split('T')[0],
              description: `BTCPayServer Invoice ${invoice.invoice_id}`,
              customer: payload?.metadata?.buyerEmail || 'Unknown Customer',
            },
          };
        } catch (error) {
          console.warn(`Failed to parse webhook payload for invoice ${invoice.invoice_id}:`, error);
          return {
            id: invoice.id,
            invoiceId: invoice.invoice_id,
            storeId: invoice.store_id,
            settledAt: invoice.settled_at,
            quickbooksStatus: invoice.quickbooks_status,
            quickbooksTransactionId: invoice.quickbooks_transaction_id,
            amount: 'Parse Error',
            currency: 'Unknown',
            customerInfo: 'Parse Error',
            quickbooksData: null,
          };
        }
      });

      return {
        invoices: formattedInvoices,
      };
    } catch (error) {
      console.error('Failed to fetch settled invoices:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        invoices: [],
        error: errorMessage,
      };
    }
  });
};
