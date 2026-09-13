/**
 * Privacy-Preserving Browser Vision Agent
 * Request Size Limit & Body Parser Middleware
 *
 * Enforces strict limits on incoming request payloads to prevent memory exhaustion,
 * DOS attacks, and unauthorized dumping of heavy uncompressed media.
 * Default limit: 500KB (512,000 bytes).
 */

export const DEFAULT_MAX_BODY_SIZE = 500 * 1024; // 500 KB

export class PayloadTooLargeError extends Error {
  constructor(message = 'Payload Too Large: Request body exceeds maximum allowed size.') {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.statusCode = 413;
  }
}

export class MalformedJsonError extends Error {
  constructor(message = 'Bad Request: Malformed JSON payload.') {
    super(message);
    this.name = 'MalformedJsonError';
    this.statusCode = 400;
  }
}

/**
 * Reads and parses JSON body from an incoming HTTP request with strict size limiting.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} [options]
 * @param {number} [options.maxSize=512000] Maximum allowed payload size in bytes
 * @returns {Promise<any>} Parsed JSON object
 */
export async function readJsonBody(req, res, options = {}) {
  const maxSize = options.maxSize || Number(process.env.MAX_BODY_SIZE_BYTES) || DEFAULT_MAX_BODY_SIZE;

  // 1. Fast check via Content-Length header if present
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    const err = new PayloadTooLargeError(`Request content-length ${contentLength} exceeds maximum limit of ${maxSize} bytes.`);
    if (res && !res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    throw err;
  }

  return new Promise((resolve, reject) => {
    let accumulatedBytes = 0;
    const chunks = [];
    let aborted = false;

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    }

    function onData(chunk) {
      if (aborted) return;
      accumulatedBytes += chunk.length;

      if (accumulatedBytes > maxSize) {
        aborted = true;
        cleanup();
        req.resume(); // drain incoming data to avoid abrupt socket reset before response

        const err = new PayloadTooLargeError(`Request payload exceeded limit of ${maxSize} bytes.`);
        if (res && !res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
          res.end(JSON.stringify({ error: err.message }));
        }
        reject(err);
        return;
      }

      chunks.push(chunk);
    }

    function onEnd() {
      if (aborted) return;
      cleanup();

      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw || raw.trim().length === 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (parseErr) {
        const err = new MalformedJsonError(`Invalid JSON payload: ${parseErr.message}`);
        if (res && !res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        reject(err);
      }
    }

    function onError(err) {
      if (aborted) return;
      cleanup();
      reject(err);
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Standard Express/Connect middleware wrapper for size limiting and JSON parsing
 * @param {object} [options]
 * @param {number} [options.maxSize=512000]
 */
export function createSizeLimitMiddleware(options = {}) {
  return async (req, res, next) => {
    try {
      req.body = await readJsonBody(req, res, options);
      if (next) next();
    } catch (err) {
      // Error already handled and responded in readJsonBody if res was passed
      if (next) next(err);
    }
  };
}
