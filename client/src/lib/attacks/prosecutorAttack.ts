import { buildEquivalenceClasses, DataRow, EquivalenceClass, getRiskLevel, RiskLevel } from "./utils";

export interface ProsecutorRecordRow {
  rowIdx: number;
  qiValues: Record<string, string>;
  ecSize: number;
  linkScore: number;
  atRisk: boolean;
}

export interface ProsecutorLDivResult {
  sa: string;
  minL: number;
  violatingEcs: number;
  totalEcs: number;
  violatingRecordPct: number;
  status: "PASS" | "FAIL";
}

export interface ProsecutorTCloseResult {
  sa: string;
  maxDistance: number;
  violatingEcs: number;
  totalEcs: number;
  status: "PASS" | "FAIL";
}

export interface ProsecutorResult {
  // ── backward-compat fields (used by comparison dashboard) ──
  riskScore: number;
  riskLevel: RiskLevel;
  uniquenessRate: number;
  highRiskRate: number;
  avgEcSize: number;
  minK: number;
  uniqueRecordsCount: number;
  histogram: { label: string; count: number; risk: number }[];
  linkScoreDistribution: { bucket: string; count: number }[];
  topVulnerable: { qiCombo: string; qiValues: Record<string, string>; linkScore: number; ecSize: number; reason: string }[];
  recommendations: string[];
  equivalenceClasses: EquivalenceClass[];
  totalRecords: number;

  // ── new spec fields ──
  sampleN: number;
  reIdRisk: number;
  atRiskCount: number;
  protectedCount: number;
  quasiIdentifiers: string[];
  recordTable: ProsecutorRecordRow[];
  ecSizeTable: { label: string; numECs: number; numRecords: number; pct: string }[];
  lDiversityResults: ProsecutorLDivResult[];
  tClosenessResults: ProsecutorTCloseResult[];
  topVulnerableRecord: ProsecutorRecordRow | null;
}

