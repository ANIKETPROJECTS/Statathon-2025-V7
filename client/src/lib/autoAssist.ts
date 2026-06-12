import type { DataRow } from "./attacks/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DType = "id_string" | "categorical" | "ordinal_numeric" | "continuous_numeric" | "binary" | "text";
export type ColumnClass = "DIRECT_ID" | "QUASI_ID" | "SENSITIVE" | "IGNORE";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface ColumnProfile {
  colName: string;
  totalRows: number;
  uniqueCount: number;
  cardinalityRatio: number;
  inferredDtype: DType;
  isNumeric: boolean;
  isCategorical: boolean;
  topValue: string;
  topValueFreq: number;
  entropy: number;
  gini: number;
  diversityScore: number;
  nullPct: number;
}

export interface ColumnClassification {
  col: string;
  classification: ColumnClass;
  confidence: number;
  confidenceLabel: Confidence;
  reason: string;
  profile: ColumnProfile;
}

export interface QIContribution {
  soloUniqueValues: number;
  soloCardinalityRatio: number;
  marginalNewECs: number;
  marginalRiskPct: number;
  riskRank: number;
}

export interface KSuggestion {
  suggestedK: number;
  pctUnique: number;
  pctProtectedAtK5: number;
  reason: string;
}

export interface LSuggestion {
  suggestedL: number;
  actualMinL: number;
  actualMeanL: number;
  pctViolating: number;
  reason: string;
}

export interface TSuggestion {
  suggestedT: number;
  maxTvd: number;
  meanTvd: number;
  pctViolatingAtStd: number;
  reason: string;
}

export interface SampleSuggestion {
  suggestedPct: number;
  suggestedN: number;
  reason: string;
}

export interface AutoAssistResult {
  datasetInfo: { rows: number; columns: number };
  classifications: Record<string, ColumnClassification>;
  columnGroups: {
    directIdentifiers: string[];
    quasiIdentifiers: string[];
    sensitiveAttributes: string[];
    ignore: string[];
  };
  qiContributions: Record<string, QIContribution>;
  suggestedParams: { k: number; l: number; t: number; samplePct: number };
  paramDetails: {
    k: KSuggestion;
    l: Record<string, LSuggestion>;
    t: Record<string, TSuggestion>;
    sample: SampleSuggestion;
  };
}

// ── Stage 1: Column Profiling ─────────────────────────────────────────────────

function inferDtype(values: string[], uniqueCount: number, n: number): DType {
  const ratio = uniqueCount / n;
  if (uniqueCount === 2) return "binary";

  const numericCount = values.filter((v) => v !== "" && !isNaN(Number(v))).length;
  if (numericCount / values.length > 0.8) {
    if (ratio > 0.95) return "continuous_numeric";
    if (uniqueCount <= 20) return "ordinal_numeric";
    return "continuous_numeric";
  }

  const avgLen = values.reduce((s, v) => s + v.length, 0) / Math.max(values.length, 1);
  if (ratio > 0.90) return "id_string";
  if (avgLen > 40) return "text";
  return "categorical";
}

function computeEntropy(values: string[]): number {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const n = values.length;
  if (n === 0) return 0;
  const k = counts.size;
  if (k <= 1) return 0;
  let H = 0;
  counts.forEach((c) => {
    const p = c / n;
    if (p > 0) H -= p * Math.log2(p);
  });
  const Hmax = Math.log2(k);
  return Hmax > 0 ? parseFloat((H / Hmax).toFixed(4)) : 0;
}

function computeGini(values: string[]): number {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const n = values.length;
  if (n === 0) return 0;
  const k = counts.size;
  if (k <= 1) return 0;
  let sumSq = 0;
  counts.forEach((c) => { const p = c / n; sumSq += p * p; });
  const G = 1 - sumSq;
  const Gmax = 1 - 1 / k;
  return Gmax > 0 ? parseFloat((G / Gmax).toFixed(4)) : 0;
}

