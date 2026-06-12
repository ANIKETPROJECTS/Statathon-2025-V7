import { getRiskLevel, RiskLevel } from "./utils";

export interface CompositeResult {
  score: number; // 0–100
  riskLevel: RiskLevel;
  breakdown: { attack: string; weight: number; risk: number; weighted: number; enabled: boolean }[];
  enabledCount: number;
}

/**
 * NIST-Inspired Composite Privacy Risk Score (10-Attack Framework)
 *
 * Only ENABLED (run) attacks contribute to the composite score.
 * Weights of enabled attacks are re-normalized to sum to 1.0, so:
 *   composite = Σ(weight_i * risk_i) / Σ(weight_i)  for enabled attacks only
 *
 * Disabled/unrun attacks appear in the breakdown with enabled=false and
 * weighted=0 — they do NOT dilute the score.
 *
 * Relative weights (before normalization):
 *   Identity threats  (Prosecutor + Record Linkage + Singling Out): 0.36
 *   Attribute threats (Attr. Disclosure + Marketer + Differencing):  0.31
 *   Inference threats (Journalist + Inference + Model Inversion):    0.29
 *   Presence threats  (Membership):                                  0.04
 */
const WEIGHTS: Record<string, number> = {
  prosecutor:          0.12,
  journalist:          0.10,
  marketer:            0.08,
  singlingOut:         0.12,
  inference:           0.08,
  membership:          0.04,
  recordLinkage:       0.12,
  attributeDisclosure: 0.12,
  differencing:        0.11,
  modelInversion:      0.11,
};

const LABELS: Record<string, string> = {
  prosecutor:          "Prosecutor",
  journalist:          "Journalist",
  marketer:            "Marketer",
  singlingOut:         "Singling Out",
  inference:           "Inference",
  membership:          "Membership",
  recordLinkage:       "Record Linkage",
  attributeDisclosure: "Attr. Disclosure",
  differencing:        "Differencing",
  modelInversion:      "Model Inversion",
};

export function computeCompositeScore(risks: {
  prosecutor?:          number;
  journalist?:          number;
  marketer?:            number;
  singlingOut?:         number;
  inference?:           number;
  membership?:          number;
  recordLinkage?:       number;
  attributeDisclosure?: number;
  differencing?:        number;
  modelInversion?:      number;
}): CompositeResult {
  const keys = Object.keys(WEIGHTS) as (keyof typeof risks)[];

  const enabledWeightSum = keys
    .filter((k) => risks[k] !== undefined)
    .reduce((s, k) => s + WEIGHTS[k], 0);

  const breakdown = keys.map((k) => {
    const enabled = risks[k] !== undefined;
    const risk    = risks[k] ?? 0;
    const rawW    = WEIGHTS[k];
    const normW   = enabledWeightSum > 0 && enabled ? rawW / enabledWeightSum : 0;
    return {
      attack:  LABELS[k],
      weight:  parseFloat((normW * 100).toFixed(1)),
      risk:    parseFloat((risk  * 100).toFixed(1)),
      weighted: parseFloat((normW * risk * 100).toFixed(1)),
      enabled,
    };
  });

  const composite = enabledWeightSum > 0
    ? keys
        .filter((k) => risks[k] !== undefined)
        .reduce((s, k) => s + (WEIGHTS[k] / enabledWeightSum) * (risks[k] ?? 0), 0)
    : 0;

  const score = parseFloat((composite * 100).toFixed(1));

  return {
    score,
    riskLevel: getRiskLevel(composite),
    breakdown,
    enabledCount: keys.filter((k) => risks[k] !== undefined).length,
  };
}
