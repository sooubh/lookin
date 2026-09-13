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
export async function handleAgentReason(req, res, body) {
  const startTime = Date.now();

  // 1. Validate incoming sanitized payload
  const payloadValidation = validateSanitizedPayload(body);
  if (!payloadValidation.valid) {
    console.warn('[Security] Rejected payload with privacy violations:', payloadValidation.errors);
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
    console.error(`[AI Provider Error] ${providerName} reasoning failed:`, providerErr.message);
    const statusCode = providerErr.message.includes('is not configured') ? 500 : 502;
    return sendJson(res, statusCode, {
      error: 'AI reasoning failed',
      provider: providerName,
      message: providerErr.message,
    });
  }

  // 4. Validate model output against strict action schema
  const planValidation = validateActionPlan(rawPlan);
  if (!planValidation.valid) {
    console.warn('[Security] Model output failed strict action schema validation:', planValidation.errors);
    return sendJson(res, 502, {
      error: 'Model output schema validation failed',
      provider: providerName,
      violations: planValidation.errors,
    });
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Agent] /agent/reason completed via ${providerName} in ${durationMs}ms with ${planValidation.plan.actions.length} action(s).`);

  // 5. Return structured action plan
  return sendJson(res, 200, {
    actions: planValidation.plan.actions,
  });
}
