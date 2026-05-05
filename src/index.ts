#!/usr/bin/env node
import { FastMCP } from 'fastmcp';
import {
  buildCachedToolsListPayload,
  collectToolsWhileRegistering,
  installCachedToolsListHandler,
} from './cachedToolsList.js';
import { initializeGoogleClient } from './clients.js';
import { registerAllTools } from './tools/index.js';
import { wrapServerForRemote } from './remoteWrapper.js';
import { registerLandingPage } from './landingPage.js';
import { registerDownloadRoute } from './downloadProxy.js';
import { logger } from './logger.js';

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

const server = new FastMCP({
  name: 'Google Docs & Sheets MCP Server',
  version: '1.0.0',
  authenticate: async (request: any) => {
    const url = new URL(request.url || '', `http://${request.headers?.host || 'localhost'}`);
    
    // ALLOW Health Checks so Cloud Run stays alive
    if (url.pathname === '/' || (url.pathname === '/mcp' && request.method === 'GET')) {
      return { identity: 'health-check' };
    }

    // BOUNCER: Block unauthorized access
    if (url.searchParams.get('key') !== process.env.MCP_SECRET_KEY) {
       logger.warn('Unauthorized access blocked.');
       throw new Error('Unauthorized');
    }
    return { identity: 'claude-bot' };
  }
});

const registeredTools: any[] = [];
collectToolsWhileRegistering(server, registeredTools);
if (isRemote) wrapServerForRemote(server);
registerAllTools(server);

try {
  await initializeGoogleClient();
  
  if (isRemote) {
    logger.info('Starting in remote mode...');
    registerLandingPage(server, registeredTools.length);
    registerDownloadRoute(server);

    const port = parseInt(process.env.PORT || '8080');
    await server.start({
      transportType: 'httpStream',
      httpStream: { port, host: '0.0.0.0' },
    });
    logger.info(`Server live on port ${port}`);
  } else {
    const cachedToolsList = await buildCachedToolsListPayload(registeredTools);
    await server.start({ transportType: 'stdio' });
    installCachedToolsListHandler(server, cachedToolsList);
  }
} catch (startError: any) {
  logger.error('FATAL: Startup failed:', startError.message || startError);
  process.exit(1);
}