function profileColumn(col: string, data: DataRow[]): ColumnProfile {
  const n = data.length;
  const rawValues = data.map((r) => String(r[col] ?? ""));
  const nonNull = rawValues.filter((v) => v !== "" && v !== "null" && v !== "undefined");
  const nullCount = n - nonNull.length;

  const uniqueSet = new Set(nonNull);
  const uniqueCount = uniqueSet.size;
  const cardinalityRatio = n > 0 ? uniqueCount / n : 0;

  const inferredDtype = inferDtype(nonNull, uniqueCount, Math.max(n, 1));
  const isNumeric = ["continuous_numeric", "ordinal_numeric"].includes(inferredDtype);
  const isCategorical = cardinalityRatio < 0.05;

  const valueCounts = new Map<string, number>();
  nonNull.forEach((v) => valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1));
  let topValue = "";
  let topValueCount = 0;
  valueCounts.forEach((c, v) => { if (c > topValueCount) { topValueCount = c; topValue = v; } });
  const topValueFreq = nonNull.length > 0 ? topValueCount / nonNull.length : 0;

  const entropy = computeEntropy(nonNull);
  const gini = computeGini(nonNull);
  const diversityScore = 0.6 * entropy + 0.4 * gini;

  return {
    colName: col, totalRows: n, uniqueCount, cardinalityRatio,
    inferredDtype, isNumeric, isCategorical,
    topValue, topValueFreq, entropy, gini, diversityScore,
    nullPct: n > 0 ? nullCount / n : 0,
  };
}

// ── Stage 2: Column Classification ───────────────────────────────────────────

const DIRECT_ID_KW = ["name","phone","mobile","email","aadhar","aadhaar","pan","passport","voter_id","employee_id","respondent_id","uid","person_id","individual_id","contact","address","pincode","pin"];
const QUASI_ID_KW  = ["state","district","village","tehsil","block","ward","round","centre","zone","region","area","sector","fsu","serial","code","stratum","sub_round","visit","age","gender","sex","occupation","education","relation","hh_size","household_size","hhtype","caste"];
const SENSITIVE_KW = ["income","salary","wage","earning","expenditure","expense","hhid","hhno","health","disease","illness","disability","loan","debt","asset","land","mpi","poverty","score","mlm","mlt","sr","status","mpce","consumption","nss","nsc"];
const IGNORE_KW    = ["flag","weight","multiplier","wgt","fw","fweight","record_type","rec_type","filler","blank","dummy","version","batch","created_at","updated_at","timestamp"];

function nameBonus(colName: string, keywords: string[], bonus = 25): number {
  const lower = colName.toLowerCase().replace(/\s/g, "_");
  for (const kw of keywords) { if (lower.includes(kw)) return bonus; }
  return 0;
}

function scoreDirectId(p: ColumnProfile): number {
  let s = 0;
  const cr = p.cardinalityRatio;
  if (cr >= 0.95) s += 60; else if (cr >= 0.80) s += 40; else if (cr >= 0.60) s += 20;
  if (p.entropy >= 0.90) s += 20; else if (p.entropy >= 0.70) s += 10;
  if (p.inferredDtype === "id_string") s += 20;
  return Math.min(s, 100);
}

function scoreQuasiId(p: ColumnProfile): number {
  let s = 0;
  const cr = p.cardinalityRatio;
  if (cr >= 0.005 && cr <= 0.50) {
    if (cr <= 0.05) s += Math.round(60 * (cr / 0.05));
    else s += Math.round(60 * (1 - (cr - 0.05) / 0.45));
  }
  const H = p.entropy;
  if (H >= 0.30 && H <= 0.75) s += 25; else if (H >= 0.10 && H < 0.30) s += 10;
  if (p.inferredDtype === "categorical" || p.inferredDtype === "ordinal_numeric") s += 15;
  return Math.min(s, 100);
}

function scoreSensitive(p: ColumnProfile): number {
  let s = 0;
  const cr = p.cardinalityRatio;
  if (p.inferredDtype === "continuous_numeric" || p.inferredDtype === "ordinal_numeric") s += 30;
  else if (p.inferredDtype === "categorical") s += 20;
  if (p.entropy >= 0.60) s += 30; else if (p.entropy >= 0.40) s += 15;
  if (cr >= 0.01 && cr <= 0.30) s += 20; else if (cr > 0.30 && cr <= 0.70) s += 10;
  return Math.min(s, 100);
}

function scoreIgnore(p: ColumnProfile): number {
  let s = 0;
  if (p.topValueFreq >= 0.95) s += 70; else if (p.topValueFreq >= 0.80) s += 40;
  if (p.entropy <= 0.05) s += 30; else if (p.entropy <= 0.15) s += 15;
  return Math.min(s, 100);
}

