import { buildEquivalenceClasses, frequencyMap, getRiskLevel, type DataRow, type RiskLevel } from "./utils";

export interface AttributeDisclosureResult {
  riskScore: number;
  riskLevel: RiskLevel;
  totalGroups: number;
  highRiskGroups: number;
  avgDominantProb: number;
  worstCaseProb: number;
  entropyRisk: number;
  sensitiveAttrCount: number;
  dominantProbHistogram: { bucket: string; count: number }[];
  perGroupRisks: {
    qiCombo: string;
    size: number;
    dominantValue: string;
    dominantProb: number;
    entropy: number;
    maxEntropy: number;
    entropyRisk: number;
    riskLevel: RiskLevel;
  }[];
  topSensitiveValues: { value: string; frequency: number; groupPct: number }[];
  perSAResults: {
    sa: string;
    avgDominantProb: number;
    worstCaseProb: number;
    entropyRisk: number;
    highRiskGroups: number;
    riskLevel: RiskLevel;
  }[];
  recommendations: string[];
}

/**
 * Attribute Disclosure Attack
 *
 * Objective: Even if re-identification is prevented (k-anonymity holds),
 * can an attacker infer a sensitive attribute value from the equivalence class?
 *
 * Mathematical Model:
 *   For each equivalence class EC(QI):
 *
 *   Dominant probability:
 *     Pmax = max_v { freq(v) / |EC| }
 *
 *   Entropy-based version (Shannon entropy):
 *     H(S) = -Σ p_i × log2(p_i)
 *     H_max = log2(|distinct values|)
 *     Entropy Risk = 1 - H(S) / H_max   (0 = perfect diversity, 1 = full disclosure)
 *
 *   Attribute Disclosure Risk (ADR):
 *     ADR = Pmax   (probability attacker correctly guesses sensitive value)
 *
 *   Dataset-level risk (weighted by group size):
 *     Risk = Σ (|EC| × Pmax_EC) / N
 *
 * Risk Levels:
 *   ADR < 0.30 → LOW
 *   ADR 0.30–0.60 → MEDIUM
 *   ADR 0.60–0.80 → HIGH
 *   ADR > 0.80 → CRITICAL
 *
 * Reference: Machanavajjhala et al., l-Diversity: Privacy Beyond k-Anonymity,
 *            ACM TKDD 2007.
 */
