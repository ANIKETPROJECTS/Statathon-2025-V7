/**
 * Differencing Attack — per SafeData Pipeline spec v1.0
 *
 * An attacker with access to a query interface (counts, sums, averages) issues two
 * carefully chosen aggregate queries that differ by exactly one record, then subtracts
 * the results to isolate that individual's sensitive attribute value.
 *
 * Core formula:
 *   diff_risk(r) = f(|EC(r)|)   — see risk function below
 *   DDR           = mean(diff_risk(r)) across all N records
 *   riskScore     = DDR
 *
 * Labels: Exact Reconstruction / Near-Exact / Partial / Protected
 */

import { freqDist, totalVariationDistance, getRiskLevel, isNumeric, type DataRow, type RiskLevel } from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiffLabel = "Exact Reconstruction" | "Near-Exact" | "Partial" | "Protected";

export interface DiffRecordRow {
  rowIdx: number;
  qiValues: Record<string, string>;
  ecSize: number;
  diffRisk: number;
  diffLabel: DiffLabel;
  queryPairPossible: boolean;
  atRisk: boolean;
}

export interface ECSizeBucket {
  label: string;
  ecCount: number;
  recordCount: number;
  pct: number;
  riskCategory: "Exact" | "Near-Exact" | "Partial" | "Protected" | "Safe";
  fill: string;
}

export interface DiffSARecon {
  sa: string;
  isNumericSA: boolean;
  saRange: number;
  saStd: number;
  saMin: number;
  saMax: number;
  exactReconEcs: number;
  requiredNoiseStd: number;
  reconstructionTable: { ecSize: number; reconError: number; errorPct: number; verdict: string }[];
}

export interface DiffQueryPair {
  rank: number;
  rowIdx: number;
  qiCombo: string;
  qiConditions: string;
  ecSize: number;
  saName: string;
  r1: number | null;
  r2: number | null;
  reconstructedValue: number | string | null;
  diffRisk: number;
  formula: string;
}

export interface DifferencingResult {
  riskScore: number;
  riskLevel: RiskLevel;
  N: number;
  ddr: number;
  exactCount: number;
  nearExactCount: number;
  partialCount: number;
  protectedCount: number;
  coverageRate: number;
  distinctEcs: number;
  minK: number;
  avgEcSize: number;
  quasiIdentifiers: string[];
  sensitiveAttributes: string[];
  recordTable: DiffRecordRow[];
  ecSizeDistribution: ECSizeBucket[];
  saReconstruction: DiffSARecon[];
  lDivResults: { sa: string; minL: number; violatingEcs: number; totalEcs: number; lStatus: "PASS" | "FAIL" }[];
  tCloseResults: { sa: string; maxDistance: number; violatingEcs: number; totalEcs: number; tStatus: "PASS" | "FAIL" }[];
  topVulnerable: { rank: number; qiCombo: string; ecSize: number; diffRisk: number; diffLabel: DiffLabel; whyVulnerable: string }[];
  queryPairs: DiffQueryPair[];
  mostVulnerableRecord: {
    rowIdx: number; qiValues: Record<string, string>; ecSize: number;
    diffRisk: number; saName: string; saValue: string | null;
    isNumericSA: boolean; r1: number | null; r2: number | null;
    reconstructedValue: number | string | null;
  } | null;
  recommendations: string[];
}

// ─── Risk function ────────────────────────────────────────────────────────────

function diffRisk(ecSize: number, k: number): number {
  if (ecSize === 1)  return 1.00;
  if (ecSize === 2)  return 0.75;
  if (ecSize === 3)  return 0.50;
  if (ecSize < k)    return parseFloat((1 / ecSize).toFixed(4));
  return parseFloat(Math.max(0.05, 1 / ecSize).toFixed(4));
}

function diffLabel(ecSize: number, k: number): DiffLabel {
  if (ecSize === 1)  return "Exact Reconstruction";
  if (ecSize <= 3)   return "Near-Exact";
  if (ecSize < k)    return "Partial";
  return "Protected";
}

// ─── Main function ────────────────────────────────────────────────────────────

