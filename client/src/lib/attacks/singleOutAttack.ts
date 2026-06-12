/**
 * Singling Out Attack — Full Spec Implementation
 *
 * Per GDPR Article 29 WP / EDPB definition:
 *   "The ability to isolate some or all records which identify an individual in the dataset."
 *
 * Two sub-attacks:
 *   1. Predicate Singling Out — subsets of QI columns (size 1–3) that return exactly 1 record
 *   2. Probabilistic Singling Out — expected fraction isolatable via EC rarity
 *
 * Algorithm follows the SafeData Pipeline Singling Out Spec §3.5.
 */

import { DataRow, getRiskLevel, RiskLevel } from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubsetSummary {
  subset: string[];
  subsetSize: number;
  soCount: number;
  soRate: number;
  minEcSize: number;
}

export interface EcBucket {
  sizeLabel: string;
  minSize: number;
  maxSize: number;
  numECs: number;
  numRecords: number;
  pctDataset: number;
}

export interface SoScoreBucket {
  label: string;
  count: number;
  meaning: string;
}

export interface VulnerableRecord {
  rowIndex: number;
  qiValues: Record<string, string>;
  ecSize: number;
  soScore: number;
  probSoScore: number;
  singledOut: boolean;
  mostIsolatingPredicate: string;
  status: "SINGLED_OUT" | "PARTIALLY_ISOLATED" | "PROTECTED";
}

export interface RecordSoDetail {
  rowIndex: number;
  qiValues: Record<string, string>;
  ecSize: number;
  soScore: number;
  probSoScore: number;
  singledOut: boolean;
  status: "SINGLED_OUT" | "PARTIALLY_ISOLATED" | "PROTECTED";
}

export interface LDivSoResult {
  minL: number;
  violatingECs: number;
  totalECs: number;
  combinedSinglingRisk: number;
}

export interface TCloseSoResult {
  maxDistance: number;
  violatingECs: number;
  totalECs: number;
}

export interface SingleOutResult {
  // Core metrics
  N: number;
  numSingletons: number;
  predicateSoFull: number;   // % singled out by full QI set
  predicateSoRate: number;   // % singled out by any 1–3 column subset
  probSoRate: number;        // numDistinctECs / N * 100
  numDistinctECs: number;
  totalSubsetsTested: number;
  minK: number;
  avgEcSize: number;
  atRiskCount: number;
  protectedCount: number;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";

  // Column analysis
  soloSoCounts: Record<string, number>;
  pairSoCounts: Record<string, number>;
  topDangerousSubsets: SubsetSummary[];

  // Distributions
  ecDistribution: EcBucket[];
  soScoreDistribution: SoScoreBucket[];

  // Records
  topVulnerable: VulnerableRecord[];
  allRecords: RecordSoDetail[];

  // L-Diversity & T-Closeness per SA
  lDiversity: Record<string, LDivSoResult>;
  tCloseness: Record<string, TCloseSoResult>;

  // Recommendations
  recommendations: string[];

  // QI/SA context
  quasiIdentifiers: string[];
  sensitiveAttributes: string[];

  // Legacy fields (composite score / older callers)
  riskScore: number;
  singlingOutRate: number;
  singulableCount: number;
  totalRecords: number;
  avgFootprint: number;
  gdprStatus: "FAIL" | "PASS";
  footprintHistogram: { label: string; count: number }[];
  effortCurve: { k: number; pct: number }[];
  attrSingulability: { attr: string; score: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 1) return arr.map((v) => [v]);
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    getCombinations(arr.slice(i + 1), k - 1).forEach((combo) =>
      result.push([arr[i], ...combo])
    );
  }
  return result;
}

function buildEcDistribution(
  groups: Map<string, number[]>,
  n: number
): EcBucket[] {
  const buckets: EcBucket[] = [
    { sizeLabel: "1 (Unique / Singled Out)", minSize: 1, maxSize: 1, numECs: 0, numRecords: 0, pctDataset: 0 },
    { sizeLabel: "2–4", minSize: 2, maxSize: 4, numECs: 0, numRecords: 0, pctDataset: 0 },
    { sizeLabel: "5–10", minSize: 5, maxSize: 10, numECs: 0, numRecords: 0, pctDataset: 0 },
    { sizeLabel: "11–20", minSize: 11, maxSize: 20, numECs: 0, numRecords: 0, pctDataset: 0 },
    { sizeLabel: ">20", minSize: 21, maxSize: Infinity, numECs: 0, numRecords: 0, pctDataset: 0 },
  ];
  groups.forEach((indices) => {
    const sz = indices.length;
    const bucket = buckets.find((b) => sz >= b.minSize && sz <= b.maxSize);
    if (bucket) {
      bucket.numECs++;
      bucket.numRecords += sz;
    }
  });
  buckets.forEach((b) => {
    b.pctDataset = n > 0 ? Math.round((b.numRecords / n) * 1000) / 10 : 0;
  });
  return buckets;
}

