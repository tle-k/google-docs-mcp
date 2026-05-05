#!/usr/bin/env node

// src/index.ts
import { FastMCP } from 'fastmcp';
import * as fs from 'fs'; // Moved to top for build stability
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

// --- Auth subcommand ---
if (process.argv[2] === 'auth') {
  const { runAuthFlow } = await import('./auth.js');
  try {
    await runAuthFlow();
    logger.info('Authorization complete.');
    process.exit(0);
  } catch (error: any) {
    logger.error('Authorization failed:', error.message || error);
    process.exit(1);
  }
}

// --- Process Management ---
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

// --- Validation Fix ---
// We only require OAuth vars if the Service Account JSON is NOT present.
if (isRemote && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  const missing = ['BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    logger.error(`FATAL: Missing OAuth env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// --- 1. Service Account Sandbox Setup ---
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  try {
    fs.writeFileSync('/tmp/service-account.json', process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/service-account.json';
    logger.info('Service Account JSON configured in sandbox.');
  } catch (err) {
    logger.error('Failed to write sandbox credentials:', err);
  }
}

// --- 2. Initialize Server with Smarter Bouncer ---
const server = new FastMCP({
  name: 'Ultimate Google Docs & Sheets MCP Server',
  version: '1.0.0',
  authenticate: async (request: any) => {
    const url = new URL(request.url || '', `http://${request.headers?.host || 'localhost'}`);
    
    // BOUNCER BYPASS: Allow health checks so Cloud Run doesn't shut down the service
    if (url.pathname === '/' || (url.pathname === '/mcp' && request.method === 'GET')) {
      return { identity: 'health-check' };
    }

    // AUTH CHECK: Verify the secret key for all actual MCP traffic
    if (url.searchParams.get('key') !== process.env.MCP_SECRET_KEY) {
       logger.warn('Unauthorized access blocked by bouncer.');
       throw new Error('Unauthorized');
    }
    return { identity: 'claude-trading-bot' };
  }
});

const registeredTools: any[] = [];
collectToolsWhileRegistering(server, registeredTools);
if (isRemote) wrapServerForRemote(server);
registerAllTools(server);

try {
  if (isRemote) {
    await initializeGoogleClient();
    logger.info('Starting in remote mode (Service Account Sandbox)...');
    
    registerLandingPage(server, registeredTools.length);
    registerDownloadRoute(server);

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
    await initializeGoogleClient();
    const cachedToolsList = await buildCachedToolsListPayload(registeredTools);
    await server.start({ transportType: 'stdio' });
    installCachedToolsListHandler(server, cachedToolsList);
  }
} catch (startError: any) {
  logger.error('FATAL: Startup failed:', startError.message || startError);
  process.exit(1);
}
