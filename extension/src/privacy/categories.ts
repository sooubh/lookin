/**
 * Privacy Sensitivity Categories and Tiers
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md and 02_PRIVACY_FIREWALL_PLAN.md.
 */

export type SensitivityTier = 0 | 1 | 2 | 3;

export const SENSITIVITY_TIERS = {
  PUBLIC: 0 as SensitivityTier,
  PERSONAL: 1 as SensitivityTier,
  SENSITIVE: 2 as SensitivityTier,
  SECRET: 3 as SensitivityTier,
} as const;

export type PrivacyCategory =
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'username'
  | 'password'
  | 'otp'
  | 'credit_card'
  | 'bank_account'
  | 'government_id'
  | 'face'
  | 'api_key'
  | 'private_document'
  | 'ip_address'
  | 'unknown';

/**
 * Static mapping of categories to their default sensitivity tiers.
 * - Tier 0 (Public): General UI elements, buttons, public text
 * - Tier 1 (Personal): PII identifiers (name, email, phone, address, username, ip_address)
 * - Tier 2 (Sensitive): Financial values, IDs, accounts, private documents, faces
 * - Tier 3 (Secret): Passwords, OTPs, API keys, tokens, CVVs (STRICTLY BLOCKED)
 */
export const CATEGORY_TIER_MAP: Record<PrivacyCategory, SensitivityTier> = {
  name: SENSITIVITY_TIERS.PERSONAL,
  email: SENSITIVITY_TIERS.PERSONAL,
  phone: SENSITIVITY_TIERS.PERSONAL,
  address: SENSITIVITY_TIERS.PERSONAL,
  username: SENSITIVITY_TIERS.PERSONAL,
  ip_address: SENSITIVITY_TIERS.PERSONAL,

  credit_card: SENSITIVITY_TIERS.SENSITIVE,
  bank_account: SENSITIVITY_TIERS.SENSITIVE,
  government_id: SENSITIVITY_TIERS.SENSITIVE,
  face: SENSITIVITY_TIERS.SENSITIVE,
  private_document: SENSITIVITY_TIERS.SENSITIVE,

  password: SENSITIVITY_TIERS.SECRET,
  otp: SENSITIVITY_TIERS.SECRET,
  api_key: SENSITIVITY_TIERS.SECRET,

  unknown: SENSITIVITY_TIERS.PUBLIC,
};

/**
 * Base engineering weights for sensitivity tiers used in risk calculations.
 */
export const TIER_WEIGHTS: Record<SensitivityTier, number> = {
  0: 0.0,
  1: 0.4,
  2: 0.75,
  3: 1.0,
};

/**
 * Returns default sensitivity tier for a category.
 */
export function getTierForCategory(category: PrivacyCategory): SensitivityTier {
  return CATEGORY_TIER_MAP[category] ?? SENSITIVITY_TIERS.PUBLIC;
}

/**
 * Returns whether a category or tier is classified as a Tier 3 Secret.
 */
export function isSecret(categoryOrTier: PrivacyCategory | SensitivityTier): boolean {
  if (typeof categoryOrTier === 'number') {
    return categoryOrTier === SENSITIVITY_TIERS.SECRET;
  }
  return CATEGORY_TIER_MAP[categoryOrTier] === SENSITIVITY_TIERS.SECRET;
}

/**
 * Returns human-readable label for a privacy category.
 */
export function getCategoryDisplayName(category: PrivacyCategory): string {
  switch (category) {
    case 'name':
      return 'Person Name';
    case 'email':
      return 'Email Address';
    case 'phone':
      return 'Phone Number';
    case 'address':
      return 'Physical Address';
    case 'username':
      return 'Username / Account Handle';
    case 'password':
      return 'Password / Credential';
    case 'otp':
      return 'One-Time Password (OTP)';
    case 'credit_card':
      return 'Credit / Debit Card';
    case 'bank_account':
      return 'Bank Account / IBAN';
    case 'government_id':
      return 'Government Identifier';
    case 'face':
      return 'Human Face Region';
    case 'api_key':
      return 'API Key / Secret Token';
    case 'private_document':
      return 'Private Document';
    case 'ip_address':
      return 'IP Address';
    default:
      return 'Unknown';
  }
}