export function runDifferencingAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[],
  kThreshold = 5,
  lThreshold = 3,
  tThreshold = 0.2,
): DifferencingResult {
  const N = data.length;
  if (N === 0 || quasiIdentifiers.length === 0) return emptyResult(quasiIdentifiers, sensitiveAttributes);

  // ── Step 1: Build EC map ───────────────────────────────────────────────────
  const ecMap = new Map<string, number[]>();
  data.forEach((row, idx) => {
    const key = quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|");
    const existing = ecMap.get(key);
    if (existing) existing.push(idx);
    else ecMap.set(key, [idx]);
  });

  const ecSizeArr: number[] = new Array(N);
  ecMap.forEach((indices) => { const sz = indices.length; indices.forEach((i) => { ecSizeArr[i] = sz; }); });

  // ── Step 2: Per-record risk & label ────────────────────────────────────────
  const recordTable: DiffRecordRow[] = data.map((row, idx) => {
    const sz = ecSizeArr[idx];
    const risk = diffRisk(sz, kThreshold);
    const label = diffLabel(sz, kThreshold);
    const qiValues: Record<string, string> = {};
    quasiIdentifiers.forEach((qi) => { qiValues[qi] = String(row[qi] ?? ""); });
    return {
      rowIdx: idx + 1,
      qiValues,
      ecSize: sz,
      diffRisk: risk,
      diffLabel: label,
      queryPairPossible: sz <= 3,
      atRisk: sz < kThreshold,
    };
  });

  // ── Step 3: Dataset-level metrics ─────────────────────────────────────────
  const exactCount    = data.filter((_, i) => ecSizeArr[i] === 1).length;
  const nearExactCount = data.filter((_, i) => ecSizeArr[i] > 1 && ecSizeArr[i] <= 3).length;
  const partialCount  = data.filter((_, i) => ecSizeArr[i] >= 4 && ecSizeArr[i] < kThreshold).length;
  const protectedCount = data.filter((_, i) => ecSizeArr[i] >= kThreshold).length;

  const ddr = recordTable.reduce((s, r) => s + r.diffRisk, 0) / N;
  const coverageRate = ((exactCount + nearExactCount) / N) * 100;
  const distinctEcs  = ecMap.size;
  const minK = Math.min(...ecSizeArr);
  const avgEcSize = ecSizeArr.reduce((s, v) => s + v, 0) / N;

  // ── Step 4: EC size distribution table ────────────────────────────────────
  const ecSizeCounts = new Map<number, number>(); // ec_size → count of ECs with that size
  ecMap.forEach((indices) => {
    const sz = indices.length;
    ecSizeCounts.set(sz, (ecSizeCounts.get(sz) ?? 0) + 1);
  });

  const bucket1Ecs     = Array.from(ecSizeCounts.entries()).filter(([s]) => s === 1).reduce((s, [, c]) => s + c, 0);
  const bucket23Ecs    = Array.from(ecSizeCounts.entries()).filter(([s]) => s >= 2 && s <= 3).reduce((s, [, c]) => s + c, 0);
  const bucketPartEcs  = Array.from(ecSizeCounts.entries()).filter(([s]) => s >= 4 && s < kThreshold).reduce((s, [, c]) => s + c, 0);
  const bucketProtEcs  = Array.from(ecSizeCounts.entries()).filter(([s]) => s >= kThreshold && s <= 10).reduce((s, [, c]) => s + c, 0);
  const bucketSafeEcs  = Array.from(ecSizeCounts.entries()).filter(([s]) => s > 10).reduce((s, [, c]) => s + c, 0);

  const ecSizeDistribution: ECSizeBucket[] = [
    { label: "1 (Exact)", ecCount: bucket1Ecs, recordCount: exactCount, pct: N > 0 ? parseFloat(((exactCount / N) * 100).toFixed(1)) : 0, riskCategory: "Exact", fill: "#DC2626" },
    { label: "2–3 (Near-Exact)", ecCount: bucket23Ecs, recordCount: nearExactCount, pct: N > 0 ? parseFloat(((nearExactCount / N) * 100).toFixed(1)) : 0, riskCategory: "Near-Exact", fill: "#EA580C" },
    { label: `4–${kThreshold - 1} (Partial)`, ecCount: bucketPartEcs, recordCount: partialCount, pct: N > 0 ? parseFloat(((partialCount / N) * 100).toFixed(1)) : 0, riskCategory: "Partial", fill: "#D97706" },
    { label: `${kThreshold}–10 (Protected)`, ecCount: bucketProtEcs, recordCount: protectedCount - data.filter((_, i) => ecSizeArr[i] > 10).length, pct: 0, riskCategory: "Protected", fill: "#16A34A" },
    { label: ">10 (Safe)", ecCount: bucketSafeEcs, recordCount: data.filter((_, i) => ecSizeArr[i] > 10).length, pct: 0, riskCategory: "Safe", fill: "#15803D" },
  ].map((b) => ({ ...b, pct: b.pct || (N > 0 ? parseFloat(((b.recordCount / N) * 100).toFixed(1)) : 0) }));

  // ── Step 5: Per-SA reconstruction analysis ────────────────────────────────
  const saReconstruction: DiffSARecon[] = sensitiveAttributes.map((sa) => {
    const numericSA = isNumeric(data, sa);
    const vals = data.map((r) => Number(r[sa])).filter((v) => !isNaN(v));
    const saMin = vals.length > 0 ? Math.min(...vals) : 0;
    const saMax = vals.length > 0 ? Math.max(...vals) : 0;
    const saRange = Math.max(1, saMax - saMin);
    const saMean = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const saStd = vals.length > 1
      ? Math.sqrt(vals.reduce((s, v) => s + (v - saMean) ** 2, 0) / vals.length)
      : 1;

    const exactReconEcs = Array.from(ecMap.values()).filter((idxArr) => idxArr.length === 1).length;
    const requiredNoiseStd = numericSA ? saRange : 1;

    const reconstructionTable = [1, 2, 3, 5, kThreshold, 10].map((sz) => {
      const reconError = numericSA ? saStd / Math.sqrt(sz) : 0;
      const errorPct   = numericSA ? parseFloat(((reconError / saRange) * 100).toFixed(1)) : 0;
      const verdict    = sz === 1 ? "🔴 Exact" : reconError < 0.1 * saRange ? "🔴 High" : reconError < 0.3 * saRange ? "🟠 Moderate" : "🟢 Protected";
      return { ecSize: sz, reconError: parseFloat(reconError.toFixed(4)), errorPct, verdict };
    });

    return { sa, isNumericSA: numericSA, saRange, saStd: parseFloat(saStd.toFixed(4)), saMin, saMax, exactReconEcs, requiredNoiseStd, reconstructionTable };
  });

  // ── Step 6: L-Diversity per SA ─────────────────────────────────────────────
  const lDivResults = sensitiveAttributes.map((sa) => {
    let minL = Infinity;
    let violatingEcs = 0;
    ecMap.forEach((indices) => {
      const vals = new Set(indices.map((i) => String(data[i][sa] ?? "")));
      if (vals.size < minL) minL = vals.size;
      if (vals.size < lThreshold) violatingEcs++;
    });
    return { sa, minL: minL === Infinity ? 0 : minL, violatingEcs, totalEcs: ecMap.size, lStatus: violatingEcs === 0 ? "PASS" as const : "FAIL" as const };
  });

  // ── Step 7: T-Closeness per SA ─────────────────────────────────────────────
  const tCloseResults = sensitiveAttributes.map((sa) => {
    const globalVals = data.map((r) => String(r[sa] ?? ""));
    const globalDist = freqDist(globalVals);
    let maxDistance = 0;
    let violatingEcs = 0;
    ecMap.forEach((indices) => {
      const localVals = indices.map((i) => String(data[i][sa] ?? ""));
      const localDist = freqDist(localVals);
      const tvd = totalVariationDistance(localDist, globalDist);
      if (tvd > maxDistance) maxDistance = tvd;
      if (tvd > tThreshold) violatingEcs++;
    });
    return { sa, maxDistance: parseFloat(maxDistance.toFixed(4)), violatingEcs, totalEcs: ecMap.size, tStatus: violatingEcs === 0 ? "PASS" as const : "FAIL" as const };
  });

  // ── Step 8: Top 10 vulnerable records ─────────────────────────────────────
  const topVulnerable = [...recordTable]
    .sort((a, b) => b.diffRisk - a.diffRisk)
    .slice(0, 10)
    .map((row, i) => ({
      rank: i + 1,
      qiCombo: quasiIdentifiers.map((qi) => `${qi}=${row.qiValues[qi]}`).join(", "),
      ecSize: row.ecSize,
      diffRisk: row.diffRisk,
      diffLabel: row.diffLabel,
      whyVulnerable: row.ecSize === 1
        ? "Singleton — query pair isolates exactly"
        : row.ecSize <= 3
          ? `Group of ${row.ecSize} — high-confidence subtraction`
          : `EC below k=${kThreshold} — differencing produces signal`,
    }));

  // ── Step 9: Query pair catalogue (top 5 most vulnerable) ──────────────────
  const topForQueryPairs = [...recordTable]
    .sort((a, b) => b.diffRisk - a.diffRisk)
    .slice(0, 5);

  const primarySA = sensitiveAttributes[0] ?? "";
  const primarySANumeric = isNumeric(data, primarySA);

  const queryPairs: DiffQueryPair[] = topForQueryPairs.map((row, i) => {
    const qiKey = quasiIdentifiers.map((qi) => `${row.qiValues[qi]}`).join("|");
    const ecIndices = ecMap.get(qiKey) ?? [];
    const qiConditions = quasiIdentifiers.map((qi) => `${qi}='${row.qiValues[qi]}'`).join(" AND ");

    let r1: number | null = null;
    let r2: number | null = null;
    let reconstructedValue: number | string | null = null;
    let formula = "SA Value = R₁×n − R₂×(n−1)";

    if (primarySA && ecIndices.length > 0) {
      if (primarySANumeric) {
        const saVals = ecIndices.map((idx) => Number(data[idx][primarySA])).filter((v) => !isNaN(v));
        if (saVals.length > 0) {
          r1 = parseFloat((saVals.reduce((s, v) => s + v, 0) / saVals.length).toFixed(2));
          const withoutTarget = saVals.slice(1);
          r2 = withoutTarget.length > 0 ? parseFloat((withoutTarget.reduce((s, v) => s + v, 0) / withoutTarget.length).toFixed(2)) : r1;
          const n = saVals.length;
          reconstructedValue = parseFloat((r1 * n - r2 * (n - 1)).toFixed(2));
          formula = `SA = AVG_full×${n} − AVG_without×${n - 1} = ${r1}×${n} − ${r2}×${n - 1} = ${reconstructedValue}`;
        }
      } else {
        // Count-based for categorical
        const targetVal = String(data[ecIndices[0] ?? 0]?.[primarySA] ?? "");
        const countWithTarget = ecIndices.filter((idx) => String(data[idx][primarySA] ?? "") === targetVal).length;
        const countWithout    = Math.max(0, countWithTarget - 1);
        r1 = countWithTarget;
        r2 = countWithout;
        reconstructedValue = countWithTarget - countWithout === 1 ? `${primarySA} = ${targetVal}` : "Unknown";
        formula = `COUNT(${primarySA}='${targetVal}') = ${countWithTarget} − ${countWithout} = ${countWithTarget - countWithout}`;
      }
    }

    return {
      rank: i + 1,
      rowIdx: row.rowIdx,
      qiCombo: quasiIdentifiers.map((qi) => `${qi}=${row.qiValues[qi]}`).join(", "),
      qiConditions,
      ecSize: row.ecSize,
      saName: primarySA || "SA",
      r1,
      r2,
      reconstructedValue,
      diffRisk: row.diffRisk,
      formula,
    };
  });

  // ── Step 10: Most vulnerable record (for narrative §5.5) ──────────────────
  let mostVulnerableRecord: DifferencingResult["mostVulnerableRecord"] = null;
  if (topForQueryPairs.length > 0) {
    const mvRow = topForQueryPairs[0];
    const mvQiKey = quasiIdentifiers.map((qi) => `${mvRow.qiValues[qi]}`).join("|");
    const mvEc = ecMap.get(mvQiKey) ?? [];
    const mvSaValue = mvEc.length > 0 && primarySA ? String(data[mvEc[0]]?.[primarySA] ?? "") : null;
    const qp = queryPairs[0];
    mostVulnerableRecord = {
      rowIdx: mvRow.rowIdx,
      qiValues: mvRow.qiValues,
      ecSize: mvRow.ecSize,
      diffRisk: mvRow.diffRisk,
      saName: primarySA || "SA",
      saValue: mvSaValue,
      isNumericSA: primarySANumeric,
      r1: qp?.r1 ?? null,
      r2: qp?.r2 ?? null,
      reconstructedValue: qp?.reconstructedValue ?? null,
    };
  }

  // ── Step 11: Recommendations ───────────────────────────────────────────────
  const recommendations = buildRecommendations(
    ddr, exactCount, nearExactCount, partialCount, kThreshold, lThreshold,
    saReconstruction, lDivResults, N,
  );

  return {
    riskScore: parseFloat(ddr.toFixed(4)),
    riskLevel: ddr > 0.2 ? "HIGH" : ddr >= 0.05 ? "MEDIUM" : "LOW",
    N,
    ddr,
    exactCount,
    nearExactCount,
    partialCount,
    protectedCount,
    coverageRate: parseFloat(coverageRate.toFixed(2)),
    distinctEcs,
    minK,
    avgEcSize: parseFloat(avgEcSize.toFixed(2)),
    quasiIdentifiers,
    sensitiveAttributes,
    recordTable,
    ecSizeDistribution,
    saReconstruction,
    lDivResults,
    tCloseResults,
    topVulnerable,
    queryPairs,
    mostVulnerableRecord,
    recommendations,
  };
}

