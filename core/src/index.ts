import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { apiRoutes } from './api/routes';
import { initializeDatabase } from './models/database';

async function startServer() {
  const fastify = Fastify({
    logger: true,
  });

  // Register plugins
  await fastify.register(cors);

  // Calculate the web dist path - use absolute path from working directory
  const webDistPath = path.join(process.cwd(), 'web/dist');
  console.log('🚀 Current working directory:', process.cwd());
  console.log('🚀 __dirname:', __dirname);
  console.log('🚀 Web dist path (from cwd):', webDistPath);
  console.log('🚀 Web dist exists:', fs.existsSync(webDistPath));
  console.log('🚀 Index.html exists:', fs.existsSync(path.join(webDistPath, 'index.html')));

  // Initialize database first
  await initializeDatabase();

  // Register API routes
  await fastify.register(apiRoutes, { prefix: '/api' });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Serve the React SPA for the root route
  fastify.get('/', async (request, reply) => {
    console.log('📄 Serving index.html for root route');
    return reply.sendFile('index.html', webDistPath);
  });

  // Serve static files from the web build (assets, etc.)
  await fastify.register(staticPlugin, {
    root: webDistPath,
    prefix: '/', // Serve all files from root, but API routes take precedence
  });

  // Catch-all route to serve the React SPA for any other routes (SPA routing)
  fastify.setNotFoundHandler(async (request, reply) => {
    // Only serve index.html for GET requests
    if (request.method === 'GET') {
      console.log(`📄 Serving index.html for SPA route: ${request.url}`);
      return reply.sendFile('index.html', webDistPath);
    }
    console.log(`❌ 404 for ${request.method}:${request.url}`);
    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
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
