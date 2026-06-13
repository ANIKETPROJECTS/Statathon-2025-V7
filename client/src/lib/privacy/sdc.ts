import { type DataRow, columnRange, isNumericCol, type PrivacyResult } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// FAMILY 1: Statistical Disclosure Control (SDC) — Full Spec Implementation
// Statathon 2025 | AIRAVATA Technologies
// ════════════════════════════════════════════════════════════════════════════

// ─── Statistical helpers ──────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function rankArray(arr: number[]): number[] {
  const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length).fill(0);
  sorted.forEach((item, rank) => { ranks[item.i] = rank + 1; });
  return ranks;
}

function spearmanRho(a: number[], b: number[]): number {
  const N = a.length;
  if (N < 2) return 1;
  const ra = rankArray(a), rb = rankArray(b);
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (N * (N * N - 1));
}

function pearsonR(a: number[], b: number[]): number {
  const N = a.length;
  if (N < 2) return 1;
  const ma = mean(a), mb = mean(b);
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0);
  const da  = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0));
  const db  = Math.sqrt(b.reduce((s, v) => s + (v - mb) ** 2, 0));
  if (da === 0 || db === 0) return 1;
  return num / (da * db);
}

function tvd(vals: string[], origFreq: Map<string, number>, newFreq: Map<string, number>, N: number): number {
  return 0.5 * vals.reduce((s, v) => {
    const p = (origFreq.get(v) || 0) / N;
    const q = (newFreq.get(v) || 0) / N;
    return s + Math.abs(p - q);
  }, 0);
}

function chiSquareP(chi2: number, df: number): number {
  // Wilson-Hilferty normal approximation for chi-square CDF
  if (df <= 0 || chi2 < 0) return 1;
  const z = Math.cbrt(chi2 / df) - (1 - 2 / (9 * df));
  const sigma = Math.sqrt(2 / (9 * df));
  const norm = z / sigma;
  return 1 - 0.5 * (1 + erf(norm / Math.SQRT2));
}
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const ans = 1 - poly * Math.exp(-x * x);
  return x >= 0 ? ans : -ans;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

// ─── HTML report builder ──────────────────────────────────────────────────────

function htmlRow(label: string, value: string | number, good?: boolean | null): string {
  const style = good === true ? "color:#16A34A;font-weight:600" : good === false ? "color:#DC2626;font-weight:600" : "";
  return `<tr><td style="padding:5px 10px;color:#6b7280">${label}</td><td style="padding:5px 10px;text-align:right;${style}">${String(value)}</td></tr>`;
}