export function runAttributeDisclosureAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[]
): AttributeDisclosureResult {
  if (data.length === 0 || quasiIdentifiers.length === 0 || sensitiveAttributes.length === 0) {
    return emptyResult(sensitiveAttributes.length);
  }

  const ecs = buildEquivalenceClasses(data, quasiIdentifiers);
  const N = data.length;

  // ── Per-group, per-SA analysis ────────────────────────────────────────────
  type GroupRisk = {
    qiCombo: string;
    size: number;
    dominantValue: string;
    dominantProb: number;
    entropy: number;
    maxEntropy: number;
    entropyRisk: number;
    riskLevel: RiskLevel;
  };

  let totalWeightedRisk = 0;
  let highRiskGroups = 0;
  const allGroupRisks: GroupRisk[] = [];
  const perSAMap = new Map<string, { dominantProbs: number[]; entropyRisks: number[]; highRisk: number }>();

  sensitiveAttributes.forEach((sa) => {
    perSAMap.set(sa, { dominantProbs: [], entropyRisks: [], highRisk: 0 });
  });

  ecs.forEach((ec) => {
    let ecMaxRisk = 0;
    let ecDominantValue = "";
    let ecDominantProb = 0;
    let ecEntropy = 0;
    let ecMaxEntropy = 0;
    let ecEntropyRisk = 0;

    sensitiveAttributes.forEach((sa) => {
      const vals = ec.records.map((r) => String(r[sa] ?? "MISSING"));
      const fm = frequencyMap(vals);

      // Dominant probability: Pmax = max(freq(v)) / |EC|
      let maxCount = 0;
      let dominantValue = "";
      fm.forEach((cnt, val) => {
        if (cnt > maxCount) { maxCount = cnt; dominantValue = val; }
      });
      const dominantProb = maxCount / ec.size;

      // Shannon entropy
      const distinctCount = fm.size;
      let entropy = 0;
      fm.forEach((cnt) => {
        const p = cnt / ec.size;
        if (p > 0) entropy -= p * Math.log2(p);
      });
      const maxEntropy = distinctCount > 1 ? Math.log2(distinctCount) : 1;
      const entropyRisk = maxEntropy > 0 ? 1 - entropy / maxEntropy : 1;

      const saEntry = perSAMap.get(sa)!;
      saEntry.dominantProbs.push(dominantProb);
      saEntry.entropyRisks.push(entropyRisk);
      if (dominantProb > 0.6) saEntry.highRisk++;

      // Use worst SA for the group-level risk
      if (dominantProb > ecDominantProb) {
        ecDominantProb = dominantProb;
        ecDominantValue = dominantValue;
        ecEntropy = entropy;
        ecMaxEntropy = maxEntropy;
        ecEntropyRisk = entropyRisk;
      }
    });

    ecMaxRisk = ecDominantProb;
    totalWeightedRisk += ec.size * ecMaxRisk;
    if (ecMaxRisk > 0.6) highRiskGroups++;

    allGroupRisks.push({
      qiCombo: ec.key.slice(0, 80),
      size: ec.size,
      dominantValue: ecDominantValue,
      dominantProb: ecDominantProb,
      entropy: ecEntropy,
      maxEntropy: ecMaxEntropy,
      entropyRisk: ecEntropyRisk,
      riskLevel: getRiskLevel(ecMaxRisk >= 0.8 ? 0.8 : ecMaxRisk >= 0.6 ? 0.65 : ecMaxRisk >= 0.3 ? 0.4 : 0.1),
    });
  });

  const riskScore = totalWeightedRisk / N;
  const avgDominantProb = allGroupRisks.reduce((s, g) => s + g.dominantProb, 0) / (allGroupRisks.length || 1);
  const worstCaseProb = allGroupRisks.reduce((m, g) => Math.max(m, g.dominantProb), 0);
  const avgEntropyRisk = allGroupRisks.reduce((s, g) => s + g.entropyRisk, 0) / (allGroupRisks.length || 1);

  // ── Dominant Probability Histogram ────────────────────────────────────────
  const probBuckets = [
    { label: "<30% LOW", min: 0, max: 0.3 },
    { label: "30-60% MED", min: 0.3, max: 0.6 },
    { label: "60-80% HIGH", min: 0.6, max: 0.8 },
    { label: ">80% CRIT", min: 0.8, max: 1.01 },
  ];
  const dominantProbHistogram = probBuckets.map(({ label, min, max }) => ({
    bucket: label,
    count: allGroupRisks.filter((g) => g.dominantProb >= min && g.dominantProb < max).length,
  }));

  // ── Top Sensitive Values ───────────────────────────────────────────────────
  const globalSensitiveValues = new Map<string, number>();
  sensitiveAttributes.forEach((sa) => {
    data.forEach((row) => {
      const v = String(row[sa] ?? "MISSING");
      globalSensitiveValues.set(v, (globalSensitiveValues.get(v) || 0) + 1);
    });
  });
  const topSensitiveValues = [...globalSensitiveValues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, frequency]) => ({
      value: value.slice(0, 30),
      frequency,
      groupPct: parseFloat(((frequency / N) * 100).toFixed(1)),
    }));

  // ── Per-SA Summary ────────────────────────────────────────────────────────
  const perSAResults = sensitiveAttributes.map((sa) => {
    const entry = perSAMap.get(sa)!;
    const avgDP = entry.dominantProbs.reduce((s, v) => s + v, 0) / (entry.dominantProbs.length || 1);
    const worstDP = entry.dominantProbs.reduce((m, v) => Math.max(m, v), 0);
    const avgER = entry.entropyRisks.reduce((s, v) => s + v, 0) / (entry.entropyRisks.length || 1);
    return {
      sa,
      avgDominantProb: parseFloat(avgDP.toFixed(3)),
      worstCaseProb: parseFloat(worstDP.toFixed(3)),
      entropyRisk: parseFloat(avgER.toFixed(3)),
      highRiskGroups: entry.highRisk,
      riskLevel: getRiskLevel(worstDP >= 0.8 ? 0.75 : worstDP >= 0.6 ? 0.6 : worstDP >= 0.3 ? 0.35 : 0.1),
    };
  });

  const perGroupRisks = [...allGroupRisks]
    .sort((a, b) => b.dominantProb - a.dominantProb)
    .slice(0, 20);

  return {
    riskScore: parseFloat(riskScore.toFixed(4)),
    riskLevel: getRiskLevel(riskScore),
    totalGroups: ecs.length,
    highRiskGroups,
    avgDominantProb: parseFloat(avgDominantProb.toFixed(3)),
    worstCaseProb: parseFloat(worstCaseProb.toFixed(3)),
    entropyRisk: parseFloat(avgEntropyRisk.toFixed(3)),
    sensitiveAttrCount: sensitiveAttributes.length,
    dominantProbHistogram,
    perGroupRisks,
    topSensitiveValues,
    perSAResults,
    recommendations: buildRecommendations(riskScore, worstCaseProb, highRiskGroups, ecs.length, avgEntropyRisk),
  };
}

function buildRecommendations(
  risk: number,
  worstCase: number,
  highRiskGroups: number,
  totalGroups: number,
  entropyRisk: number
): string[] {
  const recs: string[] = [];
  const highPct = totalGroups > 0 ? (highRiskGroups / totalGroups) * 100 : 0;

  if (worstCase > 0.8) {
    recs.push(`Worst-case attribute disclosure is ${(worstCase * 100).toFixed(0)}% — an attacker can guess the sensitive value with near-certainty in at least one equivalence class.`);
  }
  if (highPct > 30) {
    recs.push(`${highPct.toFixed(0)}% of equivalence classes have attribute disclosure risk > 60%. Apply L-Diversity (l ≥ 3) to distribute sensitive values across groups.`);
  }
  if (entropyRisk > 0.6) {
    recs.push("Low entropy in sensitive attribute distributions detected — equivalence classes are dominated by a single value. Increase data diversity or apply T-Closeness.");
  }
  if (risk > 0.5) {
    recs.push("Overall attribute disclosure risk is HIGH. Consider splitting high-risk equivalence classes by further generalizing quasi-identifiers or suppressing outlier records.");
  }
  recs.push("Use Entropy L-Diversity (Machanavajjhala et al. 2007) to ensure H(S) ≥ log2(l) within each equivalence class.");
  if (risk < 0.3) {
    recs.push("Attribute disclosure risk is LOW. Sensitive attributes are well-distributed across equivalence classes.");
  }
  return recs;
}

function emptyResult(saCount: number): AttributeDisclosureResult {
  return {
    riskScore: 0, riskLevel: "LOW", totalGroups: 0, highRiskGroups: 0,
    avgDominantProb: 0, worstCaseProb: 0, entropyRisk: 0, sensitiveAttrCount: saCount,
    dominantProbHistogram: [], perGroupRisks: [], topSensitiveValues: [],
    perSAResults: [], recommendations: ["Select at least one sensitive attribute to run Attribute Disclosure analysis."],
  };
}
