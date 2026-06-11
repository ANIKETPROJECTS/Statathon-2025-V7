import { getRiskLevel, RiskLevel } from "./utils";

export interface CompositeResult {
  score: number; // 0–100
  riskLevel: RiskLevel;
  breakdown: { attack: string; weight: number; risk: number; weighted: number }[];
}

/**
 * NIST-Inspired Composite Privacy Risk Score (8-Attack Framework)
 *
 * Weights reflect the threat landscape for Indian Government unit-level data:
 *  - Identity threats  (Prosecutor + Record Linkage + Singling Out): 0.50
 *  - Attribute threats (Attribute Disclosure + Marketer):            0.25
 *  - Inference threats (Journalist + Inference):                     0.20
 *  - Presence threats  (Membership):                                 0.05
 *
 * All weights sum to 1.00.
 */
const WEIGHTS = {
  prosecutor:           0.15,
  journalist:           0.15,
  marketer:             0.10,
  singlingOut:          0.15,
  inference:            0.10,
  membership:           0.05,
  recordLinkage:        0.15,
  attributeDisclosure:  0.15,
};

export function computeCompositeScore(risks: {
  prosecutor: number;
  journalist: number;
  marketer: number;
  singlingOut: number;
  inference: number;
  membership: number;
  recordLinkage: number;
  attributeDisclosure: number;
}): CompositeResult {
  const breakdown = [
    { attack: "Prosecutor",            weight: WEIGHTS.prosecutor,           risk: risks.prosecutor },
    { attack: "Journalist",            weight: WEIGHTS.journalist,           risk: risks.journalist },
    { attack: "Marketer",              weight: WEIGHTS.marketer,             risk: risks.marketer },
    { attack: "Singling Out",          weight: WEIGHTS.singlingOut,          risk: risks.singlingOut },
    { attack: "Inference",             weight: WEIGHTS.inference,            risk: risks.inference },
    { attack: "Membership",            weight: WEIGHTS.membership,           risk: risks.membership },
    { attack: "Record Linkage",        weight: WEIGHTS.recordLinkage,        risk: risks.recordLinkage },
    { attack: "Attribute Disclosure",  weight: WEIGHTS.attributeDisclosure,  risk: risks.attributeDisclosure },
  ].map((b) => ({ ...b, weighted: b.weight * b.risk }));

  const composite = breakdown.reduce((s, b) => s + b.weighted, 0);
  const score = parseFloat((composite * 100).toFixed(1));

  return {
    score,
    riskLevel: getRiskLevel(composite),
    breakdown,
  };
}
