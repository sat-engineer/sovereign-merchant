import { FastifyPluginAsync } from 'fastify';
import { btcpayClient } from '../services/btcpay';
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
};

// Webhook processing routes
const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/btcpay', async (request, reply) => {
    const payload = request.body as unknown;

    // Basic validation - check if it's a valid webhook payload
    if (!payload || typeof payload !== 'object') {
      return reply.code(400).send({
        error: 'Invalid webhook payload',
      });
    }

    const webhookPayload = payload as BTCPayWebhookPayload;

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

      console.log(`✅ Stored BTCPay webhook event: ${webhookId} (${webhookPayload.type})`);

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

  // Get recent webhook events
  fastify.get('/btcpay', async () => {
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
};

// Main API routes - register all route groups
export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(statusRoutes);
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
              customer: payload?.metadata?.buyerEmail || 'Unknown Customer'
            }
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
            quickbooksData: null
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
