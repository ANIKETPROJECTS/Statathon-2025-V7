/**
 * Membership Inference Attack — per SafeData Pipeline spec v1.0
 *
 * Form A — Record Distinctiveness / Outlier Score (nearest-neighbour Gower distance)
 * Form B — Population-Relative Membership Score (via Multiplier_comb rarity)
 *
 * NOTE: O(N²) distance matrix — capped at 200 records for performance.
 * For N > 1000 a future version should use approximate nearest-neighbour (e.g. BallTree).
 */

import { DataRow, getRiskLevel, RiskLevel } from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemberRecordTrace {
  rowIdx: number;
  formAScore: number;
  formBScore: number | null;
  nearestNeighborIdx: number;
  nearestNeighborDist: number;
  highRisk: boolean;
  status: "HIGH" | "MEDIUM" | "LOW";
  profileValues: Record<string, string>;
}

export interface MembershipDistBucket {
  range: string;
  count: number;
  pct: number;
  meaning: string;
}

export interface CrossCheckRow {
  rowIdx: number;
  ecSize: number;
  prosecutorStatus: "PROTECTED" | "VULNERABLE";
  membershipStatus: "HIGH" | "MEDIUM" | "LOW";
  formAScore: number;
  formBScore: number | null;
  conflict: boolean;
}

export interface MembershipResult {
  riskScore: number;
  riskLevel: RiskLevel;
  N: number;
  totalRecords: number;
  profileAttributesUsed: string[];
  excludedDirectIdentifiers: string[];
  configConflicts: string[];
  smallSampleWarning: boolean;
  avgFormAScore: number;
  formADistribution: MembershipDistBucket[];
  formBStatus: "ok" | "unavailable";
  avgFormBScore: number | null;
  formBDistribution: MembershipDistBucket[];
  highRiskCount: number;
  pctHighRisk: number;
  mostDistinctiveRowIdx: number;
  mostDistinctiveFormAScore: number;
  records: MemberRecordTrace[];
  top10Distinctive: MemberRecordTrace[];
  crossCheck: CrossCheckRow[];
  recommendations: string[];
  // Legacy fields kept for backward compatibility with existing KPI wiring
  membershipRiskPct: number;
  aucScore: number;
  isolationRate: number;
  memorization: number;
  rocCurve: { fpr: number; tpr: number }[];
  similarityDistribution: { bucket: string; members: number; nonMembers: number }[];
  thresholdTable: { threshold: number; tpr: number; fpr: number; precision: number }[];
}

// ─── Preprocessing helpers ────────────────────────────────────────────────────

function parseNumericVal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/\s*acres?\s*$/i, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function detectNumericAttrs(data: DataRow[], attrs: string[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const attr of attrs) {
    const sample = data.slice(0, Math.min(data.length, 30));
    const nonNull = sample.filter((r) => r[attr] !== null && r[attr] !== undefined && r[attr] !== "");
    if (nonNull.length === 0) { result.set(attr, false); continue; }
    const numericCount = nonNull.filter((r) => parseNumericVal(r[attr]) !== null).length;
    result.set(attr, numericCount / nonNull.length >= 0.7);
  }
  return result;
}

function computeRanges(data: DataRow[], attrs: string[], numericFlags: Map<string, boolean>): Map<string, number> {
  const result = new Map<string, number>();
  for (const attr of attrs) {
    if (!numericFlags.get(attr)) continue;
    const vals = data.map((r) => parseNumericVal(r[attr])).filter((v): v is number => v !== null);
    if (vals.length === 0) { result.set(attr, 1); continue; }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    result.set(attr, hi === lo ? 1 : hi - lo);
  }
  return result;
}

// ─── Gower distance ───────────────────────────────────────────────────────────

function gowerDistance(
  r1: DataRow,
  r2: DataRow,
  attrs: string[],
  numericFlags: Map<string, boolean>,
  rangeMap: Map<string, number>,
): number {
  let total = 0;
  let count = 0;
  for (const attr of attrs) {
    if (numericFlags.get(attr)) {
      const v1 = parseNumericVal(r1[attr]);
      const v2 = parseNumericVal(r2[attr]);
      if (v1 === null || v2 === null) {
        total += 0.5;
      } else {
        const range = rangeMap.get(attr) ?? 1;
        total += Math.abs(v1 - v2) / range;
      }
    } else {
      const s1 = String(r1[attr] ?? "").trim().toLowerCase();
      const s2 = String(r2[attr] ?? "").trim().toLowerCase();
      total += s1 === s2 ? 0 : 1;
    }
    count++;
  }
  return count === 0 ? 0 : Math.min(1, total / count);
}

