/**
 * Privacy-Preserving Browser Vision Agent
 * OpenRouter Provider Adapter
 *
 * Calls OpenRouter AI models (including multimodal models via openrouter/free router)
 * with sanitized context and structured JSON output.
 */

import { buildPromptMessages } from '../prompts/vision-agent.js';

export class OpenRouterProvider {
  constructor(options = {}) {
    this.name = 'openrouter';
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = options.model || process.env.OPENROUTER_MODEL || 'openrouter/free';
    this.apiUrl = options.apiUrl || process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
    this.timeoutMs = options.timeoutMs || 60000;
  }

  /**
   * Helper to clean markdown code blocks before JSON parsing
   * @param {string} text
   * @returns {string}
   */
  static cleanJsonText(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();
    // Remove ```json ... ``` wrapper if present
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    return cleaned.trim();
  }

  /**
   * Generates action plan using OpenRouter
   * @param {object} params
   * @param {string} params.task
   * @param {object} [params.context]
   * @param {string[]} [params.capabilities]
   * @param {string} [params.model] Optional model override
   * @returns {Promise<object>} Action plan object
   */
  async reason({ task, context = {}, capabilities = [], model } = {}) {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured. Please set the environment variable.');
    }

    const selectedModel = model || this.model;
    const messages = buildPromptMessages({ task, context, capabilities });

    const requestBody = {
      model: selectedModel,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.1,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/sooubh/lookin',
          'X-Title': 'Privacy-Preserving Browser Vision Agent',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error (HTTP ${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('OpenRouter response did not contain message content.');
      }

      const cleaned = OpenRouterProvider.cleanJsonText(content);
      const parsed = JSON.parse(cleaned);
      return parsed;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