function buildReason(cls: ColumnClass, p: ColumnProfile, scores: Record<ColumnClass, number>): string {
  const cr = p.cardinalityRatio;
  const H = p.entropy;
  const parts: string[] = [];
  if (cls === "DIRECT_ID") {
    parts.push(`${(cr * 100).toFixed(0)}% of values are unique`);
    parts.push(`dtype=${p.inferredDtype}`);
  } else if (cls === "QUASI_ID") {
    parts.push(`${p.uniqueCount} distinct values across ${p.totalRows} rows`);
    parts.push(`cardinality=${cr.toFixed(2)}`);
    if (H < 0.5) parts.push("low entropy — values cluster into groups (linkable)");
  } else if (cls === "SENSITIVE") {
    parts.push(`dtype=${p.inferredDtype}`);
    parts.push("matches known sensitive keywords");
    parts.push("disclosure may harm the individual");
  } else {
    if (p.topValueFreq > 0.9) parts.push(`top value appears in ${(p.topValueFreq * 100).toFixed(0)}% of rows`);
    if (H < 0.1) parts.push("near-zero entropy — carries no discriminating information");
  }
  return parts.join(" | ");
}

function classifyColumn(p: ColumnProfile): { cls: ColumnClass; confidence: number; reason: string } {
  // Hard override rules
  if (p.cardinalityRatio === 1.0 && p.inferredDtype === "id_string") {
    return { cls: "DIRECT_ID", confidence: 100, reason: "Every value is unique — this is a direct identifier." };
  }
  if (p.uniqueCount === 1) {
    return { cls: "IGNORE", confidence: 100, reason: "This column has only one value — it carries no information." };
  }
  if (p.nullPct > 0.80) {
    return { cls: "IGNORE", confidence: 100, reason: "More than 80% of values are missing." };
  }

  const scores: Record<ColumnClass, number> = {
    DIRECT_ID: scoreDirectId(p) + nameBonus(p.colName, DIRECT_ID_KW, 30),
    QUASI_ID:  scoreQuasiId(p)  + nameBonus(p.colName, QUASI_ID_KW,  25),
    SENSITIVE: scoreSensitive(p) + nameBonus(p.colName, SENSITIVE_KW, 25),
    IGNORE:    scoreIgnore(p)    + nameBonus(p.colName, IGNORE_KW,    20),
  };

  let winner: ColumnClass = "IGNORE";
  let maxScore = -1;
  (Object.keys(scores) as ColumnClass[]).forEach((k) => {
    if (scores[k] > maxScore) { maxScore = scores[k]; winner = k; }
  });

  const reason = buildReason(winner, p, scores);
  return { cls: winner, confidence: Math.min(maxScore, 100), reason };
}

// ── Stage 3: QI Risk Contribution ────────────────────────────────────────────

function buildGroupKey(row: DataRow, qis: string[]): string {
  return qis.map((qi) => String(row[qi] ?? "")).join("|");
}

function countGroups(data: DataRow[], qis: string[]): number {
  const s = new Set<string>();
  data.forEach((r) => s.add(buildGroupKey(r, qis)));
  return s.size;
}

function qiRiskContribution(data: DataRow[], qis: string[]): Record<string, QIContribution> {
  const n = data.length;
  if (n === 0) return {};

  const results: Record<string, Omit<QIContribution, "riskRank">> = {};

  qis.forEach((qi) => {
    const soloUnique = new Set(data.map((r) => String(r[qi] ?? ""))).size;
    const soloRatio = soloUnique / n;

    const otherQis = qis.filter((q) => q !== qi);
    let marginal: number;
    if (otherQis.length === 0) {
      marginal = soloUnique;
    } else {
      const withoutQi = countGroups(data, otherQis);
      const withAll = countGroups(data, qis);
      marginal = withAll - withoutQi;
    }

    results[qi] = {
      soloUniqueValues: soloUnique,
      soloCardinalityRatio: parseFloat(soloRatio.toFixed(4)),
      marginalNewECs: marginal,
      marginalRiskPct: parseFloat(((marginal / n) * 100).toFixed(2)),
    };
  });

  // Rank by marginalRiskPct descending
  const sorted = Object.entries(results).sort((a, b) => b[1].marginalRiskPct - a[1].marginalRiskPct);
  const final: Record<string, QIContribution> = {};
  sorted.forEach(([qi, data], i) => { final[qi] = { ...data, riskRank: i + 1 }; });
  return final;
}

// ── Stage 4: Parameter Auto-Suggestion ───────────────────────────────────────

