#!/usr/bin/env node
import { FastMCP } from 'fastmcp';
import * as fs from 'fs';
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

// --- Process Management ---
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

// --- 1. Service Account Sandbox Setup ---
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  try {
    // Write credentials to Cloud Run's temporary file system
    fs.writeFileSync('/tmp/service-account.json', process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/service-account.json';
    logger.info('Service Account JSON configured in sandbox.');
  } catch (err) {
    logger.error('Failed to write sandbox credentials:', err);
  }
} else if (isRemote) {
  // Only check for OAuth variables if we ARE NOT using a Service Account
  const missing = ['BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    logger.error(`FATAL: Missing OAuth env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// --- 2. Initialize Server with URL Bouncer ---
const server = new FastMCP({
  name: 'Ultimate Google Docs & Sheets MCP Server',
  version: '1.0.0',
  authenticate: async (request: any) => {
    const url = new URL(request.url || '', `http://${request.headers?.host || 'localhost'}`);
    
    // ALLOW HEALTH CHECKS: Google Cloud Run needs this to know the server is alive
    if (url.pathname === '/' || (url.pathname === '/mcp' && request.method === 'GET')) {
      return { identity: 'health-check' };
    }

    // BOUNCER CHECK: Block Claude or anyone else if they don't have the key
    if (url.searchParams.get('key') !== process.env.MCP_SECRET_KEY) {
       logger.warn('Unauthorized access blocked by bouncer.');
       throw new Error('Unauthorized');
    }
    return { identity: 'claude-trading-bot' };
  }
});

// --- 3. Register Tools ---
const registeredTools: any[] = [];
collectToolsWhileRegistering(server, registeredTools);
if (isRemote) wrapServerForRemote(server);
registerAllTools(server);

// --- 4. Start the Server ---
try {
  if (isRemote) {
    await initializeGoogleClient();
    logger.info('Starting in remote mode (Service Account Sandbox)...');
    
    registerLandingPage(server, registeredTools.length);
    registerDownloadRoute(server);

    // Explicitly listen on Cloud Run's required port
    const port = parseInt(process.env.PORT || '8080');
    await server.start({
      transportType: 'httpStream',
      httpStream: {
        port,
        host: '0.0.0.0',
      },
    });
    logger.info(`Server live on port ${port}`);
  } else {
    // Local fallback
    await initializeGoogleClient();
    const cachedToolsList = await buildCachedToolsListPayload(registeredTools);
    await server.start({ transportType: 'stdio' });
    installCachedToolsListHandler(server, cachedToolsList);
  }
} catch (startError: any) {
  logger.error('FATAL: Startup failed:', startError.message || startError);
  process.exit(1);
}
