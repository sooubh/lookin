/**
 * Privacy-Preserving Browser Vision Agent
 * AI Provider Registry & Abstraction
 *
 * Exposes a unified getProvider(name) factory returning the configured adapter.
 */

import { MockProvider } from './mock.js';
import { OpenRouterProvider } from './openrouter.js';
import { GroqProvider } from './groq.js';

export { MockProvider, OpenRouterProvider, GroqProvider };

// Singleton instances for default reuse if desired, or create new with options
const instances = new Map();

/**
 * Returns an instance of the requested AI provider adapter.
 *
 * @param {string} [name] Provider name ('mock' | 'openrouter' | 'groq')
 * @param {object} [options] Provider-specific configuration options
 * @param {boolean} [options.fresh=false] Whether to create a fresh instance instead of returning cached
 * @returns {MockProvider | OpenRouterProvider | GroqProvider}
 */
export function getProvider(name, options = {}) {
  const providerName = (name || process.env.DEFAULT_AI_PROVIDER || 'mock').toLowerCase().trim();

  if (!options.fresh && instances.has(providerName) && Object.keys(options).length === 0) {
    return instances.get(providerName);
  }

  let provider;

  switch (providerName) {
    case 'mock':
      provider = new MockProvider(options);
      break;

    case 'openrouter':
    case 'open-router':
      provider = new OpenRouterProvider(options);
      break;

    case 'groq':
      provider = new GroqProvider(options);
      break;

    default:
      throw new Error(`Unknown AI provider '${name}'. Supported providers: mock, openrouter, groq`);
  }

  if (!options.fresh && Object.keys(options).length === 0) {
    instances.set(providerName, provider);
  }

  return provider;
}