function buildSoScoreDist(scores: number[]): SoScoreBucket[] {
  const buckets: SoScoreBucket[] = [
    { label: "1.00 (all subsets)", count: 0, meaning: "Completely isolated — every QI combo singles them out" },
    { label: "0.51–0.99 (high)", count: 0, meaning: "Singled out by majority of tested subsets" },
    { label: "0.26–0.50 (medium)", count: 0, meaning: "Singled out by some subsets — moderate risk" },
    { label: "0.01–0.25 (low)", count: 0, meaning: "Singled out by few subsets — low but real risk" },
    { label: "0.00 (protected)", count: 0, meaning: "Not singled out by any tested subset" },
  ];
  scores.forEach((s) => {
    if (s >= 1.0) buckets[0].count++;
    else if (s > 0.50) buckets[1].count++;
    else if (s > 0.25) buckets[2].count++;
    else if (s > 0) buckets[3].count++;
    else buckets[4].count++;
  });
  return buckets;
}

function buildRecommendations(
  numSingletons: number,
  n: number,
  atRiskCount: number,
  predicateSoRate: number,
  probSoRate: number,
  soloSoCounts: Record<string, number>,
  pairSoCounts: Record<string, number>,
  topDangerousSubsets: SubsetSummary[],
  lDiversity: Record<string, LDivSoResult>,
  tCloseness: Record<string, TCloseSoResult>,
  qis: string[],
  k: number,
  l: number
): string[] {
  const recs: string[] = [];

  if (numSingletons > 0) {
    recs.push(
      `🔴 CRITICAL — ${numSingletons} record${numSingletons !== 1 ? "s are" : " is"} uniquely identified by all QIs combined. ` +
      `An attacker needs only ONE predicate query using ALL selected QI columns to isolate these individuals with 100% certainty. ` +
      `Action: Apply record suppression — remove or heavily generalise these rows. Target: 0 singleton records after generalisation.`
    );
  }

  // Top solo column
  const topSoloEntry = Object.entries(soloSoCounts).sort((a, b) => b[1] - a[1])[0];
  if (topSoloEntry && topSoloEntry[1] > 0) {
    recs.push(
      `🔴 CRITICAL — Column "${topSoloEntry[0]}" singles out ${topSoloEntry[1]} record${topSoloEntry[1] !== 1 ? "s" : ""} on its own — it acts as a de-facto direct identifier. ` +
      `Action: Remove "${topSoloEntry[0]}" from the released dataset entirely, or replace with a generalised/bucketed version.`
    );
  }

  if (predicateSoRate > 20) {
    const topPair = topDangerousSubsets.find((s) => s.subsetSize === 2);
    recs.push(
      `🔴 HIGH — Predicate Singling Out Rate is ${predicateSoRate.toFixed(1)}% (threshold: <5%). ` +
      `${atRiskCount} records are isolatable by at least one 1–3 column predicate. ` +
      (topPair ? `Start with [${topPair.subset.join(", ")}] — this pair alone singles out ${topPair.soCount} records. ` : "") +
      `Action: Generalise the top dangerous column combinations listed in the Dangerous Combinations table.`
    );
  } else if (predicateSoRate > 5) {
    recs.push(
      `🟡 MEDIUM — Predicate Singling Out Rate is ${predicateSoRate.toFixed(1)}% (threshold: <5%). ` +
      `${atRiskCount} records are isolatable. Action: Apply k-anonymisation with k ≥ ${k} and generalise the top QI combinations.`
    );
  }

  if (probSoRate > 20) {
    recs.push(
      `🟡 MEDIUM — Probabilistic SO Rate is ${probSoRate.toFixed(1)}%. Even records not singled out by exact predicates have rare QI profiles. ` +
      `Action: Apply k-anonymisation with k ≥ ${k} across all QI combinations to reduce the number of distinct equivalence classes.`
    );
  }

  Object.entries(lDiversity).forEach(([sa, res]) => {
    if (res.combinedSinglingRisk > 0) {
      recs.push(
        `🔴 HIGH — ${res.combinedSinglingRisk} record${res.combinedSinglingRisk !== 1 ? "s are" : " is"} BOTH singled out AND in L-Diversity-violating ECs for "${sa}". ` +
        `An attacker can isolate the individual AND read their "${sa}" value with 100% certainty — the most severe privacy outcome. ` +
        `Action: Apply (1) suppression/generalisation of the top singling column, AND (2) L-Diversity enforcement on "${sa}".`
      );
    } else if (res.violatingECs > 0) {
      recs.push(
        `🟡 MEDIUM — L-Diversity violated for "${sa}" in ${res.violatingECs} ECs. ` +
        `Action: Ensure each QI group has at least ${l} distinct values of "${sa}". Consider coarsening or suppressing "${sa}" in the released dataset.`
      );
    }
  });

  recs.push(
    `ℹ️ NOTE ON EXTERNAL DATA REQUIREMENT — Unlike Prosecutor and Marketer attacks, Singling Out requires NO external databases. ` +
    `This risk is inherent to the released dataset itself and cannot be mitigated by restricting access to external data sources.`
  );
  recs.push(
    `ℹ️ NEXT STEP — Go to "Privacy Enhancement" to apply these fixes automatically. ` +
    `After enhancement, re-run this assessment to verify that the Predicate SO Rate drops below 5%.`
  );

  return recs;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function runSingleOutAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[] = [],
  k: number = 5,
  l: number = 3,
  t: number = 0.20,
  maxSubsetSize: number = 3
): SingleOutResult {
  const n = data.length;
  if (n === 0 || quasiIdentifiers.length === 0) return emptyResult(quasiIdentifiers, sensitiveAttributes);

  // Sample up to 500 rows for performance
  const sample = n > 500 ? data.slice(0, 500) : [...data];
  const sn = sample.length;

  // Limit QIs to 8 for manageable subset enumeration
  const qis = quasiIdentifiers.slice(0, 8);

  // ── Step 1: Build full-QI Equivalence Classes ──────────────────────────────
  const fullEcGroups = new Map<string, number[]>();
  sample.forEach((row, idx) => {
    const key = qis.map((qi) => String(row[qi] ?? "")).join("|");
    if (!fullEcGroups.has(key)) fullEcGroups.set(key, []);
    fullEcGroups.get(key)!.push(idx);
  });

  const ecSizeByIdx = new Map<number, number>();
  fullEcGroups.forEach((indices) => {
    indices.forEach((idx) => ecSizeByIdx.set(idx, indices.length));
  });

  const allEcSizes = Array.from(ecSizeByIdx.values());
  const numSingletons = allEcSizes.filter((s) => s === 1).length;
  const predicateSoFull = (numSingletons / sn) * 100;
  const numDistinctECs = fullEcGroups.size;
  const probSoRate = (numDistinctECs / sn) * 100;
  const minK = allEcSizes.length > 0 ? Math.min(...allEcSizes) : 0;
  const avgEcSize = allEcSizes.length > 0 ? allEcSizes.reduce((a, b) => a + b, 0) / sn : 0;

  // ── Step 2: Enumerate all QI subsets up to maxSubsetSize ───────────────────
  const allSubsets: string[][] = [];
  const capSize = Math.min(maxSubsetSize, qis.length);
  for (let sz = 1; sz <= capSize; sz++) {
    getCombinations(qis, sz).forEach((combo) => allSubsets.push(combo));
  }
  const totalSubsets = allSubsets.length;

  // ── Step 3: For each subset — compute which records are singled out ─────────
  const subsetSoCount = new Array(sn).fill(0);
  const minSingledSubset: (string[] | null)[] = new Array(sn).fill(null);
  const soloSoCounts: Record<string, number> = {};
  const pairSoCounts: Record<string, number> = {};
  qis.forEach((qi) => { soloSoCounts[qi] = 0; });

  const subsetSummaries: SubsetSummary[] = [];

  for (const subset of allSubsets) {
    const subEcMap = new Map<string, number[]>();
    sample.forEach((row, idx) => {
      const key = subset.map((c) => String(row[c] ?? "")).join("|");
      if (!subEcMap.has(key)) subEcMap.set(key, []);
      subEcMap.get(key)!.push(idx);
    });

    let soCountThis = 0;
    let minEcSizeThis = Infinity;

    subEcMap.forEach((indices) => {
      const sz = indices.length;
      minEcSizeThis = Math.min(minEcSizeThis, sz);
      if (sz === 1) {
        soCountThis++;
        const idx = indices[0];
        subsetSoCount[idx]++;
        if (minSingledSubset[idx] === null || subset.length < minSingledSubset[idx]!.length) {
          minSingledSubset[idx] = subset;
        }
      }
    });

    subsetSummaries.push({
      subset,
      subsetSize: subset.length,
      soCount: soCountThis,
      soRate: Math.round((soCountThis / sn) * 1000) / 10,
      minEcSize: minEcSizeThis === Infinity ? 0 : minEcSizeThis,
    });

    if (subset.length === 1) soloSoCounts[subset[0]] = soCountThis;
    if (subset.length === 2) pairSoCounts[`${subset[0]},${subset[1]}`] = soCountThis;
  }

  // ── Step 4: Per-record scores ──────────────────────────────────────────────
  const soScores = subsetSoCount.map((c) => totalSubsets > 0 ? c / totalSubsets : 0);
  const probSoScores = sample.map((_, idx) => {
    const sz = ecSizeByIdx.get(idx) ?? 1;
    return 1 / sz;
  });
  const singledOut = subsetSoCount.map((c) => c > 0);
  const atRiskCount = singledOut.filter(Boolean).length;
  const protectedCount = sn - atRiskCount;
  const predicateSoRate = (atRiskCount / sn) * 100;

  // ── Step 5: Distributions ──────────────────────────────────────────────────
  const ecDistribution = buildEcDistribution(fullEcGroups, sn);
  const soScoreDistribution = buildSoScoreDist(soScores);
  const topDangerousSubsets = [...subsetSummaries]
    .sort((a, b) => b.soCount - a.soCount)
    .slice(0, 10);

  // ── Step 6: All records + top vulnerable ──────────────────────────────────
  const allRecords: RecordSoDetail[] = sample.map((row, idx) => {
    const qiVals: Record<string, string> = {};
    qis.forEach((qi) => { qiVals[qi] = String(row[qi] ?? ""); });
    const ecSize = ecSizeByIdx.get(idx) ?? 1;
    const so = singledOut[idx];
    const status: RecordSoDetail["status"] =
      so ? "SINGLED_OUT" :
      ecSize < k ? "PARTIALLY_ISOLATED" : "PROTECTED";
    return {
      rowIndex: idx + 1,
      qiValues: qiVals,
      ecSize,
      soScore: Math.round(soScores[idx] * 1000) / 1000,
      probSoScore: Math.round(probSoScores[idx] * 1000) / 1000,
      singledOut: so,
      status,
    };
  });

  const topVulnerable: VulnerableRecord[] = [...allRecords]
    .sort((a, b) => b.soScore - a.soScore || b.probSoScore - a.probSoScore)
    .slice(0, 10)
    .map((r) => {
      const isoSubset = minSingledSubset[r.rowIndex - 1];
      const pred = isoSubset
        ? isoSubset.map((c) => `${c}=${r.qiValues[c]}`).join(" AND ")
        : "—";
      return { ...r, mostIsolatingPredicate: pred };
    });

  // ── Step 7: L-Diversity & T-Closeness per SA ──────────────────────────────
  const lDiversity: Record<string, LDivSoResult> = {};
  const tCloseness: Record<string, TCloseSoResult> = {};

  for (const sa of sensitiveAttributes) {
    // L-Diversity
    let minL = Infinity;
    let violatingL = 0;
    fullEcGroups.forEach((indices) => {
      const vals = new Set(indices.map((i) => String(sample[i][sa] ?? "")));
      const lVal = vals.size;
      minL = Math.min(minL, lVal);
      if (lVal < l) violatingL++;
    });

    // Combined singling + l-div risk: records that are singled out AND in l-violating ECs
    let combinedRisk = 0;
    fullEcGroups.forEach((indices) => {
      const lDivVals = new Set(indices.map((i) => String(sample[i][sa] ?? "")));
      if (lDivVals.size < l) {
        indices.forEach((i) => { if (singledOut[i]) combinedRisk++; });
      }
    });

    lDiversity[sa] = {
      minL: minL === Infinity ? 0 : minL,
      violatingECs: violatingL,
      totalECs: numDistinctECs,
      combinedSinglingRisk: combinedRisk,
    };

    // T-Closeness
    const globalCounts = new Map<string, number>();
    sample.forEach((row) => {
      const v = String(row[sa] ?? "");
      globalCounts.set(v, (globalCounts.get(v) ?? 0) + 1);
    });
    const globalDist = new Map<string, number>();
    globalCounts.forEach((cnt, v) => globalDist.set(v, cnt / sn));

    let maxDist = 0;
    let violatingT = 0;
    fullEcGroups.forEach((indices) => {
      const localCounts = new Map<string, number>();
      indices.forEach((i) => {
        const v = String(sample[i][sa] ?? "");
        localCounts.set(v, (localCounts.get(v) ?? 0) + 1);
      });
      const localDist = new Map<string, number>();
      localCounts.forEach((cnt, v) => localDist.set(v, cnt / indices.length));

      const allVals = new Set([
        ...Array.from(globalDist.keys()),
        ...Array.from(localDist.keys()),
      ]);
      let tvd = 0;
      allVals.forEach((v) => {
        tvd += Math.abs((localDist.get(v) ?? 0) - (globalDist.get(v) ?? 0));
      });
      tvd /= 2;
      maxDist = Math.max(maxDist, tvd);
      if (tvd > t) violatingT++;
    });

    tCloseness[sa] = {
      maxDistance: Math.round(maxDist * 10000) / 10000,
      violatingECs: violatingT,
      totalECs: numDistinctECs,
    };
  }

  // ── Step 8: Recommendations ────────────────────────────────────────────────
  const recommendations = buildRecommendations(
    numSingletons, sn, atRiskCount,
    Math.round(predicateSoRate * 10) / 10,
    Math.round(probSoRate * 10) / 10,
    soloSoCounts, pairSoCounts, topDangerousSubsets,
    lDiversity, tCloseness, qis, k, l
  );

  // ── Legacy fields ──────────────────────────────────────────────────────────
  const footprints: number[] = [];
  allRecords.forEach((r, idx) => {
    if (r.singledOut && minSingledSubset[idx]) {
      footprints.push(minSingledSubset[idx]!.length);
    }
  });
  const avgFootprint =
    footprints.length > 0
      ? Math.round((footprints.reduce((a, b) => a + b, 0) / footprints.length) * 100) / 100
      : 0;
  const footprintHistogram = [1, 2, 3, 4, 5].map((fk) => ({
    label: `${fk} attr${fk > 1 ? "s" : ""}`,
    count: footprints.filter((f) => f === fk).length,
  }));
  const effortCurve = [1, 2, 3, 4, 5].map((fk) => ({
    k: fk,
    pct: parseFloat(((footprints.filter((f) => f <= fk).length / sn) * 100).toFixed(1)),
  }));
  const attrSingulability = qis
    .map((col) => ({
      attr: col,
      score: parseFloat(((soloSoCounts[col] ?? 0) / sn).toFixed(3)),
    }))
    .sort((a, b) => b.score - a.score);

  const riskLev: "HIGH" | "MEDIUM" | "LOW" =
    predicateSoRate > 20 ? "HIGH" : predicateSoRate > 5 ? "MEDIUM" : "LOW";

  return {
    N: sn,
    numSingletons,
    predicateSoFull: Math.round(predicateSoFull * 10) / 10,
    predicateSoRate: Math.round(predicateSoRate * 10) / 10,
    probSoRate: Math.round(probSoRate * 10) / 10,
    numDistinctECs,
    totalSubsetsTested: totalSubsets,
    minK,
    avgEcSize: Math.round(avgEcSize * 100) / 100,
    atRiskCount,
    protectedCount,
    riskLevel: riskLev,
    soloSoCounts,
    pairSoCounts,
    topDangerousSubsets,
    ecDistribution,
    soScoreDistribution,
    topVulnerable,
    allRecords,
    lDiversity,
    tCloseness,
    recommendations,
    quasiIdentifiers: qis,
    sensitiveAttributes,
    // Legacy
    riskScore: Math.round(predicateSoRate) / 100,
    singlingOutRate: Math.round(predicateSoRate * 10) / 1000,
    singulableCount: atRiskCount,
    totalRecords: sn,
    avgFootprint,
    gdprStatus: predicateSoRate > 5 ? "FAIL" : "PASS",
    footprintHistogram,
    effortCurve,
    attrSingulability,
  };
}

function emptyResult(qis: string[], sas: string[]): SingleOutResult {
  return {
    N: 0, numSingletons: 0, predicateSoFull: 0, predicateSoRate: 0, probSoRate: 0,
    numDistinctECs: 0, totalSubsetsTested: 0, minK: 0, avgEcSize: 0,
    atRiskCount: 0, protectedCount: 0, riskLevel: "LOW",
    soloSoCounts: {}, pairSoCounts: {}, topDangerousSubsets: [],
    ecDistribution: [], soScoreDistribution: [],
    topVulnerable: [], allRecords: [],
    lDiversity: {}, tCloseness: {},
    recommendations: ["Select quasi-identifiers to run Singling Out Attack."],
    quasiIdentifiers: qis, sensitiveAttributes: sas,
    riskScore: 0, singlingOutRate: 0, singulableCount: 0, totalRecords: 0,
    avgFootprint: 0, gdprStatus: "PASS",
    footprintHistogram: [], effortCurve: [], attrSingulability: [],
  };
}
