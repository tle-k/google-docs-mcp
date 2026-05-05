#!/usr/bin/env node
import { FastMCP } from 'fastmcp';
import { initializeGoogleClient } from './clients.js';
import { registerAllTools } from './tools/index.js';
import { logger } from './logger.js';

process.on('uncaughtException', (error) => logger.error('Uncaught Exception:', error));
process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection:', reason));

const server = new FastMCP({
  name: 'Ultimate Google Docs Server',
  version: '1.0.0',
  authenticate: async (request: any) => {
    const url = new URL(request.url || '', `http://${request.headers?.host || 'localhost'}`);
    
    // Cloud Run health check bypass
    if (url.pathname === '/' || (url.pathname === '/mcp' && request.method === 'GET')) {
      return { identity: 'health-check' };
    }

    if (url.searchParams.get('key') !== process.env.MCP_SECRET_KEY) {
       throw new Error('Unauthorized');
    }
    return { identity: 'claude-bot' };
  }
});

registerAllTools(server);

try {
  await initializeGoogleClient();
  
  const port = parseInt(process.env.PORT || '8080');
  await server.start({
    transportType: 'httpStream',
    httpStream: { port, host: '0.0.0.0' },
  });
  logger.info(`Server successfully started on port ${port}`);
} catch (startError: any) {
  logger.error('FATAL: Startup failed:', startError);
  process.exit(1);
}
