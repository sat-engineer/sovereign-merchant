import { FastifyPluginAsync } from 'fastify';

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  // Basic API routes will go here

  fastify.get('/status', async () => {
    return {
      status: 'ok',
      message: 'Sovereign Merchant API is running',
      timestamp: new Date().toISOString(),
    };
  });

  // Configuration routes will go here
  fastify.get('/config', async () => {
    return {
      btcpayConfigured: false,
      quickbooksConfigured: false,
      setupComplete: false,
    };
  });

  // Webhook routes for BTCPayServer will go here
  fastify.post('/webhooks/btcpay', async (request, reply) => {
    // TODO: Process BTCPay webhooks
    reply.code(200).send({ received: true });
  });
};
