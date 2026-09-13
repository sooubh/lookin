/**
 * Privacy-Preserving Browser Vision Agent
 * Node Gateway Server
 *
 * Minimal HTTP server:
 * - Listens on configurable port (default 3000)
 * - Zero database, zero raw-content persistence
 * - Enforces strict 500KB request body size limit via middleware
 * - Routes:
 *     GET  /health
 *     POST /agent/reason
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonBody, PayloadTooLargeError, MalformedJsonError } from './middleware/size-limit.js';
import { handleAgentReason } from './routes/agent.js';

/**
 * Lightweight zero-dependency .env file loader
 * @param {string} [envPath='.env']
 */
export function loadEnv(envPath = '.env') {
  try {
    const fullPath = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Ignore errors loading .env
  }
}

// Automatically load local .env if present
loadEnv();

/**
 * Handles CORS preflight and adds standard headers
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} true if request was handled as OPTIONS preflight
 */
function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/**
 * Main request router
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function requestHandler(req, res) {
  if (handleCors(req, res)) {
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. Health check endpoint
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'privacy-browser-agent-gateway',
        uptime: process.uptime(),
        defaultProvider: process.env.DEFAULT_AI_PROVIDER || 'mock',
      })
    );
    return;
  }

  // 2. Reason endpoint
  if (req.method === 'POST' && pathname === '/agent/reason') {
    let body;
    try {
      body = await readJsonBody(req, res);
    } catch (err) {
      // Handled by readJsonBody directly if res was passed
      return;
    }

    try {
      await handleAgentReason(req, res, body);
    } catch (unhandledErr) {
      console.error('[Server] Unhandled route error:', unhandledErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
    return;
  }

  // 3. 404 Not Found for any unknown route
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
}

/**
 * Creates and returns the configured HTTP server instance
 * @param {object} [options]
 * @returns {import('node:http').Server}
 */
export function createServer(options = {}) {
  return http.createServer(requestHandler);
}

/**
 * Starts the HTTP server on configured port/host
 * @param {number} [port]
 * @param {string} [host]
 * @returns {Promise<import('node:http').Server>}
 */
export function startServer(port = Number(process.env.PORT) || 3000, host = process.env.HOST || '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.on('error', (err) => {
      console.error('[Server] Server error:', err);
      reject(err);
    });

    server.listen(port, host, () => {
      console.log(`[Gateway] Privacy-Preserving Agent Gateway listening on http://${host}:${port}`);
      console.log(`[Gateway] Active AI Provider: ${process.env.DEFAULT_AI_PROVIDER || 'mock'}`);
      console.log(`[Gateway] Max Request Body Size: ${process.env.MAX_BODY_SIZE_BYTES || '512000'} bytes`);
      resolve(server);
    });
  });
}

// Auto-start server when executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((err) => {
    console.error('[Server] Failed to start server:', err);
    process.exit(1);
  });
}
