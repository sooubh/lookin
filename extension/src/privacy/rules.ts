/**
 * Deterministic Regex and Checksum Privacy Rules
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md and 02_PRIVACY_FIREWALL_PLAN.md.
 */

import { PrivacyCategory, SensitivityTier, SENSITIVITY_TIERS } from './categories.js';

export interface DeterministicRule {
  id: string;
  category: PrivacyCategory;
  tier: SensitivityTier;
  confidence: number;
  description: string;
  pattern: RegExp;
  validator?: (match: string, fullText: string) => boolean;
}

/**
 * Validates a credit card number using the Luhn checksum algorithm (MOD 10).
 */
export function validateLuhn(numStr: string): boolean {
  const digits = numStr.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Validates an International Bank Account Number (IBAN) using ISO 7064 MOD 97-10.
 */
export function validateIBAN(ibanStr: string): boolean {
  const clean = ibanStr.replace(/[\s-]/g, '').toUpperCase();
  // Standard IBAN: 2 letters country code, 2 digits check, up to 30 alphanumerics
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;

  // Move the first 4 characters to the end
  const rearranged = clean.slice(4) + clean.slice(0, 4);

  // Convert letters to two-digit numbers (A=10, B=11, ... Z=35)
  let numericString = '';
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numericString += (code - 55).toString();
    } else {
      numericString += rearranged[i];
    }
  }

  try {
    return BigInt(numericString) % 97n === 1n;
  } catch {
    return false;
  }
}

/**
 * Validates US Social Security Numbers (SSN).
 * Ensures area number is not 000, 666, or 900-999; group not 00; serial not 0000.
 */
export function validateSSN(ssnStr: string): boolean {
  const clean = ssnStr.replace(/[^\d]/g, '');
  if (clean.length !== 9) return false;

  const area = parseInt(clean.substring(0, 3), 10);
  const group = parseInt(clean.substring(3, 5), 10);
  const serial = parseInt(clean.substring(5, 9), 10);

  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;

  return true;
}

/**
 * Master catalog of deterministic pattern rules.
 */
export const DETERMINISTIC_RULES: DeterministicRule[] = [
  // 1. Passwords (Tier 3 - Secret)
  {
    id: 'sec-password-explicit',
    category: 'password',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.99,
    description: 'Explicit password/credentials pattern assignment',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?([^\s'"]{4,})['"]?/i,
  },

  // 2. OTP / 2FA / Verification Codes (Tier 3 - Secret)
  {
    id: 'sec-otp-code',
    category: 'otp',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.98,
    description: 'One-Time Password or 2FA verification code',
    pattern: /(?:otp|one[-_\s]?time[-_\s]?pass(?:word)?|verification[-_\s]?code|auth(?:entication)?[-_\s]?code|2fa[-_\s]?code|pin)\s*[:=]?\s*['"]?(\d{4,8})['"]?/i,
  },

  // 3. AWS API Keys (Tier 3 - Secret)
  {
    id: 'sec-aws-access-key',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.99,
    description: 'AWS Access Key ID (AKIA...)',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'sec-aws-secret-key',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.99,
    description: 'AWS Secret Access Key assignment',
    pattern: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
  },

  // 4. GitHub Personal Access Tokens (Tier 3 - Secret)
  {
    id: 'sec-github-token',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.99,
    description: 'GitHub Personal Access Token (ghp, gho, ghu, ghs, ghr)',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/,
  },

  // 5. Stripe API Keys (Tier 3 - Secret)
  {
    id: 'sec-stripe-key',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.99,
    description: 'Stripe Secret or Restricted Key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/,
  },

  // 6. Generic Bearer Tokens / API Keys (Tier 3 - Secret)
  {
    id: 'sec-generic-api-key',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.95,
    description: 'Generic API key / secret assignment',
    pattern: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*['"]?([A-Za-z0-9_\-\.]{20,})['"]?/i,
  },
  {
    id: 'sec-bearer-token',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.98,
    description: 'Authorization Bearer token header or value',
    pattern: /\bBearer\s+([A-Za-z0-9_\-\.]{20,})\b/i,
  },

  // 7. JWT Tokens (Tier 3 - Secret)
  {
    id: 'sec-jwt-token',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.98,
    description: 'JSON Web Token (JWT)',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },

  // 8. PEM Private Key Headers (Tier 3 - Secret)
  {
    id: 'sec-pem-private-key',
    category: 'api_key',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 1.0,
    description: 'PEM Private Key header block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  },

  // 9. Credit Card Numbers with Luhn Checksum (Tier 2 - Sensitive)
  {
    id: 'sens-credit-card-luhn',
    category: 'credit_card',
    tier: SENSITIVITY_TIERS.SENSITIVE,
    confidence: 0.99,
    description: 'Credit/Debit card number verified with Luhn checksum',
    // 13-19 digit formats including Visa, Mastercard, Amex, Discover
    pattern: /\b(?:\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,4}|\d{4}[-\s]?\d{6}[-\s]?\d{5})\b/,
    validator: (match) => validateLuhn(match),
  },

  // 10. Bank Account / IBAN with MOD 97 Checksum (Tier 2 - Sensitive)
  {
    id: 'sens-bank-iban',
    category: 'bank_account',
    tier: SENSITIVITY_TIERS.SENSITIVE,
    confidence: 0.99,
    description: 'International Bank Account Number (IBAN) verified with MOD 97',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i,
    validator: (match) => validateIBAN(match),
  },

  // 11. US Social Security Numbers (Tier 2 - Sensitive)
  {
    id: 'sens-gov-ssn',
    category: 'government_id',
    tier: SENSITIVITY_TIERS.SENSITIVE,
    confidence: 0.98,
    description: 'US Social Security Number (SSN)',
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/,
    validator: (match) => validateSSN(match),
  },

  // 12. Email Addresses (Tier 1 - Personal)
  {
    id: 'pers-email',
    category: 'email',
    tier: SENSITIVITY_TIERS.PERSONAL,
    confidence: 0.99,
    description: 'RFC 5322 standard email address',
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  },

  // 13. Phone Numbers (Tier 1 - Personal)
  {
    id: 'pers-phone',
    category: 'phone',
    tier: SENSITIVITY_TIERS.PERSONAL,
    confidence: 0.92,
    description: 'International or national telephone number format',
    // Matches formats like +1-800-555-0199, (555) 019-2834, +91 9876543210, etc.
    pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    validator: (match) => {
      // Clean digits to ensure it's between 10 and 15 digits
      const digits = match.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    },
  },

  // 14. IP Addresses (Tier 1 - Personal)
  {
    id: 'pers-ip-address',
    category: 'ip_address',
    tier: SENSITIVITY_TIERS.PERSONAL,
    confidence: 0.95,
    description: 'IPv4 Address format',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/,
  },
];
