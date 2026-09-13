/**
 * Simple Zero-Dependency HTTP Server for Privacy Agent Demo Site
 * Serves synthetic benchmarks and interactive demo pages on port 8080 (or PORT env).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEMO_ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createDemoServer() {
  const server = http.createServer((req, res) => {
    // Basic CORS for local testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Parse URL and sanitize file path
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let safePath = path.normalize(decodeURIComponent(reqUrl.pathname));
    if (safePath === '/' || safePath === '') {
      safePath = '/index.html';
    }

    const filePath = path.join(DEMO_ROOT, safePath);

    // Prevent directory traversal attacks
    if (!filePath.startsWith(DEMO_ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Directory traversal denied');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', (streamErr) => {
        console.error('[Demo Server] Stream error:', streamErr);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
      });
    });
  });

  return server;
}

export function startServer(port = Number(process.env.PORT) || 8080) {
  const server = createDemoServer();
  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`\n======================================================`);
      console.log(`  Lookin Privacy Agent — Controlled Demo Site`);
      console.log(`  Local URL: http://localhost:${actualPort}`);
      console.log(`  Workflow A (Form):      http://localhost:${actualPort}/index.html`);
      console.log(`  Workflow B (Statement): http://localhost:${actualPort}/statement.html`);
      console.log(`======================================================\n`);
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

// Direct CLI execution
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error('[Demo Server] Failed to start:', err);
    process.exit(1);
  });
}
