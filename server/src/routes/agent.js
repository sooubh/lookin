/**
 * Privacy-Preserving Browser Vision Agent
 * Agent Reasoning Route Handler (POST /agent/reason)
 *
 * Implements the core server-side reasoning endpoint:
 * 1. Validates incoming sanitized payload (strictly blocking token-vault mappings and raw secrets).
 * 2. Invokes the selected AI provider adapter.
 * 3. Enforces strict schema validation on the returned action plan.
 * 4. Returns validated actions: { actions: [...] }.
 * 5. Guarantees zero raw-content persistence or token caching.
 */

import { validateSanitizedPayload } from '../schemas/sanitized-payload.js';
import { validateActionPlan } from '../schemas/action-plan.js';
import { getProvider } from '../providers/index.js';

/**
 * Sends a JSON response with proper status code and headers
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} payload
 */
function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });
  res.end(JSON.stringify(payload));
}

/**
 * Handles POST /agent/reason
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} body Parsed request body
 */
/**
 * Redacts any potential secrets or sensitive values before logging to console
 * @param {any} val
 * @returns {any}
 */
export function safeSanitizeLog(val) {
  if (typeof val === 'string') {
    return val
      .replace(/\bsk-[a-zA-Z0-9]{15,}\b/g, 'sk-***')
      .replace(/\bghp_[a-zA-Z0-9]{15,}\b/g, 'ghp_***')
      .replace(/\b(?:\d{4}[\s-]){3}\d{1,4}\b/g, '****-****-****-****')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]');
  }
  if (Array.isArray(val)) {
    return val.map(safeSanitizeLog);
  }
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (/password|passwd|otp|token|secret|private[-_]?key/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = safeSanitizeLog(v);
      }
    }
    return out;
  }
  return val;
}

function safeLog(level, ...args) {
  const sanitized = args.map(safeSanitizeLog);
  if (level === 'warn') {
    console.warn(...sanitized);
  } else if (level === 'error') {
    console.error(...sanitized);
  } else {
    console.log(...sanitized);
  }
}

/**
 * Handles POST /agent/reason
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} body Parsed request body
 */
export async function handleAgentReason(req, res, body) {
  const startTime = Date.now();

  // 1. Validate incoming sanitized payload
  const payloadValidation = validateSanitizedPayload(body);
  if (!payloadValidation.valid) {
    safeLog('warn', '[Security] Rejected payload with privacy violations:', payloadValidation.errors);
    return sendJson(res, 400, {
      error: 'Sanitized payload validation failed',
      violations: payloadValidation.errors,
    });
  }

  const { task, context, capabilities, provider: requestedProvider, model } = payloadValidation.sanitizedData;

  // 2. Select AI provider adapter
  const providerName = requestedProvider || process.env.DEFAULT_AI_PROVIDER || 'mock';
  let provider;

  try {
    provider = getProvider(providerName);
  } catch (providerInitErr) {
    return sendJson(res, 400, {
      error: `Invalid AI provider requested: ${providerInitErr.message}`,
    });
  }

  // 3. Call AI provider reasoning
  let rawPlan;
  try {
    rawPlan = await provider.reason({
      task,
      context,
      capabilities,
      model,
    });
  } catch (providerErr) {
    const isTimeout =
      providerErr.name === 'AbortError' ||
      providerErr.code === 'ETIMEDOUT' ||
      /timeout|timed\s*out|abort/i.test(providerErr.message);

    const isNotConfigured = providerErr.message.includes('is not configured');
    const statusCode = isTimeout ? 504 : (isNotConfigured ? 500 : 502);
    const errorType = isTimeout ? 'Gateway Timeout' : 'AI reasoning failed';

    safeLog('error', `[AI Provider Error] ${providerName} reasoning failed:`, providerErr.message);

    return sendJson(res, statusCode, {
      error: errorType,
      provider: providerName,
      message: isTimeout ? 'AI provider request timed out' : providerErr.message,
    });
  }

  // 4. Validate model output against strict action schema
  const planValidation = validateActionPlan(rawPlan);
  if (!planValidation.valid) {
    safeLog('warn', '[Security] Model output failed strict action schema validation:', planValidation.errors);
    return sendJson(res, 502, {
      error: 'Model output schema validation failed',
      provider: providerName,
      violations: planValidation.errors,
    });
  }

  const durationMs = Date.now() - startTime;
  safeLog('log', `[Agent] /agent/reason completed via ${providerName} in ${durationMs}ms with ${planValidation.plan.actions.length} action(s).`);

  // 5. Return structured action plan
  return sendJson(res, 200, {
    actions: planValidation.plan.actions,
  });
}
