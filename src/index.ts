#!/usr/bin/env node

// src/index.ts
//
// Single entry point for the Google Docs MCP Server.
//
// Usage:
//   @a-bonus/google-docs-mcp          Start the MCP server (default)
//   @a-bonus/google-docs-mcp auth     Run the interactive OAuth flow
//
// Remote mode (env vars):
//   MCP_TRANSPORT=httpStream           Use Streamable HTTP instead of stdio
//   BASE_URL=https://...               Public URL for OAuth redirects
//   ALLOWED_DOMAINS=scio.cz,...        Restrict to specific Google Workspace domains

import { FastMCP } from 'fastmcp';
import { OAuthProxy } from 'fastmcp/auth';
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
import { FirestoreTokenStorage } from './firestoreTokenStorage.js';
import { logger } from './logger.js';

// --- Auth subcommand ---
if (process.argv[2] === 'auth') {
  const { runAuthFlow } = await import('./auth.js');
  try {
    await runAuthFlow();
    logger.info('Authorization complete. You can now start the MCP server.');
    process.exit(0);
  } catch (error: any) {
    logger.error('Authorization failed:', error.message || error);
    process.exit(1);
  }
}

// --- Server startup ---

process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  logger.error('Uncaught Exception:', error);
  if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.stdin.on('end', () => {
  logger.info('stdin closed — MCP host disconnected. Shutting down.');
  process.exit(0);
});

process.stdin.on('error', () => {
  process.exit(0);
});

// Graceful shutdown on termination signals.
// Without these handlers, a host that sends SIGTERM (rather than closing
// stdin) leaves the server running and accumulating in the background.
const cleanShutdown = (signal: string) => {
  logger.info(`Received ${signal} — shutting down.`);
  process.exit(0);
};
process.on('SIGTERM', () => cleanShutdown('SIGTERM'));
process.on('SIGINT', () => cleanShutdown('SIGINT'));
process.on('SIGHUP', () => cleanShutdown('SIGHUP'));

// Orphan-process watchdog (stdio mode only).
// In practice, some MCP clients exit without sending SIGTERM, and the
// stdin 'end' event can be swallowed by the transport's internal read
// loop — leaving the server running as a zombie that consumes CPU and
// memory indefinitely. As a backstop, detect reparenting to init
// (PID 1) and exit. The check runs every 10 s and is unref()'d so it
// does not keep the event loop alive on its own.
if (process.env.MCP_TRANSPORT !== 'httpStream') {
  const initialPpid = process.ppid;
  const watchdog = setInterval(() => {
    if (process.ppid !== initialPpid && process.ppid === 1) {
      logger.info(
        `Parent process (was PID ${initialPpid}) exited; reparented to init. Shutting down.`
      );
      process.exit(0);
    }
  }, 10_000);
  watchdog.unref();
}

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

if (isRemote) {
  const missing = ['BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    logger.error(`FATAL: Missing required env vars for httpStream mode: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const GOOGLE_API_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
];

// --- 1. Service Account Sandbox Setup ---
const fs = await import('fs');
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  // Write the JSON to a temporary file that Google's SDK automatically detects
  fs.writeFileSync('/tmp/service-account.json', process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/service-account.json';
}

// --- 2. Initialize Server with URL Bouncer ---
const server = new FastMCP({
  name: 'Ultimate Google Docs & Sheets MCP Server',
  version: '1.0.0',
  authenticate: async (request: any) => {
    // Check the URL for the ?key= parameter
    const url = new URL(request.url || '', `http://${request.headers?.host || 'localhost'}`);
    if (url.searchParams.get('key') !== process.env.MCP_SECRET_KEY) {
       throw new Error('Unauthorized access blocked by bouncer.');
    }
    // If the key matches, let Claude in
    return { identity: 'claude-trading-bot' };
  }
});

const registeredTools: Parameters<FastMCP['addTool']>[0][] = [];
collectToolsWhileRegistering(server, registeredTools);
if (isRemote) wrapServerForRemote(server);
registerAllTools(server);

try {
  if (isRemote) {
    await initializeGoogleClient();
    logger.info('Starting in remote mode (Service Account + API Key Bouncer)...');
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

    logger.info(`MCP Server running at ${process.env.BASE_URL || `http://0.0.0.0:${port}`}/mcp`);
  } else {
    await initializeGoogleClient();
    logger.info('Starting Ultimate Google Docs & Sheets MCP server...');

    const cachedToolsList = await buildCachedToolsListPayload(registeredTools);
    await server.start({ transportType: 'stdio' as const });
    installCachedToolsListHandler(server, cachedToolsList);
    logger.info('MCP Server running using stdio. Awaiting client connection...');
  }
  logger.info('Process-level error handling configured to prevent crashes from timeout errors.');
} catch (startError: any) {
  logger.error('FATAL: Server failed to start:', startError.message || startError);
  process.exit(1);
}
