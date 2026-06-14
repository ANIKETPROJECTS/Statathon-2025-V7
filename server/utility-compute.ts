// Utility Measurement Computation Engine
// Implements all formulas from the Utility Measurement Module Specification:
// MAE/NMAE, Relative Bias, Variance Ratio, MPS, Percentile Preservation, SFS,
// KS Statistic, JSD, Wasserstein-1, Entropy/EPR, UVRR, Histogram Intersection,
// Pearson Correlation Matrix (Frobenius), R² retention, and OUS composite.

type Row = Record<string, any>;

// ── LOW-LEVEL MATH HELPERS ────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function variance(arr: number[], m?: number): number {
  if (!arr.length) return 0;
  const mu = m ?? mean(arr);
  return arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length;
}

function sortedArr(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function shannonH(counts: number[]): number {
  const tot = counts.reduce((s, v) => s + v, 0);
  if (!tot) return 0;
  let h = 0;
  for (const c of counts) {
    if (c > 0) { const p = c / tot; h -= p * Math.log2(p); }
  }
  return h;
}

function numericEntropy(vals: number[], bins = 10): number {
  if (vals.length < 2) return 0;
  const mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) return 0;
  const w = (mx - mn) / bins;
  const cnt = new Array(bins).fill(0);
  for (const v of vals) cnt[clamp(Math.floor((v - mn) / w), 0, bins - 1)]++;
  return shannonH(cnt);
}

function catEntropy(vals: (string | number)[]): number {
  const freq = new Map<string, number>();
  for (const v of vals) freq.set(String(v), (freq.get(String(v)) ?? 0) + 1);
  return shannonH(Array.from(freq.values()));
}

// ── UNIT SUFFIX STRIPPING ─────────────────────────────────────────────────────

// Strips common unit suffixes (e.g. " acres", " ha", " kg") before numeric parse.
// Also handles suffixes without a space (e.g. "5acres").
const UNIT_PATTERNS = [
  /\s+acres?$/i,
  /\s+ha$/i,
  /\s+hectares?$/i,
  /\s+kg$/i,
  /\s+lbs?$/i,
  /\s+kgs?$/i,
  /\s+m2?$/i,
  /\s+sq\.?\s*ft\.?$/i,
  /\s+%$/,
];

function stripUnit(v: any): any {
  if (typeof v !== 'string') return v;
  let s = v.trim();
  for (const pat of UNIT_PATTERNS) {
    s = s.replace(pat, '');
  }
  return s;
}

// ── PSEUDONYMIZATION DETECTION ────────────────────────────────────────────────

// Returns true if the processed column has been converted to opaque identifier tokens
// (e.g. "PSEUDO_95012", hash-based tokens).  Uses ≥60% of non-null values matching
// the PSEUDO_* pattern, OR all non-null values failing parseFloat.
const PSEUDO_RE = /^PSEUDO_/i;

function columnIsPseudonymized(rows: Row[], col: string): boolean {
  const nonNull = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
  if (!nonNull.length) return false;
  const pseudoCount = nonNull.filter(v => PSEUDO_RE.test(String(v))).length;
  if (pseudoCount / nonNull.length >= 0.6) return true;
  // Secondary check: all values are non-numeric strings (fail parseFloat)
  const numericCount = nonNull.filter(v => {
    const stripped = stripUnit(v);
    return !isNaN(parseFloat(String(stripped))) && String(stripped).trim() !== '';
  }).length;
  return numericCount === 0 && nonNull.length > 0;
}

// ── ALL-NULL DETECTION ────────────────────────────────────────────────────────

function columnIsAllNull(rows: Row[], col: string): boolean {
  if (!rows.length) return true;
  return rows.every(r => r[col] === null || r[col] === undefined || String(r[col]).trim() === '');
}

// ── NUMERIC VALUE EXTRACTORS ──────────────────────────────────────────────────

function numVals(rows: Row[], col: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const raw = stripUnit(r[col]);
    const v = Number(raw);
    if (!isNaN(v)) out.push(v);
  }
  return out;
}

