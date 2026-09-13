/**
 * Privacy-Preserving Browser Vision Agent
 * Provider-Neutral VLM Reasoning Prompt
 *
 * Instructs the reasoning model to:
 * 1. Operate ONLY over sanitized browser perception context (DOM, safe text, layout, redacted visual).
 * 2. Respect the client-side privacy boundary (never request secrets, use vault tokens as-is).
 * 3. Emit ONLY a strictly valid JSON action plan matching the schema.
 * 4. Reject arbitrary code execution, script injection, or unvalidated commands.
 */

export const SYSTEM_PROMPT = `You are the reasoning core of a Privacy-Preserving Browser Vision Agent.
You assist users by planning browser interactions based strictly on sanitized perceptions provided by a client-side Chrome extension.

### CRITICAL PRIVACY INVARIANTS:
1. All private user data, passwords, authentication credentials, and secrets remain securely on the client machine.
2. If you see token placeholders like [PERSON_1], [EMAIL_1], [PHONE_1], or [PASSWORD_REDACTED], treat them as valid opaque values. If an action requires filling a field with that data, specify the placeholder token in the action's "value" field. The client browser will locally resolve it from its secure local vault. NEVER attempt to guess, extract, or ask for the original value.
3. You will receive only safe, sanitized DOM structures, accessibility metadata, safe visible text, and optionally a sanitized screenshot where sensitive regions have already been redacted.
4. Do NOT attempt to output executable code, eval statements, <script> tags, or shell commands.

### OUTPUT FORMAT:
You MUST respond with a single valid JSON object and nothing else. No conversational chatter, no preamble, and no markdown wrapping outside the JSON.
The JSON object must strictly match this schema:

{
  "actions": [
    {
      "type": "click" | "type" | "select" | "scroll" | "navigate" | "focus" | "extract" | "wait",
      "target": {
        "id": "element-id-if-known",
        "role": "button | input | link | select | ...",
        "text": "visible-label-or-button-text",
        "selector": "css-selector-if-applicable",
        "bbox": [x, y, width, height]
      },
      "value": "string value for typing (or token placeholder like [NAME_1])",
      "direction": "up | down | left | right",
      "amount": 300,
      "url": "https://example.com/target-page",
      "durationMs": 1000,
      "risk": "low" | "medium" | "high",
      "reason": "Clear explanation of why this step is taken"
    }
  ]
}

### RISK CLASSIFICATION RULES:
- "low": Read-only actions, scrolling, clicking normal navigation links/tabs/buttons, focusing inputs.
- "medium": Typing into form fields, selecting options, form submissions that are standard and non-destructive.
- "high": Irreversible operations, monetary transactions, account deletion, publishing public content, or sending sensitive communications.`;

/**
 * Builds the user prompt payload describing the task, perception context, and allowed capabilities
 * @param {object} params
 * @param {string} params.task
 * @param {object} [params.context]
 * @param {string[]} [params.capabilities]
 * @returns {string} Formatted prompt string
 */
export function formatUserPrompt({ task, context = {}, capabilities = [] }) {
  const parts = [];

  parts.push(`### USER TASK:\n${task}`);

  if (capabilities && capabilities.length > 0) {
    parts.push(`### ALLOWED CAPABILITIES:\n${capabilities.join(', ')}`);
  }

  parts.push(`### SANITIZED BROWSER CONTEXT:`);

  if (context.viewport) {
    parts.push(`Viewport: ${context.viewport.width || 1280}x${context.viewport.height || 800}`);
  }

  if (context.url) {
    parts.push(`Current URL: ${context.url}`);
  }

  if (context.title) {
    parts.push(`Page Title: ${context.title}`);
  }

  if (context.dom && (Array.isArray(context.dom) || Object.keys(context.dom).length > 0)) {
    const domStr = typeof context.dom === 'string' ? context.dom : JSON.stringify(context.dom, null, 2);
    parts.push(`DOM Elements (Sanitized):\n${domStr}`);
  } else if (context.elements && Array.isArray(context.elements)) {
    parts.push(`Visible Interactive Elements (Sanitized):\n${JSON.stringify(context.elements, null, 2)}`);
  }

  if (context.safeText && Array.isArray(context.safeText) && context.safeText.length > 0) {
    parts.push(`Safe Visible Text:\n${context.safeText.join('\n')}`);
  }

  if (context.visualRegions && Array.isArray(context.visualRegions) && context.visualRegions.length > 0) {
    parts.push(`Visual Regions (Sanitized):\n${JSON.stringify(context.visualRegions, null, 2)}`);
  }

  if (context.sanitizedImage) {
    parts.push(`[Note: Sanitized screenshot provided visually with sensitive bounding boxes redacted]`);
  }

  parts.push(`\nBased strictly on the sanitized context above, produce the structured action plan JSON to accomplish the user task.`);

  return parts.join('\n\n');
}

/**
 * Builds messages array for standard chat completion APIs (OpenRouter, Groq, etc.)
 * Supports multimodal input if context.sanitizedImage is present.
 *
 * @param {object} params
 * @param {string} params.task
 * @param {object} [params.context]
 * @param {string[]} [params.capabilities]
 * @returns {Array<{ role: string, content: string | Array<object> }>}
 */
export function buildPromptMessages({ task, context = {}, capabilities = [] }) {
  const userTextPrompt = formatUserPrompt({ task, context, capabilities });

  // Check if sanitizedImage is provided
  const hasImage = Boolean(context.sanitizedImage && typeof context.sanitizedImage === 'string');

  if (!hasImage) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userTextPrompt },
    ];
  }

  // Multimodal user message
  const imageUrl = context.sanitizedImage.startsWith('data:')
    ? context.sanitizedImage
    : `data:image/jpeg;base64,${context.sanitizedImage}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: userTextPrompt },
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
          },
        },
      ],
    },
  ];
}
