/**
 * Marketer Attack — per SafeData Pipeline spec v1.0
 *
 * The Marketer Attack models a DATA BROKER attempting BULK re-identification.
 * Goal: re-identify as many records as possible for commercial gain.
 *
 * Key formulas:
 *   marketer_reid_rate   = num_distinct_ECs / N
 *   expected_reids       = num_distinct_ECs
 *   success_rate         = (N / P) × marketer_reid_rate
 *   attr_disclosure(EC)  = max_frequency_of_any_SA_value_within_EC
 *   population_inf_risk  = num_singletons / N
 */

import {
  buildEquivalenceClasses,
  DataRow,
  freqDist,
  getRiskLevel,
  RiskLevel,
  totalVariationDistance,
} from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketerRecordRow {
  rowIdx: number;
  qiValues: Record<string, string>;
  ecSize: number;
  linkScore: number;
  marketerValue: string;      // ★★★★★ scale
  marketerValueNum: number;   // 1–5 for sorting
  atRisk: boolean;
}

export interface MarketerAttrDisclosure {
  sa: string;
  avgDisclosureRisk: number;
  pctEcsFullDisclosure: number;
  minDisclosureRisk: number;
  maxDisclosureRisk: number;
  status: "PASS" | "WARN" | "FAIL";
}

export interface MarketerLDivResult {
  sa: string;
  minL: number;
  violatingEcs: number;
  totalEcs: number;
  violatingRecordPct: number;
  status: "PASS" | "FAIL";
}

export interface MarketerTCloseResult {
  sa: string;
  maxDistance: number;
  violatingEcs: number;
  totalEcs: number;
  status: "PASS" | "FAIL";
}

export interface MarketerResult {
  // Backward-compat (composite score)
  riskScore: number;
  riskLevel: RiskLevel;
  totalRecords: number;

  // Spec §4 fields
  sampleN: number;
  populationSize: number;
  samplingFraction: number;
  numDistinctEcs: number;
  marketerReIdRate: number;          // num_distinct_ECs / N
  marketerSuccessRate: number;       // (N/P) × reid_rate
  expectedCorrectReIds: number;      // = num_distinct_ECs
  numSingletons: number;
  populationInferenceRisk: number;   // num_singletons / N
  avgEcSize: number;
  minK: number;
  atRiskCount: number;
  protectedCount: number;
  quasiIdentifiers: string[];

  // Per-record table
  recordTable: MarketerRecordRow[];

  // EC distribution table+chart
  ecSizeTable: { label: string; numECs: number; numRecords: number; pct: string; marketerValue: string }[];

  // Link score distribution
  linkScoreDistribution: { bucket: string; count: number; interpretation: string }[];

  // Attribute disclosure (§4.7)
  attrDisclosure: MarketerAttrDisclosure[];

  // Top singletons for narrative
  topSingletons: { rowIdx: number; qiValues: Record<string, string> }[];

  // Top vulnerable records (§4.12)
  topVulnerable: {
    qiCombo: string;
    qiValues: Record<string, string>;
    linkScore: number;
    ecSize: number;
    marketerValue: string;
    reason: string;
  }[];

  // L-Diversity & T-Closeness
  lDiversityResults: MarketerLDivResult[];
  tClosenessResults: MarketerTCloseResult[];

  // Legacy fields (used by existing comparison/composite score logic)
  lDiversityPassRate: number;
  tClosenessPassRate: number;
  atRiskGroups: number;
  totalGroups: number;

  recommendations: string[];
}

// ─── Star rating helper ───────────────────────────────────────────────────────

function marketerStars(linkScore: number): { label: string; num: number } {
  if (linkScore >= 1.0)          return { label: "★★★★★", num: 5 };
  if (linkScore >= 0.5)          return { label: "★★★★☆", num: 4 };
  if (linkScore >= 0.25)         return { label: "★★★☆☆", num: 3 };
  if (linkScore >= 0.10)         return { label: "★★☆☆☆", num: 2 };
  return                                { label: "★☆☆☆☆", num: 1 };
}