// Parse generalised values: "30-40" → 35, "50+" → 55, "<10" → 5
function parseMidpoint(v: any): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = stripUnit(v);
    const m1 = String(s).match(/^([\d.]+)-([\d.]+)$/);
    if (m1) return (parseFloat(m1[1]) + parseFloat(m1[2])) / 2;
    const m2 = String(s).match(/^([\d.]+)\+$/);
    if (m2) return parseFloat(m2[1]) * 1.1;
    const m3 = String(s).match(/^[<≤]\s*([\d.]+)$/);
    if (m3) return parseFloat(m3[1]) / 2;
    const n = parseFloat(String(s));
    if (!isNaN(n)) return n;
  }
  return null;
}

function approxNumVals(rows: Row[], col: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = parseMidpoint(r[col]);
    if (v !== null) out.push(v);
  }
  return out;
}

// ── DISTRIBUTION METRICS ──────────────────────────────────────────────────────

function ksStatistic(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const sa = sortedArr(a), sb = sortedArr(b);
  const all = [...sa, ...sb].sort((x, y) => x - y);
  const na = sa.length, nb = sb.length;
  let ia = 0, ib = 0, maxD = 0;
  for (const x of all) {
    while (ia < na && sa[ia] <= x) ia++;
    while (ib < nb && sb[ib] <= x) ib++;
    maxD = Math.max(maxD, Math.abs(ia / na - ib / nb));
  }
  return maxD;
}

function jsd(a: number[], b: number[], bins = 20): number {
  if (!a.length || !b.length) return 0;
  const mn = Math.min(...a), mx = Math.max(...a);
  if (mn === mx) return 0;
  const w = (mx - mn) / bins;
  const pc = new Array(bins).fill(0);
  const qc = new Array(bins).fill(0);
  for (const v of a) pc[clamp(Math.floor((v - mn) / w), 0, bins - 1)]++;
  for (const v of b) {
    const v2 = Math.max(mn, Math.min(mx - 1e-10, v));
    qc[clamp(Math.floor((v2 - mn) / w), 0, bins - 1)]++;
  }
  const sp = pc.reduce((s, v) => s + v, 0) || 1;
  const sq = qc.reduce((s, v) => s + v, 0) || 1;
  let val = 0;
  for (let i = 0; i < bins; i++) {
    const p = pc[i] / sp, q = qc[i] / sq, m = 0.5 * (p + q);
    if (p > 0 && m > 0) val += 0.5 * p * Math.log2(p / m);
    if (q > 0 && m > 0) val += 0.5 * q * Math.log2(q / m);
  }
  return clamp(val);
}

function wasserstein1(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const range = Math.max(...a) - Math.min(...a);
  if (!range) return 0;
  const sa = sortedArr(a), sb = sortedArr(b);
  const n = Math.min(sa.length, sb.length);
  const sample = (arr: number[]): number[] => {
    if (arr.length === n) return arr;
    return Array.from({ length: n }, (_, i) => arr[Math.round(i * (arr.length - 1) / (n - 1 || 1))]);
  };
  const ra = sample(sa), rb = sample(sb);
  return clamp(ra.reduce((s, v, i) => s + Math.abs(v - rb[i]), 0) / n / range);
}

function histIntersect(a: (string | number)[], b: (string | number)[]): number {
  const na = a.length || 1, nb = b.length || 1;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const v of a) fa.set(String(v), (fa.get(String(v)) ?? 0) + 1);
  for (const v of b) fb.set(String(v), (fb.get(String(v)) ?? 0) + 1);
  const cats = new Set([...fa.keys(), ...fb.keys()]);
  let hi = 0;
  for (const c of cats) hi += Math.min((fa.get(c) ?? 0) / na, (fb.get(c) ?? 0) / nb);
  return hi;
}

// ── HISTOGRAM FOR FRONTEND ────────────────────────────────────────────────────

export interface HistogramData {
  bins: number[];     // bin edge starts
  origCounts: number[];
  procCounts: number[];
}

