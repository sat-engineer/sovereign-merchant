import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'path';
import { apiRoutes } from './api/routes';
import { initializeDatabase } from './models/database';

async function startServer() {
  const fastify = Fastify({
    logger: true,
  });

  // Register plugins
  await fastify.register(cors);

  // Serve static files from the web build (for development and production)
  await fastify.register(staticPlugin, {
    root: path.join(__dirname, '../../web/dist'),
    prefix: '/',
  });

  // Initialize database
  await initializeDatabase();

  // Register API routes
  await fastify.register(apiRoutes, { prefix: '/api' });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Start server
  const port = parseInt(process.env.PORT || '3000');
  const host = process.env.HOST || 'localhost';

  try {
    await fastify.listen({ port, host });
    console.log(`🚀 Sovereign Merchant server listening on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

startServer();