// ─── Main function ────────────────────────────────────────────────────────────

export function runMarketerAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[] = [],
  lThreshold = 3,
  tThreshold = 0.2,
  kThreshold = 3,
  populationSizeOverride?: number,
): MarketerResult {
  const n = data.length;
  if (n === 0 || quasiIdentifiers.length === 0) return emptyResult(quasiIdentifiers);

  const P = populationSizeOverride ?? n * 10;
  const samplingFraction = n / P;

  // ── Step 1: Build EC map (key → row indices) ─────────────────────────────
  const ecMap = new Map<string, number[]>();
  data.forEach((row, idx) => {
    const key = quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|");
    const existing = ecMap.get(key);
    if (existing) existing.push(idx);
    else ecMap.set(key, [idx]);
  });

  const numDistinctEcs = ecMap.size;

  // ── Step 2: Per-record metrics ────────────────────────────────────────────
  const ecSizeArr: number[] = new Array(n);
  ecMap.forEach((indices) => {
    const sz = indices.length;
    indices.forEach((i) => { ecSizeArr[i] = sz; });
  });

  const recordTable: MarketerRecordRow[] = data.map((row, idx) => {
    const sz = ecSizeArr[idx];
    const ls = 1 / sz;
    const stars = marketerStars(ls);
    const qiValues: Record<string, string> = {};
    quasiIdentifiers.forEach((qi) => { qiValues[qi] = String(row[qi] ?? ""); });
    return {
      rowIdx: idx + 1,
      qiValues,
      ecSize: sz,
      linkScore: parseFloat(ls.toFixed(4)),
      marketerValue: stars.label,
      marketerValueNum: stars.num,
      atRisk: sz < kThreshold,
    };
  });

  // ── Step 3: Marketer-specific metrics ─────────────────────────────────────
  const marketerReIdRate = numDistinctEcs / n;
  const marketerSuccessRate = samplingFraction * marketerReIdRate;
  const expectedCorrectReIds = numDistinctEcs;

  const numSingletons = Array.from(ecMap.values()).filter((v) => v.length === 1).length;
  const populationInferenceRisk = numSingletons / n;

  const atRiskCount = recordTable.filter((r) => r.atRisk).length;
  const protectedCount = n - atRiskCount;
  const avgEcSize = n / numDistinctEcs;
  const minK = Math.min(...Array.from(ecMap.values()).map((v) => v.length));

  // ── Step 4: EC Size Distribution Table ───────────────────────────────────
  const ecBuckets = [
    { label: "1 (Unique)", min: 1, max: 1,         marketerValue: "★★★★★" },
    { label: "2–4",        min: 2, max: 4,         marketerValue: "★★★☆☆" },
    { label: "5–10",       min: 5, max: 10,        marketerValue: "★★☆☆☆" },
    { label: "11–20",      min: 11, max: 20,       marketerValue: "★☆☆☆☆" },
    { label: ">20",        min: 21, max: Infinity,  marketerValue: "★☆☆☆☆" },
  ];
  const ecSizeTable = ecBuckets.map((b) => {
    const matchingKeys: string[] = [];
    ecMap.forEach((indices, key) => {
      if (indices.length >= b.min && indices.length <= b.max) matchingKeys.push(key);
    });
    const numRecords = matchingKeys.reduce((s, k) => s + ecMap.get(k)!.length, 0);
    return {
      label: b.label,
      numECs: matchingKeys.length,
      numRecords,
      pct: n > 0 ? ((numRecords / n) * 100).toFixed(1) + "%" : "0%",
      marketerValue: b.marketerValue,
    };
  });

  // ── Step 5: Link Score Distribution ──────────────────────────────────────
  const scoreBuckets = [
    { bucket: "1.00 (certain)",    min: 1.0,  max: 1.0,   interpretation: "Premium-value records — 100% certain match" },
    { bucket: "0.51–0.99 (high)",  min: 0.51, max: 0.999, interpretation: "More likely correct than not — profitable target" },
    { bucket: "0.26–0.50 (med)",   min: 0.26, max: 0.50,  interpretation: "Coin-flip — marginal target" },
    { bucket: "0.01–0.25 (low)",   min: 0.01, max: 0.25,  interpretation: "< 25% chance — rarely targeted individually" },
    { bucket: "0.00 (safe)",       min: 0.0,  max: 0.0,   interpretation: "Effectively anonymous — no commercial value" },
  ];
  const linkScoreDistribution = scoreBuckets.map(({ bucket, min, max, interpretation }) => {
    const count = recordTable.filter((r) => {
      if (min === max) return Math.abs(r.linkScore - min) < 0.0001;
      return r.linkScore >= min && r.linkScore <= max;
    }).length;
    return { bucket, count, interpretation };
  });

  // ── Step 6: Attribute Disclosure Risk (§4.7) ──────────────────────────────
  const attrDisclosure: MarketerAttrDisclosure[] = sensitiveAttributes.map((sa) => {
    const ecMaxFreqs: number[] = [];
    let fullDisclosureEcs = 0;

    ecMap.forEach((indices) => {
      const counts = new Map<string, number>();
      indices.forEach((i) => {
        const v = String(data[i][sa] ?? "");
        counts.set(v, (counts.get(v) ?? 0) + 1);
      });
      const maxFreq = Math.max(...Array.from(counts.values())) / indices.length;
      ecMaxFreqs.push(maxFreq);
      if (maxFreq >= 1.0) fullDisclosureEcs++;
    });

    // Weighted average by records (per-record: use EC's maxFreq)
    let totalWeightedFreq = 0;
    ecMap.forEach((indices, key) => {
      const idx = [...ecMap.keys()].indexOf(key);
      totalWeightedFreq += ecMaxFreqs[idx] * indices.length;
    });
    const avgDisclosureRisk = n > 0 ? totalWeightedFreq / n : 0;
    const minDisclosureRisk = Math.min(...ecMaxFreqs);
    const maxDisclosureRisk = Math.max(...ecMaxFreqs);
    const pctEcsFullDisclosure = ecMap.size > 0 ? (fullDisclosureEcs / ecMap.size) * 100 : 0;

    const status: "PASS" | "WARN" | "FAIL" =
      avgDisclosureRisk > 0.8 ? "FAIL" :
      avgDisclosureRisk > 0.5 ? "WARN" : "PASS";

    return {
      sa,
      avgDisclosureRisk: parseFloat(avgDisclosureRisk.toFixed(4)),
      pctEcsFullDisclosure: parseFloat(pctEcsFullDisclosure.toFixed(1)),
      minDisclosureRisk: parseFloat(minDisclosureRisk.toFixed(4)),
      maxDisclosureRisk: parseFloat(maxDisclosureRisk.toFixed(4)),
      status,
    };
  });

  // ── Step 7: Top singletons for narrative (§4.4, §4.8) ────────────────────
  const topSingletons = recordTable
    .filter((r) => r.ecSize === 1)
    .slice(0, 3)
    .map((r) => ({ rowIdx: r.rowIdx, qiValues: r.qiValues }));

  // ── Step 8: Top 10 Vulnerable Records (§4.12) ────────────────────────────
  const topVulnerable = [...recordTable]
    .sort((a, b) => b.linkScore - a.linkScore)
    .slice(0, 10)
    .map((r) => ({
      qiCombo: quasiIdentifiers.map((qi) => `${qi}=${r.qiValues[qi]}`).join(", "),
      qiValues: r.qiValues,
      linkScore: r.linkScore,
      ecSize: r.ecSize,
      marketerValue: r.marketerValue,
      reason: r.ecSize === 1
        ? "Singleton — uniquely linkable in bulk attack"
        : `Only ${r.ecSize} look-alike${r.ecSize > 1 ? "s" : ""} — ${(r.linkScore * 100).toFixed(0)}% linkage probability`,
    }));

  // ── Step 9: L-Diversity (§4.9) ───────────────────────────────────────────
  let lDiverseCount = 0;
  const lDiversityResults: MarketerLDivResult[] = sensitiveAttributes.map((sa) => {
    let minL = Infinity;
    let violatingEcs = 0;
    let violatingRecords = 0;
    ecMap.forEach((indices) => {
      const vals = new Set<string>();
      indices.forEach((i) => vals.add(String(data[i][sa] ?? "")));
      if (vals.size < minL) minL = vals.size;
      if (vals.size < lThreshold) { violatingEcs++; violatingRecords += indices.length; }
    });
    if (!isFinite(minL)) minL = 0;
    const passes = violatingEcs === 0;
    if (passes) lDiverseCount++;
    return {
      sa,
      minL,
      violatingEcs,
      totalEcs: ecMap.size,
      violatingRecordPct: parseFloat(((violatingRecords / n) * 100).toFixed(1)),
      status: passes ? "PASS" : "FAIL",
    };
  });

  // ── Step 10: T-Closeness (§4.10) ─────────────────────────────────────────
  let tCloseCount = 0;
  const tClosenessResults: MarketerTCloseResult[] = sensitiveAttributes.map((sa) => {
    const globalCounts = new Map<string, number>();
    data.forEach((row) => {
      const v = String(row[sa] ?? "");
      globalCounts.set(v, (globalCounts.get(v) ?? 0) + 1);
    });
    const globalDist: Record<string, number> = {};
    globalCounts.forEach((count, v) => { globalDist[v] = count / n; });
    const allValues = Array.from(globalCounts.keys());

    let maxDistance = 0;
    let violatingEcs = 0;
    ecMap.forEach((indices) => {
      const localCounts = new Map<string, number>();
      indices.forEach((i) => {
        const v = String(data[i][sa] ?? "");
        localCounts.set(v, (localCounts.get(v) ?? 0) + 1);
      });
      const sz = indices.length;
      let tvd = 0;
      allValues.forEach((v) => {
        const lp = (localCounts.get(v) ?? 0) / sz;
        const gp = globalDist[v] ?? 0;
        tvd += Math.abs(lp - gp);
      });
      tvd /= 2;
      if (tvd > maxDistance) maxDistance = tvd;
      if (tvd > tThreshold) violatingEcs++;
    });
    const passes = violatingEcs === 0;
    if (passes) tCloseCount++;
    return {
      sa,
      maxDistance: parseFloat(maxDistance.toFixed(4)),
      violatingEcs,
      totalEcs: ecMap.size,
      status: passes ? "PASS" : "FAIL",
    };
  });

  // Legacy pass rates for composite score
  const saCount = Math.max(1, sensitiveAttributes.length);
  const lDiversityPassRate = lDiverseCount / saCount;
  const tClosenessPassRate = tCloseCount / saCount;
  const atRiskGroups = lDiversityResults.filter((r) => r.status === "FAIL").length +
    tClosenessResults.filter((r) => r.status === "FAIL").length;

  // ── Step 11: Recommendations (§4.13) ─────────────────────────────────────
  const recommendations: string[] = [];
  const topQI = quasiIdentifiers[0] ?? "quasi-identifier";

  if (numSingletons > 0) {
    recommendations.push(
      `🔴 CRITICAL — ${numSingletons} singleton record${numSingletons > 1 ? "s" : ""} detected. Commercial value: HIGHEST (100% linkage certainty). Action: Apply record suppression — remove these ${numSingletons} row${numSingletons > 1 ? "s" : ""} before release, OR generalise "${topQI}" to reduce singleton count to zero.`
    );
  }
  if (marketerReIdRate > 0.2) {
    recommendations.push(
      `🔴 HIGH — Marketer Re-ID Rate is ${(marketerReIdRate * 100).toFixed(1)}% (threshold: <5%). ${expectedCorrectReIds} records are linkable in a bulk attack. Action: Apply k-anonymisation. Generalise "${topQI}" to reduce the number of distinct ECs. Aim for Min-K ≥ ${kThreshold}.`
    );
  } else if (marketerReIdRate > 0.05) {
    recommendations.push(
      `🟡 MEDIUM — Marketer Re-ID Rate ${(marketerReIdRate * 100).toFixed(1)}% is above the 5% safe threshold. Consider additional generalisation to reduce linkable ECs.`
    );
  }
  attrDisclosure.filter((a) => a.status === "FAIL").forEach((a) => {
    recommendations.push(
      `🔴 HIGH — Attribute Disclosure Risk for "${a.sa}" is ${(a.avgDisclosureRisk * 100).toFixed(1)}%. A data broker who links records can infer "${a.sa}" with ${(a.avgDisclosureRisk * 100).toFixed(1)}% accuracy. Action: Ensure l-diversity ≥ ${lThreshold} within every EC.`
    );
  });
  attrDisclosure.filter((a) => a.status === "WARN").forEach((a) => {
    recommendations.push(
      `🟡 MEDIUM — Attribute Disclosure Risk for "${a.sa}" is ${(a.avgDisclosureRisk * 100).toFixed(1)}% (50–80% range). Significant leakage risk — consider coarsening or suppressing.`
    );
  });
  lDiversityResults.filter((r) => r.status === "FAIL").forEach((r) => {
    recommendations.push(
      `🟡 MEDIUM — L-Diversity violated for "${r.sa}" (${r.violatingEcs}/${r.totalEcs} ECs have fewer than ${lThreshold} distinct values). Apply local suppression or top-coding.`
    );
  });
  tClosenessResults.filter((r) => r.status === "FAIL").forEach((r) => {
    recommendations.push(
      `🟡 MEDIUM — T-Closeness violated for "${r.sa}" (max TVD: ${r.maxDistance} > ${tThreshold}). Consider value generalisation or post-randomisation.`
    );
  });
  recommendations.push(
    `ℹ️ POPULATION CONTEXT — This dataset represents ${(samplingFraction * 100).toFixed(1)}% of an assumed population of ${P.toLocaleString()}. Marketer success rate: ${(marketerSuccessRate * 100).toFixed(2)}% per random target.`
  );
  recommendations.push(
    `ℹ️ NEXT STEP — Go to "Privacy Enhancement" to apply these fixes automatically. After enhancement, re-run this assessment to verify improvement.`
  );

  return {
    riskScore: marketerReIdRate,
    riskLevel: getRiskLevel(marketerReIdRate),
    totalRecords: n,
    sampleN: n,
    populationSize: P,
    samplingFraction,
    numDistinctEcs,
    marketerReIdRate,
    marketerSuccessRate,
    expectedCorrectReIds,
    numSingletons,
    populationInferenceRisk,
    avgEcSize: parseFloat(avgEcSize.toFixed(2)),
    minK,
    atRiskCount,
    protectedCount,
    quasiIdentifiers,
    recordTable,
    ecSizeTable,
    linkScoreDistribution,
    attrDisclosure,
    topSingletons,
    topVulnerable,
    lDiversityResults,
    tClosenessResults,
    lDiversityPassRate,
    tClosenessPassRate,
    atRiskGroups,
    totalGroups: numDistinctEcs,
    recommendations,
  };
}

// ─── Empty result ─────────────────────────────────────────────────────────────

function emptyResult(qis: string[]): MarketerResult {
  return {
    riskScore: 0, riskLevel: "LOW", totalRecords: 0,
    sampleN: 0, populationSize: 0, samplingFraction: 0,
    numDistinctEcs: 0, marketerReIdRate: 0, marketerSuccessRate: 0,
    expectedCorrectReIds: 0, numSingletons: 0, populationInferenceRisk: 0,
    avgEcSize: 0, minK: 0, atRiskCount: 0, protectedCount: 0,
    quasiIdentifiers: qis,
    recordTable: [], ecSizeTable: [], linkScoreDistribution: [],
    attrDisclosure: [], topSingletons: [], topVulnerable: [],
    lDiversityResults: [], tClosenessResults: [],
    lDiversityPassRate: 1, tClosenessPassRate: 1, atRiskGroups: 0, totalGroups: 0,
    recommendations: ["No data or quasi-identifiers selected."],
  };
}