function suggestK(data: DataRow[], qis: string[]): KSuggestion {
  const n = data.length;
  if (n === 0 || qis.length === 0) return { suggestedK: 5, pctUnique: 0, pctProtectedAtK5: 100, reason: "No data." };

  const ecSizes = new Map<string, number>();
  data.forEach((r) => {
    const k = buildGroupKey(r, qis);
    ecSizes.set(k, (ecSizes.get(k) ?? 0) + 1);
  });
  const sizeArr = data.map((r) => ecSizes.get(buildGroupKey(r, qis))!);
  const pctUnique = (sizeArr.filter((s) => s === 1).length / n) * 100;
  const pctK5 = (sizeArr.filter((s) => s >= 5).length / n) * 100;

  // 10th percentile of EC sizes
  const sorted = [...sizeArr].sort((a, b) => a - b);
  const p10Idx = Math.floor(0.10 * sorted.length);
  let suggestedK = Math.max(2, sorted[p10Idx] ?? 1);
  suggestedK = Math.min(suggestedK, 10);

  let reason: string;
  if (pctUnique > 50) {
    reason = `${pctUnique.toFixed(0)}% of records are singletons. k=${suggestedK} recommended — significant generalisation will be needed.`;
  } else if (suggestedK <= 2) {
    reason = `Most ECs are very small. k=2 is the minimum. Consider k=5 as best practice.`;
    suggestedK = 2;
  } else {
    reason = `With k=${suggestedK}, approximately 90% of records will be in equivalence classes of at least this size.`;
  }

  return { suggestedK, pctUnique: parseFloat(pctUnique.toFixed(1)), pctProtectedAtK5: parseFloat(pctK5.toFixed(1)), reason };
}

function suggestL(data: DataRow[], qis: string[], sas: string[], suggestedK: number): { overall: number; details: Record<string, LSuggestion> } {
  if (qis.length === 0 || sas.length === 0) return { overall: 2, details: {} };

  const n = data.length;
  const ecGroups = new Map<string, DataRow[]>();
  data.forEach((r) => {
    const k = buildGroupKey(r, qis);
    const g = ecGroups.get(k);
    if (g) g.push(r); else ecGroups.set(k, [r]);
  });

  const details: Record<string, LSuggestion> = {};
  sas.forEach((sa) => {
    const lPerEc: number[] = [];
    ecGroups.forEach((rows) => {
      const distinct = new Set(rows.map((r) => String(r[sa] ?? ""))).size;
      lPerEc.push(distinct);
    });
    const actualMin = Math.min(...lPerEc);
    const actualMean = lPerEc.reduce((s, v) => s + v, 0) / lPerEc.length;
    let suggestedL = Math.max(2, Math.floor(suggestedK / 2));
    suggestedL = Math.min(suggestedL, actualMin + 1);
    suggestedL = Math.max(2, suggestedL);
    const pctViolating = (lPerEc.filter((v) => v < suggestedL).length / lPerEc.length) * 100;

    const reason = actualMin === 1
      ? `Some ECs have only 1 distinct ${sa} value — attacker learns it with certainty. l=${suggestedL} recommended.`
      : `Average EC has ${actualMean.toFixed(1)} distinct ${sa} values. l=${suggestedL} would protect ${(100 - pctViolating).toFixed(0)}% of records.`;

    details[sa] = { suggestedL, actualMinL: actualMin, actualMeanL: parseFloat(actualMean.toFixed(2)), pctViolating: parseFloat(pctViolating.toFixed(1)), reason };
  });

  const overallL = details[sas[0]]?.suggestedL ?? 2;
  return { overall: overallL, details };
}

function suggestT(data: DataRow[], qis: string[], sas: string[]): { overall: number; details: Record<string, TSuggestion> } {
  if (qis.length === 0 || sas.length === 0) return { overall: 0.20, details: {} };

  const n = data.length;
  const ecGroups = new Map<string, DataRow[]>();
  data.forEach((r) => {
    const k = buildGroupKey(r, qis);
    const g = ecGroups.get(k);
    if (g) g.push(r); else ecGroups.set(k, [r]);
  });

  const details: Record<string, TSuggestion> = {};
  sas.forEach((sa) => {
    const globalCounts = new Map<string, number>();
    data.forEach((r) => { const v = String(r[sa] ?? ""); globalCounts.set(v, (globalCounts.get(v) ?? 0) + 1); });
    const globalDist: Record<string, number> = {};
    globalCounts.forEach((c, v) => { globalDist[v] = c / n; });
    const allVals = Array.from(globalCounts.keys());

    const tvds: number[] = [];
    ecGroups.forEach((rows) => {
      const lc = new Map<string, number>();
      rows.forEach((r) => { const v = String(r[sa] ?? ""); lc.set(v, (lc.get(v) ?? 0) + 1); });
      const sz = rows.length;
      let tvd = 0;
      allVals.forEach((v) => {
        const lp = (lc.get(v) ?? 0) / sz;
        const gp = globalDist[v] ?? 0;
        tvd += Math.abs(lp - gp);
      });
      tvds.push(tvd / 2);
    });

    const maxTvd = Math.max(...tvds);
    const meanTvd = tvds.reduce((s, v) => s + v, 0) / tvds.length;
    const suggestedT = parseFloat(Math.min(0.50, Math.max(0.10, meanTvd + 0.05)).toFixed(2));
    const pctViolatingAtStd = (tvds.filter((v) => v > 0.20).length / tvds.length) * 100;

    details[sa] = {
      suggestedT, maxTvd: parseFloat(maxTvd.toFixed(4)), meanTvd: parseFloat(meanTvd.toFixed(4)),
      pctViolatingAtStd: parseFloat(pctViolatingAtStd.toFixed(1)),
      reason: `Avg EC deviation for ${sa}: ${meanTvd.toFixed(3)}. Max: ${maxTvd.toFixed(3)}. At t=0.20: ${pctViolatingAtStd.toFixed(0)}% of ECs violate.`,
    };
  });

  const tVals = Object.values(details).map((d) => d.suggestedT);
  const overall = tVals.length > 0 ? parseFloat((tVals.reduce((s, v) => s + v, 0) / tVals.length).toFixed(2)) : 0.20;
  return { overall, details };
}

