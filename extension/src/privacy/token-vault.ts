/**
 * Client-Side Local Token Vault
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Prompt A9).
 *
 * Security Invariant: Original-to-token mappings stay strictly client-side.
 * Never send token vault mappings to the server.
 */

import { PrivacyCategory, isSecret } from './categories.js';

export class SecurityInvariantViolationError extends Error {
  constructor(message: string) {
    super(`[Security Invariant Violation] ${message}`);
    this.name = 'SecurityInvariantViolationError';
  }
}

export class TokenVault {
  // Mapping of token -> raw value
  private tokenToRaw = new Map<string, string>();
  // Mapping of raw value -> token
  private rawToToken = new Map<string, string>();
  // Category counters for sequential indexing e.g. [EMAIL_1], [EMAIL_2]
  private categoryCounters = new Map<string, number>();

  constructor(initialMappings?: Record<string, string>) {
    if (initialMappings) {
      for (const [token, secret] of Object.entries(initialMappings)) {
        this.store(token, secret);
      }
    }
  }

  /**
   * Stores a local secret under an opaque token.
   * e.g. store('[EMAIL_1]', 'alice@privacy-test.dev')
   */
  public store(token: string, secretValue: string): void {
    const normalizedToken = token.startsWith('[') && token.endsWith(']')
      ? token
      : `[${token}]`;
    this.tokenToRaw.set(normalizedToken, secretValue);
    this.rawToToken.set(secretValue, normalizedToken);
  }

  public get(token: string): string | undefined {
    const normalizedToken = token.startsWith('[') && token.endsWith(']')
      ? token
      : `[${token}]`;
    return this.tokenToRaw.get(normalizedToken);
  }

  public has(token: string): boolean {
    const normalizedToken = token.startsWith('[') && token.endsWith(']')
      ? token
      : `[${token}]`;
    return this.tokenToRaw.has(normalizedToken);
  }

  public getKnownTokens(): string[] {
    return Array.from(this.tokenToRaw.keys());
  }

  /**
   * Tokenizes a raw personal/sensitive value into a safe client-side placeholder.
   * INVARIANT: Tier 3 secrets (passwords, OTPs, API keys) must NEVER be tokenized
   * for transmission; they must be blocked.
   */
  public tokenize(category: PrivacyCategory, rawValue: string): string {
    if (!rawValue || typeof rawValue !== 'string') {
      return '';
    }

    const trimmed = rawValue.trim();
    if (!trimmed) return '';

    // Hard Invariant: Tier 3 secrets are never tokenized
    if (isSecret(category)) {
      throw new SecurityInvariantViolationError(
        `Tier 3 Secret (${category}) cannot be tokenized for transmission. It must be blocked.`
      );
    }

    // Reuse existing token if already tokenized
    const existing = this.rawToToken.get(trimmed);
    if (existing) {
      return existing;
    }

    // Determine category token prefix: e.g. email -> EMAIL, credit_card -> CARD
    const prefix = this.getPrefixForCategory(category);
    const count = (this.categoryCounters.get(prefix) ?? 0) + 1;
    this.categoryCounters.set(prefix, count);

    const token = `[${prefix}_${count}]`;

    this.tokenToRaw.set(token, trimmed);
    this.rawToToken.set(trimmed, token);

    return token;
  }

  /**
   * Detokenizes a single token back to its local raw value.
   */
  public detokenize(token: string): string | undefined {
    return this.tokenToRaw.get(token);
  }

  /**
   * Replaces all token placeholders within a text string with their local original values.
   * Used exclusively inside the local browser execution guard before interacting with the DOM.
   */
  public detokenizeText(text: string): string {
    if (!text || typeof text !== 'string') return text;

    return text.replace(/\[[A-Z0-9_]+_\d+\]/g, (match) => {
      return this.tokenToRaw.get(match) ?? match;
    });
  }

  /**
   * Resolves any tokens present in the string with real local secret values.
   * Compatible with BrowserExecutor execution interface.
   */
  public resolveTokens(text: string): { resolvedText: string; tokensResolved: string[] } {
    if (!text || typeof text !== 'string') {
      return { resolvedText: text || '', tokensResolved: [] };
    }
    const tokensResolved: string[] = [];
    const resolvedText = text.replace(/\[[A-Z0-9_]+_\d+\]/g, (match) => {
      if (this.tokenToRaw.has(match)) {
        tokensResolved.push(match);
        return this.tokenToRaw.get(match)!;
      }
      return match;
    });

    return { resolvedText, tokensResolved };
  }

  /**
   * Checks whether a token exists in the vault.
   */
  public hasToken(token: string): boolean {
    return this.tokenToRaw.has(token);
  }

  /**
   * Checks whether a raw value has already been tokenized.
   */
  public hasRawValue(rawValue: string): boolean {
    return this.rawToToken.has(rawValue.trim());
  }

  /**
   * Determines if a string matches the token placeholder format (e.g. [EMAIL_1]).
   */
  public isTokenFormat(tokenStr: string): boolean {
    return /^\[[A-Z0-9_]+_\d+\]$/.test(tokenStr);
  }

  /**
   * Returns list of all raw values stored locally.
   * Used exclusively by the Payload Sanitizer leak scanner to verify none leak out.
   */
  public getRawValues(): string[] {
    return Array.from(this.rawToToken.keys());
  }

  /**
   * Returns list of all generated tokens.
   */
  public getTokens(): string[] {
    return Array.from(this.tokenToRaw.keys());
  }

  /**
   * Total number of stored tokens.
   */
  public size(): number {
    return this.tokenToRaw.size;
  }

  /**
   * Resets and clears the vault.
   */
  public clear(): void {
    this.tokenToRaw.clear();
    this.rawToToken.clear();
    this.categoryCounters.clear();
  }

  /**
   * Invariant Enforcement: Attempting to serialize or export the token vault mappings
   * to the cloud/server is strictly forbidden.
   */
  public exportForServer(): never {
    throw new SecurityInvariantViolationError(
      'Token vault mappings are strictly confidential to the browser and must NEVER be exported or transmitted to the server.'
    );
  }

  private getPrefixForCategory(category: PrivacyCategory): string {
    switch (category) {
      case 'email':
        return 'EMAIL';
      case 'name':
        return 'PERSON';
      case 'phone':
        return 'PHONE';
      case 'address':
        return 'ADDRESS';
      case 'username':
        return 'USER';
      case 'credit_card':
        return 'CARD';
      case 'bank_account':
        return 'BANK_ACCOUNT';
      case 'government_id':
        return 'GOV_ID';
      case 'ip_address':
        return 'IP';
      case 'private_document':
        return 'DOCUMENT';
      default:
        return category.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    }
  }
}
