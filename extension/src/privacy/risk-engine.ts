/**
 * Transparent Engineering Risk Engine
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md and 02_PRIVACY_FIREWALL_PLAN.md.
 * Formula: risk = sensitivity_weight * detection_confidence * exposure_impact (clamped to [0, 1])
 */

import { DetectedEntity } from '../common/types.js';
import {
  SensitivityTier,
  SENSITIVITY_TIERS,
  TIER_WEIGHTS,
  PrivacyCategory,
} from './categories.js';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskAssessment {
  score: number; // [0, 1]
  tier: SensitivityTier;
  category: PrivacyCategory;
  level: RiskLevel;
  formula: string;
  factors: {
    sensitivityWeight: number;
    confidence: number;
    exposureImpact: number;
  };
}

/**
 * Computes transparent engineering risk score clamped to [0, 1].
 * Formula: sensitivity_weight * confidence * exposure_impact
 */
export function computeRiskScore(
  tier: SensitivityTier,
  confidence: number,
  exposureImpact = 1.0
): number {
  const sensitivityWeight = TIER_WEIGHTS[tier] ?? 0.0;
  const clampedConfidence = Math.max(0, Math.min(1, confidence));
  const clampedExposure = Math.max(0, Math.min(1, exposureImpact));

  const rawRisk = sensitivityWeight * clampedConfidence * clampedExposure;
  const clampedRisk = Math.max(0, Math.min(1, rawRisk));

  // Precision rounded to 3 decimal places
  return Math.round(clampedRisk * 1000) / 1000;
}

/**
 * Maps a numerical risk score and tier to a qualitative RiskLevel.
 */
export function getRiskLevel(score: number, tier: SensitivityTier): RiskLevel {
  if (tier === SENSITIVITY_TIERS.SECRET || score >= 0.85) {
    return 'critical';
  }
  if (score >= 0.60) {
    return 'high';
  }
  if (score >= 0.30) {
    return 'medium';
  }
  return 'low';
}

/**
 * Fully assesses an entity's risk and provides transparent engineering factors.
 */
export function assessEntityRisk(
  entity: DetectedEntity,
  exposureImpact = 1.0
): RiskAssessment {
  const sensitivityWeight = TIER_WEIGHTS[entity.tier] ?? 0.0;
  const score = computeRiskScore(entity.tier, entity.confidence, exposureImpact);
  const level = getRiskLevel(score, entity.tier);

  return {
    score,
    tier: entity.tier,
    category: entity.category,
    level,
    formula: `${sensitivityWeight.toFixed(2)} (weight) * ${entity.confidence.toFixed(2)} (conf) * ${exposureImpact.toFixed(2)} (exposure)`,
    factors: {
      sensitivityWeight,
      confidence: entity.confidence,
      exposureImpact,
    },
  };
}