function suggestSampleSize(n: number): SampleSuggestion {
  if (n <= 500) return { suggestedPct: 100, suggestedN: n, reason: "Dataset is small — using 100% for maximum accuracy." };
  const Z = 1.96, p = 0.5;
  if (n <= 5000) {
    const e = 0.05;
    const nReq = Math.round((Z * Z * p * (1 - p)) / (e * e));
    const nCorr = Math.round(nReq / (1 + (nReq - 1) / n));
    const pct = Math.min(100, Math.max(50, Math.round((nCorr / n) * 100)));
    return { suggestedPct: pct, suggestedN: nCorr, reason: `With ${pct}% sample (${nCorr} rows), results accurate to ±5% at 95% confidence.` };
  }
  const e = 0.02;
  const nReq = Math.round((Z * Z * p * (1 - p)) / (e * e));
  const nCorr = Math.min(nReq, 10000);
  const pct = Math.max(10, Math.round((nCorr / n) * 100));
  return { suggestedPct: pct, suggestedN: nCorr, reason: `With ${pct}% sample (${nCorr} rows), results accurate to ±2% at 95% confidence. Increase to 100% for exact results.` };
}

// ── Master Function ───────────────────────────────────────────────────────────

export function runAutoAssist(data: DataRow[], columns: string[]): AutoAssistResult {
  const n = data.length;

  // Stage 1: Profile
  const profiles: Record<string, ColumnProfile> = {};
  columns.forEach((col) => { profiles[col] = profileColumn(col, data); });

  // Stage 2: Classify
  const classifications: Record<string, ColumnClassification> = {};
  columns.forEach((col) => {
    const p = profiles[col];
    const { cls, confidence, reason } = classifyColumn(p);
    const confidenceLabel: Confidence = confidence >= 80 ? "HIGH" : confidence >= 50 ? "MEDIUM" : "LOW";
    classifications[col] = { col, classification: cls, confidence, confidenceLabel, reason, profile: p };
  });

  const directIdentifiers = columns.filter((c) => classifications[c].classification === "DIRECT_ID");
  const quasiIdentifiers  = columns.filter((c) => classifications[c].classification === "QUASI_ID");
  const sensitiveAttributes = columns.filter((c) => classifications[c].classification === "SENSITIVE");
  const ignore            = columns.filter((c) => classifications[c].classification === "IGNORE");

  // Stage 3: QI contributions (cap data at 2000 rows for speed)
  const sampleForContrib = data.length > 2000 ? data.slice(0, 2000) : data;
  const qiContributions = quasiIdentifiers.length > 0
    ? qiRiskContribution(sampleForContrib, quasiIdentifiers)
    : {};

  // Stage 4: Parameter suggestions
  const kResult = suggestK(data, quasiIdentifiers);
  const suggestedK = kResult.suggestedK;
  const lResult = suggestL(data, quasiIdentifiers, sensitiveAttributes, suggestedK);
  const tResult = suggestT(data, quasiIdentifiers, sensitiveAttributes);
  const sampleResult = suggestSampleSize(n);

  return {
    datasetInfo: { rows: n, columns: columns.length },
    classifications,
    columnGroups: { directIdentifiers, quasiIdentifiers, sensitiveAttributes, ignore },
    qiContributions,
    suggestedParams: {
      k: suggestedK,
      l: lResult.overall,
      t: tResult.overall,
      samplePct: sampleResult.suggestedPct,
    },
    paramDetails: {
      k: kResult,
      l: lResult.details,
      t: tResult.details,
      sample: sampleResult,
    },
  };
}
