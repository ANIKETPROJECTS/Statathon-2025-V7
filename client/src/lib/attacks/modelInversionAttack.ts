/**
 * Model Inversion Attack — SafeData Pipeline spec v1.0
 *
 * Sections implemented:
 *   §4.2 Attribute Inference (EC-based conditional distribution, VulnScore)
 *   §4.4 Aggregate Inversion (small-cell AggInvRisk)
 *   §4.5 Composite MIRisk per record and dataset
 *   §5   Thresholds & Risk Levels
 *   §6   k/l/t protection analysis
 *   §7   Attack Simulation pseudocode
 *   §8   All 8 result sections (data side)
 *
 * Reference: Fredrikson et al., ACM CCS 2015.
 */

import {
  buildEquivalenceClasses,
  freqDist,
  getRiskLevel,
  type DataRow,
  type RiskLevel,
} from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MIPerSAResult {
  sa: string;
  maxConfidence: number;
  meanConfidence: number;
  atRiskPct: number;
  riskLevel: RiskLevel;
}

export interface MIProtectionStat {
  total: number;
  satisfying: number;
  violating: number;
  violatingPct: number;
  exposedRecords: number;
  exposedPct: number;
}

export interface MISmallCells {
  count: number;
  totalCells: number;
  pct: number;
  highRiskCombos: { combo: string; size: number; aggRisk: number }[];
}

export interface MIRecordRow {
  rowIdx: number;
  qiHash: string;
  vulnScore: number;
  miRisk: number;
  riskLevel: RiskLevel;
  kOk: boolean;
  lOk: boolean;
  tOk: boolean;
  action: string;
}

export interface MILeakageEntry {
  qi: string;
  sa: string;
  mi: number;
}

export interface ModelInversionResult {
  // ── Core scores ──
  riskScore: number;
  riskLevel: RiskLevel;
  datasetMIRisk: number;
  totalRecords: number;
  atRiskCount: number;
  atRiskPct: number;

  // ── §8.2 Per-SA Attribute Inference ──
  perSAResults: MIPerSAResult[];

  // ── §8.3 EC VulnScore distribution ──
  ecVulnDistribution: { bucket: string; count: number }[];

  // ── §8.4 k/l/t protection ──
  kAnalysis: MIProtectionStat;
  lAnalysis: MIProtectionStat;
  tAnalysis: MIProtectionStat;

  // ── §8.5 Small-cell aggregate inversion ──
  aggInvRisk: number;
  smallCells: MISmallCells;

  // ── §8.6 Per-record drill-down ──
  perRecordTable: MIRecordRow[];

  // ── §8.7 Leakage map (Mutual Information) ──
  miLeakageMap: MILeakageEntry[];

  // ── §8.8 Recommendations ──
  recommendations: { priority: "P1" | "P2" | "P3"; label: string; mitigation: string; target: string; reduction: string }[];