// ─── Recommendations ──────────────────────────────────────────────────────────

function buildRecommendations(
  ddr: number,
  exactCount: number,
  nearExactCount: number,
  partialCount: number,
  k: number,
  l: number,
  saRecon: DiffSARecon[],
  lDivResults: { sa: string; violatingEcs: number; totalEcs: number }[],
  N: number,
): string[] {
  const recs: string[] = [];

  if (exactCount > 0) {
    const noiseStr = saRecon[0] ? ` Additionally, add Laplace noise (std ≥ ${saRecon[0].requiredNoiseStd.toFixed(2)}) to any published aggregates.` : "";
    recs.push(
      `🔴 CRITICAL — ${exactCount} records are exactly reconstructable (singleton ECs). Any attacker with query access can issue two aggregate queries to reconstruct a sensitive attribute value with zero error for these individuals. Action: Apply record suppression for singleton ECs, OR generalise QIs to merge singletons into larger groups.${noiseStr}`
    );
  }

  if (nearExactCount > 0) {
    recs.push(
      `🔴 HIGH — ${nearExactCount} records are near-exactly reconstructable (EC size 2–3). Groups of 2–3 records allow 50–75% reconstruction accuracy. Combined with external auxiliary data, accuracy increases further. Action: Push all ECs to size ≥ k=${k} via QI generalisation.`
    );
  }

  recs.push(
    `🔴 CRITICAL — No Differential Privacy noise applied. k-anonymity and l-diversity do NOT protect against differencing. The only robust protection is adding calibrated noise to aggregates before release. Action: In Privacy Enhancement, apply the Laplace Mechanism. This adds uncertainty to any published aggregate, making differencing attacks statistically infeasible.`
  );

  if (partialCount > 0) {
    recs.push(
      `🟡 MEDIUM — ${partialCount} records have Partial differencing risk (EC below k=${k}). Differencing produces noisy estimates but still extracts signal. Action: Increase k-anonymity threshold or apply QI generalisation to push these ECs above the threshold.`
    );
  }

  const failingLDiv = lDivResults.filter((r) => r.violatingEcs > 0);
  if (failingLDiv.length > 0) {
    recs.push(
      `🟡 L-Diversity violated for ${failingLDiv.map((r) => r.sa).join(", ")}. While l-diversity alone does not block differencing, fixing l-diversity violations reduces the overall attack surface.`
    );
  }

  recs.push(
    `ℹ️ KEY DISTINCTION — This attack targets AGGREGATE RELEASES, not just raw data. Even if you never release individual records, publishing any COUNT / SUM / AVG statistics from this dataset is vulnerable unless differential privacy noise is applied.`
  );

  recs.push(
    `ℹ️ NEXT STEP — Go to "Privacy Enhancement" to apply Differential Privacy noise and QI generalisation. After enhancement, re-run this assessment.`
  );

  return recs;
}

// ─── Empty result ─────────────────────────────────────────────────────────────

function emptyResult(qis: string[], sas: string[]): DifferencingResult {
  return {
    riskScore: 0, riskLevel: "LOW", N: 0, ddr: 0,
    exactCount: 0, nearExactCount: 0, partialCount: 0, protectedCount: 0,
    coverageRate: 0, distinctEcs: 0, minK: 0, avgEcSize: 0,
    quasiIdentifiers: qis, sensitiveAttributes: sas,
    recordTable: [], ecSizeDistribution: [], saReconstruction: [],
    lDivResults: [], tCloseResults: [], topVulnerable: [],
    queryPairs: [], mostVulnerableRecord: null,
    recommendations: ["Select quasi-identifiers to run the Differencing Attack."],
  };
}