function buildHistogram(origVals: number[], procVals: number[], bins = 20): HistogramData {
  if (!origVals.length) return { bins: [], origCounts: [], procCounts: [] };
  const mn = Math.min(...origVals), mx = Math.max(...origVals);
  if (mn === mx) return { bins: [mn], origCounts: [origVals.length], procCounts: [procVals.length] };
  const w = (mx - mn) / bins;
  const oc = new Array(bins).fill(0);
  const pc = new Array(bins).fill(0);
  const edges = Array.from({ length: bins }, (_, i) => mn + i * w);
  for (const v of origVals) oc[clamp(Math.floor((v - mn) / w), 0, bins - 1)]++;
  for (const v of procVals) {
    const v2 = Math.max(mn, Math.min(mx - 1e-10, v));
    pc[clamp(Math.floor((v2 - mn) / w), 0, bins - 1)]++;
  }
  return { bins: edges, origCounts: oc, procCounts: pc };
}

// ── CORRELATION ───────────────────────────────────────────────────────────────

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ex = x[i] - mx, ey = y[i] - my;
    num += ex * ey; dx += ex * ex; dy += ey * ey;
  }
  return Math.sqrt(dx * dy) > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function corrMatrix(colData: Record<string, number[]>, cols: string[]): number[][] {
  return cols.map(c1 => cols.map(c2 => c1 === c2 ? 1 : pearson(colData[c1], colData[c2])));
}

function frobNorm(m: number[][]): number {
  return Math.sqrt(m.flat().reduce((s, v) => s + v * v, 0));
}

function frobDist(a: number[][], b: number[][]): number {
  const diff = a.map((row, i) => row.map((v, j) => v - b[i][j]));
  const na = frobNorm(a);
  return na > 0 ? clamp(frobNorm(diff) / na) : 0;
}

// ── R² RETENTION PROXY (pairwise correlation as proxy) ───────────────────────

function r2Retention(origData: Record<string, number[]>, procData: Record<string, number[]>, cols: string[]): number {
  if (cols.length < 2) return 0.9;
  const retentions: number[] = [];
  for (let i = 0; i < cols.length; i++) {
    const target = cols[i];
    const ot = origData[target], pt = procData[target];
    if (!ot?.length || !pt?.length) continue;
    let sumOrig = 0, sumProc = 0, cnt = 0;
    for (let j = 0; j < cols.length; j++) {
      if (i === j) continue;
      const feat = cols[j];
      if (!origData[feat]?.length || !procData[feat]?.length) continue;
      const ro = pearson(origData[feat], ot);
      const rp = pearson(procData[feat], pt);
      sumOrig += ro * ro; sumProc += rp * rp; cnt++;
    }
    if (cnt > 0 && sumOrig > 0) retentions.push(Math.min(1, sumProc / sumOrig));
  }
  return retentions.length ? mean(retentions) : 0.85;
}

// ── PER-COLUMN FIDELITY TYPES ─────────────────────────────────────────────────

export interface NumFidelity {
  col: string;
  origMean: number; procMean: number;
  origStd: number; procStd: number;
  origMin: number; origMax: number;
  origMedian: number; procMedian: number;
  relBias: number;      // percent
  varRatio: number;
  nmae: number;         // 0–1
  mps: number;          // 0–1
  pp: number;           // 0–1
  sfs: number;          // 0–1
  ksStat: number;       // 0–1
  jsd: number;          // 0–1
  wassersteinNorm: number; // 0–1
  entropyOrig: number;
  entropyProc: number;
  epr: number;          // entropy preservation ratio
  uvrr: number;         // unique value retention ratio
  origP: number[];      // [P5,P10,P25,P50,P75,P90,P95]
  procP: number[];
  histogram: HistogramData;
  generalised: boolean;
  // Fix #1: pseudonymization flags
  pseudonymized: boolean;   // true if processed column converted to PSEUDO_* tokens
  // Fix #7: all-null flag
  allNull: boolean;         // true if 100% null in both original and processed
  excluded: boolean;        // true if excluded from scoring (pseudonymized or allNull)
}

export interface CatFidelity {
  col: string;
  histIntersection: number;
  uvrr: number;
  entropyOrig: number;
  entropyProc: number;
  epr: number;
  sfs: number;
  origFreq: Record<string, number>;   // value → fraction
  procFreq: Record<string, number>;
}

// ── PER-COLUMN COMPUTATION ────────────────────────────────────────────────────

