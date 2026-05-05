#!/usr/bin/env node
import { FastMCP } from 'fastmcp';
import { initializeGoogleClient } from './clients.js';
import { registerAllTools } from './tools/index.js';

const server = new FastMCP({
  name: 'Drive Agent',
  version: '1.0.0',
  authenticate: async (req: any) => {
    const url = new URL(req.url || '', 'http://localhost');
    // Allow health checks
    if (url.pathname === '/') return { identity: 'health' };
    // Verify your secret key
    if (url.searchParams.get('key') !== process.env.MCP_SECRET_KEY) throw new Error('Unauthorized');
    return { identity: 'claude' };
  }
});

registerAllTools(server);

try {
  await initializeGoogleClient();
  await server.start({ transportType: 'httpStream', httpStream: { port: 8080, host: '0.0.0.0' } });
} catch (err) {
  process.exit(1);
}