  // ── Legacy fields (used by composite score + existing charts) ──
  successfulInversions: number;
  inversionRate: number;
  avgConfidence: number;
  maxConfidence: number;
  reconstructionAccuracy: number;
  confidenceHistogram: { bucket: string; count: number }[];
  inversionCurve: { threshold: string; inversions: number; rate: number }[];
  topReconstructedRecords: { qiCombo: string; targetSA: string; reconstructedValue: string; confidence: number }[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALPHA = 0.5;
const GAMMA = 0.2;
const BETA_FAIL = 0.3;
const HIGH_CONF_TAU = 0.85;
const SMALL_CELL_THETA = 5;
const TOP_COMBO_LIMIT = 20;
const PER_RECORD_LIMIT = 500;

// ─── EMD (L1 / Total Variation Distance) ──────────────────────────────────────

function emDistance(local: Map<string, number>, global: Map<string, number>): number {
  const allKeys = new Set([...Array.from(local.keys()), ...Array.from(global.keys())]);
  let tvd = 0;
  allKeys.forEach((k) => tvd += Math.abs((local.get(k) ?? 0) - (global.get(k) ?? 0)));
  return tvd / 2;
}

// ─── Mutual Information I(Q_j ; S) ────────────────────────────────────────────

function mutualInformation(data: DataRow[], qi: string, sa: string): number {
  const n = data.length;
  if (n === 0) return 0;

  const jointCounts = new Map<string, number>();
  const qiCounts = new Map<string, number>();
  const saCounts = new Map<string, number>();

  for (const row of data) {
    const q = String(row[qi] ?? "");
    const s = String(row[sa] ?? "");
    const key = `${q}|||${s}`;
    jointCounts.set(key, (jointCounts.get(key) ?? 0) + 1);
    qiCounts.set(q, (qiCounts.get(q) ?? 0) + 1);
    saCounts.set(s, (saCounts.get(s) ?? 0) + 1);
  }

  let mi = 0;
  jointCounts.forEach((cnt, key) => {
    const [q, s] = key.split("|||");
    const pQS = cnt / n;
    const pQ = (qiCounts.get(q) ?? 0) / n;
    const pS = (saCounts.get(s) ?? 0) / n;
    if (pQS > 0 && pQ > 0 && pS > 0) {
      mi += pQS * Math.log2(pQS / (pQ * pS));
    }
  });

  return Math.max(0, mi);
}

// ─── Action recommendation ────────────────────────────────────────────────────

function recommendAction(kOk: boolean, lOk: boolean, tOk: boolean, vulnScore: number): string {
  if (!lOk && vulnScore > 0.85) return "Suppress";
  if (!lOk) return "Add Diversity";
  if (!kOk) return "Generalise QI";
  if (!tOk) return "Generalise QI";
  return "—";
}

// ─── Main function ─────────────────────────────────────────────────────────────

export function runModelInversionAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[],
  k = 5,
  l = 3,
  t = 0.20,
): ModelInversionResult {
  if (data.length === 0 || quasiIdentifiers.length === 0 || sensitiveAttributes.length === 0) {
    return emptyResult();
  }

  const N = data.length;
  const ECs = buildEquivalenceClasses(data, quasiIdentifiers);
  const numECs = ECs.length;

  // ── Global SA distributions (for EMD) ────────────────────────────────────────
  const globalDists = new Map<string, Map<string, number>>();
  for (const sa of sensitiveAttributes) {
    const vals = data.map((r) => String(r[sa] ?? ""));
    globalDists.set(sa, freqDist(vals));
  }

  // ─── Per-EC computations ──────────────────────────────────────────────────────
  // Maps: ecKey → various stats
  interface ECStats {
    size: number;
    vulnScores: Map<string, number>;  // sa → max P(S|Q)
    localDists: Map<string, Map<string, number>>;
    kOk: boolean;
    lOk: boolean;
    tOk: boolean;
    aggInvRisk: number;
    records: DataRow[];
    qiCombo: string;
  }

  const ecStatMap = new Map<string, ECStats>();

  for (const ec of ECs) {
    const localVulnScores = new Map<string, number>();
    const localDists = new Map<string, Map<string, number>>();

    let lOk = true;
    let tOk = true;

    for (const sa of sensitiveAttributes) {
      const saVals = ec.records.map((r) => String(r[sa] ?? ""));
      const dist = freqDist(saVals);
      localDists.set(sa, dist);

      const maxP = Math.max(...Array.from(dist.values()));
      localVulnScores.set(sa, maxP);

      const distinctCount = dist.size;
      if (distinctCount < l) lOk = false;

      const emd = emDistance(dist, globalDists.get(sa)!);
      if (emd > t) tOk = false;
    }

    const kOk = ec.size >= k;
    const aggInvRisk = ec.size === 1 ? 1.0 : 1 / ec.size;

    const qiCombo = quasiIdentifiers.map((qi) => `${qi}=${ec.records[0]?.[qi] ?? ""}`).join(", ").slice(0, 80);

    ecStatMap.set(ec.key, {
      size: ec.size,
      vulnScores: localVulnScores,
      localDists,
      kOk,
      lOk,
      tOk,
      aggInvRisk,
      records: ec.records,
      qiCombo,
    });
  }

  // ─── §8.3 EC VulnScore distribution (histogram of max VulnScore per EC across all SAs) ──
  const ecVulnBuckets = [
    { bucket: "0.0–0.2", min: 0, max: 0.2 },
    { bucket: "0.2–0.4", min: 0.2, max: 0.4 },
    { bucket: "0.4–0.6", min: 0.4, max: 0.6 },
    { bucket: "0.6–0.8", min: 0.6, max: 0.8 },
    { bucket: "0.8–1.0", min: 0.8, max: 1.01 },
  ];
  const ecVulnScores: number[] = [];
  ecStatMap.forEach((stat) => {
    const maxV = Math.max(...Array.from(stat.vulnScores.values()));
    ecVulnScores.push(maxV);
  });
  const ecVulnDistribution = ecVulnBuckets.map(({ bucket, min, max }) => ({
    bucket,
    count: ecVulnScores.filter((v) => v >= min && v < max).length,
  }));

  // ─── §8.4 k/l/t Protection Analysis ─────────────────────────────────────────
  let kViolating = 0, lViolating = 0, tViolating = 0;
  let kExposed = 0, lExposed = 0, tExposed = 0;

  ecStatMap.forEach((stat) => {
    if (!stat.kOk) { kViolating++; kExposed += stat.size; }
    if (!stat.lOk) { lViolating++; lExposed += stat.size; }
    if (!stat.tOk) { tViolating++; tExposed += stat.size; }
  });

  const kAnalysis: MIProtectionStat = {
    total: numECs,
    satisfying: numECs - kViolating,
    violating: kViolating,
    violatingPct: parseFloat(((kViolating / Math.max(numECs, 1)) * 100).toFixed(1)),
    exposedRecords: kExposed,
    exposedPct: parseFloat(((kExposed / N) * 100).toFixed(1)),
  };
  const lAnalysis: MIProtectionStat = {
    total: numECs,
    satisfying: numECs - lViolating,
    violating: lViolating,
    violatingPct: parseFloat(((lViolating / Math.max(numECs, 1)) * 100).toFixed(1)),
    exposedRecords: lExposed,
    exposedPct: parseFloat(((lExposed / N) * 100).toFixed(1)),
  };
  const tAnalysis: MIProtectionStat = {
    total: numECs,
    satisfying: numECs - tViolating,
    violating: tViolating,
    violatingPct: parseFloat(((tViolating / Math.max(numECs, 1)) * 100).toFixed(1)),
    exposedRecords: tExposed,
    exposedPct: parseFloat(((tExposed / N) * 100).toFixed(1)),
  };

  // ─── §8.5 Small-Cell Aggregate Inversion ─────────────────────────────────────
  const smallCellECs: { combo: string; size: number; aggRisk: number }[] = [];
  let totalAggInvSum = 0;

  ecStatMap.forEach((stat) => {
    totalAggInvSum += stat.aggInvRisk;
    if (stat.size <= SMALL_CELL_THETA) {
      smallCellECs.push({ combo: stat.qiCombo, size: stat.size, aggRisk: parseFloat((1 / stat.size).toFixed(3)) });
    }
  });

  const aggInvRisk = parseFloat((totalAggInvSum / Math.max(numECs, 1)).toFixed(4));
  smallCellECs.sort((a, b) => b.aggRisk - a.aggRisk);

  const smallCells: MISmallCells = {
    count: smallCellECs.length,
    totalCells: numECs,
    pct: parseFloat(((smallCellECs.length / Math.max(numECs, 1)) * 100).toFixed(1)),
    highRiskCombos: smallCellECs.slice(0, TOP_COMBO_LIMIT),
  };

  // ─── §8.6 Per-record table + MIRisk computation ──────────────────────────────
  const perRecordTable: MIRecordRow[] = [];
  let totalMIRiskSum = 0;
  let atRiskCount = 0;
  const allVulnScores: number[] = [];
  const allMIRisks: number[] = [];

  // For legacy Naïve Bayes confidence histogram
  const legacyAllConfs: number[] = [];

  let rowIdx = 0;
  for (const ec of ECs) {
    const stat = ecStatMap.get(ec.key)!;

    // Max VulnScore across all SAs for this EC
    const ecMaxVuln = sensitiveAttributes.length > 0
      ? Math.max(...sensitiveAttributes.map((sa) => stat.vulnScores.get(sa) ?? 0))
      : 0;

    const miRisk = Math.min(1,
      ALPHA * ecMaxVuln +
      GAMMA * stat.aggInvRisk +
      (stat.lOk ? 0 : BETA_FAIL),
    );

    for (const row of ec.records) {
      allVulnScores.push(ecMaxVuln);
      allMIRisks.push(miRisk);
      legacyAllConfs.push(ecMaxVuln);
      totalMIRiskSum += miRisk;
      if (miRisk >= 0.61) atRiskCount++;

      if (perRecordTable.length < PER_RECORD_LIMIT) {
        const qiHash = quasiIdentifiers.map((qi) => `${qi}=${row[qi] ?? ""}`).join(", ").slice(0, 60);
        perRecordTable.push({
          rowIdx,
          qiHash,
          vulnScore: parseFloat((ecMaxVuln * 100).toFixed(1)),
          miRisk: parseFloat((miRisk * 100).toFixed(1)),
          riskLevel: classifyMIRisk(miRisk),
          kOk: stat.kOk,
          lOk: stat.lOk,
          tOk: stat.tOk,
          action: recommendAction(stat.kOk, stat.lOk, stat.tOk, ecMaxVuln),
        });
      }
      rowIdx++;
    }
  }

  // Sort per-record table by MIRisk descending
  perRecordTable.sort((a, b) => b.miRisk - a.miRisk);

  const datasetMIRisk = N > 0 ? parseFloat((totalMIRiskSum / N).toFixed(4)) : 0;
  const riskScore = datasetMIRisk;
  const riskLevel = classifyMIRisk(datasetMIRisk);
  const atRiskPct = parseFloat(((atRiskCount / Math.max(N, 1)) * 100).toFixed(1));

  // ─── §8.2 Per-SA Attribute Inference Breakdown ───────────────────────────────
  const perSAResults: MIPerSAResult[] = sensitiveAttributes.map((sa) => {
    let sumConf = 0, maxConf = 0, atRiskSA = 0;
    for (const ec of ECs) {
      const stat = ecStatMap.get(ec.key)!;
      const v = stat.vulnScores.get(sa) ?? 0;
      for (let i = 0; i < ec.size; i++) {
        sumConf += v;
        if (v > maxConf) maxConf = v;
        if (v > HIGH_CONF_TAU) atRiskSA++;
      }
    }
    const meanConf = N > 0 ? sumConf / N : 0;
    return {
      sa,
      maxConfidence: parseFloat((maxConf * 100).toFixed(1)),
      meanConfidence: parseFloat((meanConf * 100).toFixed(1)),
      atRiskPct: parseFloat(((atRiskSA / Math.max(N, 1)) * 100).toFixed(1)),
      riskLevel: classifyMIRisk(maxConf >= 0.81 ? 0.81 : maxConf >= 0.61 ? 0.65 : maxConf >= 0.31 ? 0.35 : 0.1),
    };
  });

  // ─── §8.7 Mutual Information Leakage Map ─────────────────────────────────────
  const miLeakageMap: MILeakageEntry[] = [];
  for (const qi of quasiIdentifiers) {
    for (const sa of sensitiveAttributes) {
      const mi = mutualInformation(data, qi, sa);
      miLeakageMap.push({ qi, sa, mi: parseFloat(mi.toFixed(4)) });
    }
  }
  miLeakageMap.sort((a, b) => b.mi - a.mi);

  // ─── §8.8 Recommendations ────────────────────────────────────────────────────
  const recs = buildRecommendations(datasetMIRisk, lAnalysis, kAnalysis, tAnalysis, smallCells, perSAResults);

  // ─── Legacy fields (confidence histogram + inversion curve + top records) ─────
  const confBuckets = [
    { label: "0–25% (Low)", min: 0, max: 0.25 },
    { label: "25–50%", min: 0.25, max: 0.5 },
    { label: "50–75%", min: 0.5, max: 0.75 },
    { label: "75–90%", min: 0.75, max: 0.9 },
    { label: ">90% (Critical)", min: 0.9, max: 1.01 },
  ];
  const confidenceHistogram = confBuckets.map(({ label, min, max }) => ({
    bucket: label,
    count: legacyAllConfs.filter((v) => v >= min && v < max).length,
  }));

  const thresholds = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  const inversionCurve = thresholds.map((thresh) => ({
    threshold: `${(thresh * 100).toFixed(0)}%`,
    inversions: legacyAllConfs.filter((v) => v >= thresh).length,
    rate: parseFloat(((legacyAllConfs.filter((v) => v >= thresh).length / Math.max(legacyAllConfs.length, 1)) * 100).toFixed(1)),
  }));

  const topReconstructedRecords: ModelInversionResult["topReconstructedRecords"] = [];
  for (const ec of ECs) {
    if (topReconstructedRecords.length >= 10) break;
    const stat = ecStatMap.get(ec.key)!;
    for (const sa of sensitiveAttributes) {
      const v = stat.vulnScores.get(sa) ?? 0;
      if (v > HIGH_CONF_TAU) {
        const globalDist = globalDists.get(sa)!;
        const localDist = stat.localDists.get(sa)!;
        let bestVal = "";
        let bestP = 0;
        localDist.forEach((p, val) => { if (p > bestP) { bestP = p; bestVal = val; } });
        topReconstructedRecords.push({
          qiCombo: stat.qiCombo,
          targetSA: sa,
          reconstructedValue: bestVal,
          confidence: parseFloat((v * 100).toFixed(1)),
        });
      }
    }
  }
  topReconstructedRecords.sort((a, b) => b.confidence - a.confidence);

  const successfulInversions = legacyAllConfs.filter((v) => v > 0.80).length;
  const avgConfidence = N > 0 ? parseFloat(((legacyAllConfs.reduce((s, v) => s + v, 0) / N) * 100).toFixed(1)) : 0;
  const maxConfidence = parseFloat((Math.max(...legacyAllConfs, 0) * 100).toFixed(1));

  return {
    riskScore,
    riskLevel,
    datasetMIRisk,
    totalRecords: N,
    atRiskCount,
    atRiskPct,
    perSAResults,
    ecVulnDistribution,
    kAnalysis,
    lAnalysis,
    tAnalysis,
    aggInvRisk,
    smallCells,
    perRecordTable,
    miLeakageMap,
    recommendations: recs,
    successfulInversions,
    inversionRate: parseFloat(((successfulInversions / Math.max(N, 1)) * 100).toFixed(1)),
    avgConfidence,
    maxConfidence,
    reconstructionAccuracy: 0,
    confidenceHistogram,
    inversionCurve,
    topReconstructedRecords: topReconstructedRecords.slice(0, 10),
  };
}

// ─── Risk Classification (§5) ─────────────────────────────────────────────────

function classifyMIRisk(score: number): RiskLevel {
  if (score >= 0.81) return "CRITICAL";
  if (score >= 0.61) return "HIGH";
  if (score >= 0.31) return "MEDIUM";
  return "LOW";
}

// ─── Recommendations (§8.8) ──────────────────────────────────────────────────

function buildRecommendations(
  datasetMIRisk: number,
  lA: MIProtectionStat,
  kA: MIProtectionStat,
  tA: MIProtectionStat,
  sc: MISmallCells,
  perSA: MIPerSAResult[],
): ModelInversionResult["recommendations"] {
  const recs: ModelInversionResult["recommendations"] = [];

  if (lA.violating > 0) {
    recs.push({
      priority: "P1",
      label: "Increase L-Diversity",
      mitigation: `Apply l-diversity (l ≥ ${Math.max(3, Math.ceil(lA.violating / 10))}) to all equivalence classes failing the l-check`,
      target: `${lA.violating} classes (${lA.exposedRecords} records) without sufficient SA diversity`,
      reduction: "~0.20 MIRisk reduction",
    });
  }

  const highVulnSAs = perSA.filter((s) => s.maxConfidence > 90);
  if (highVulnSAs.length > 0) {
    recs.push({
      priority: "P1",
      label: "Suppress High-Confidence Records",
      mitigation: `Suppress or generalise records where VulnScore > 90% for: ${highVulnSAs.map((s) => s.sa).join(", ")}`,
      target: `${highVulnSAs.length} sensitive attribute(s) with near-certain inference`,
      reduction: "~0.15 MIRisk reduction",
    });
  }

  if (kA.violating > 0) {
    recs.push({
      priority: "P2",
      label: "Generalise Quasi-Identifiers",
      mitigation: "Increase k-anonymity by generalising age bands, ZIP codes, or other QIs to reduce EC specificity",
      target: `${kA.violating} classes (${kA.exposedRecords} records) with EC size < k`,
      reduction: "~0.08 MIRisk reduction",
    });
  }

  if (sc.count > 0) {
    recs.push({
      priority: "P2",
      label: "Add Laplace Noise to Aggregates",
      mitigation: "Apply Differential Privacy (Laplace mechanism) to any published aggregate statistics to prevent differencing attacks",
      target: `${sc.count} small cells (n ≤ 5) that enable exact aggregate inversion`,
      reduction: "~0.05 MIRisk reduction",
    });
  }

  if (tA.violating > 0) {
    recs.push({
      priority: "P3",
      label: "Apply T-Closeness",
      mitigation: `Enforce t-closeness (t ≤ 0.15) for ${tA.violating} classes where SA distribution deviates from global`,
      target: `${tA.violating} equivalence classes with EMD > threshold`,
      reduction: "~0.04 MIRisk reduction",
    });
  }

  if (recs.length === 0) {
    recs.push({
      priority: "P3",
      label: "Model Output Perturbation",
      mitigation: "Apply prediction perturbation: return rounded/binned confidence scores instead of exact probabilities to prevent gradient-based inversion",
      target: "All model outputs and published statistics",
      reduction: "~0.03 MIRisk reduction",
    });
  }

  return recs;
}

// ─── Empty result ─────────────────────────────────────────────────────────────

function emptyResult(): ModelInversionResult {
  const emptyStat: MIProtectionStat = { total: 0, satisfying: 0, violating: 0, violatingPct: 0, exposedRecords: 0, exposedPct: 0 };
  return {
    riskScore: 0, riskLevel: "LOW", datasetMIRisk: 0, totalRecords: 0,
    atRiskCount: 0, atRiskPct: 0, perSAResults: [], ecVulnDistribution: [],
    kAnalysis: emptyStat, lAnalysis: emptyStat, tAnalysis: emptyStat,
    aggInvRisk: 0, smallCells: { count: 0, totalCells: 0, pct: 0, highRiskCombos: [] },
    perRecordTable: [], miLeakageMap: [],
    recommendations: [{ priority: "P3", label: "Configure Assessment", mitigation: "Select quasi-identifiers and sensitive attributes to run Model Inversion analysis.", target: "All columns", reduction: "N/A" }],
    successfulInversions: 0, inversionRate: 0, avgConfidence: 0, maxConfidence: 0,
    reconstructionAccuracy: 0, confidenceHistogram: [], inversionCurve: [], topReconstructedRecords: [],
  };
}