function computeNumFidelity(origRows: Row[], procRows: Row[], col: string): NumFidelity {
  // Fix #7: Check if column is 100% null in both original and processed
  const origAllNull = columnIsAllNull(origRows, col);
  const procAllNull = columnIsAllNull(procRows, col);
  const allNull = origAllNull && procAllNull;

  // Fix #1: Detect if processed column has been pseudonymized (PSEUDO_* tokens or non-numeric)
  const pseudonymized = !procAllNull && columnIsPseudonymized(procRows, col);

  // Fix #2: Strip unit suffixes when extracting numeric values (handles " acres" etc.)
  const origVals = numVals(origRows, col);  // numVals already calls stripUnit

  const sampleProc = procRows.slice(0, 5).map(r => r[col]);
  // Only treat as generalised if NOT pseudonymized — generalised values have range patterns like "30-40"
  const isGeneralised = !pseudonymized && sampleProc.some(v => typeof v === 'string' && isNaN(Number(v)));
  const procVals = pseudonymized
    ? []  // no usable numeric data
    : (isGeneralised ? approxNumVals(procRows, col) : numVals(procRows, col));

  const emptyBase: NumFidelity = {
    col, origMean: 0, procMean: 0, origStd: 0, procStd: 0, origMin: 0, origMax: 0,
    origMedian: 0, procMedian: 0,
    relBias: 0, varRatio: 1, nmae: 0, mps: 1, pp: 1, sfs: 1,
    ksStat: 0, jsd: 0, wassersteinNorm: 0, entropyOrig: 0, entropyProc: 0, epr: 1, uvrr: 1,
    origP: [0,0,0,0,0,0,0], procP: [0,0,0,0,0,0,0],
    histogram: { bins: [], origCounts: [], procCounts: [] },
    generalised: isGeneralised,
    pseudonymized: false,
    allNull: false,
    excluded: false,
  };

  // Fix #7: All-null in both — exclude from scoring (return N/A marker)
  if (allNull) {
    return { ...emptyBase, allNull: true, excluded: true, sfs: 0 };
  }

  if (!origVals.length) return { ...emptyBase, pseudonymized, excluded: pseudonymized };

  // Fix #1: Pseudonymized column → SFS = 0, total information loss
  if (pseudonymized) {
    const origMean = mean(origVals);
    const origVar = variance(origVals, origMean);
    const origStd = Math.sqrt(origVar);
    const sOrig = sortedArr(origVals);
    const origP = [5, 10, 25, 50, 75, 90, 95].map(p => percentile(sOrig, p));
    return {
      ...emptyBase,
      col,
      origMean,
      origStd,
      origMin: Math.min(...origVals),
      origMax: Math.max(...origVals),
      origMedian: origP[3],
      origP,
      // Processed stats are meaningless — show 0
      procMean: 0, procStd: 0, procMedian: 0,
      procP: [0,0,0,0,0,0,0],
      // Worst-case divergence metrics
      relBias: 100,
      varRatio: 0,
      nmae: 1,
      mps: 0,
      pp: 0,
      sfs: 0,            // Fix #1: SFS = 0%
      ksStat: 1,
      jsd: 1,            // Fix #3: Consistent with Distributions tab
      wassersteinNorm: 1,
      entropyOrig: numericEntropy(origVals),
      entropyProc: 0,
      epr: 0,
      uvrr: 0,
      histogram: buildHistogram(origVals, []),
      generalised: false,
      pseudonymized: true,
      allNull: false,
      excluded: true,    // Fix #1: excluded from SFS average
    };
  }

  const origMean = mean(origVals);
  const procMean = procVals.length ? mean(procVals) : origMean;
  const origVar = variance(origVals, origMean);
  const procVar = procVals.length ? variance(procVals) : origVar;
  const origStd = Math.sqrt(origVar);
  const procStd = Math.sqrt(procVar);
  const origMin = Math.min(...origVals);
  const origMax = Math.max(...origVals);
  const range = origMax - origMin || 1;

  const ps = [5, 10, 25, 50, 75, 90, 95];
  const sOrig = sortedArr(origVals);
  const sProc = procVals.length ? sortedArr(procVals) : sOrig;
  const origP = ps.map(p => percentile(sOrig, p));
  const procP = ps.map(p => percentile(sProc, p));

  // A2: Relative Bias
  const relBias = origMean !== 0 ? (procMean - origMean) / Math.abs(origMean) * 100 : 0;
  // A3: Variance Ratio
  const varRatio = origVar > 0 ? clamp(procVar / origVar, 0, 5) : 1;
  // A1: NMAE (mean-based proxy — works for both aligned & non-aligned)
  const nmae = clamp(Math.abs(procMean - origMean) / range);
  // A4: MPS
  const mps = clamp(1 - Math.abs(procMean - origMean) / (origStd + 1e-10));
  // A5: Percentile Preservation
  const ppErrors = ps.map((_, i) => Math.abs(procP[i] - origP[i]) / (Math.abs(origP[i]) + 1e-10));
  const pp = clamp(1 - mean(ppErrors));
  // A6: SFS
  const sfs = clamp(
    (1 - nmae) * 0.30 +
    (1 - Math.abs(relBias) / 100) * 0.25 +
    Math.min(varRatio, 1 / (varRatio || 1)) * 0.25 +
    mps * 0.10 +
    pp * 0.10
  );

  const ks = procVals.length ? ksStatistic(origVals, procVals) : 0;
  const jsdVal = procVals.length ? jsd(origVals, procVals) : 1;
  const w1 = procVals.length ? wasserstein1(origVals, procVals) : 1;
  const entOrig = numericEntropy(origVals);
  const entProc = procVals.length ? numericEntropy(procVals) : 0;
  const epr = entOrig > 0 ? clamp(entProc / entOrig, 0, 2) : 1;

  const origUniq = new Set(origVals.map(v => Math.round(v * 100))).size;
  const procRaw = procRows.map(r => r[col]).filter(v => v !== null && v !== undefined);
  const procUniq = new Set(procRaw.map(v => String(v))).size;
  const uvrr = origUniq > 0 ? clamp(procUniq / origUniq) : 1;

  const histogram = buildHistogram(origVals, procVals);

  return {
    col, origMean, procMean, origStd, procStd, origMin, origMax,
    origMedian: origP[3], procMedian: procP[3],
    relBias, varRatio, nmae, mps, pp, sfs,
    ksStat: ks, jsd: jsdVal, wassersteinNorm: w1,
    entropyOrig: entOrig, entropyProc: entProc, epr, uvrr,
    origP, procP, histogram, generalised: isGeneralised,
    pseudonymized: false,
    allNull: false,
    excluded: false,
  };
}

