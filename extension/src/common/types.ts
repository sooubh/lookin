/**
 * Master Type Definitions for Privacy-Preserving Browser Vision Agent
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * 03_BROWSER_AGENT_AND_AI_PLAN.md, and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md.
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

export type PrivacyDecisionAction =
  | 'allow'
  | 'tokenize'
  | 'blur'
  | 'mask'
  | 'structure_only'
  | 'block'
  | 'omit';

export interface DetectedEntity {
  category: PrivacyCategory;
  tier: SensitivityTier;
  text?: string;
  span?: { start: number; end: number };
  bbox?: [number, number, number, number]; // [x, y, width, height]
  confidence: number;
  source: 'dom' | 'regex' | 'ner' | 'visual';
  elementId?: string;
}

export interface PrivacyDecision {
  category: PrivacyCategory;
  tier: SensitivityTier;
  risk: number; // [0, 1]
  confidence: number; // [0, 1]
  task_required: boolean;
  decision: PrivacyDecisionAction;
  token?: string; // e.g. "[EMAIL_1]"
  replacement?: string;
  reason: string;
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompactElement {
  id: string;
  role: string;
  name: string;
  type?: string;
  visible: boolean;
  enabled: boolean;
  bounds: ElementBounds;
  placeholder?: string;
  context?: string;
  checked?: boolean;
}

export interface PerceptionElement {
  id: string;
  role: string;
  text: string;
  name?: string;
  type?: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  bounds?: ElementBounds;
  visible: boolean;
  enabled: boolean;
  inputType?: string;
  autocomplete?: string;
  placeholder?: string;
  context?: string;
  checked?: boolean;
  selected?: boolean;
  value?: string;
  source: 'dom' | 'vision' | 'accessibility';
}

export interface PagePerception {
  viewport: { width: number; height: number };
  url: string;
  title: string;
  elements: PerceptionElement[];
  timestamp: number;
}

export interface TaskRequirement {
  task: string;
  intent: string;
  requiredContext: string[];
  optionalContext: string[];
  forbiddenContext: string[];
  allowedActions: ActionType[];
  highRiskActions: ActionType[];
}

export type ActionType =
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'navigate'
  | 'focus'
  | 'extract'
  | 'wait';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ActionTarget {
  text?: string;
  role?: string;
  id?: string;
  bbox?: [number, number, number, number];
  selector?: string;
}

export interface AgentAction {
  type: ActionType;
  target?: ActionTarget;
  value?: string;
  risk: RiskLevel;
  reason: string;
}

export interface SanitizedContext {
  task: string;
  url: string;
  safeDom: {
    viewport: { width: number; height: number };
    elements: Array<{
      id: string;
      role: string;
      text: string;
      bbox: [number, number, number, number];
      enabled: boolean;
      inputType?: string;
    }>;
  };
  safeText: string[];
  sanitizedImage: string | null; // Data URL or null; NEVER raw
  capabilities: ActionType[];
  privacyReceipt: PrivacyReceipt;
}

export interface PrivacyReceipt {
  detected: number;
  allowed: number;
  tokenized: number;
  blurred: number;
  masked: number;
  blocked: number;
  omitted: number;
  rawScreenshotSent: false; // Must strictly be false
  rawSecretSent: false;     // Must strictly be false
  payloadBytes: number;
  localInferenceMs: number;
  serverReasoningMs: number;
  timestamp: number;
}
