/**
 * Privacy-Preserving Browser Vision Agent
 * Sanitized Payload Validation
 *
 * Enforces the browser-server privacy boundary before calling any reasoning provider:
 * 1. Confirms task & context structure.
 * 2. Statically ensures NO token vault mappings leave the client.
 * 3. Detects and blocks raw unredacted secrets, passwords, OTPs, or API keys.
 */

// Patterns indicating raw unredacted secret values
const RAW_SECRET_PATTERNS = [
  // High-entropy API keys
  /\bsk-[a-zA-Z0-9]{20,}\b/,                 // OpenAI / generic sk-
  /\bghp_[a-zA-Z0-9]{20,}\b/,                // GitHub Personal Access Token
  /\bgithub_pat_[a-zA-Z0-9_]{22,}\b/,        // Fine-grained GitHub PAT
  /\bAIza[0-9A-Za-z-_]{35}\b/,               // Google API Key
  /\bAKIA[0-9A-Z]{16}\b/,                    // AWS Access Key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,      // Private Keys
  // Credit card patterns (spaced or unspaced 13-19 digits)
  /\b(?:\d{4}[\s-]){3}\d{1,4}\b/,            // Formatted 4-4-4-4
  /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,4}\b/, // Visa
  /\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Mastercard
  /\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/,    // Amex
  // US SSN pattern
  /\b\d{3}-\d{2}-\d{4}\b/,
];

// Disallowed property names that indicate token vault leaks, raw credentials, or raw screenshots
const DISALLOWED_KEYS = new Set([
  'tokenvault',
  'token_vault',
  'tokenmap',
  'token_map',
  'tokensmapping',
  'tokenmappings',
  'vaultmap',
  'rawpassword',
  'raw_password',
  'passwd',
  'privatekey',
  'private_key',
  'masterkey',
  'master_key',
  'cardnumber',
  'card_number',
  'creditcard',
  'credit_card',
  'cvv',
  'cvc',
  'screenshot',
  'rawscreenshot',
  'raw_screenshot',
  'rawscreenshotbase64',
  'rawimage',
  'raw_image',
]);

// Token pattern: e.g. [PERSON_1], [EMAIL_2], [TOKEN_123]
const TOKEN_PLACEHOLDER_REGEX = /^\[[A-Z_]+_\d+\]$/;

/**
 * Checks if a string contains raw secrets or unredacted PII patterns
 * @param {string} str
 * @returns {string|null} Matched description or null
 */
function detectRawSecretPattern(str) {
  if (typeof str !== 'string') return null;

  // Placeholder tokens like [PASSWORD_REDACTED], [EMAIL_1] are explicitly safe
  if (str.startsWith('[') && str.endsWith(']') && str.includes('_')) {
    return null;
  }

  for (const pattern of RAW_SECRET_PATTERNS) {
    if (pattern.test(str)) {
      return `Raw secret / PII pattern matching ${pattern.toString()}`;
    }
  }

  return null;
}

/**
 * Recursively scans payload for token vault dictionaries and raw secret leaks
 * @param {any} val
 * @param {string} path
 * @param {string[]} violations
 */
function scanPayloadForViolations(val, path, violations) {
  if (val === null || val === undefined) return;

  if (typeof val === 'string') {
    const leak = detectRawSecretPattern(val);
    if (leak) {
      violations.push(`${path}: ${leak}`);
    }
    // Block raw unredacted data URI images unless explicitly sent as sanitizedImage
    if (val.startsWith('data:image/') && !path.endsWith('sanitizedImage')) {
      violations.push(`${path}: Raw unredacted image data detected. Only sanitizedImage is permitted.`);
    }
  } else if (Array.isArray(val)) {
    val.forEach((item, index) => scanPayloadForViolations(item, `${path}[${index}]`, violations));
  } else if (typeof val === 'object') {
    const keys = Object.keys(val);

    // 1. Check for forbidden mapping keys
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      if (DISALLOWED_KEYS.has(lowerKey)) {
        if (lowerKey.includes('screenshot') || lowerKey.includes('image')) {
          violations.push(`${path}: Disallowed property '${key}' detected. Raw screenshots must never be sent to the server.`);
        } else {
          violations.push(`${path}: Disallowed property '${key}' detected. Token vault mappings and raw secrets must remain on the client.`);
        }
      }

      // Check if keys themselves are token placeholders mapping to real values:
      // e.g. { "[PERSON_1]": "John Doe" }
      if (TOKEN_PLACEHOLDER_REGEX.test(key) && typeof val[key] === 'string') {
        violations.push(`${path}: Token vault mapping dictionary detected for key '${key}'. The server must never receive original-to-token mappings.`);
      }
    }

    // 2. Check for token mapping array entries: { token: "[...]", value: "..." }
    if (
      (val.token && typeof val.token === 'string' && TOKEN_PLACEHOLDER_REGEX.test(val.token)) &&
      (val.value || val.raw || val.resolved || val.original)
    ) {
      violations.push(`${path}: Token vault mapping entry ({ token: '${val.token}', ... }) detected. Mappings must stay client-side.`);
    }

    // 3. Check for explicit raw password fields with non-token string content
    if ('password' in val && typeof val.password === 'string') {
      const pw = val.password.trim();
      if (pw.length > 0 && !pw.startsWith('[') && !pw.endsWith(']')) {
        violations.push(`${path}.password: Raw password value transmitted. Passwords must never leave the browser.`);
      }
    }

    // 4. Check for explicit raw OTP fields
    if ('otp' in val) {
      const otpStr = String(val.otp).trim();
      if (otpStr.length > 0 && !otpStr.startsWith('[') && !otpStr.endsWith(']')) {
        violations.push(`${path}.otp: Raw OTP code transmitted. Authentication codes must never leave the browser.`);
      }
    }

    // 5. Check for explicit raw API key / secret properties
    for (const secKey of ['apikey', 'api_key', 'privatekey', 'private_key']) {
      if (secKey in val && typeof val[secKey] === 'string') {
        const secretVal = val[secKey].trim();
        if (secretVal.length > 0 && !secretVal.startsWith('[') && !secretVal.endsWith(']')) {
          violations.push(`${path}.${secKey}: Raw secret/key transmitted. Secrets must never leave the browser.`);
        }
      }
    }

    // Recurse on children
    for (const [key, child] of Object.entries(val)) {
      scanPayloadForViolations(child, `${path}.${key}`, violations);
    }
  }
}

/**
 * Validates the incoming sanitized payload for /agent/reason
 * @param {any} body
 * @returns {{ valid: boolean, errors: string[], sanitizedData?: { task: string, context: object, capabilities: string[] } }}
 */
export function validateSanitizedPayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: ['Request body must be a non-null JSON object.'],
    };
  }

  // Task validation
  if (!body.task || typeof body.task !== 'string' || body.task.trim().length === 0) {
    errors.push('Field "task" is required and must be a non-empty string.');
  }

  // Context validation
  if (body.context !== undefined && (typeof body.context !== 'object' || body.context === null || Array.isArray(body.context))) {
    errors.push('Field "context" if provided must be an object.');
  }

  // Capabilities validation
  if (body.capabilities !== undefined && !Array.isArray(body.capabilities)) {
    errors.push('Field "capabilities" if provided must be an array of action names.');
  }

  // Privacy & security scan
  scanPayloadForViolations(body, 'root', errors);

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    errors: [],
    sanitizedData: {
      task: body.task.trim(),
      context: body.context || {},
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
      provider: typeof body.provider === 'string' ? body.provider.trim() : undefined,
      model: typeof body.model === 'string' ? body.model.trim() : undefined,
    },
  };
}