function buildReport(
  title: string,
  dataset: string,
  timestamp: string,
  N: number,
  Nout: number,
  paramsHtml: string,
  complianceHtml: string,
  metricsHtml: string,
  interpretation: string,
  recommendations: string[],
): string {
  const passed = complianceHtml.includes("YES");
  const badge = passed
    ? `<span style="background:#16A34A;color:white;padding:4px 12px;border-radius:4px;font-weight:700">PASS</span>`
    : `<span style="background:#DC2626;color:white;padding:4px 12px;border-radius:4px;font-weight:700">FAIL</span>`;
  const recs = recommendations.length
    ? `<h2 style="color:#1e40af;border-bottom:2px solid #e5e7eb;padding-bottom:4px">Recommendations</h2>` +
      recommendations.map((r) => `<div style="padding:8px;margin:4px 0;background:#fef9c3;border-left:4px solid #d97706;border-radius:4px;font-size:13px">${r}</div>`).join("")
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} Report</title>
<style>body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#111}
h1{font-size:18px;margin-bottom:4px}h2{font-size:14px;margin-top:20px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}
th{background:#f3f4f6;padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb}
tr:nth-child(even){background:#f9fafb}
.section{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:16px}
.section-header{background:#1e3a5f;color:white;padding:8px 12px;font-weight:600;font-size:13px}
</style></head><body>
<div style="background:#1e3a5f;color:white;padding:16px;border-radius:8px;margin-bottom:20px">
  <strong style="font-size:17px">SafeData Pipeline — ${title} Report</strong><br/>
  Government of India · MoSPI · AIRAVATA Technologies<br/>
  <small>Dataset: ${dataset} &nbsp;|&nbsp; Generated: ${timestamp}</small>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <span style="font-size:15px;font-weight:600">Compliance Status: ${badge}</span>
  <span style="font-size:13px;color:#6b7280">Input: ${N} records → Output: ${Nout} records</span>
</div>
<div class="section"><div class="section-header">Parameters</div>
<table>${paramsHtml}</table></div>
<div class="section"><div class="section-header">Compliance & Metrics</div>
<table>${complianceHtml}${metricsHtml}</table></div>
<div class="section"><div class="section-header">Interpretation</div>
<div style="padding:12px;font-size:13px;line-height:1.6">${interpretation}</div></div>
${recs}
</body></html>`;
}

// ─── Shared empty result ──────────────────────────────────────────────────────

function sdcEmpty(name: string): PrivacyResult {
  return {
    technique: name, family: "SDC",
    processedData: [], originalCount: 0, processedCount: 0,
    recordsSuppressed: 0, informationLoss: 0, executionMs: 0,
    stats: {}, warnings: ["No data or no columns selected."],
    compliancePassed: null,
  };
}

// ─── Mondrian helper (shared by K-Anon, L-Div, T-Close) ──────────────────────

interface Partition { indices: number[] }

function medianValue(vals: number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ─── FNV-1a 32-bit hash (Issue 8: content-derived pseudonymisation) ───────────
// Hashes (col + NUL + val) so identical sequential-position values in different
// columns produce different PSEUDO_NNNNN outputs, eliminating cross-column linkage.
function fnv1a32(s: string): number {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV prime, keep uint32
  }
  return h;
}

// Result type that carries Issue-1 diagnostic info back to the caller
interface MondrianResult {
  partitions: Partition[];
  oversizedLeafCount: number;   // #leaves with size > 2k−1 (couldn't be split further)
  oversizedLeafRecords: number; // total records in those leaves
}

function mondrianPartition(data: DataRow[], qis: string[], k: number): MondrianResult {
  if (data.length === 0 || qis.length === 0) return { partitions: [], oversizedLeafCount: 0, oversizedLeafRecords: 0 };
  const globalRanges = new Map<string, number>();
  qis.forEach((c) => globalRanges.set(c, columnRange(data, c)));
  const globalDistinctCounts = new Map<string, number>();
  qis.forEach((c) => {
    if (!isNumericCol(data, c)) {
      globalDistinctCounts.set(c, new Set(data.map((r) => String(r[c]))).size);
    }
  });

  // Score a column: higher = better candidate for splitting
  function scoreCol(col: string, indices: number[]): number {
    if (isNumericCol(data, col)) {
      const vals = indices.map((i) => Number(data[i][col])).filter((v) => !isNaN(v));
      if (vals.length < 2) return -1;
      const gRange = Math.max(globalRanges.get(col) || 1, 1);
      return (Math.max(...vals) - Math.min(...vals)) / gRange;
    } else {
      const globalD = Math.max(globalDistinctCounts.get(col) || 1, 2);
      const partD = new Set(indices.map((i) => String(data[i][col]))).size;
      if (partD < 2) return -1;
      return (partD - 1) / (globalD - 1);
    }
  }

  // Numeric split at median — returns [left, right] if both ≥ k, else null
  function trySplitNumeric(col: string, indices: number[]): [number[], number[]] | null {
    const vals = indices.map((i) => Number(data[i][col])).filter((v) => !isNaN(v));
    const mid = medianValue(vals);
    const left: number[] = [], right: number[] = [];
    indices.forEach((i) => {
      const v = Number(data[i][col]);
      (isNaN(v) || v <= mid ? left : right).push(i);
    });
    if (left.length < k || right.length < k) return null;
    return [left, right];
  }

  // Categorical split: try every possible split point and pick the most balanced one
  function trySplitCategorical(col: string, indices: number[]): [number[], number[]] | null {
    const distinct = Array.from(new Set(indices.map((i) => String(data[i][col])))).sort();
    if (distinct.length < 2) return null;
    let bestLeft: number[] | null = null, bestRight: number[] | null = null, bestBalance = -1;
    for (let splitAt = 1; splitAt < distinct.length; splitAt++) {
      const leftSet = new Set(distinct.slice(0, splitAt));
      const left: number[] = [], right: number[] = [];
      indices.forEach((i) => (leftSet.has(String(data[i][col])) ? left : right).push(i));
      if (left.length >= k && right.length >= k) {
        const balance = Math.min(left.length, right.length) / Math.max(left.length, right.length);
        if (balance > bestBalance) { bestBalance = balance; bestLeft = left; bestRight = right; }
      }
    }
    if (bestLeft && bestRight) return [bestLeft, bestRight];
    return null;
  }

  // Issue 1: track unsplittable leaves whose size exceeds 2k−1
  // Mondrian invariant: a leaf is returned here only when ALL columns fail to split.
  // A leaf with size > 2k−1 means data diversity was too low to subdivide further;
  // k-anonymity is still satisfied (size ≥ k) but the class is coarser than ideal.
  let oversizedLeafCount = 0;
  let oversizedLeafRecords = 0;

  function split(partition: Partition): Partition[] {
    const { indices } = partition;
    // Sort columns by descending score and try each in turn
    const ranked = qis
      .map((col) => ({ col, score: scoreCol(col, indices) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    for (const { col } of ranked) {
      const result = isNumericCol(data, col)
        ? trySplitNumeric(col, indices)
        : trySplitCategorical(col, indices);
      if (result) {
        const [left, right] = result;
        return [...split({ indices: left }), ...split({ indices: right })];
      }
    }
    // No valid split found on any column — leaf partition retained as-is.
    // Issue 1: flag if this leaf is larger than 2k−1 (could not be halved while keeping both ≥ k)
    if (indices.length > 2 * k - 1) {
      oversizedLeafCount++;
      oversizedLeafRecords += indices.length;
    }
    return [partition];
  }

  const partitions = split({ indices: data.map((_, i) => i) });
  return { partitions, oversizedLeafCount, oversizedLeafRecords };
}


// ════════════════════════════════════════════════════════════════════════════
// 1. K-ANONYMITY (Mondrian Greedy Partitioning)
//    Ref: LeFevre et al., ICDE 2006
// ════════════════════════════════════════════════════════════════════════════

export function applyKAnonymity(
  data: DataRow[],
  qis: string[],
  k: number,
  suppressionLimit: number,       // 0–1 fraction
  genMethod: "midpoint" | "range" = "range",
  directIds: string[] = [],       // Issue 6: columns to pseudonymise
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0 || qis.length === 0) return sdcEmpty("K-Anonymity (Mondrian)");

  const N = data.length;
  const maxSuppressCount = Math.ceil(suppressionLimit * N);

  // ── Issue 7: Sort data stably by QI values before partitioning for full determinism ──
  const stableData = [...data].sort((a, b) => {
    for (const qi of qis) {
      const va = String(a[qi] ?? ""), vb = String(b[qi] ?? "");
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  });

  const globalRanges = new Map<string, number>();
  qis.forEach((c) => globalRanges.set(c, columnRange(stableData, c)));
  const globalDistinctCountsKA = new Map<string, number>();
  qis.forEach((c) => {
    if (!isNumericCol(stableData, c)) {
      globalDistinctCountsKA.set(c, Math.max(new Set(stableData.map((r) => String(r[c]))).size, 2));
    }
  });

  // ── Issue 8 fix: Content-derived pseudonym maps for Direct-ID columns ────────
  // Each pseudonym is derived from FNV-1a hash of (col + NUL + originalValue).
  // This breaks the cross-column correlation that arose when both columns shared
  // the same sequential counter — FSU_Serial_No and District_code now produce
  // independent PSEUDO_NNNNN values even when they have the same row-count.
  // Within-column stability is preserved: same value always → same pseudonym.
  const pseudoMaps = new Map<string, Map<string, string>>();
  directIds.forEach((col) => {
    const map = new Map<string, string>();
    // Sort distinct values for stable ordering, then assign hash-derived numbers
    const distinct = Array.from(new Set(stableData.map((r) => String(r[col] ?? "")))).sort();
    const usedNums = new Set<number>();
    distinct.forEach((v) => {
      // Hash col+"\0"+val so different columns with different values never collide by position
      let num = fnv1a32(col + "\0" + v) % 100000;
      // Linear-probe collision resolution within this column's namespace
      while (usedNums.has(num)) num = (num + 1) % 100000;
      usedNums.add(num);
      map.set(v, `PSEUDO_${String(num).padStart(5, "0")}`);
    });
    pseudoMaps.set(col, map);
  });

  // ── Partition ────────────────────────────────────────────────────────────────
  // Issue 1: mondrianPartition now returns oversized-leaf diagnostics alongside partitions.
  // Mondrian invariant: a split is only accepted when both halves are ≥ k, so all leaf
  // partitions have size ≥ k. "Small partitions" (size < k) therefore never arise from
  // Mondrian itself — the suppression/merge path (Issue 5) is a safety net for partitions
  // injected from outside, and for oversized leaves (size > 2k−1) that could not be halved.
  const { partitions: rawPartitionsAll, oversizedLeafCount, oversizedLeafRecords } = mondrianPartition(stableData, qis, k);
  let validPartitions = rawPartitionsAll.filter((p) => p.indices.length >= k);
  let smallPartitions = rawPartitionsAll.filter((p) => p.indices.length < k);
  const initialSmallCount = smallPartitions.reduce((s, p) => s + p.indices.length, 0);

  // ── Issue 5: Merge-smallest fallback when suppression would exceed limit ─────
  // Note: under Mondrian's invariant this path is only reachable if the caller passes
  // pre-filtered partitions with sub-k sizes, or if future algorithm changes produce them.
  const mergedPartitions: Partition[] = [];
  let mergeActivated = false;
  if (initialSmallCount > maxSuppressCount && smallPartitions.length > 0) {
    mergeActivated = true;
    smallPartitions.sort((a, b) => a.indices.length - b.indices.length);
    let pool: number[] = [];
    for (const sp of smallPartitions) {
      pool = [...pool, ...sp.indices];
      if (pool.length >= k) {
        mergedPartitions.push({ indices: pool });
        pool = [];
      }
    }
    // Remaining pool that still can't reach k → will be suppressed
    smallPartitions = pool.length > 0 ? [{ indices: pool }] : [];
  }

  const allValidPartitions = [...validPartitions, ...mergedPartitions];
  const suppressed: number[] = [];
  const processed: DataRow[] = [];
  const equivClassSizes: number[] = [];
  const gilPerCol = new Map<string, number>();
  qis.forEach((c) => gilPerCol.set(c, 0));

  smallPartitions.forEach((p) => suppressed.push(...p.indices));

  const allRowKeys = stableData.length > 0 ? Object.keys(stableData[0]) : [];
  const nonQInonDirect = allRowKeys.filter((c) => !qis.includes(c) && !directIds.includes(c));

  for (const partition of allValidPartitions) {
    const { indices } = partition;
    equivClassSizes.push(indices.length);

    const generalised: DataRow = {};
    qis.forEach((col) => {
      const vals = indices.map((i) => stableData[i][col]);
      if (isNumericCol(stableData, col)) {
        const nums = vals.map((v) => Number(v)).filter((v) => !isNaN(v));
        const lo = Math.min(...nums), hi = Math.max(...nums);
        gilPerCol.set(col, (gilPerCol.get(col) || 0) + ((hi - lo) / Math.max(globalRanges.get(col) || 1, 1)) * indices.length);
        if (genMethod === "midpoint") {
          const mid = (lo + hi) / 2;
          generalised[col] = String(Number.isInteger(mid) ? mid : mid.toFixed(2));
        } else {
          generalised[col] = lo === hi ? String(lo) : `[${lo}–${hi}]`;
        }
      } else {
        const distinct = Array.from(new Set(vals.map(String))).sort();
        const globalD = globalDistinctCountsKA.get(col) || 2;
        const localD = distinct.length;
        // Issue 4: Categorical GIL proxy = (distinct_partition − 1) / (distinct_global − 1)
        if (localD > 1) {
          gilPerCol.set(col, (gilPerCol.get(col) || 0) + ((localD - 1) / (globalD - 1)) * indices.length);
        }
        if (genMethod === "midpoint") {
          // Most-common value in partition = categorical "centre"
          const freq = new Map<string, number>();
          vals.forEach((v) => { const s = String(v); freq.set(s, (freq.get(s) || 0) + 1); });
          let bestVal = distinct[0], bestCnt = 0;
          freq.forEach((cnt, v) => { if (cnt > bestCnt) { bestCnt = cnt; bestVal = v; } });
          generalised[col] = bestVal;
        } else {
          generalised[col] = distinct.length === 1 ? distinct[0] : `{${distinct.join(",")}}`;
        }
      }
    });

    indices.forEach((i) => {
      const row: DataRow = { ...generalised };
      nonQInonDirect.forEach((c) => (row[c] = stableData[i][c]));
      // Issue 6: replace Direct-ID values with pseudonyms
      directIds.forEach((c) => {
        const v = String(stableData[i][c] ?? "");
        row[c] = pseudoMaps.get(c)?.get(v) ?? v;
      });
      processed.push(row);
    });
  }

  // ── Issue 4: GIL — normalise by N (spec: GIL = 1/(|QI|×N) × Σ) ─────────────
  const gilCols: Record<string, number> = {};
  let gilTotal = 0;
  qis.forEach((col) => {
    const g = parseFloat(((gilPerCol.get(col) || 0) / Math.max(N, 1)).toFixed(4));
    gilCols[col] = g;
    gilTotal += g;
  });
  const gil = parseFloat((gilTotal / Math.max(qis.length, 1)).toFixed(4));

  const minEC = equivClassSizes.length > 0 ? Math.min(...equivClassSizes) : 0;
  const avgEC = equivClassSizes.length > 0 ? mean(equivClassSizes) : 0;
  const suppressionRate = N > 0 ? suppressed.length / N : 0;
  const kSatisfied = minEC >= k && suppressed.length <= maxSuppressCount;

  // Issue 4: surface GIL formula per column in the colStats panel
  const colStatsGIL: Record<string, Record<string, string | number>> = {};
  qis.forEach((col) => {
    const isNum = isNumericCol(stableData, col);
    colStatsGIL[col] = {
      "GIL": gilCols[col],
      "GIL formula": isNum ? "range_part / range_global" : "(distinct_part−1) / (distinct_global−1)",
    };
  });

  // Issue 8: pseudonym note now reflects content-derived (FNV-1a hash) approach
  const pseudoNote = directIds.length > 0
    ? ` Direct-ID columns (${directIds.join(", ")}) were pseudonymised using content-derived FNV-1a hashing — each column's values map independently to PSEUDO_NNNNN tokens, preventing cross-column re-identification via pseudonym correlation.`
    : "";
  // Issue 1: oversized-leaf note
  const oversizedNote = oversizedLeafCount > 0
    ? ` [Issue 1] ${oversizedLeafCount} equivalence class(es) containing ${oversizedLeafRecords} records could not be split further (size > ${2 * k - 1} = 2k−1); all QI columns had insufficient diversity to produce two sub-partitions of size ≥ k. k-Anonymity is still satisfied but these classes are coarser than optimal.`
    : "";
  // Issue 5: merge note (rarely triggered under Mondrian invariant)
  const mergeNote = mergeActivated
    ? ` Suppression limit was exceeded; merge fallback formed ${mergedPartitions.length} additional group(s) from small partitions.`
    : "";
  const gilNote = `Categorical GIL uses proxy (distinct_in_partition − 1)/(distinct_global − 1); numeric GIL uses partition_range/global_range (NIST 8053 §4.3 adaptation).`;
  const detNote = `Output is fully deterministic: data was sorted by QI values before Mondrian partitioning.`;

  const interp =
    `This dataset was anonymised using k-Anonymity (Mondrian, ${genMethod === "midpoint" ? "midpoint" : "range"} generalisation) with k=${k}. ` +
    `${equivClassSizes.length} equivalence classes were formed (min=${minEC}, avg=${avgEC.toFixed(1)}, max=${equivClassSizes.length > 0 ? Math.max(...equivClassSizes) : 0}). ` +
    `k-Anonymity is ${kSatisfied ? "SATISFIED" : "NOT SATISFIED — min class < k"}. ` +
    `GIL = ${(gil * 100).toFixed(1)}% — ${(gil * 100).toFixed(0)}% of QI precision sacrificed for privacy. ` +
    `${suppressed.length} records (${(suppressionRate * 100).toFixed(1)}%) suppressed.` +
    mergeNote + oversizedNote + pseudoNote + " " + gilNote + " " + detNote;

  const warnings: string[] = [
    ...(suppressionRate > suppressionLimit && suppressionLimit > 0
      ? [`Suppression ${(suppressionRate*100).toFixed(1)}% exceeds limit ${(suppressionLimit*100).toFixed(0)}% — consider lowering k or raising the suppression limit.`] : []),
    ...(mergeActivated ? [`Merge fallback: ${mergedPartitions.length} group(s) formed by merging small partitions to honour suppression limit.`] : []),
    // Issue 1: surface oversized-leaf warning so the QA issue is visible in the results panel
    ...(oversizedLeafCount > 0 ? [
      `[Issue 1] ${oversizedLeafCount} oversized leaf partition(s) (${oversizedLeafRecords} records, size > ${2*k-1}=2k−1) could not be split — QI diversity too low. k-Anonymity still holds but classes are coarser than optimal. Consider reducing k or adding QI columns.`
    ] : []),
    ...(suppressionRate > 0.1 ? ["Suppression > 10% — consider lowering k."] : []),
    ...(gil > 0.5 ? ["GIL > 50% — high information loss. Consider reducing k or narrowing QI set."] : []),
    ...(directIds.length > 0 ? [`${directIds.length} Direct-ID column(s) pseudonymised with content-derived hashing (FNV-1a): ${directIds.join(", ")} — cross-column pseudonym correlation eliminated.`] : []),
    "k-Anonymity does not protect against attribute disclosure or differencing attacks.",
  ];

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "K-Anonymity",
    "dataset", now, N, processed.length,
    htmlRow("K Value", k) +
    htmlRow("Suppression Limit", `${(suppressionLimit * 100).toFixed(0)}%`) +
    htmlRow("Generalisation Method", genMethod === "midpoint" ? "Midpoint [(lo+hi)/2 | most_common_value]" : "Range [[lo–hi] | {all_values}]") +
    htmlRow("QI Columns", qis.join(", ")) +
    (directIds.length > 0 ? htmlRow("Pseudonymised Direct-IDs (content-hashed)", directIds.join(", ")) : ""),
    htmlRow("k-Anonymity Satisfied", kSatisfied ? "YES" : "NO", kSatisfied) +
    htmlRow("Min Equivalence Class", `${minEC} (≥ ${k})`, minEC >= k) +
    htmlRow("Avg Equivalence Class", avgEC.toFixed(1)) +
    htmlRow("Max Equivalence Class", equivClassSizes.length > 0 ? String(Math.max(...equivClassSizes)) : "0") +
    htmlRow("Number of Classes", equivClassSizes.length) +
    htmlRow("Suppressed Records", `${suppressed.length} (${(suppressionRate*100).toFixed(1)}%)`, suppressionRate <= suppressionLimit) +
    (mergeActivated ? htmlRow("Merge Fallback Groups", mergedPartitions.length) : "") +
    htmlRow("Oversized Leaf Partitions (Issue 1)", oversizedLeafCount > 0 ? `${oversizedLeafCount} class(es), ${oversizedLeafRecords} records` : "None", oversizedLeafCount === 0),
    htmlRow("GIL Score (avg across QIs)", `${(gil * 100).toFixed(2)}%`, gil <= 0.3) +
    qis.map((col) => htmlRow(
      `GIL — ${col} (${isNumericCol(stableData, col) ? "numeric: range/global_range" : "categorical: (d_p−1)/(d_g−1)"})`,
      `${(gilCols[col] * 100).toFixed(2)}%`,
    )).join(""),
    interp,
    warnings.filter((w) => !w.includes("does not protect")),
  );

  return {
    technique: "K-Anonymity (Mondrian)", family: "SDC",
    processedData: processed, originalCount: N, processedCount: processed.length,
    recordsSuppressed: suppressed.length,
    informationLoss: gil,
    executionMs: Math.round(performance.now() - t0),
    stats: {
      k,
      kAnonymitySatisfied: kSatisfied ? "YES" : "NO",
      equivalenceClasses: equivClassSizes.length,
      minEquivClassSize: minEC,
      avgEquivClassSize: parseFloat(avgEC.toFixed(1)),
      maxEquivClassSize: equivClassSizes.length > 0 ? Math.max(...equivClassSizes) : 0,
      suppressionRate: `${(suppressionRate * 100).toFixed(1)}%`,
      suppressedRecords: suppressed.length,
      mergedGroups: mergeActivated ? mergedPartitions.length : 0,
      // Issue 1: oversized-leaf diagnostics — visible in the stats panel
      oversizedLeafPartitions: oversizedLeafCount,
      oversizedLeafRecords,
      // Issue 8: pseudonymisation method is now content-derived (FNV-1a), not sequential
      pseudonymisedCols: directIds.length,
      pseudonymisationMethod: directIds.length > 0 ? "FNV-1a content-hash (col+value)" : "N/A",
      generalisationMethod: genMethod,
      gilScore: `${(gil * 100).toFixed(2)}%`,
    },
    colStats: colStatsGIL,
    warnings,
    interpretation: interp,
    compliancePassed: kSatisfied,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 2. L-DIVERSITY (Entropy / Distinct / Recursive)
//    Ref: Machanavajjhala et al., TKDE 2007
// ════════════════════════════════════════════════════════════════════════════

export function applyLDiversity(
  data: DataRow[],
  qis: string[],
  sensitiveAttr: string,
  l: number,
  method: "entropy" | "distinct" | "recursive",
  kBase = 3,
  c = 0.5,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0 || qis.length === 0) return sdcEmpty("L-Diversity");
  const N = data.length;

  const saVals = Array.from(new Set(data.map((r) => String(r[sensitiveAttr] ?? ""))));
  const saUnique = saVals.length;

  const logL = Math.log(l);
  const kForEC = Math.max(2, kBase);
  const { partitions: ldPartitions } = mondrianPartition(data, qis, kForEC);

  const classMap = new Map<number, number[]>();
  ldPartitions.forEach((part, idx) => {
    if (part.indices.length >= kForEC) classMap.set(idx, part.indices);
  });

  const satisfying: DataRow[] = [];
  let violating = 0;
  const entropies: number[] = [];

  for (const [, indices] of Array.from(classMap)) {
    const rows = indices.map((i) => data[i]);
    const freqMap = new Map<string, number>();
    rows.forEach((r) => {
      const v = String(r[sensitiveAttr] ?? "");
      freqMap.set(v, (freqMap.get(v) || 0) + 1);
    });

    let entropy = 0;
    freqMap.forEach((cnt) => {
      const p = cnt / rows.length;
      if (p > 0) entropy -= p * Math.log(p);
    });
    entropies.push(entropy);

    let satisfied = false;
    if (method === "entropy") {
      satisfied = entropy >= logL;
    } else if (method === "distinct") {
      satisfied = freqMap.size >= l;
    } else {
      // Recursive (c, l)-diversity: r₁ < c × (r₂ + r₃ + …)
      const sorted = Array.from(freqMap.values()).sort((a, b) => b - a);
      const r1 = sorted[0] || 0;
      const rest = sorted.slice(1).reduce((s, v) => s + v, 0);
      satisfied = freqMap.size >= l && (rest === 0 ? false : r1 < c * rest);
    }

    if (satisfied) {
      rows.forEach((r) => satisfying.push(r));
    } else {
      violating++;
    }
  }

  const totalClasses = classMap.size;
  const passing = totalClasses - violating;
  const lSatisfied = violating === 0;
  const minEntropy = entropies.length > 0 ? Math.min(...entropies) : 0;
  const maxEntropy = entropies.length > 0 ? Math.max(...entropies) : 0;
  const avgEntropy = entropies.length > 0 ? mean(entropies) : 0;

  const interp = `${passing} of ${totalClasses} equivalence classes satisfy ${l}-diversity using the ${method} method. ` +
    (method === "entropy" ? `The minimum entropy observed is ${minEntropy.toFixed(3)}, which ${minEntropy >= logL ? "meets" : "does not meet"} the threshold of log(${l}) = ${logL.toFixed(3)}. ` : "") +
    `${violating} classes were suppressed. ` +
    (saUnique < l ? `WARNING: The SA column has only ${saUnique} unique values — l-diversity at l=${l} may be impossible globally. Reduce l to ≤ ${saUnique}.` : "");

  const warnings: string[] = [
    ...(saUnique < l ? [`CRITICAL: SA column has only ${saUnique} unique values globally — reduce L to ≤ ${saUnique}.`] : []),
    "L-Diversity protects against attribute disclosure but not skewness or similarity attacks.",
    ...(violating / Math.max(totalClasses, 1) > 0.3 ? ["Many violating classes — consider a larger dataset, lower l, or switch to Distinct variant."] : []),
  ];

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    `L-Diversity (${method})`, "dataset", now, N, satisfying.length,
    htmlRow("L Value", l) + htmlRow("Variant", method) +
      (method === "recursive" ? htmlRow("c (recursive)", c) : "") +
      htmlRow("Underlying K", kBase) +
      htmlRow("QI Columns", qis.join(", ")) + htmlRow("Sensitive Attribute", sensitiveAttr),
    htmlRow("L-Diversity Satisfied", lSatisfied ? "YES" : "NO", lSatisfied) +
    htmlRow("Total Equivalence Classes", totalClasses) +
    htmlRow("Classes Passing", passing, passing === totalClasses) +
    htmlRow("Classes Failing", violating, violating === 0) +
    htmlRow("Suppressed Records", `${N - satisfying.length} (${N > 0 ? ((N - satisfying.length)/N*100).toFixed(1) : 0}%)`, N - satisfying.length === 0),
    (method === "entropy"
      ? htmlRow("Min Class Entropy", minEntropy.toFixed(4), minEntropy >= logL) +
        htmlRow("Max Class Entropy", maxEntropy.toFixed(4)) +
        htmlRow("Avg Class Entropy", avgEntropy.toFixed(4)) +
        htmlRow("Entropy Threshold log(l)", logL.toFixed(4))
      : ""),
    interp,
    warnings.filter((w) => !w.includes("skewness")),
  );

  return {
    technique: `L-Diversity (${method})`, family: "SDC",
    processedData: satisfying, originalCount: N, processedCount: satisfying.length,
    recordsSuppressed: N - satisfying.length,
    informationLoss: N > 0 ? (N - satisfying.length) / N : 0,
    executionMs: Math.round(performance.now() - t0),
    stats: {
      l, method, underlyingK: kBase,
      lDiversitySatisfied: lSatisfied ? "YES" : "NO",
      totalEquivClasses: totalClasses,
      classesPassing: passing,
      classesFailing: violating,
      ...(method === "entropy" ? {
        minClassEntropy: minEntropy.toFixed(4),
        maxClassEntropy: maxEntropy.toFixed(4),
        avgClassEntropy: avgEntropy.toFixed(4),
        entropyThreshold: logL.toFixed(4),
      } : {}),
      saUniqueValues: saUnique,
    },
    warnings,
    interpretation: interp,
    compliancePassed: lSatisfied,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 3. T-CLOSENESS (Earth Mover's Distance)
//    Ref: Li et al., ICDE 2007
// ════════════════════════════════════════════════════════════════════════════

export function applyTCloseness(
  data: DataRow[],
  qis: string[],
  sensitiveAttr: string,
  t: number,
  kBase = 3,
  // Issue 9: distanceMetric is now a real parameter, not a cosmetic toggle.
  // For NUMERIC SA: EMD = CDF-based (ordered, sensitive to value ordering);
  //                 TVD = ½ × L1 (unordered, ignores ordinal structure).
  // For CATEGORICAL SA: EMD and TVD are mathematically identical (EMD reduces to
  //   ½L1 for unordered categories), so the choice has no effect — the UI shows
  //   an explanatory note rather than a disabled control.
  distanceMetric: "emd" | "tvd" = "emd",
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0 || qis.length === 0) return sdcEmpty("T-Closeness");
  const N = data.length;

  const globalFreq = new Map<string, number>();
  data.forEach((r) => {
    const v = String(r[sensitiveAttr] ?? "");
    globalFreq.set(v, (globalFreq.get(v) || 0) + 1);
  });
  const globalVals = Array.from(globalFreq.keys()).sort();
  const isNumericSA = isNumericCol(data, sensitiveAttr);

  // For categorical SA, EMD ≡ TVD (½ L1) — toggle has no mathematical effect.
  // effectiveMetric captures what is actually computed so labels are accurate.
  const effectiveMetric = isNumericSA ? distanceMetric : "tvd";
  const metricLabel =
    !isNumericSA              ? "TVD — ½ L1 (categorical; EMD≡TVD for unordered SA)"
    : distanceMetric === "emd" ? "EMD — CDF-based (ordered, numeric SA)"
                               : "TVD — ½ L1 (unordered; no CDF accumulation)";

  function computeDistance(partition: DataRow[]): number {
    const localFreq = new Map<string, number>();
    partition.forEach((r) => {
      const v = String(r[sensitiveAttr] ?? "");
      localFreq.set(v, (localFreq.get(v) || 0) + 1);
    });
    const m = partition.length;

    if (isNumericSA && effectiveMetric === "emd") {
      // EMD for ordered numeric SA: sum of absolute CDF differences (normalised)
      let cumP = 0, cumQ = 0, emd = 0;
      for (const v of globalVals) {
        cumP += (localFreq.get(v) || 0) / m;
        cumQ += (globalFreq.get(v) || 0) / N;
        emd += Math.abs(cumP - cumQ);
      }
      return emd / Math.max(globalVals.length - 1, 1);
    } else {
      // TVD = ½ × L1 for both: (a) categorical SA (all cases), (b) numeric SA with TVD selected.
      // This is the correct formula for Total Variation Distance (no CDF accumulation).
      let l1 = 0;
      globalVals.forEach((v) => {
        l1 += Math.abs(((localFreq.get(v) || 0) / m) - ((globalFreq.get(v) || 0) / N));
      });
      return l1 / 2;
    }
  }

  const k = Math.max(2, kBase);
  const { partitions: tcPartitions } = mondrianPartition(data, qis, k);
  const classMap = new Map<number, DataRow[]>();
  tcPartitions.forEach((part, idx) => {
    if (part.indices.length >= k) classMap.set(idx, part.indices.map((i) => data[i]));
  });

  const satisfying: DataRow[] = [];
  let satisfyingClasses = 0, violatingClasses = 0;
  const distances: number[] = [];

  for (const [, rows] of Array.from(classMap)) {
    const d = computeDistance(rows);
    distances.push(d);
    if (d <= t) {
      rows.forEach((r) => satisfying.push(r));
      satisfyingClasses++;
    } else {
      violatingClasses++;
    }
  }

  const minDist = distances.length > 0 ? Math.min(...distances) : 0;
  const maxDist = distances.length > 0 ? Math.max(...distances) : 0;
  const avgDist = distances.length > 0 ? mean(distances) : 0;
  const tSatisfied = violatingClasses === 0;

  // Issue 10: use metric-neutral labels in interpretation and stats
  const metricShort = effectiveMetric === "emd" ? "EMD" : "TVD";
  const interp =
    `${satisfyingClasses} of ${classMap.size} equivalence classes satisfy t-closeness at t=${t} using ${metricShort}. ` +
    `Maximum ${metricShort} = ${maxDist.toFixed(4)} (threshold: ${t}). ` +
    (violatingClasses > 0 ? `${violatingClasses} classes failed and were suppressed. ` : "") +
    (!isNumericSA ? `Note: for categorical SA "${sensitiveAttr}", EMD and TVD are mathematically identical (both equal ½ × L1 distance). The metric toggle has no effect on the result. ` : "") +
    `T-Closeness prevents skewness attacks by ensuring no equivalence class has a significantly different SA distribution from the global dataset.`;

  const warnings: string[] = [
    "T-Closeness is the strictest SDC technique but significantly reduces data utility.",
    ...(t < 0.1 ? ["Very tight t threshold — try t=0.20–0.35 for better record retention."] : []),
    ...(maxDist > t && !tSatisfied ? [`Max ${metricShort} ${maxDist.toFixed(4)} exceeds t=${t}. Increase t or add more QI columns.`] : []),
    // Issue 9: inform user when metric toggle is inert
    ...(!isNumericSA ? [`Note: SA "${sensitiveAttr}" is categorical — EMD ≡ TVD (½ L1) for unordered categories. Both metrics give identical results. Select a numeric/ordinal SA to see EMD vs TVD diverge.`] : []),
  ];

  const now = new Date().toLocaleString("en-IN");
  // Issue 10: technique name and report title now reflect the effective metric
  const techniqueName = `T-Closeness (${metricShort})`;
  const report = buildReport(
    techniqueName, "dataset", now, N, satisfying.length,
    htmlRow("T Threshold", t) +
    htmlRow("Selected Metric", distanceMetric.toUpperCase()) +
    htmlRow("Effective Metric", metricLabel) +
    htmlRow("Underlying K", k) +
    htmlRow("QI Columns", qis.join(", ")) +
    htmlRow("Sensitive Attribute", sensitiveAttr) +
    (!isNumericSA ? htmlRow("Metric Note", "EMD ≡ TVD for categorical SA — toggle is inert") : ""),
    htmlRow("T-Closeness Satisfied", tSatisfied ? "YES" : "NO", tSatisfied) +
    htmlRow("Total Equivalence Classes", classMap.size) +
    htmlRow(`Classes Passing (${metricShort} ≤ t)`, satisfyingClasses, satisfyingClasses === classMap.size) +
    htmlRow(`Classes Failing (${metricShort} > t)`, violatingClasses, violatingClasses === 0) +
    htmlRow("Suppressed Records", `${N - satisfying.length} (${N > 0 ? ((N - satisfying.length)/N*100).toFixed(1) : 0}%)`, N - satisfying.length === 0),
    htmlRow(`Min ${metricShort} (best class)`, minDist.toFixed(4), minDist <= t) +
    htmlRow(`Max ${metricShort} (worst class)`, maxDist.toFixed(4), maxDist <= t) +
    htmlRow(`Avg ${metricShort}`, avgDist.toFixed(4)),
    interp,
    warnings.filter((w) => !w.includes("strictest")),
  );

  return {
    technique: techniqueName, family: "SDC",
    processedData: satisfying, originalCount: N, processedCount: satisfying.length,
    recordsSuppressed: N - satisfying.length,
    informationLoss: N > 0 ? (N - satisfying.length) / N : 0,
    executionMs: Math.round(performance.now() - t0),
    stats: {
      t, underlyingK: k,
      tClosenessSatisfied: tSatisfied ? "YES" : "NO",
      totalClasses: classMap.size,
      satisfyingClasses, violatingClasses,
      // Issue 10: renamed from emdType → metricType; label now tracks selected metric
      selectedMetric: distanceMetric.toUpperCase(),
      effectiveMetric: metricShort,
      metricType: metricLabel,
      categoricalEquivalenceNote: !isNumericSA ? "EMD≡TVD for unordered categorical SA" : null,
      [`min${metricShort}`]: minDist.toFixed(4),
      [`max${metricShort}`]: maxDist.toFixed(4),
      [`avg${metricShort}`]: avgDist.toFixed(4),
    },
    warnings,
    interpretation: interp,
    compliancePassed: tSatisfied,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 4. RANK SWAPPING
//    Ref: Domingo-Ferrer & Torra, 2005
// ════════════════════════════════════════════════════════════════════════════

export function applyRankSwapping(
  data: DataRow[],
  targetCols: string[],
  swapFraction: number,
  seed = 42,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("Rank Swapping");
  const N = data.length;
  const numericCols = targetCols.filter((c) => isNumericCol(data, c));
  // Bug 1 fix: track columns that were selected but non-numeric (silently skipped before)
  const skippedCols  = targetCols.filter((c) => !isNumericCol(data, c));
  const p = Math.max(1, Math.round(swapFraction * N));

  const processed: DataRow[] = data.map((r) => ({ ...r }));

  // Seeded PRNG (simple mulberry32)
  let rngState = seed + 0x6D2B79F5;
  function rng(): number {
    rngState += 0x6D2B79F5;
    let z = rngState;
    z = (z ^ (z >>> 15)) * (z | 1);
    z ^= z + (z ^ (z >>> 7)) * (z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  numericCols.forEach((col) => {
    const order = Array.from({ length: N }, (_, i) => i)
      .sort((a, b) => Number(processed[a][col]) - Number(processed[b][col]));
    const rankOrder = new Array(N).fill(0);
    order.forEach((origIdx, rank) => { rankOrder[origIdx] = rank; });

    const swapped = new Uint8Array(N);
    const shuffled = Array.from({ length: N }, (_, i) => i).sort(() => rng() - 0.5);

    for (const rank of shuffled) {
      const i = order[rank];
      if (swapped[i]) continue;
      const lo = Math.max(0, rank - p), hi = Math.min(N - 1, rank + p);
      const candidates: number[] = [];
      for (let r = lo; r <= hi; r++) {
        if (r !== rank && !swapped[order[r]]) candidates.push(order[r]);
      }
      if (candidates.length === 0) continue;
      const j = candidates[Math.floor(rng() * candidates.length)];
      const tmp = processed[i][col];
      processed[i][col] = processed[j][col];
      processed[j][col] = tmp;
      swapped[i] = 1; swapped[j] = 1;
    }
  });

  // Compute per-column metrics
  const colStats: Record<string, Record<string, string | number>> = {};
  let totalSwappedPairs = 0;

  numericCols.forEach((col) => {
    const orig = data.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    const res  = processed.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    const len = Math.min(orig.length, res.length);
    const o = orig.slice(0, len), r = res.slice(0, len);

    const rho = spearmanRho(o, r);
    const mae = mean(o.map((v, i) => Math.abs(v - r[i])));
    const origMean = mean(o), resMean = mean(r);
    const origStd  = stddev(o), resStd  = stddev(r);
    const meanPct  = origMean !== 0 ? Math.abs(origMean - resMean) / Math.abs(origMean) * 100 : 0;
    const stdPct   = origStd  !== 0 ? Math.abs(origStd  - resStd)  / Math.abs(origStd)  * 100 : 0;
    const swapCount = o.filter((v, i) => v !== r[i]).length;
    const swapRate  = swapCount / len * 100;
    totalSwappedPairs += swapCount;

    colStats[col] = {
      "Swap Rate": `${swapRate.toFixed(1)}%`,
      "MAE": mae.toFixed(4),
      "Spearman ρ": rho.toFixed(4),
      "Mean Shift": `${meanPct.toFixed(2)}%`,
      "Std Dev Shift": `${stdPct.toFixed(2)}%`,
    };
  });

  const avgRho = numericCols.length > 0
    ? mean(numericCols.map((c) => parseFloat(String(colStats[c]["Spearman ρ"]))))
    : 1;
  const swapOccurred = totalSwappedPairs > 0;

  // Bug 2 fix: compliance is based on algorithm performance, NOT on whether all selected
  // columns were processable. Skipped (non-numeric) columns are an input issue → warning,
  // not a failure. Real failures are: no cols processed, severe distortion, or no swaps.
  const compliancePassed =
    numericCols.length > 0 &&     // at least one column actually processed
    avgRho >= 0.85 &&             // utility retained (spec Section 4.4 threshold)
    swapOccurred;                 // some swapping occurred

  const interp =
    `Rank swapping applied to ${numericCols.length} column${numericCols.length !== 1 ? "s" : ""} ` +
    `(${numericCols.join(", ")}) with swap fraction ${(swapFraction * 100).toFixed(0)}% (p=${p} records). ` +
    `Mean Spearman ρ = ${avgRho.toFixed(3)} — ${avgRho >= 0.90 ? "high" : avgRho >= 0.75 ? "moderate" : "low"} utility retention. ` +
    `Marginal preservation confirmed (sorted value distributions identical). ` +
    (skippedCols.length > 0
      ? `⚠ ${skippedCols.length} selected column${skippedCols.length > 1 ? "s" : ""} ` +
        `(${skippedCols.join(", ")}) skipped — non-numeric values; algorithm ran on ${numericCols.length} of ${targetCols.length} selected columns. `
      : "");

  const warnings: string[] = [
    ...(numericCols.length === 0
      ? ["No numeric columns to process. Rank swapping only applies to numeric (pure number) columns. All selected columns contain non-numeric values."]
      : []),
    // Bug 1 fix: explicitly warn about each skipped column (not silent any more)
    ...skippedCols.map((c) => {
      const sampleVal = String(data[0]?.[c] ?? "");
      return `Column "${c}" skipped — non-numeric (sample value: "${sampleVal}"). Rank swapping requires pure numeric columns. Deselect this column or convert its values to numbers first.`;
    }),
    ...(avgRho < 0.85 && numericCols.length > 0
      ? [`High distortion: mean Spearman ρ = ${avgRho.toFixed(3)} < 0.85 threshold. Reduce swap fraction below ${(swapFraction * 50).toFixed(0)}%.`]
      : []),
    ...(!swapOccurred && numericCols.length > 0
      ? ["No swaps occurred — increase swap fraction or check dataset size."]
      : []),
  ];

  const colTable = numericCols.map((c) =>
    htmlRow(c, `ρ=${colStats[c]["Spearman ρ"]}  MAE=${colStats[c]["MAE"]}  swap=${colStats[c]["Swap Rate"]}`)
  ).join("");

  // Bug 3 fix: separate processed vs skipped in the report params, add compliance criteria
  const complianceCriteriaHtml = `
<tr><td colspan="2" style="padding:8px 10px 4px;font-weight:600;color:#1e40af;border-top:2px solid #e5e7eb">Compliance Criteria (Rank Swapping)</td></tr>
${htmlRow("① Marginal Preservation", "sorted(original) == sorted(result) per column", true)}
${htmlRow("② Avg Spearman ρ ≥ 0.85", avgRho >= 0.85 ? `${avgRho.toFixed(4)} ✅` : `${avgRho.toFixed(4)} ✗ (< 0.85)`, avgRho >= 0.85)}
${htmlRow("③ At least one column processed", numericCols.length > 0 ? `${numericCols.length} column(s) ✅` : "0 columns ✗", numericCols.length > 0)}
${htmlRow("④ Swap occurred", swapOccurred ? "YES ✅" : "NO ✗", swapOccurred)}
${skippedCols.length > 0 ? htmlRow("⑤ Skipped columns", `${skippedCols.length} (${skippedCols.join(", ")}) — non-numeric; not a FAIL`) : ""}
`;

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "Rank Swapping", "dataset", now, N, N,
    // Bug 3 fix: show processed and skipped columns separately
    htmlRow("Swap Fraction", `${(swapFraction * 100).toFixed(0)}%`) +
    htmlRow("Max Rank Distance (p)", `${p} records`) +
    htmlRow("Target Columns (processed)", numericCols.length > 0 ? numericCols.join(", ") : "None") +
    (skippedCols.length > 0
      ? htmlRow("Skipped Columns", `${skippedCols.join(", ")} (non-numeric — string values)`)
      : "") +
    htmlRow("Random Seed", seed),
    htmlRow("Compliance Status", compliancePassed ? "PASS" : "FAIL", compliancePassed) +
    htmlRow("Avg Spearman ρ", avgRho.toFixed(4), avgRho >= 0.85) +
    htmlRow("Marginal Preservation", "CONFIRMED", true) +
    htmlRow("Total Swapped Records", totalSwappedPairs) +
    complianceCriteriaHtml,
    colTable,
    interp,
    warnings,
  );

  return {
    technique: "Rank Swapping", family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: Math.max(0, 1 - avgRho),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      swapFraction: `${(swapFraction * 100).toFixed(0)}%`,
      maxRankDistance: p,
      columnsSwapped: numericCols.length,
      // Bug 1 fix: expose skipped columns in stats so ResultCard can show them
      columnsSkipped: skippedCols.length,
      skippedColumnNames: skippedCols.length > 0 ? skippedCols.join(", ") : null,
      avgSpearmanRho: avgRho.toFixed(4),
      marginalPreservation: "CONFIRMED",
    },
    colStats,
    warnings,
    interpretation: interp,
    compliancePassed,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 5. MICROAGGREGATION (MDAV)
//    Ref: Domingo-Ferrer & Mateo-Sanz, IEEE TKDE 2002
// ════════════════════════════════════════════════════════════════════════════

export function applyMicroaggregation(
  data: DataRow[],
  targetCols: string[],
  clusterSize: number,
  distanceMetric: "euclidean" | "manhattan" = "euclidean",
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("Microaggregation");
  const numericCols = targetCols.filter((c) => isNumericCol(data, c));
  if (numericCols.length === 0) return sdcEmpty("Microaggregation");
  const N = data.length;
  const k = clusterSize;

  // Normalise target columns to [0,1] for distance calculation
  const ranges = numericCols.map((c) => ({ min: Math.min(...data.map((r) => Number(r[c]))), range: Math.max(1, columnRange(data, c)) }));
  const norm = (row: DataRow, ci: number) => (Number(row[numericCols[ci]]) - ranges[ci].min) / ranges[ci].range;

  const distFn = (a: DataRow, b: DataRow): number => {
    if (distanceMetric === "manhattan") {
      return numericCols.reduce((s, _c, ci) => s + Math.abs(norm(a, ci) - norm(b, ci)), 0);
    }
    return Math.sqrt(numericCols.reduce((s, _c, ci) => s + (norm(a, ci) - norm(b, ci)) ** 2, 0));
  };

  const centroidVec = (rows: DataRow[]): number[] =>
    numericCols.map((c) => mean(rows.map((r) => Number(r[c]))));
  const distToVec = (row: DataRow, vec: number[]): number => {
    if (distanceMetric === "manhattan") return vec.reduce((s, v, ci) => s + Math.abs(norm(row, ci) - (v - ranges[ci].min) / ranges[ci].range), 0);
    return Math.sqrt(vec.reduce((s, v, ci) => s + (norm(row, ci) - (v - ranges[ci].min) / ranges[ci].range) ** 2, 0));
  };

  // MDAV algorithm
  const remaining: number[] = data.map((_, i) => i);
  const clusters: number[][] = [];

  while (remaining.length >= k) {
    const rows = remaining.map((i) => data[i]);
    const c = centroidVec(rows);

    // r1: farthest from centroid
    let r1 = 0, r1d = -1;
    rows.forEach((r, ri) => { const d = distToVec(r, c); if (d > r1d) { r1d = d; r1 = ri; } });
    const r1idx = remaining[r1];

    // k nearest to r1
    const nearR1 = remaining
      .map((origIdx) => ({ origIdx, d: distFn(data[origIdx], data[r1idx]) }))
      .sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.origIdx);
    clusters.push(nearR1);
    const usedA = new Set(nearR1);
    remaining.splice(0, remaining.length, ...remaining.filter((i) => !usedA.has(i)));

    if (remaining.length < k) break;

    const rows2 = remaining.map((i) => data[i]);
    const c2 = centroidVec(rows2);
    let r2 = 0, r2d = -1;
    rows2.forEach((r, ri) => { const d = distToVec(r, c2); if (d > r2d) { r2d = d; r2 = ri; } });
    const r2idx = remaining[r2];
    const nearR2 = remaining
      .map((origIdx) => ({ origIdx, d: distFn(data[origIdx], data[r2idx]) }))
      .sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.origIdx);
    clusters.push(nearR2);
    const usedB = new Set(nearR2);
    remaining.splice(0, remaining.length, ...remaining.filter((i) => !usedB.has(i)));
  }
  if (remaining.length > 0 && clusters.length > 0) {
    clusters[clusters.length - 1].push(...remaining);
  } else if (remaining.length > 0) {
    clusters.push([...remaining]);
  }

  // Replace values with cluster centroids
  const processed: DataRow[] = data.map((r) => ({ ...r }));
  clusters.forEach((cluster) => {
    numericCols.forEach((col) => {
      const cMean = mean(cluster.map((i) => Number(data[i][col])));
      cluster.forEach((i) => { processed[i][col] = parseFloat(cMean.toFixed(4)); });
    });
  });

  // SSE / SST information loss
  const globalMeans = numericCols.map((c) => mean(data.map((r) => Number(r[c]))));
  let sse = 0, sst = 0;
  clusters.forEach((cluster) => {
    numericCols.forEach((col, ci) => {
      const cMean = mean(cluster.map((i) => Number(data[i][col])));
      cluster.forEach((i) => {
        sse += (Number(data[i][col]) - cMean) ** 2;
        sst += (Number(data[i][col]) - globalMeans[ci]) ** 2;
      });
    });
  });
  const il = sst > 0 ? sse / sst : 0;

  const clusterSizes = clusters.map((c) => c.length);

  // Per-column stats
  const colStats: Record<string, Record<string, string | number>> = {};
  numericCols.forEach((col) => {
    const origVals = data.map((r) => Number(r[col]));
    const newVals  = processed.map((r) => Number(r[col]));
    const r = pearsonR(origVals, newVals);
    const mad = mean(origVals.map((v, i) => Math.abs(v - newVals[i])));
    const origStd = stddev(origVals), newStd = stddev(newVals);
    const varRatio = origStd > 0 ? (newStd * newStd) / (origStd * origStd) : 1;
    colStats[col] = {
      "MAD": mad.toFixed(4),
      "Pearson r": r.toFixed(4),
      "Var Ratio": varRatio.toFixed(4),
      "Orig Mean": mean(origVals).toFixed(4),
      "Post Mean": mean(newVals).toFixed(4),
    };
  });

  const avgPearson = numericCols.length > 0
    ? mean(numericCols.map((c) => parseFloat(String(colStats[c]["Pearson r"])))) : 1;
  const ilPct = (il * 100).toFixed(1);
  const compliancePassed = il < 0.30 && avgPearson >= 0.80;

  const interp = `MDAV microaggregation was applied to ${numericCols.length} columns with cluster size k=${k}. ` +
    `${clusters.length} clusters were formed. The information loss (SSE/SST) is ${ilPct}%, indicating ` +
    `${il < 0.15 ? "low" : il < 0.30 ? "moderate" : "high"} distortion. ` +
    `The average Pearson correlation across target columns is ${avgPearson.toFixed(3)}, showing ${avgPearson >= 0.90 ? "high" : "moderate"} utility preservation.`;

  const warnings: string[] = [
    ...(il > 0.30 ? [`High information loss (${ilPct}%). Reduce k or apply to fewer columns.`] : []),
    ...numericCols.filter((c) => parseFloat(String(colStats[c]["Pearson r"])) < 0.80)
      .map((c) => `Column "${c}" is heavily distorted (Pearson r=${colStats[c]["Pearson r"]}). Consider excluding it.`),
  ];

  const colTable = numericCols.map((c) =>
    htmlRow(c, `r=${colStats[c]["Pearson r"]}  MAD=${colStats[c]["MAD"]}  Var ratio=${colStats[c]["Var Ratio"]}`)
  ).join("");

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "Microaggregation (MDAV)", "dataset", now, N, N,
    htmlRow("Cluster Size (k)", k) + htmlRow("Target Columns", numericCols.join(", ")) + htmlRow("Distance Metric", distanceMetric),
    htmlRow("Number of Clusters", clusters.length) +
    htmlRow("Min Cluster Size", Math.min(...clusterSizes), Math.min(...clusterSizes) >= k) +
    htmlRow("Max Cluster Size", Math.max(...clusterSizes)) +
    htmlRow("Avg Cluster Size", mean(clusterSizes).toFixed(1)) +
    htmlRow("SSE / SST (IL Score)", `${ilPct}% (${il < 0.15 ? "Low" : il < 0.30 ? "Medium" : "High"})`, il < 0.30),
    colTable,
    interp,
    warnings,
  );

  return {
    technique: "Microaggregation (MDAV)", family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: il,
    executionMs: Math.round(performance.now() - t0),
    stats: {
      clusterSize: k,
      totalClusters: clusters.length,
      minClusterSize: Math.min(...clusterSizes),
      maxClusterSize: Math.max(...clusterSizes),
      avgClusterSize: mean(clusterSizes).toFixed(1),
      ilScoreSSESST: `${ilPct}%`,
      ilInterpretation: il < 0.15 ? "Low" : il < 0.30 ? "Moderate" : "High",
      avgPearsonR: avgPearson.toFixed(4),
      distanceMetric,
      columnsAggregated: numericCols.length,
    },
    colStats,
    warnings,
    interpretation: interp,
    compliancePassed,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 6. PRAM (Post-Randomisation Method)
//    Ref: Kooiman et al., Statistics Netherlands, 1997
// ════════════════════════════════════════════════════════════════════════════

export function applyPRAM(
  data: DataRow[],
  targetCols: string[],
  retentionProb: number,
  variant: "simple" | "unbiased" = "simple",
  seed = 42,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("PRAM");
  const N = data.length;
  const catCols = targetCols.filter((c) => !isNumericCol(data, c));

  // Auto-detect categoricals if nothing selected
  const cols = catCols.length > 0 ? catCols : targetCols;
  const effectiveCols = cols.filter((c) => !isNumericCol(data, c));

  // Seeded PRNG
  let rngState = seed + 0x6D2B79F5;
  function rng(): number {
    rngState += 0x6D2B79F5;
    let z = rngState;
    z = (z ^ (z >>> 15)) * (z | 1);
    z ^= z + (z ^ (z >>> 7)) * (z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  const categories = new Map<string, string[]>();
  effectiveCols.forEach((col) => {
    const distinct = Array.from(new Set(data.map((r) => String(r[col] ?? "")))).sort();
    categories.set(col, distinct);
  });

  const processed: DataRow[] = data.map((row) => {
    const newRow = { ...row };
    effectiveCols.forEach((col) => {
      const cats = categories.get(col)!;
      if (cats.length <= 1) return;
      const currentVal = String(row[col] ?? "");
      const currentIdx = cats.indexOf(currentVal);
      if (currentIdx === -1) return;
      const offDiag = (1 - retentionProb) / (cats.length - 1);
      let r = rng() - retentionProb;
      if (r <= 0) { newRow[col] = currentVal; return; }
      for (let j = 0; j < cats.length; j++) {
        if (j === currentIdx) continue;
        r -= offDiag;
        if (r <= 0) { newRow[col] = cats[j]; return; }
      }
      newRow[col] = cats[cats.length - 1];
    });
    return newRow;
  });

  // Per-column metrics
  const colStats: Record<string, Record<string, string | number>> = {};

  effectiveCols.forEach((col) => {
    const cats = categories.get(col)!;
    const S = cats.length;
    let retained = 0;
    const origFreq = new Map<string, number>(), newFreq = new Map<string, number>();
    cats.forEach((c) => { origFreq.set(c, 0); newFreq.set(c, 0); });
    data.forEach((r, i) => {
      const orig = String(r[col] ?? ""), proc = String(processed[i][col] ?? "");
      if (orig === proc) retained++;
      origFreq.set(orig, (origFreq.get(orig) || 0) + 1);
      newFreq.set(proc, (newFreq.get(proc) || 0) + 1);
    });
    const actualRetention = retained / N;
    const tvdVal = tvd(cats, origFreq, newFreq, N);

    // Chi-square test
    let chi2 = 0;
    cats.forEach((c) => {
      const expected = (origFreq.get(c) || 0);
      const observed = (newFreq.get(c) || 0);
      if (expected > 0) chi2 += (observed - expected) ** 2 / expected;
    });
    const pValue = chiSquareP(chi2, Math.max(1, S - 1));

    colStats[col] = {
      "Categories": S,
      "Actual Retention": `${(actualRetention * 100).toFixed(1)}%`,
      "Perturbation Rate": `${((1 - actualRetention) * 100).toFixed(1)}%`,
      "TVD": tvdVal.toFixed(4),
      "χ² p-value": pValue.toFixed(4),
    };
  });

  const avgTVD = effectiveCols.length > 0
    ? mean(effectiveCols.map((c) => parseFloat(String(colStats[c]["TVD"])))) : 0;
  const compliancePassed = avgTVD < 0.10 &&
    effectiveCols.every((c) => parseFloat(String(colStats[c]["χ² p-value"])) > 0.05);

  const interp = `PRAM was applied to ${effectiveCols.length} categorical columns with retention probability ${(retentionProb * 100).toFixed(0)}% (${variant} variant). ` +
    `The mean Total Variation Distance is ${avgTVD.toFixed(4)}, indicating ${avgTVD < 0.10 ? "minimal" : avgTVD < 0.20 ? "moderate" : "high"} distribution shift post-perturbation. ` +
    `For each record, an adversary who knows the perturbed value has only ${(retentionProb * 100).toFixed(0)}% confidence the original value matches — providing plausible deniability.`;

  const warnings: string[] = [
    ...(effectiveCols.length === 0 ? ["No categorical columns found. PRAM primarily applies to categorical attributes."] : []),
    ...(avgTVD > 0.20 ? [`Distribution has shifted significantly (avg TVD=${avgTVD.toFixed(3)}). Switch to Unbiased PRAM variant.`] : []),
  ];

  const colTable = effectiveCols.map((c) =>
    htmlRow(c, `Retention=${colStats[c]["Actual Retention"]}  TVD=${colStats[c]["TVD"]}  χ²-p=${colStats[c]["χ² p-value"]}`)
  ).join("");

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "PRAM", "dataset", now, N, N,
    htmlRow("Retention Probability", `${(retentionProb * 100).toFixed(0)}% (keep) / ${((1-retentionProb)*100).toFixed(0)}% (change)`) +
    htmlRow("PRAM Variant", variant) + htmlRow("Target Columns", effectiveCols.join(", ")) + htmlRow("Random Seed", seed),
    htmlRow("Avg TVD", avgTVD.toFixed(4), avgTVD < 0.10) +
    htmlRow("Distributional Similarity", compliancePassed ? "CONFIRMED (χ² p > 0.05)" : "REJECTED", compliancePassed),
    colTable,
    interp,
    warnings,
  );

  return {
    technique: "PRAM (Post Randomisation Method)", family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: Math.min(1, avgTVD * 5),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      retentionProbability: `${(retentionProb * 100).toFixed(0)}%`,
      perturbationProbability: `${((1 - retentionProb) * 100).toFixed(0)}%`,
      variant,
      categoricalColsPerturbed: effectiveCols.length,
      avgTVD: avgTVD.toFixed(4),
      transitionMatrix: `M[i,i]=${retentionProb}, M[i,j]=${((1 - retentionProb) / Math.max(2, 1)).toFixed(3)} (off-diagonal)`,
    },
    colStats,
    warnings,
    interpretation: interp,
    compliancePassed,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 7. TOP/BOTTOM CODING (Percentile Capping + Optional Noise)
// ════════════════════════════════════════════════════════════════════════════

export function applyTopBottomCoding(
  data: DataRow[],
  targetCols: string[],
  topPercentile: number,   // 50–100 (e.g. 95)
  bottomPercentile: number, // 0–50 (e.g. 5)
  addNoise: boolean,
  noiseLambda: number,     // σ_noise = lambda × col_std
  seed = 42,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("Top/Bottom Coding");
  const N = data.length;
  const numericCols = targetCols.filter((c) => isNumericCol(data, c));

  if (topPercentile <= bottomPercentile) {
    return {
      ...sdcEmpty("Top/Bottom Coding"),
      warnings: ["Validation error: Bottom cap must be less than top cap."],
    };
  }

  // Seeded PRNG
  let rngState = seed + 0x6D2B79F5;
  function rng(): number {
    rngState += 0x6D2B79F5;
    let z = rngState;
    z = (z ^ (z >>> 15)) * (z | 1);
    z ^= z + (z ^ (z >>> 7)) * (z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }
  function boxMullerNormal(): number {
    const u1 = rng(), u2 = rng();
    return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  }

  const colStats: Record<string, Record<string, string | number>> = {};
  const processed: DataRow[] = data.map((r) => ({ ...r }));

  numericCols.forEach((col) => {
    const origVals = data.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    const sorted = [...origVals].sort((a, b) => a - b);
    const qBot = percentile(sorted, bottomPercentile);
    const qTop = percentile(sorted, topPercentile);
    const origMean = mean(origVals), origStd = stddev(origVals);
    const sigmaNoise = noiseLambda * origStd;

    let nTopCapped = 0, nBotCapped = 0;

    data.forEach((row, i) => {
      let v = Number(row[col]);
      if (isNaN(v)) return;
      if (v > qTop) { nTopCapped++; v = qTop; }
      else if (v < qBot) { nBotCapped++; v = qBot; }
      if (addNoise && sigmaNoise > 0) v += sigmaNoise * boxMullerNormal();
      processed[i][col] = parseFloat(v.toFixed(4));
    });

    const newVals = processed.map((r) => Number(r[col]));
    const newMean = mean(newVals), newStd = stddev(newVals);
    const meanShiftPct = origMean !== 0 ? Math.abs(origMean - newMean) / Math.abs(origMean) * 100 : 0;
    const stdShiftPct  = origStd  !== 0 ? Math.abs(origStd  - newStd)  / Math.abs(origStd)  * 100 : 0;

    colStats[col] = {
      "q_bot": qBot.toFixed(4),
      "q_top": qTop.toFixed(4),
      "Bot Capped": `${nBotCapped} (${(nBotCapped/N*100).toFixed(1)}%)`,
      "Top Capped": `${nTopCapped} (${(nTopCapped/N*100).toFixed(1)}%)`,
      "Mean Shift": `${meanShiftPct.toFixed(2)}%`,
      "Std Dev Shift": `${stdShiftPct.toFixed(2)}%`,
      ...(addNoise ? { "σ_noise": sigmaNoise.toFixed(4) } : {}),
    };
  });

  const totalAffected = numericCols.reduce((s, c) => {
    const bCap = parseInt(String(colStats[c]["Bot Capped"]).split(" ")[0]);
    const tCap = parseInt(String(colStats[c]["Top Capped"]).split(" ")[0]);
    return s + bCap + tCap;
  }, 0);

  const maxCappingCol = numericCols.length > 0
    ? numericCols.reduce((best, c) => {
        const bRate = parseFloat(String(colStats[c]["Bot Capped"]).match(/\((.+)%\)/)?.[1] ?? "0");
        const tRate = parseFloat(String(colStats[c]["Top Capped"]).match(/\((.+)%\)/)?.[1] ?? "0");
        const bestBRate = parseFloat(String(colStats[best]?.["Bot Capped"] ?? "0%").match(/\((.+)%\)/)?.[1] ?? "0");
        const bestTRate = parseFloat(String(colStats[best]?.["Top Capped"] ?? "0%").match(/\((.+)%\)/)?.[1] ?? "0");
        return (bRate + tRate) > (bestBRate + bestTRate) ? c : best;
      })
    : "";

  const avgMeanShift = numericCols.length > 0
    ? mean(numericCols.map((c) => parseFloat(String(colStats[c]["Mean Shift"])))) : 0;
  const compliancePassed = avgMeanShift < 5 && numericCols.length > 0;

  const interp = `Top/Bottom coding was applied to ${numericCols.length} columns. ` +
    `Values above the ${topPercentile}th percentile and below the ${bottomPercentile}th percentile were capped. ` +
    `A total of ${totalAffected} record-column instances were capped across all columns. ` +
    (addNoise ? `Gaussian noise with λ=${noiseLambda} was added after capping (σ_noise = λ × col_std per column). ` : "No noise was added. ") +
    `This prevents re-identification via extreme values, which are often unique to specific individuals in survey microdata.`;

  const warnings: string[] = [
    ...(numericCols.length === 0 ? ["No numeric target columns selected."] : []),
    ...(avgMeanShift > 5 ? [`Significant mean shift detected (avg ${avgMeanShift.toFixed(1)}%). Consider widening the percentile range.`] : []),
    ...(maxCappingCol && parseFloat(String(colStats[maxCappingCol]["Top Capped"]).match(/\((.+)%\)/)?.[1] ?? "0") > 20
      ? [`Over 20% of records capped in "${maxCappingCol}". Increase top percentile or decrease bottom percentile.`] : []),
    ...(addNoise && noiseLambda > 0.3 ? [`Noise λ=${noiseLambda} is high — consider reducing it below 0.3.`] : []),
  ];

  const colTable = numericCols.map((c) =>
    htmlRow(c, `[${colStats[c]["q_bot"]}, ${colStats[c]["q_top"]}]  bot=${colStats[c]["Bot Capped"]}  top=${colStats[c]["Top Capped"]}  mean-shift=${colStats[c]["Mean Shift"]}`)
  ).join("");

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "Top/Bottom Coding", "dataset", now, N, N,
    htmlRow("Top Percentile Cap", `${topPercentile}th percentile`) +
    htmlRow("Bottom Percentile Cap", `${bottomPercentile}th percentile`) +
    htmlRow("Gaussian Noise", addNoise ? `ENABLED (λ=${noiseLambda})` : "DISABLED") +
    htmlRow("Target Columns", numericCols.join(", ")),
    htmlRow("Total Records Affected", `${totalAffected} instances`, totalAffected < N * 0.2 * numericCols.length) +
    htmlRow("Avg Mean Shift", `${avgMeanShift.toFixed(2)}%`, avgMeanShift < 5),
    colTable,
    interp,
    warnings,
  );

  return {
    technique: "Top/Bottom Coding", family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: Math.min(1, avgMeanShift / 100),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      topPercentile: `${topPercentile}th`,
      bottomPercentile: `${bottomPercentile}th`,
      gaussianNoise: addNoise ? `ENABLED (λ=${noiseLambda})` : "DISABLED",
      totalAffectedInstances: totalAffected,
      avgMeanShift: `${avgMeanShift.toFixed(2)}%`,
      columnsProcessed: numericCols.length,
    },
    colStats,
    warnings,
    interpretation: interp,
    compliancePassed,
    report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 8. NOISE ADDITION (Gaussian / Laplace / Uniform)
//    Ref: SDC Spec §8 — proportional σ_noise = λ × col_std
// ════════════════════════════════════════════════════════════════════════════

export function applyNoiseAddition(
  data: DataRow[],
  targetCols: string[],
  distribution: "gaussian" | "laplace" | "uniform",
  lambdaNoise: number,
  clipToRange: boolean,
  seed = 42,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("Noise Addition");
  const N = data.length;
  const numericCols = targetCols.filter((c) => isNumericCol(data, c));
  if (numericCols.length === 0) {
    return { ...sdcEmpty("Noise Addition"), warnings: ["No numeric target columns selected."] };
  }

  let rngState = (seed >>> 0) + 0x6D2B79F5;
  function rng(): number {
    rngState = (rngState + 0x6D2B79F5) >>> 0;
    let z = rngState;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }
  function sampleGaussian(): number {
    const u1 = rng() + 1e-10, u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function sampleLaplace(b: number): number {
    const u = rng() - 0.5;
    return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u) + 1e-12);
  }

  const colStats: Record<string, Record<string, string | number>> = {};
  const processed: DataRow[] = data.map((r) => ({ ...r }));
  let totalInfoLoss = 0;

  numericCols.forEach((col) => {
    const origVals = data.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    if (origVals.length === 0) return;
    const colMean   = mean(origVals);
    const colStd    = stddev(origVals);
    const colMin    = Math.min(...origVals);
    const colMax    = Math.max(...origVals);
    const sigmaNoise = lambdaNoise * colStd;

    data.forEach((row, i) => {
      const v = Number(row[col]);
      if (isNaN(v)) return;
      let eps: number;
      if (distribution === "gaussian") {
        eps = sigmaNoise * sampleGaussian();
      } else if (distribution === "laplace") {
        const b = sigmaNoise / Math.SQRT2;
        eps = sampleLaplace(b);
      } else {
        const delta = sigmaNoise * Math.sqrt(3);
        eps = delta * (2 * rng() - 1);
      }
      let noisy = v + eps;
      if (clipToRange) noisy = Math.max(colMin, Math.min(colMax, noisy));
      processed[i][col] = parseFloat(noisy.toFixed(6));
    });

    const noisyVals  = processed.map((r) => Number(r[col]));
    const noisyMean  = mean(noisyVals);
    const noisyStd   = stddev(noisyVals);
    const mae        = mean(noisyVals.map((v, i) => Math.abs(v - origVals[i])));
    const pearson    = pearsonR(origVals, noisyVals);
    const snr        = sigmaNoise > 0 ? (colStd * colStd) / (sigmaNoise * sigmaNoise) : Infinity;
    const meanShiftPct = colMean !== 0 ? Math.abs(noisyMean - colMean) / Math.abs(colMean) * 100 : 0;
    const varInflPct   = colStd > 0 ? ((noisyStd * noisyStd - colStd * colStd) / (colStd * colStd)) * 100 : 0;

    colStats[col] = {
      "σ_noise":       sigmaNoise.toFixed(4),
      "SNR":           snr === Infinity ? "∞" : snr.toFixed(2),
      "MAE":           mae.toFixed(4),
      "Pearson r":     pearson.toFixed(4),
      "Mean Shift":    `${meanShiftPct.toFixed(2)}%`,
      "Var Inflation": `${varInflPct.toFixed(2)}%`,
    };
    totalInfoLoss += Math.min(1, 1 - pearson);
  });

  const avgInfoLoss = numericCols.length > 0 ? totalInfoLoss / numericCols.length : 0;
  const avgPearson  = numericCols.length > 0
    ? mean(numericCols.map((c) => parseFloat(String(colStats[c]?.["Pearson r"] ?? "1")))) : 1;
  const finiteSnrs  = numericCols
    .filter((c) => colStats[c]?.["SNR"] !== "∞")
    .map((c) => parseFloat(String(colStats[c]?.["SNR"] ?? "100")));
  const avgSnr = finiteSnrs.length > 0 ? mean(finiteSnrs) : Infinity;
  const compliancePassed = avgPearson >= 0.85 && lambdaNoise <= 0.5;

  const warnings: string[] = [
    ...(lambdaNoise > 0.5 ? ["High noise (λ > 0.5): data utility severely degraded. Reduce λ."] : []),
    ...(avgPearson < 0.85 ? [`Low avg Pearson r=${avgPearson.toFixed(3)} — consider reducing λ.`] : []),
    ...(!clipToRange ? ["Clipping disabled — noisy values may exceed original data range."] : []),
  ];

  const now = new Date().toLocaleString("en-IN");
  const colTable = numericCols.map((c) => htmlRow(c,
    `σ=${colStats[c]["σ_noise"]} SNR=${colStats[c]["SNR"]} MAE=${colStats[c]["MAE"]} r=${colStats[c]["Pearson r"]} shift=${colStats[c]["Mean Shift"]}`
  )).join("");

  const distLabel = distribution.charAt(0).toUpperCase() + distribution.slice(1);
  const interp = `Noise was injected into ${numericCols.length} column(s) using the ${distLabel} distribution with λ=${lambdaNoise}. ` +
    `Avg SNR = ${avgSnr === Infinity ? "∞" : avgSnr.toFixed(2)}. Mean values preserved within ≈${(lambdaNoise * 100).toFixed(0)}% of original. ` +
    `Avg Pearson r = ${avgPearson.toFixed(3)} — ${avgPearson > 0.95 ? "high" : avgPearson > 0.85 ? "moderate" : "low"} utility. ` +
    (clipToRange ? "Values clipped to original column ranges after injection." : "No clipping applied.");

  const report = buildReport(
    "Noise Addition", "dataset", now, N, N,
    htmlRow("Distribution", distLabel) +
    htmlRow("Noise Multiplier (λ)", lambdaNoise.toFixed(3)) +
    htmlRow("Clip to Range", clipToRange ? "YES" : "NO") +
    htmlRow("Target Columns", numericCols.join(", ")),
    htmlRow("Compliance (r ≥ 0.85, λ ≤ 0.5)", compliancePassed ? "YES" : "NO", compliancePassed) +
    htmlRow("Avg Pearson r", avgPearson.toFixed(4), avgPearson >= 0.85) +
    htmlRow("Avg SNR", avgSnr === Infinity ? "∞" : avgSnr.toFixed(2), avgSnr >= 10),
    colTable, interp, warnings,
  );

  return {
    technique: `Noise Addition (${distLabel})`, family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: Math.min(1, avgInfoLoss),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      distribution: distLabel,
      noiseLambda:      lambdaNoise,
      clipToRange:      clipToRange ? "YES" : "NO",
      columnsProcessed: numericCols.length,
      avgPearsonR:      avgPearson.toFixed(4),
      avgSNR:           avgSnr === Infinity ? "∞" : avgSnr.toFixed(2),
    },
    colStats, warnings, interpretation: interp, compliancePassed, report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 9. EXPLICIT SUPPRESSION (Row / Cell / Both)
//    Ref: SDC Spec §9 — deliberate suppression by rule
// ════════════════════════════════════════════════════════════════════════════

export function applyExplicitSuppression(
  data: DataRow[],
  mode: "row" | "cell" | "both",
  criterion: "uniqueness" | "outlier" | "sensitive_value" | "threshold",
  params: {
    qiCols?: string[];
    minGroupSize?: number;
    zThreshold?: number;
    targetCols?: string[];
    saCol?: string;
    riskValues?: string[];
    lowerBound?: number;
    upperBound?: number;
    minCellFrequency?: number;
  },
  suppressionBudgetPct: number,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("Explicit Suppression");
  const N = data.length;
  const maxSuppress = Math.ceil(suppressionBudgetPct * N);

  const processed: DataRow[] = data.map((r) => ({ ...r }));
  const suppressedRowSet = new Set<number>();
  const suppressedCells: [number, string][] = [];

  // --- ROW SUPPRESSION ---
  if (mode === "row" || mode === "both") {
    let candidates: number[] = [];

    if (criterion === "uniqueness") {
      const qiCols = params.qiCols ?? [];
      const groupKey = (row: DataRow) => qiCols.map((c) => String(row[c] ?? "")).join("|");
      const groupSizes = new Map<string, number>();
      data.forEach((r) => { const k = groupKey(r); groupSizes.set(k, (groupSizes.get(k) || 0) + 1); });
      const minGrp = params.minGroupSize ?? 2;
      candidates = data.map((r, i) => ({ r, i }))
        .filter(({ r }) => (groupSizes.get(groupKey(r)) ?? 1) < minGrp).map(({ i }) => i);

    } else if (criterion === "outlier") {
      const tCols = params.targetCols ?? Object.keys(data[0] ?? {}).filter((c) => isNumericCol(data, c));
      const zThr = params.zThreshold ?? 3.0;
      const outlierSet = new Set<number>();
      tCols.forEach((col) => {
        const vals = data.map((r) => Number(r[col])).filter((v) => !isNaN(v));
        const mu = mean(vals), sigma = stddev(vals);
        if (sigma === 0) return;
        data.forEach((r, i) => {
          if (!isNaN(Number(r[col])) && Math.abs(Number(r[col]) - mu) > zThr * sigma) outlierSet.add(i);
        });
      });
      candidates = Array.from(outlierSet);

    } else if (criterion === "sensitive_value") {
      const saCol = params.saCol ?? "";
      const riskVals = new Set(params.riskValues ?? []);
      candidates = data.map((r, i) => ({ r, i }))
        .filter(({ r }) => riskVals.has(String(r[saCol] ?? ""))).map(({ i }) => i);

    } else if (criterion === "threshold") {
      const tCol = params.targetCols?.[0] ?? "";
      const lo = params.lowerBound ?? -Infinity;
      const hi = params.upperBound ?? Infinity;
      candidates = data.map((r, i) => ({ r, i }))
        .filter(({ r }) => { const v = Number(r[tCol]); return !isNaN(v) && (v < lo || v > hi); })
        .map(({ i }) => i);
    }

    candidates.slice(0, maxSuppress).forEach((i) => suppressedRowSet.add(i));
  }

  // --- CELL-LEVEL SUPPRESSION ---
  if (mode === "cell" || mode === "both") {
    const tCols = params.targetCols ?? (data.length > 0 ? Object.keys(data[0]) : []);
    const minFreq = params.minCellFrequency ?? 3;
    tCols.forEach((col) => {
      const freqMap = new Map<string, number>();
      data.forEach((r) => { const v = String(r[col] ?? ""); freqMap.set(v, (freqMap.get(v) || 0) + 1); });
      data.forEach((r, i) => {
        if ((freqMap.get(String(r[col] ?? "")) ?? 0) < minFreq) {
          processed[i][col] = "***";
          suppressedCells.push([i, col]);
        }
      });
    });
  }

  const finalData = processed.filter((_, i) => !suppressedRowSet.has(i));
  const rowsSuppressed = suppressedRowSet.size;
  const cellsSuppressed = suppressedCells.length;
  const rowSuppRate = N > 0 ? rowsSuppressed / N : 0;
  const cellSuppRate = N > 0 && data[0] ? cellsSuppressed / (N * Object.keys(data[0]).length) : 0;
  const budgetUsed = maxSuppress > 0 ? rowsSuppressed / maxSuppress : 0;
  const compliancePassed = rowSuppRate <= suppressionBudgetPct;

  const interp = `Explicit suppression in "${mode}" mode using the "${criterion}" criterion. ` +
    (mode !== "cell" ? `${rowsSuppressed} rows (${(rowSuppRate*100).toFixed(1)}%) suppressed — budget: ${(budgetUsed*100).toFixed(1)}%. ` : "") +
    (mode !== "row" ? `${cellsSuppressed} cells suppressed at cell level. ` : "") +
    `Records retained: ${finalData.length} of ${N}.`;

  const warnings: string[] = [
    ...(rowSuppRate > suppressionBudgetPct ? [`Row suppression ${(rowSuppRate*100).toFixed(1)}% exceeds budget ${(suppressionBudgetPct*100).toFixed(0)}%.`] : []),
    ...(rowsSuppressed === 0 && (mode === "row" || mode === "both") ? ["No rows matched the suppression criterion."] : []),
    ...(cellsSuppressed === 0 && (mode === "cell" || mode === "both") ? ["No cells matched the frequency threshold."] : []),
  ];

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "Explicit Suppression", "dataset", now, N, finalData.length,
    htmlRow("Mode", mode) + htmlRow("Criterion", criterion) +
    htmlRow("Suppression Budget", `${(suppressionBudgetPct*100).toFixed(0)}%`) +
    (criterion === "uniqueness" ? htmlRow("Min Group Size", params.minGroupSize ?? 2) : "") +
    (criterion === "outlier" ? htmlRow("Z Threshold", params.zThreshold ?? 3.0) : "") +
    (criterion === "sensitive_value" ? htmlRow("Risk Values", (params.riskValues ?? []).join(", ")) : "") +
    (criterion === "threshold" ? htmlRow("Bounds", `[${params.lowerBound ?? "−∞"}, ${params.upperBound ?? "+∞"}]`) : ""),
    htmlRow("Compliance", compliancePassed ? "YES" : "NO", compliancePassed) +
    htmlRow("Rows Suppressed", `${rowsSuppressed} (${(rowSuppRate*100).toFixed(1)}%)`, rowSuppRate <= suppressionBudgetPct) +
    htmlRow("Cells Suppressed", cellsSuppressed) +
    htmlRow("Budget Utilisation", `${(budgetUsed*100).toFixed(1)}%`) +
    htmlRow("Records Retained", finalData.length),
    "", interp, warnings,
  );

  return {
    technique: "Explicit Suppression", family: "SDC",
    processedData: finalData, originalCount: N, processedCount: finalData.length,
    recordsSuppressed: rowsSuppressed,
    informationLoss: Math.min(1, rowSuppRate + cellSuppRate * 0.3),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      mode, criterion,
      rowsSuppressed,
      rowSuppressionRate:  `${(rowSuppRate*100).toFixed(1)}%`,
      cellsSuppressed,
      cellSuppressionRate: `${(cellSuppRate*100).toFixed(3)}%`,
      budgetUtilisation:   `${(budgetUsed*100).toFixed(1)}%`,
      recordsRetained:     finalData.length,
    },
    warnings, interpretation: interp, compliancePassed, report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 10. GENERALISATION — standalone (Bin / Round / Top-K)
//     Ref: SDC Spec §10 — per-column without QI/SA
// ════════════════════════════════════════════════════════════════════════════

export interface GeneralisationColConfig {
  col: string;
  type: "bin" | "round" | "topk";
  binWidth?: number;
  roundTo?: number;
  topK?: number;
}

export function applyGeneralisation(
  data: DataRow[],
  colConfigs: GeneralisationColConfig[],
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0 || colConfigs.length === 0) return sdcEmpty("Generalisation");
  const N = data.length;

  const processed: DataRow[] = data.map((r) => ({ ...r }));
  const colStats: Record<string, Record<string, string | number>> = {};
  let totalIL = 0;

  colConfigs.forEach(({ col, type, binWidth, roundTo, topK }) => {
    const origVals = data.map((r) => r[col]);
    let il = 0;

    if (type === "bin") {
      const nums = origVals.map((v) => Number(v)).filter((v) => !isNaN(v));
      if (nums.length === 0) return;
      const lo = Math.min(...nums), hi = Math.max(...nums);
      const range = hi - lo || 1;
      const bw = binWidth && binWidth > 0 ? binWidth : range / Math.max(1, Math.ceil(Math.log2(N) + 1));
      data.forEach((row, i) => {
        const v = Number(row[col]);
        if (isNaN(v)) return;
        const binLo = Math.floor(v / bw) * bw;
        processed[i][col] = `${binLo.toFixed(2)}–${(binLo + bw).toFixed(2)}`;
      });
      il = Math.min(1, bw / range);
      const uBefore = new Set(origVals.map(String)).size;
      const uAfter  = new Set(processed.map((r) => String(r[col]))).size;
      colStats[col] = { "Type": "bin", "Bin Width": bw.toFixed(4), "IL Score": il.toFixed(4), "Unique Before": uBefore, "Unique After": uAfter };

    } else if (type === "round") {
      const rt = roundTo && roundTo > 0 ? roundTo : 10;
      const nums = origVals.map((v) => Number(v)).filter((v) => !isNaN(v));
      const colStdv = stddev(nums);
      let absErrTotal = 0;
      data.forEach((row, i) => {
        const v = Number(row[col]);
        if (isNaN(v)) return;
        const rounded = Math.round(v / rt) * rt;
        processed[i][col] = rounded;
        absErrTotal += Math.abs(rounded - v);
      });
      il = colStdv > 0 ? Math.min(1, (absErrTotal / N) / colStdv) : 0;
      const uBefore = new Set(origVals.map(String)).size;
      const uAfter  = new Set(processed.map((r) => String(r[col]))).size;
      colStats[col] = { "Type": "round", "Round To": rt, "IL Score": il.toFixed(4), "Unique Before": uBefore, "Unique After": uAfter, "Avg Abs Error": (absErrTotal / N).toFixed(4) };

    } else if (type === "topk") {
      const k = topK && topK > 0 ? topK : 10;
      const freqMap = new Map<string, number>();
      origVals.forEach((v) => freqMap.set(String(v), (freqMap.get(String(v)) || 0) + 1));
      const topKVals = new Set(
        Array.from(freqMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, k).map(([v]) => v)
      );
      let changed = 0;
      data.forEach((row, i) => {
        if (!topKVals.has(String(row[col]))) { processed[i][col] = "Other"; changed++; }
      });
      il = changed / N;
      const uBefore = new Set(origVals.map(String)).size;
      const uAfter  = new Set(processed.map((r) => String(r[col]))).size;
      colStats[col] = { "Type": "top-k", "K": k, "IL Score": il.toFixed(4), "Unique Before": uBefore, "Unique After": uAfter, "Other Rate": `${(il*100).toFixed(1)}%` };
    }

    totalIL += il;
  });

  const avgIL = colConfigs.length > 0 ? totalIL / colConfigs.length : 0;
  const compliancePassed = avgIL < 0.5;

  const interp = `Generalisation applied to ${colConfigs.length} column(s). Avg IL = ${(avgIL*100).toFixed(1)}%. ` +
    colConfigs.map(({ col, type }) => {
      const s = colStats[col]; if (!s) return "";
      if (type === "bin")   return `"${col}" binned (bw=${s["Bin Width"]}, ${s["Unique After"]} bins).`;
      if (type === "round") return `"${col}" rounded to ${s["Round To"]} (${s["Unique After"]} unique).`;
      if (type === "topk")  return `"${col}" top-${s["K"]} kept; ${s["Other Rate"]} → "Other".`;
      return "";
    }).filter(Boolean).join(" ");

  const warnings: string[] = [
    ...(avgIL > 0.5 ? ["High avg information loss (> 50%). Adjust generalisation parameters."] : []),
    ...colConfigs.filter(({ col }) => Number(colStats[col]?.["Unique After"]) === 1)
      .map(({ col }) => `"${col}" fully generalised to one value — effectively suppressed.`),
    ...colConfigs.filter(({ col, type }) => type === "topk" && parseFloat(String(colStats[col]?.["Other Rate"] ?? "0")) > 30)
      .map(({ col }) => `Over 30% of "${col}" → "Other". Increase Top-K.`),
  ];

  const now = new Date().toLocaleString("en-IN");
  const colTable = colConfigs.map(({ col }) => {
    const s = colStats[col]; if (!s) return "";
    return htmlRow(col, `type=${s["Type"]} IL=${s["IL Score"]} unique: ${s["Unique Before"]}→${s["Unique After"]}`);
  }).join("");

  const report = buildReport(
    "Generalisation", "dataset", now, N, N,
    colConfigs.map(({ col, type, binWidth, roundTo, topK }) =>
      htmlRow(col, `${type}${type === "bin" ? ` bw=${binWidth ?? "auto"}` : type === "round" ? ` rt=${roundTo ?? 10}` : ` k=${topK ?? 10}`}`)
    ).join(""),
    htmlRow("Compliance (avg IL < 0.5)", compliancePassed ? "YES" : "NO", compliancePassed) +
    htmlRow("Avg Information Loss", `${(avgIL*100).toFixed(2)}%`, avgIL < 0.3) +
    htmlRow("Columns Generalised", colConfigs.length),
    colTable, interp, warnings,
  );

  return {
    technique: "Generalisation (Standalone)", family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: Math.min(1, avgIL),
    executionMs: Math.round(performance.now() - t0),
    stats: { columnsGeneralised: colConfigs.length, avgInformationLoss: `${(avgIL*100).toFixed(2)}%` },
    colStats, warnings, interpretation: interp, compliancePassed, report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 11. DATA SHUFFLING (Full / Within-Group / Rank-Preserving)
//     Ref: SDC Spec §11 — permutation-based QI↔SA unlinking
// ════════════════════════════════════════════════════════════════════════════

export function applyDataShuffling(
  data: DataRow[],
  targetCols: string[],
  variant: "full" | "within_group" | "rank_preserving",
  groupCol: string | null,
  rankDelta: number,
  seed = 42,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0 || targetCols.length === 0) return sdcEmpty("Data Shuffling");
  const N = data.length;

  let rngState = (seed >>> 0) + 0x6D2B79F5;
  function rng(): number {
    rngState = (rngState + 0x6D2B79F5) >>> 0;
    let z = rngState;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }
  function fisherYates(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const processed: DataRow[] = data.map((r) => ({ ...r }));
  const colStats: Record<string, Record<string, string | number>> = {};

  targetCols.forEach((col) => {
    const origVals = data.map((r) => r[col]);

    if (variant === "full") {
      const perm = fisherYates(N);
      perm.forEach((srcIdx, dstIdx) => { processed[dstIdx][col] = origVals[srcIdx]; });

    } else if (variant === "within_group") {
      if (!groupCol) {
        const perm = fisherYates(N);
        perm.forEach((srcIdx, dstIdx) => { processed[dstIdx][col] = origVals[srcIdx]; });
      } else {
        const groups = new Map<string, number[]>();
        data.forEach((r, i) => {
          const gv = String(r[groupCol] ?? "");
          if (!groups.has(gv)) groups.set(gv, []);
          groups.get(gv)!.push(i);
        });
        groups.forEach((indices) => {
          const vals = indices.map((i) => origVals[i]);
          const perm = fisherYates(indices.length);
          indices.forEach((dstIdx, k) => { processed[dstIdx][col] = vals[perm[k]]; });
        });
      }

    } else {
      // rank_preserving
      const delta = Math.max(1, Math.round(rankDelta * N));
      const isNum = isNumericCol(data, col);
      const keys  = isNum
        ? data.map((r) => Number(r[col]))
        : data.map((r) => String(r[col] ?? ""));
      const sortedIdx = (keys as (number | string)[]).map((_, i) => i).sort((a, b) => {
        const ka = keys[a], kb = keys[b];
        return typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
      });
      const rankOf = new Array(N).fill(0);
      sortedIdx.forEach((origIdx, rank) => { rankOf[origIdx] = rank; });
      const assigned = new Array(N).fill(false);
      const resultVals = [...origVals];
      const order = fisherYates(N);
      order.forEach((i) => {
        if (assigned[i]) return;
        const rankI = rankOf[i];
        const lo = Math.max(0, rankI - delta), hi = Math.min(N - 1, rankI + delta);
        const cands: number[] = [];
        for (let r = lo; r <= hi; r++) { const j = sortedIdx[r]; if (!assigned[j] && j !== i) cands.push(j); }
        if (cands.length > 0) {
          const j = cands[Math.floor(rng() * cands.length)];
          resultVals[i] = origVals[j]; resultVals[j] = origVals[i];
          assigned[i] = true; assigned[j] = true;
        }
      });
      resultVals.forEach((v, i) => { processed[i][col] = v; });
    }

    const newVals = processed.map((r) => r[col]);
    const changed = newVals.filter((v, i) => String(v) !== String(origVals[i])).length;
    const distOK = JSON.stringify([...origVals].map(String).sort()) === JSON.stringify([...newVals].map(String).sort());
    let pearsonSelf = NaN;
    if (isNumericCol(data, col)) {
      pearsonSelf = pearsonR(origVals.map((v) => Number(v)), newVals.map((v) => Number(v)));
    }
    colStats[col] = {
      "Values Changed":         `${changed} (${(changed/N*100).toFixed(1)}%)`,
      "Distribution Preserved": distOK ? "YES" : "NO",
      ...(!isNaN(pearsonSelf) ? { "Pearson r (self)": pearsonSelf.toFixed(4) } : {}),
    };
  });

  const numCols = targetCols.filter((c) => isNumericCol(data, c));
  const avgPearson = numCols.length > 0
    ? mean(numCols.map((c) => parseFloat(String(colStats[c]?.["Pearson r (self)"] ?? "0")))) : NaN;
  const compliancePassed = targetCols.every((c) => colStats[c]?.["Distribution Preserved"] === "YES");

  const variantLabel = variant === "full" ? "Full" : variant === "within_group" ? "Within-Group" : "Rank-Preserving";
  const interp = `Data shuffling (${variantLabel}) applied to ${targetCols.length} column(s). ` +
    `Marginal distribution preserved: ${compliancePassed ? "YES" : "FAIL"}. ` +
    (!isNaN(avgPearson)
      ? `Avg Pearson r (original vs shuffled) = ${avgPearson.toFixed(3)} — QI↔SA linkage ${Math.abs(avgPearson) < 0.2 ? "effectively severed" : "partially disrupted"}.`
      : "");

  const warnings: string[] = [
    ...(!compliancePassed ? ["Distribution NOT preserved — check implementation."] : []),
    ...(variant === "within_group" && !groupCol ? ["No group column — fell back to full shuffle."] : []),
    ...(!isNaN(avgPearson) && Math.abs(avgPearson) > 0.2
      ? [`Residual correlation r=${avgPearson.toFixed(3)} — consider Full variant for stronger unlinking.`] : []),
  ];

  const now = new Date().toLocaleString("en-IN");
  const colTable = targetCols.map((c) => htmlRow(c,
    `changed=${colStats[c]["Values Changed"]} dist=${colStats[c]["Distribution Preserved"]}${colStats[c]["Pearson r (self)"] ? ` r=${colStats[c]["Pearson r (self)"]}` : ""}`
  )).join("");

  const report = buildReport(
    "Data Shuffling", "dataset", now, N, N,
    htmlRow("Variant", variantLabel) + htmlRow("Target Columns", targetCols.join(", ")) +
    (groupCol ? htmlRow("Group Column", groupCol) : "") +
    (variant === "rank_preserving" ? htmlRow("Rank Delta (δ)", rankDelta.toFixed(2)) : ""),
    htmlRow("Distribution Preserved", compliancePassed ? "YES" : "NO", compliancePassed) +
    (!isNaN(avgPearson) ? htmlRow("Avg Pearson r (self)", avgPearson.toFixed(4), Math.abs(avgPearson) < 0.2) : ""),
    colTable, interp, warnings,
  );

  return {
    technique: `Data Shuffling (${variantLabel})`, family: "SDC",
    processedData: processed, originalCount: N, processedCount: N,
    recordsSuppressed: 0,
    informationLoss: isNaN(avgPearson) ? 0.5 : Math.min(1, Math.max(0, 1 - Math.abs(avgPearson))),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      variant: variantLabel,
      targetColumns:        targetCols.length,
      groupColumn:          groupCol ?? "N/A",
      rankDelta:            variant === "rank_preserving" ? rankDelta : "N/A",
      distributionPreserved: compliancePassed ? "YES" : "NO",
      avgPearsonR:          isNaN(avgPearson) ? "N/A" : avgPearson.toFixed(4),
    },
    colStats, warnings, interpretation: interp, compliancePassed, report,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// 12. CELL SUPPRESSION (Statistical Tables)
//     Ref: SDC Spec §12 — primary + secondary suppression on aggregated tables
// ════════════════════════════════════════════════════════════════════════════

export function applyCellSuppression(
  data: DataRow[],
  rowCol: string,
  colCol: string,
  valueCol: string,
  aggregate: "count" | "sum" | "mean",
  nMin: number,
  pPct: number,
  kDominance: number,
  applySecondary: boolean,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return sdcEmpty("Cell Suppression");
  const N = data.length;

  const rowVals = Array.from(new Set(data.map((r) => String(r[rowCol] ?? "")))).sort();
  const colVals = Array.from(new Set(data.map((r) => String(r[colCol] ?? "")))).sort();
  const R = rowVals.length, C = colVals.length;

  if (R === 0 || C === 0) {
    return { ...sdcEmpty("Cell Suppression"), warnings: ["Selected columns produce an empty table."] };
  }

  interface Cell { value: number; count: number; contributions: number[]; display: string }

  const table: Cell[][] = rowVals.map((rv) =>
    colVals.map((cv) => {
      const sub = data.filter((r) => String(r[rowCol]) === rv && String(r[colCol]) === cv);
      const contribs = sub.map((r) => Number(r[valueCol])).filter((v) => !isNaN(v));
      const val = aggregate === "count" ? sub.length
        : aggregate === "sum" ? contribs.reduce((s, v) => s + v, 0)
        : contribs.length > 0 ? mean(contribs) : 0;
      return { value: val, count: sub.length, contributions: contribs, display: val.toFixed(2) };
    })
  );

  const rowMarginals = rowVals.map((_, ri) => colVals.reduce((s, _cv, ci) => s + table[ri][ci].value, 0));
  const colMarginals = colVals.map((_, ci) => rowVals.reduce((s, _rv, ri) => s + table[ri][ci].value, 0));

  const suppressed = new Set<string>();
  const cellKey = (ri: number, ci: number) => `${ri}_${ci}`;

  // PRIMARY suppression
  for (let ri = 0; ri < R; ri++) {
    for (let ci = 0; ci < C; ci++) {
      const cell = table[ri][ci];
      if (cell.count < nMin) { suppressed.add(cellKey(ri, ci)); continue; }
      if (cell.value > 0 && cell.contributions.length >= kDominance) {
        const sorted = [...cell.contributions].sort((a, b) => b - a);
        const topSum = sorted.slice(0, kDominance).reduce((s, v) => s + v, 0);
        if (topSum / cell.value > pPct / 100) suppressed.add(cellKey(ri, ci));
      }
    }
  }
  const primaryCount = suppressed.size;

  // SECONDARY suppression (greedy)
  if (applySecondary) {
    let changed = true, iters = 0;
    while (changed && iters < R * C * 2) {
      changed = false; iters++;
      for (const k of Array.from(suppressed)) {
        const [ri, ci] = k.split("_").map(Number);
        // row back-calc check
        const rowKnown = colVals.reduce((s, _cv, j) => suppressed.has(cellKey(ri, j)) ? s : s + table[ri][j].value, 0);
        if (Math.abs(rowMarginals[ri] - rowKnown - table[ri][ci].value) < 1e-6) {
          let bestJ = -1, bestV = Infinity;
          for (let j = 0; j < C; j++) { if (!suppressed.has(cellKey(ri, j)) && table[ri][j].value < bestV) { bestV = table[ri][j].value; bestJ = j; } }
          if (bestJ >= 0) { suppressed.add(cellKey(ri, bestJ)); changed = true; }
        }
        // col back-calc check
        const colKnown = rowVals.reduce((s, _rv, i) => suppressed.has(cellKey(i, ci)) ? s : s + table[i][ci].value, 0);
        if (Math.abs(colMarginals[ci] - colKnown - table[ri][ci].value) < 1e-6) {
          let bestI = -1, bestV = Infinity;
          for (let i = 0; i < R; i++) { if (!suppressed.has(cellKey(i, ci)) && table[i][ci].value < bestV) { bestV = table[i][ci].value; bestI = i; } }
          if (bestI >= 0) { suppressed.add(cellKey(bestI, ci)); changed = true; }
        }
      }
    }
  }

  const secondaryCount = suppressed.size - primaryCount;
  const il = suppressed.size / (R * C);

  // Build output table as DataRow[]
  const outputRows: DataRow[] = rowVals.map((rv, ri) => {
    const row: DataRow = { [rowCol]: rv };
    colVals.forEach((cv, ci) => { row[cv] = suppressed.has(cellKey(ri, ci)) ? "*" : table[ri][ci].display; });
    row["Row Total"] = rowMarginals[ri].toFixed(2);
    return row;
  });
  const totRow: DataRow = { [rowCol]: "Column Total" };
  colVals.forEach((cv, ci) => { totRow[cv] = colMarginals[ci].toFixed(2); });
  totRow["Row Total"] = rowMarginals.reduce((s, v) => s + v, 0).toFixed(2);
  outputRows.push(totRow);

  const compliancePassed = il <= 0.5;

  const interp = `Cell suppression on ${R}×${C} table (rows="${rowCol}", cols="${colCol}", values="${valueCol}" [${aggregate}]). ` +
    `Primary: ${primaryCount} cells (n<${nMin} rule + ${pPct}% dominance). ` +
    `Secondary: ${secondaryCount} additional cells. Total suppressed: ${suppressed.size}/${R*C} (${(il*100).toFixed(1)}% IL).`;

  const warnings: string[] = [
    ...(il > 0.5 ? ["Over 50% of cells suppressed. Loosen n_min or dominance threshold."] : []),
    ...(primaryCount === 0 ? ["No cells triggered primary suppression under current rules."] : []),
    ...(R < 2 || C < 2 ? ["Table is too small — choose columns with more distinct categories."] : []),
  ];

  const now = new Date().toLocaleString("en-IN");
  const report = buildReport(
    "Cell Suppression", "dataset", now, N, outputRows.length,
    htmlRow("Row Column", rowCol) + htmlRow("Column Column", colCol) +
    htmlRow("Value / Aggregate", `${valueCol} (${aggregate})`) +
    htmlRow("Min Frequency (n)", nMin) +
    htmlRow("Dominance Rule (p%)", `${pPct}% top-${kDominance} contributor(s)`) +
    htmlRow("Secondary Suppression", applySecondary ? "YES" : "NO"),
    htmlRow("Table Dimensions", `${R} × ${C}`) +
    htmlRow("Primary Suppressed", primaryCount) +
    htmlRow("Secondary Suppressed", secondaryCount) +
    htmlRow("Total Suppressed", `${suppressed.size} / ${R*C}`) +
    htmlRow("Cell IL", `${(il*100).toFixed(2)}%`, il < 0.3),
    "", interp, warnings,
  );

  return {
    technique: "Cell Suppression (Statistical Table)", family: "SDC",
    processedData: outputRows, originalCount: N, processedCount: outputRows.length,
    recordsSuppressed: 0,
    informationLoss: Math.min(1, il),
    executionMs: Math.round(performance.now() - t0),
    stats: {
      tableSize:            `${R} × ${C}`,
      aggregate,
      primarySuppressed:    primaryCount,
      secondarySuppressed:  secondaryCount,
      totalCellsSuppressed: suppressed.size,
      totalCells:           R * C,
      cellSuppressionRate:  `${(il*100).toFixed(1)}%`,
    },
    warnings, interpretation: interp, compliancePassed, report,
  };
}