function computeCatFidelity(origRows: Row[], procRows: Row[], col: string): CatFidelity {
  const ov = origRows.map(r => String(r[col] ?? '')).filter(v => v !== '' && v !== 'undefined');
  const pv = procRows.map(r => String(r[col] ?? '')).filter(v => v !== '' && v !== 'undefined');
  const hi = histIntersect(ov, pv);
  const origUniq = new Set(ov).size;
  const procUniq = new Set(pv).size;
  const uvrr = origUniq > 0 ? clamp(procUniq / origUniq) : 1;
  const entOrig = catEntropy(ov);
  const entProc = catEntropy(pv);
  const epr = entOrig > 0 ? clamp(entProc / entOrig, 0, 2) : 1;
  const eprProximity = Math.max(0, 1 - Math.abs(1 - epr));
  const sfs = clamp(hi * 0.50 + eprProximity * 0.30 + uvrr * 0.20);

  const na = ov.length || 1, nb = pv.length || 1;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const v of ov) fa.set(v, (fa.get(v) ?? 0) + 1);
  for (const v of pv) fb.set(v, (fb.get(v) ?? 0) + 1);
  const origFreq: Record<string, number> = {};
  const procFreq: Record<string, number> = {};
  for (const [k, c] of fa) origFreq[k] = c / na;
  for (const [k, c] of fb) procFreq[k] = c / nb;

  return { col, histIntersection: hi, uvrr, entropyOrig: entOrig, entropyProc: entProc, epr, sfs, origFreq, procFreq };
}

// ── OUS GRADING ───────────────────────────────────────────────────────────────

export function getGrade(ous: number): string {
  if (ous >= 90) return 'A+';
  if (ous >= 80) return 'A';
  if (ous >= 70) return 'B';
  if (ous >= 60) return 'C';
  if (ous >= 50) return 'D';
  return 'F';
}