// ─── Distribution bucketing ───────────────────────────────────────────────────

function buildDistBuckets(
  scores: number[],
  labels: { range: string; meaning: string }[],
): MembershipDistBucket[] {
  const thresholds = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
  const N = scores.length || 1;
  return labels.map((label, i) => {
    const [lo, hi] = thresholds[i];
    const count = scores.filter((s) => s >= lo && s < hi).length;
    return {
      range: label.range,
      count,
      pct: parseFloat(((count / N) * 100).toFixed(1)),
      meaning: label.meaning,
    };
  });
}

// ─── Recommendations ─────────────────────────────────────────────────────────

function buildRecommendations(
  records: MemberRecordTrace[],
  formBStatus: string,
  avgFormA: number,
  N: number,
  highRiskCount: number,
  pctHighRisk: number,
  configConflicts: string[],
  smallSampleWarning: boolean,
  mostDistinctive: MemberRecordTrace | undefined,
  profileAttrs: string[],
  data: DataRow[],
  numericFlags: Map<string, boolean>,
): string[] {
  const recs: string[] = [];

  if (configConflicts.length > 0) {
    recs.push(
      `⚠️ CONFIG — ${configConflicts.join(", ")} ${configConflicts.length === 1 ? "is" : "are"} flagged as direct identifier(s) AND selected as QI/SA. ` +
      `${configConflicts.length === 1 ? "It has" : "They have"} been excluded from the Form A distance calculation to avoid trivially inflating outlier scores.`
    );
  }

  if (mostDistinctive && mostDistinctive.formAScore >= 0.7) {
    const row = data[mostDistinctive.rowIdx];
    const numAttrs = profileAttrs.filter((a) => numericFlags.get(a));
    const topAttrs = numAttrs.slice(0, 3).map((a) => `${a}=${row[a]}`).join(", ");
    recs.push(
      `🔴 CRITICAL — Row #${mostDistinctive.rowIdx + 1} has Form A outlier score ${mostDistinctive.formAScore.toFixed(2)} (highest in dataset). ` +
      (topAttrs ? `Most distinctive continuous attributes: ${topAttrs}. ` : "") +
      `Consider: (1) bucketing numerical attributes into ranges (e.g., HH_Size → "1–4", "5–8", "9+"), ` +
      `(2) top/bottom-coding extreme values (e.g., cap Land_Owned at 95th percentile), ` +
      `(3) reviewing whether this record should be excluded from public release or released only in aggregate form.`
    );
  }

  if (highRiskCount > 0) {
    recs.push(
      `🟡 MEDIUM — ${highRiskCount} record${highRiskCount !== 1 ? "s" : ""} (${pctHighRisk}%) flagged as high membership-inference risk ` +
      `(Form A ≥ 0.7 OR Form B ≥ 0.7). Apply generalisation or perturbation to bring Form A scores below 0.7.`
    );
    if (formBStatus === "ok") {
      const highBCount = records.filter((r) => r.formBScore !== null && r.formBScore >= 0.7).length;
      if (highBCount > 0) {
        recs.push(
          `🟡 MEDIUM — ${highBCount} record${highBCount !== 1 ? "s" : ""} have high population rarity (Form B ≥ 0.7). ` +
          `These profiles are rare in the general population. If this dataset's survey scope is publicly known, ` +
          `confirming "a record with this profile exists" may reveal sensitive participation information. ` +
          `Consider aggregation or k-anonymisation at a coarser geographic/demographic level.`
        );
      }
    }
  }

  if (formBStatus === "unavailable") {
    recs.push(
      `ℹ️ NOTE — Multiplier_comb was not found in this dataset. Form B (population rarity) could not be computed. ` +
      `Re-run with Multiplier_comb included for a more complete membership risk picture.`
    );
  }

  if (smallSampleWarning) {
    recs.push(
      `ℹ️ SAMPLE SIZE — With only ${N} records, Membership Inference results are highly sensitive to individual records and may not generalise. Treat as illustrative only.`
    );
  }

  if (avgFormA < 0.3 && highRiskCount === 0) {
    recs.push(
      `✅ LOW RISK — Average Form A outlier score is ${avgFormA.toFixed(2)}. Most records have near-neighbours, providing plausible deniability against membership inference.`
    );
  }

  recs.push(
    `ℹ️ NEXT STEP — Go to "Privacy Enhancement" → "Outlier Treatment" or "Top/Bottom Coding" to address the most distinctive records. Re-run this assessment afterward — Form A scores for treated records should decrease.`
  );

  return recs;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function runMembershipAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[] = [],
  directIdentifiers: string[] = [],
): MembershipResult {
  const n = data.length;
  if (n === 0 || (quasiIdentifiers.length === 0 && sensitiveAttributes.length === 0)) {
    return emptyResult();
  }

  // Step 1: profile_attributes = (QI ∪ SA) − direct identifiers
  const allSelected = Array.from(new Set([...quasiIdentifiers, ...sensitiveAttributes]));
  const configConflicts: string[] = [];
  const excludedDirectIdentifiers: string[] = [];

  const profileAttributesUsed = allSelected.filter((attr) => {
    if (directIdentifiers.includes(attr)) {
      excludedDirectIdentifiers.push(attr);
      configConflicts.push(attr);
      return false;
    }
    return true;
  });

  if (profileAttributesUsed.length === 0) {
    return emptyResult();
  }

  // Step 2: Sample for O(N²) performance — cap at 200 records
  const MAX_N = 200;
  const sampleData = n > MAX_N ? data.slice(0, MAX_N) : data;
  const N = sampleData.length;
  const smallSampleWarning = N < 20;

  // Step 3: Preprocessing
  const numericFlags = detectNumericAttrs(sampleData, profileAttributesUsed);
  const rangeMap = computeRanges(sampleData, profileAttributesUsed, numericFlags);

  // Step 4: Form A — Gower nearest-neighbour outlier score O(N²)
  const nnDistances: number[] = new Array(N).fill(1.0);
  const nnIndices: number[] = new Array(N).fill(0);

  for (let i = 0; i < N; i++) {
    let minDist = Infinity;
    let minJ = 0;
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const d = gowerDistance(sampleData[i], sampleData[j], profileAttributesUsed, numericFlags, rangeMap);
      if (d < minDist) { minDist = d; minJ = j; }
    }
    nnDistances[i] = minDist === Infinity ? 1.0 : minDist;
    nnIndices[i] = minJ;
  }

  const avgFormAScore = nnDistances.reduce((a, b) => a + b, 0) / N;

  // Step 5: Form B — population rarity via Multiplier_comb (NOT from profile_attributes)
  let formBScores: (number | null)[] = new Array(N).fill(null);
  let formBStatus: "ok" | "unavailable" = "unavailable";
  let avgFormBScore: number | null = null;

  const multiplierVals: (number | null)[] = sampleData.map((r) => {
    const v = parseFloat(String(r["Multiplier_comb"] ?? ""));
    return isNaN(v) || v <= 0 ? null : v;
  });

  const validMultipliers = multiplierVals.filter((v): v is number => v !== null);
  if (validMultipliers.length > 0) {
    const rarities = multiplierVals.map((v) => (v !== null ? 1.0 / v : null));
    const validRarities = rarities.filter((v): v is number => v !== null);
    const maxRarity = validRarities.length > 0 ? Math.max(...validRarities) : 1;
    if (maxRarity > 0) {
      formBScores = rarities.map((r) => (r !== null ? parseFloat((r / maxRarity).toFixed(3)) : null));
      const validB = formBScores.filter((v): v is number => v !== null);
      avgFormBScore = validB.length > 0 ? parseFloat((validB.reduce((a, b) => a + b, 0) / validB.length).toFixed(3)) : null;
      formBStatus = "ok";
    }
  }

  // Step 6: Per-record traces
  const records: MemberRecordTrace[] = sampleData.map((row, i) => {
    const formA = parseFloat(nnDistances[i].toFixed(3));
    const formB = formBScores[i];
    const highRisk = formA >= 0.7 || (formB !== null && formB >= 0.7);
    const status: "HIGH" | "MEDIUM" | "LOW" = formA >= 0.7 ? "HIGH" : formA >= 0.3 ? "MEDIUM" : "LOW";

    const profileValues: Record<string, string> = {};
    profileAttributesUsed.slice(0, 6).forEach((attr) => {
      profileValues[attr] = String(row[attr] ?? "");
    });

    return {
      rowIdx: i,
      formAScore: formA,
      formBScore: formB,
      nearestNeighborIdx: nnIndices[i],
      nearestNeighborDist: formA,
      highRisk,
      status,
      profileValues,
    };
  });

  const highRiskCount = records.filter((r) => r.highRisk).length;
  const pctHighRisk = parseFloat(((highRiskCount / N) * 100).toFixed(1));

  const top10Distinctive = [...records].sort((a, b) => b.formAScore - a.formAScore).slice(0, 10);
  const mostDistinctive = top10Distinctive[0] ?? records[0];

  // Step 7: Distributions
  const formADistribution = buildDistBuckets(records.map((r) => r.formAScore), [
    { range: "0.00 – 0.19", meaning: "Has a near-identical twin — strong plausible deniability" },
    { range: "0.20 – 0.39", meaning: "Similar records exist" },
    { range: "0.40 – 0.59", meaning: "Moderately distinctive" },
    { range: "0.60 – 0.79", meaning: "Quite unusual" },
    { range: "0.80 – 1.00", meaning: "🔴 Highly distinctive — effectively a 'loner' record" },
  ]);

  const formBDistribution =
    formBStatus === "ok"
      ? buildDistBuckets(
          formBScores.filter((v): v is number => v !== null),
          [
            { range: "0.00 – 0.19", meaning: "Common profile — represents many people in the population" },
            { range: "0.20 – 0.39", meaning: "Relatively common profile" },
            { range: "0.40 – 0.59", meaning: "Moderately rare profile" },
            { range: "0.60 – 0.79", meaning: "Quite rare in the population" },
            { range: "0.80 – 1.00", meaning: "🔴 Rare profile — represents very few people in the population" },
          ],
        )
      : [];

  // Step 8: Cross-check with Prosecutor (re-compute EC sizes using QIs)
  const ecMap = new Map<string, number[]>();
  sampleData.forEach((row, i) => {
    const key = quasiIdentifiers.length > 0
      ? quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|")
      : "__all__";
    if (!ecMap.has(key)) ecMap.set(key, []);
    ecMap.get(key)!.push(i);
  });

  const K_DEFAULT = 3;
  const crossCheck: CrossCheckRow[] = records
    .filter((r) => r.status === "HIGH" || r.formAScore >= 0.5)
    .slice(0, 20)
    .map((r) => {
      const key = quasiIdentifiers.length > 0
        ? quasiIdentifiers.map((qi) => String(sampleData[r.rowIdx][qi] ?? "")).join("|")
        : "__all__";
      const ec = ecMap.get(key) ?? [r.rowIdx];
      const ecSize = ec.length;
      const prosecutorStatus: "PROTECTED" | "VULNERABLE" = ecSize >= K_DEFAULT ? "PROTECTED" : "VULNERABLE";
      return {
        rowIdx: r.rowIdx,
        ecSize,
        prosecutorStatus,
        membershipStatus: r.status,
        formAScore: r.formAScore,
        formBScore: r.formBScore,
        conflict: prosecutorStatus === "PROTECTED" && r.status === "HIGH",
      };
    });

  // Step 9: Recommendations
  const recommendations = buildRecommendations(
    records, formBStatus, avgFormAScore, N, highRiskCount, pctHighRisk,
    configConflicts, smallSampleWarning, mostDistinctive,
    profileAttributesUsed, sampleData, numericFlags,
  );

  const riskScore = parseFloat((pctHighRisk / 100).toFixed(3));

  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    N,
    totalRecords: N,
    profileAttributesUsed,
    excludedDirectIdentifiers,
    configConflicts,
    smallSampleWarning,
    avgFormAScore: parseFloat(avgFormAScore.toFixed(3)),
    formADistribution,
    formBStatus,
    avgFormBScore,
    formBDistribution,
    highRiskCount,
    pctHighRisk,
    mostDistinctiveRowIdx: mostDistinctive?.rowIdx ?? 0,
    mostDistinctiveFormAScore: mostDistinctive?.formAScore ?? 0,
    records,
    top10Distinctive,
    crossCheck,
    recommendations,
    // Legacy
    membershipRiskPct: pctHighRisk,
    aucScore: parseFloat(avgFormAScore.toFixed(3)),
    isolationRate: parseFloat((highRiskCount / N).toFixed(3)),
    memorization: parseFloat((1 - avgFormAScore).toFixed(3)),
    rocCurve: [],
    similarityDistribution: [],
    thresholdTable: [],
  };
}

// ─── Empty result ─────────────────────────────────────────────────────────────

function emptyResult(): MembershipResult {
  return {
    riskScore: 0, riskLevel: "LOW", N: 0, totalRecords: 0,
    profileAttributesUsed: [], excludedDirectIdentifiers: [], configConflicts: [],
    smallSampleWarning: false, avgFormAScore: 0,
    formADistribution: [], formBStatus: "unavailable", avgFormBScore: null,
    formBDistribution: [], highRiskCount: 0, pctHighRisk: 0,
    mostDistinctiveRowIdx: 0, mostDistinctiveFormAScore: 0,
    records: [], top10Distinctive: [], crossCheck: [],
    recommendations: ["Select quasi-identifiers and/or sensitive attributes to run Membership Inference Attack."],
    membershipRiskPct: 0, aucScore: 0, isolationRate: 0, memorization: 0,
    rocCurve: [], similarityDistribution: [], thresholdTable: [],
  };
}