export function runProsecutorAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  kThreshold: number,
  sensitiveAttributes: string[] = [],
  lThreshold = 3,
  tThreshold = 0.2,
): ProsecutorResult {
  const n = data.length;
  if (n === 0 || quasiIdentifiers.length === 0) return emptyResult(quasiIdentifiers);

  // ── Step 1: Build EC map (key → list of row indices) ──────────────────────
  const ecMap = new Map<string, number[]>();
  data.forEach((row, idx) => {
    const key = quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|");
    const existing = ecMap.get(key);
    if (existing) existing.push(idx);
    else ecMap.set(key, [idx]);
  });

  const ecs = buildEquivalenceClasses(data, quasiIdentifiers);

  // ── Step 2: Per-record link scores ─────────────────────────────────────────
  const ecSizeArr: number[] = new Array(n);
  ecMap.forEach((indices) => {
    const sz = indices.length;
    indices.forEach((i) => { ecSizeArr[i] = sz; });
  });

  let totalLinkScore = 0;
  const recordTable: ProsecutorRecordRow[] = data.map((row, idx) => {
    const sz = ecSizeArr[idx];
    const ls = 1 / sz;
    totalLinkScore += ls;
    const qiValues: Record<string, string> = {};
    quasiIdentifiers.forEach((qi) => { qiValues[qi] = String(row[qi] ?? ""); });
    return { rowIdx: idx + 1, qiValues, ecSize: sz, linkScore: parseFloat(ls.toFixed(4)), atRisk: sz < kThreshold };
  });

  // ── Step 3: Core metrics ───────────────────────────────────────────────────
  const reIdRisk = totalLinkScore / n; // = num_distinct_ECs / N
  const uniqueRecordsCount = Array.from(ecMap.values()).filter((v) => v.length === 1).length;
  const atRiskCount = recordTable.filter((r) => r.atRisk).length;
  const protectedCount = n - atRiskCount;
  const uniquenessRate = uniqueRecordsCount / n;
  const highRiskRate = atRiskCount / n;
  const avgEcSize = n / ecMap.size;
  const minK = Math.min(...Array.from(ecMap.values()).map((v) => v.length));

  // ── Step 4: Histogram (EC size buckets) ────────────────────────────────────
  const buckets = [
    { label: "1 (Unique)", min: 1, max: 1 },
    { label: "2–4",        min: 2, max: 4 },
    { label: "5–10",       min: 5, max: 10 },
    { label: "11–20",      min: 11, max: 20 },
    { label: ">20",        min: 21, max: Infinity },
  ];
  const histogram = buckets.map((b) => {
    const matching = ecs.filter((ec) => ec.size >= b.min && ec.size <= b.max);
    const count = matching.reduce((s, ec) => s + ec.size, 0);
    const avgRisk = matching.length > 0 ? matching.reduce((s, ec) => s + 1 / ec.size, 0) / matching.length : 0;
    return { label: b.label, count, risk: parseFloat((avgRisk * 100).toFixed(1)) };
  });

  // ── Step 5: EC size table for spec section 4.5 ────────────────────────────
  const ecSizeTable = buckets.map((b) => {
    const matchingEcs = ecs.filter((ec) => ec.size >= b.min && ec.size <= b.max);
    const numRecords = matchingEcs.reduce((s, ec) => s + ec.size, 0);
    return {
      label: b.label,
      numECs: matchingEcs.length,
      numRecords,
      pct: n > 0 ? ((numRecords / n) * 100).toFixed(1) + "%" : "0%",
    };
  });

  // ── Step 6: Link score distribution ───────────────────────────────────────
  const scoreBuckets: { bucket: string; min: number; max: number; meaning: string }[] = [
    { bucket: "1.00 (certain)",   min: 1.0,  max: 1.0,  meaning: "Attacker is 100% certain" },
    { bucket: "0.51–0.99 (high)", min: 0.51, max: 0.999, meaning: "More likely correct than not" },
    { bucket: "0.26–0.50 (med)",  min: 0.26, max: 0.50, meaning: "Coin-flip or worse" },
    { bucket: "0.01–0.25 (low)",  min: 0.01, max: 0.25, meaning: "Attacker has <25% chance" },
    { bucket: "0.00 (safe)",      min: 0.0,  max: 0.0,  meaning: "Effectively anonymous" },
  ];
  const linkScoreDistribution = scoreBuckets.map(({ bucket, min, max }) => {
    const count = recordTable.filter((r) => {
      if (min === max) return Math.abs(r.linkScore - min) < 0.0001;
      return r.linkScore >= min && r.linkScore <= max;
    }).length;
    return { bucket, count };
  });

  // ── Step 7: Top 10 vulnerable records ─────────────────────────────────────
  const sortedByRisk = [...recordTable].sort((a, b) => b.linkScore - a.linkScore);
  const top10 = sortedByRisk.slice(0, 10);
  const topVulnerable = top10.map((r) => ({
    qiCombo: quasiIdentifiers.map((qi) => `${qi}=${r.qiValues[qi]}`).join(", "),
    qiValues: r.qiValues,
    linkScore: r.linkScore,
    ecSize: r.ecSize,
    reason: r.ecSize === 1 ? "Singleton — no look-alike" : `EC size ${r.ecSize} < k=${kThreshold}`,
  }));
  const topVulnerableRecord = top10[0] ?? null;

  // ── Step 8: L-Diversity per SA ─────────────────────────────────────────────
  const lDiversityResults: ProsecutorLDivResult[] = sensitiveAttributes.map((sa) => {
    let minL = Infinity;
    let violatingEcs = 0;
    let violatingRecords = 0;
    ecMap.forEach((indices) => {
      const vals = new Set<string>();
      indices.forEach((i) => vals.add(String(data[i][sa] ?? "")));
      const distinct = vals.size;
      if (distinct < minL) minL = distinct;
      if (distinct < lThreshold) {
        violatingEcs++;
        violatingRecords += indices.length;
      }
    });
    if (!isFinite(minL)) minL = 0;
    return {
      sa,
      minL,
      violatingEcs,
      totalEcs: ecMap.size,
      violatingRecordPct: parseFloat(((violatingRecords / n) * 100).toFixed(1)),
      status: violatingEcs === 0 ? "PASS" : "FAIL",
    };
  });

  // ── Step 9: T-Closeness per SA (TVD) ──────────────────────────────────────
  const tClosenessResults: ProsecutorTCloseResult[] = sensitiveAttributes.map((sa) => {
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
      tvd = tvd / 2;
      if (tvd > maxDistance) maxDistance = tvd;
      if (tvd > tThreshold) violatingEcs++;
    });

    return {
      sa,
      maxDistance: parseFloat(maxDistance.toFixed(4)),
      violatingEcs,
      totalEcs: ecMap.size,
      status: violatingEcs === 0 ? "PASS" : "FAIL",
    };
  });

  // ── Step 10: Conditional recommendations ──────────────────────────────────
  const recommendations: string[] = [];
  if (uniqueRecordsCount > 0) {
    const topQI = quasiIdentifiers[0] ?? "quasi-identifier";
    recommendations.push(`🔴 CRITICAL — ${uniqueRecordsCount} singleton record${uniqueRecordsCount > 1 ? "s" : ""} found. Suppress these rows before release, OR generalize ${topQI} using range brackets.`);
  }
  if (reIdRisk > 0.2) {
    recommendations.push(`🔴 HIGH — Re-ID risk is ${(reIdRisk * 100).toFixed(1)}% (threshold: <5%). Apply k-anonymisation (generalisation) to bring Min-K up to at least ${kThreshold}.`);
  } else if (reIdRisk > 0.05) {
    recommendations.push(`🟡 MEDIUM — Re-ID risk ${(reIdRisk * 100).toFixed(1)}% is above 5% safe threshold. Consider additional generalisation.`);
  }
  lDiversityResults.filter((r) => r.status === "FAIL").forEach((r) => {
    recommendations.push(`🟡 MEDIUM — L-Diversity violated for "${r.sa}" (${r.violatingEcs}/${r.totalEcs} ECs fail). Ensure each group has ≥${lThreshold} distinct ${r.sa} values.`);
  });
  tClosenessResults.filter((r) => r.status === "FAIL").forEach((r) => {
    recommendations.push(`🟡 MEDIUM — T-Closeness violated for "${r.sa}" (max distance ${r.maxDistance} > ${tThreshold}). Distribution differs too much from global.`);
  });
  if (recommendations.length === 0) {
    recommendations.push(`✅ Prosecutor attack risk is within acceptable bounds (Re-ID: ${(reIdRisk * 100).toFixed(1)}%, Min-K: ${minK} ≥ ${kThreshold}).`);
  }
  recommendations.push(`ℹ️ NEXT STEP — Go to "Privacy Enhancement" to apply fixes automatically, then re-run this assessment to verify improvement.`);

  return {
    riskScore: reIdRisk,
    riskLevel: getRiskLevel(reIdRisk),
    uniquenessRate,
    highRiskRate,
    avgEcSize,
    minK,
    uniqueRecordsCount,
    histogram,
    linkScoreDistribution,
    topVulnerable,
    recommendations,
    equivalenceClasses: ecs,
    totalRecords: n,
    sampleN: n,
    reIdRisk,
    atRiskCount,
    protectedCount,
    quasiIdentifiers,
    recordTable,
    ecSizeTable,
    lDiversityResults,
    tClosenessResults,
    topVulnerableRecord,
  };
}

function emptyResult(qis: string[]): ProsecutorResult {
  return {
    riskScore: 0, riskLevel: "LOW", uniquenessRate: 0, highRiskRate: 0,
    avgEcSize: 0, minK: 0, uniqueRecordsCount: 0,
    histogram: [], linkScoreDistribution: [], topVulnerable: [],
    recommendations: ["No data or quasi-identifiers selected."],
    equivalenceClasses: [], totalRecords: 0,
    sampleN: 0, reIdRisk: 0, atRiskCount: 0, protectedCount: 0,
    quasiIdentifiers: qis,
    recordTable: [], ecSizeTable: [], lDiversityResults: [], tClosenessResults: [],
    topVulnerableRecord: null,
  };
}