export function getGradeLabel(grade: string): string {
  const map: Record<string, string> = {
    'A+': 'Exceptional — virtually no utility loss',
    'A':  'Excellent — minor distortion only',
    'B':  'Good — manageable trade-off',
    'C':  'Acceptable — notable utility loss',
    'D':  'Poor — significant analytical degradation',
    'F':  'Fail — data utility severely compromised',
  };
  return map[grade] ?? grade;
}

export function getVerdict(ous: number, riskReduction: number | null, suppPct: number): string {
  const rr = riskReduction ?? 0;
  if (ous >= 80 && rr >= 50 && suppPct < 5)
    return '✅ OPTIMAL — Excellent privacy-utility balance. Recommended for public release.';
  if (ous >= 70 && rr >= 50)
    return '⚠ ACCEPTABLE — Adequate balance. Minor utility loss tolerable for research use.';
  if (ous >= 70 && rr < 50)
    return '⚠ HIGH UTILITY, LOWER PROTECTION — Consider stronger parameters.';
  if (ous < 70 && rr >= 50)
    return '❌ OVER-ANONYMISED — Privacy achieved but at severe utility cost. Relax parameters.';
  return '❌ POOR BALANCE — Neither sufficient privacy nor utility achieved. Review technique choice.';
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export interface UtilityMetrics {
  ous: number;
  grade: string;
  gradeLabel: string;
  verdict: string;
  sfs: number;
  dsScore: number;
  icScore: number;
  cpScore: number;
  puScore: number;
  puInsufficient: boolean;   // Fix #5: true when <2 valid numeric cols for PU
  rowsOrig: number;
  rowsProc: number;
  commonCols: string[];
  numericCols: string[];
  catCols: string[];
  suppressedCols: string[];
  pseudonymizedCols: string[];   // Fix #1: columns that were pseudonymized
  allNullCols: string[];         // Fix #7: columns that are 100% null in both
  numericFidelity: NumFidelity[];
  catFidelity: CatFidelity[];
  correlationCols: string[];
  corrOrig: number[][];
  corrProc: number[][];
  deltaFrob: number;
  riskBefore: number | null;
  riskAfter: number | null;
  riskReduction: number | null;
  technique: string;
  datasetName: string;
  warnings: string[];
  recommendations: string[];
}

export function computeUtilityMetrics(
  origRows: Row[],
  procRows: Row[],
  origCols: string[],
  technique: string,
  datasetName: string,
  riskBefore: number | null = null,
): UtilityMetrics {
  const procCols = procRows.length > 0 ? Object.keys(procRows[0]) : origCols;
  const procColSet = new Set(procCols);
  const commonCols = origCols.filter(c => procColSet.has(c));
  const suppressedCols = origCols.filter(c => !procColSet.has(c));
  const warnings: string[] = [];

  if (suppressedCols.length > 0)
    warnings.push(`${suppressedCols.length} column(s) suppressed in processed data: ${suppressedCols.slice(0, 5).join(', ')}`);
  const rowDiff = origRows.length - procRows.length;
  if (rowDiff > 0)
    warnings.push(`${rowDiff} rows suppressed during processing (${(rowDiff / origRows.length * 100).toFixed(1)}%)`);

  // Classify columns — a column is numeric if ≥70% of original values parse as numbers
  // Fix #2: stripUnit is applied inside numVals, so unit-suffixed columns classify correctly
  const numericCols = commonCols.filter(col => {
    const tot = Math.min(origRows.length, 100);
    const sample = origRows.slice(0, tot);
    const numCount = sample.filter(r => {
      const stripped = stripUnit(r[col]);
      return !isNaN(parseFloat(String(stripped))) && String(stripped).trim() !== '';
    }).length;
    return numCount / (tot || 1) >= 0.7;
  });
  const catCols = commonCols.filter(c => !numericCols.includes(c));

  // Step 1: Statistical Fidelity
  const numFidelity = numericCols.map(col => computeNumFidelity(origRows, procRows, col));
  const catFidelity = catCols.map(col => computeCatFidelity(origRows, procRows, col));

  // Collect pseudonymized and all-null column names for reporting
  const pseudonymizedCols = numFidelity.filter(f => f.pseudonymized).map(f => f.col);
  const allNullCols = numFidelity.filter(f => f.allNull).map(f => f.col);

  // Warn about pseudonymized columns
  if (pseudonymizedCols.length > 0) {
    warnings.push(
      `${pseudonymizedCols.length} column(s) converted to identifier tokens — excluded from statistical scoring: ${pseudonymizedCols.join(', ')}`
    );
  }
  if (allNullCols.length > 0) {
    warnings.push(
      `${allNullCols.length} column(s) are 100% null in both datasets — excluded from scoring: ${allNullCols.join(', ')}`
    );
  }

  // Fix #1 + #7: Only include non-excluded columns in SFS average
  const scoredNumFidelity = numFidelity.filter(f => !f.excluded);
  const numSFS = scoredNumFidelity.length ? mean(scoredNumFidelity.map(f => f.sfs)) : 0.9;
  const catSFS = catFidelity.length ? mean(catFidelity.map(f => f.sfs)) : 0.9;
  const allN = scoredNumFidelity.length + catCols.length;
  const sfs = allN > 0
    ? (numSFS * scoredNumFidelity.length + catSFS * catCols.length) / allN
    : 0.85;

  // Step 2: Distribution Similarity — also exclude pseudonymized from DS average
  const numDS = scoredNumFidelity.length ? mean(scoredNumFidelity.map(f => 1 - f.jsd)) : 0.9;
  const catDS = catFidelity.length ? mean(catFidelity.map(f => f.histIntersection)) : 0.9;
  const dsScore = allN > 0
    ? (numDS * scoredNumFidelity.length + catDS * catCols.length) / allN
    : 0.85;

  // Step 3: Information Content — exclude pseudonymized from IC average
  const allEPR = [
    ...scoredNumFidelity.map(f => clamp(Math.max(0, 1 - Math.abs(1 - f.epr)))),
    ...catFidelity.map(f => clamp(Math.max(0, 1 - Math.abs(1 - f.epr)))),
  ];
  const icScore = allEPR.length ? mean(allEPR) : 0.85;

  // Step 4: Correlation Preservation (capped at 10 cols for performance)
  // Fix #8: Only use valid (non-pseudonymized, non-null) numeric columns for correlation
  const validNumericCols = numericCols.filter(col => {
    const f = numFidelity.find(nf => nf.col === col);
    return f && !f.excluded;
  });
  const corrCols = validNumericCols.slice(0, 10);
  let corrOrig: number[][] = [[1]], corrProc: number[][] = [[1]], deltaFrob = 0;
  if (corrCols.length >= 2) {
    const origColData: Record<string, number[]> = {};
    const procColData: Record<string, number[]> = {};
    for (const col of corrCols) {
      origColData[col] = numVals(origRows, col);
      procColData[col] = numVals(procRows, col).length > 0
        ? numVals(procRows, col)
        : approxNumVals(procRows, col);
    }
    corrOrig = corrMatrix(origColData, corrCols);
    corrProc = corrMatrix(procColData, corrCols);
    deltaFrob = frobDist(corrOrig, corrProc);
  }
  const cpScore = clamp(1 - deltaFrob);

  // Step 5: Predictive Utility
  // Fix #5: If fewer than 2 valid numeric columns remain, flag as insufficient
  let puScore = 0.85;
  let puInsufficient = false;
  if (corrCols.length >= 2) {
    const origColData: Record<string, number[]> = {};
    const procColData: Record<string, number[]> = {};
    for (const col of corrCols) {
      origColData[col] = numVals(origRows, col);
      procColData[col] = numVals(procRows, col).length > 0
        ? numVals(procRows, col)
        : approxNumVals(procRows, col);
    }
    puScore = clamp(r2Retention(origColData, procColData, corrCols));
  } else {
    // Fix #5: Not enough valid numeric columns for meaningful PU assessment
    puInsufficient = true;
    // Use a conservative estimate based on available evidence rather than 0 or 1
    puScore = validNumericCols.length === 1 ? 0.5 : 0.3;
  }

  // Step 6: OUS composite — Fix #4: recomputed with corrected SFS
  const ousFrac = clamp(sfs * 0.30 + dsScore * 0.25 + icScore * 0.20 + cpScore * 0.15 + puScore * 0.10);
  const ous = Math.round(ousFrac * 1000) / 10;

  const suppPct = origRows.length > 0 ? (origRows.length - procRows.length) / origRows.length * 100 : 0;
  // Risk after: estimated from sfs reduction of risk
  const riskAfter = riskBefore !== null
    ? Math.max(0, riskBefore - riskBefore * (1 - sfs) * 0.8)
    : null;
  const riskReduction = riskBefore !== null && riskAfter !== null && riskBefore > 0
    ? (riskBefore - riskAfter) / riskBefore * 100
    : null;

  const grade = getGrade(ous);
  const baseVerdict = getVerdict(ous, riskReduction, suppPct);

  // When columns are excluded from scoring, qualify the grade label and verdict
  // so the headline never claims "no utility loss" while simultaneously flagging destroyed columns.
  const totalExcluded = pseudonymizedCols.length + allNullCols.length;
  const totalScored = scoredNumFidelity.length + catCols.length;
  const totalOrig = numericCols.length + catCols.length;

  let gradeLabel = getGradeLabel(grade);
  let verdict = baseVerdict;

  if (totalExcluded > 0) {
    // Replace the grade label with a qualified version
    const baseLabel = getGradeLabel(grade);
    gradeLabel = `${baseLabel.split(' —')[0]} on retained columns — ${totalExcluded} column(s) lost all analytical value`;

    // Prepend a clear qualifier to the verdict
    const excludedDesc = pseudonymizedCols.length > 0
      ? `${pseudonymizedCols.length} column(s) pseudonymized (${pseudonymizedCols.slice(0, 3).join(', ')}${pseudonymizedCols.length > 3 ? '…' : ''})`
      : `${allNullCols.length} column(s) null`;
    const scoringNote = `Score computed on ${totalScored} of ${totalOrig} columns — ${excludedDesc}.`;
    verdict = `${baseVerdict}  [${scoringNote}]`;
  }

  // Auto-recommendations
  const recommendations: string[] = [];
  if (ous < 70)
    recommendations.push('Utility is below acceptable threshold. Consider reducing k, relaxing suppression limits, or switching to a softer generalisation method.');
  if (riskReduction !== null && riskReduction < 50)
    recommendations.push('Privacy protection is modest. Increase k parameter or add Differential Privacy (ε ≤ 1.0) as a complementary technique.');
  if (pseudonymizedCols.length > 0)
    recommendations.push(`${pseudonymizedCols.length} column(s) were pseudonymized and lost all statistical utility: ${pseudonymizedCols.join(', ')}. Consider generalisation (binning) instead of pseudonymisation for numeric columns to preserve analytical value.`);
  const scoredWorstCols = [...scoredNumFidelity].sort((a, b) => a.sfs - b.sfs).slice(0, 3).map(f => f.col);
  if (scoredWorstCols.length > 0)
    recommendations.push(`Columns with highest distortion among scored columns: ${scoredWorstCols.join(', ')}. Consider column-specific suppression thresholds.`);
  if (deltaFrob > 0.15)
    recommendations.push('Correlation structure shows significant change (Frobenius distance > 0.15). This may impact multivariate analysis tasks.');
  if (puInsufficient)
    recommendations.push('Predictive Utility could not be assessed — fewer than 2 valid numeric columns remain after pseudonymisation. Re-run with a technique that preserves more numeric columns.');
  if (!recommendations.length)
    recommendations.push('Data utility is well-preserved. The processed dataset is suitable for the intended analytical tasks.');

  return {
    ous, grade, gradeLabel, verdict,
    sfs, dsScore, icScore, cpScore, puScore,
    puInsufficient,
    rowsOrig: origRows.length, rowsProc: procRows.length,
    commonCols, numericCols, catCols, suppressedCols,
    pseudonymizedCols, allNullCols,
    numericFidelity: numFidelity, catFidelity,
    correlationCols: corrCols, corrOrig, corrProc, deltaFrob,
    riskBefore, riskAfter, riskReduction,
    technique, datasetName, warnings, recommendations,
  };
}
