/**
 * Privacy-Preserving Browser Vision Agent
 * Mock Provider Adapter
 *
 * Provides deterministic, hermetic reasoning for unit and integration testing
 * without requiring real API keys or external network requests.
 */

export class MockProvider {
  constructor(options = {}) {
    this.name = 'mock';
    this.options = options;
    this.responseQueue = [];
    this.simulatedError = null;
    this.lastPromptMessages = null;
    this.callCount = 0;
  }

  /**
   * Enqueues a specific mock response to be returned by the next reason() call.
   * Can be an object or a raw string (e.g. for testing parse failures).
   * @param {object|string} response
   */
  setMockResponse(response) {
    this.responseQueue.push(response);
  }

  /**
   * Simulates an upstream network or API error on next call
   * @param {Error|string} err
   */
  setError(err) {
    this.simulatedError = typeof err === 'string' ? new Error(err) : err;
  }

  /**
   * Resets all mock queues and error state
   */
  reset() {
    this.responseQueue = [];
    this.simulatedError = null;
    this.lastPromptMessages = null;
    this.callCount = 0;
  }

  /**
   * Generates or returns mock action plan
   * @param {object} params
   * @param {string} params.task
   * @param {object} [params.context]
   * @param {string[]} [params.capabilities]
   * @returns {Promise<object>} Action plan object
   */
  async reason({ task, context = {}, capabilities = [] } = {}) {
    this.callCount++;

    if (this.simulatedError) {
      const err = this.simulatedError;
      this.simulatedError = null;
      throw err;
    }

    if (this.responseQueue.length > 0) {
      const queued = this.responseQueue.shift();
      if (typeof queued === 'string') {
        try {
          return JSON.parse(queued);
        } catch {
          // Return raw string to let caller test JSON parse handling if needed
          return queued;
        }
      }
      return queued;
    }

    // Deterministic heuristic response based on sanitized task/context
    const taskLower = (task || '').toLowerCase();

    if (taskLower.includes('scroll')) {
      return {
        actions: [
          {
            type: 'scroll',
            direction: 'down',
            amount: 400,
            risk: 'low',
            reason: 'Scroll down to reveal additional page content',
          },
        ],
      };
    }

    // Extract elements from context.dom or context.dom.elements if provided
    const domElements = Array.isArray(context?.dom?.elements)
      ? context.dom.elements
      : Array.isArray(context?.dom)
      ? context.dom
      : [];

    if (taskLower.includes('type') || taskLower.includes('fill') || taskLower.includes('search')) {
      const targetEl = domElements.find((e) => e.role === 'textbox' || e.role === 'searchbox') || {
        id: 'input-search',
        role: 'searchbox',
        selector: 'input[name="q"]',
      };
      return {
        actions: [
          {
            type: 'type',
            target: {
              id: targetEl.id,
              role: targetEl.role || 'textbox',
              ...(targetEl.text ? { text: targetEl.text } : {}),
              ...(targetEl.bbox ? { bbox: targetEl.bbox } : {}),
            },
            value: context?.safeText?.[0] || 'query',
            risk: 'low',
            reason: 'Fill the field with the requested value',
          },
        ],
      };
    }

    if (taskLower.includes('extract') || taskLower.includes('statement') || taskLower.includes('spending')) {
      return {
        actions: [
          {
            type: 'extract',
            target: {
              role: 'table',
              text: 'Statement Total',
            },
            field: 'totalSpending',
            risk: 'low',
            reason: 'Extract the calculated summary information safely',
          },
        ],
      };
    }

    // Default standard response
    const btnEl = domElements.find((e) => e.role === 'button') || {
      id: 'btn-submit',
      role: 'button',
      text: 'Submit',
      bbox: [100, 200, 80, 36],
    };

    return {
      actions: [
        {
          type: 'click',
          target: {
            id: btnEl.id,
            role: 'button',
            text: btnEl.text || 'Submit',
            ...(btnEl.bbox ? { bbox: btnEl.bbox } : {}),
          },
          risk: 'low',
          reason: 'Submit the completed form per the user request',
        },
      ],
    };
  }
}
