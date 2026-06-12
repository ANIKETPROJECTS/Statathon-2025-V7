/**
 * Inference Attack — per SafeData Pipeline spec v1.0
 *
 * Form A — EC-Level Homogeneity Inference:
 *   inference_confidence(EC, SA) = most_common_count / |EC|
 *   dataset_risk(SA) = (1/N) × Σ_r confidence(EC(r), SA)
 *
 * Form B — Global Predictive Inference:
 *   Decision tree (max_depth=4) vs DummyClassifier baseline
 *   5-fold CV if N≥50, LOOCV if N<50
 *   Insufficient data guard: skip if any class has < 10 records
 */

import { DataRow, getRiskLevel, RiskLevel } from "./utils";

// ─── Form A thresholds (DIFFERENT from prosecutor/journalist) ─────────────────
const FORM_A_HIGH   = 0.70;  // ≥70% → RED
const FORM_A_MEDIUM = 0.40;  // 40–70% → YELLOW; <40% → GREEN

// Form B lift thresholds (pp = percentage points)
const LIFT_CRITICAL = 0.30;  // >30pp
const LIFT_MEDIUM   = 0.10;  // 10–30pp

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EcBreakdown {
  qiCombo: string;
  qiValues: Record<string, string>;
  ecSize: number;
  mostCommonValue: string;
  confidence: number;
  distribution: Record<string, number>;
  lDivDistinct: number;
  lDivStatus: "PASS" | "FAIL";
  flag: "HIDDEN_RISK" | "ALREADY_FLAGGED" | "SAFE";
}

export interface FormAResult {
  datasetRisk: number;
  ecBreakdown: EcBreakdown[];
  confidenceDistribution: {
    bucket: string;
    numECs: number;
    numRecords: number;
    pct: string;
    meaning: string;
  }[];
  highRiskRecordPct: number;  // % in ECs with conf >= 0.7
}

export interface FormBResult {
  status: "ok" | "insufficient_data" | "skipped";
  message?: string;
  baselineAccuracy?: number;
  attackerAccuracy?: number;
  inferenceLift?: number;
  cvMethod?: string;
  liftStatus?: "CRITICAL" | "MEDIUM" | "LOW";
}

export interface PerSAInferenceResult {
  sa: string;
  formA: FormAResult;
  formB: FormBResult;
  formAStatus: "CRITICAL" | "MEDIUM" | "LOW";
}

export interface InferenceResult {
  // Legacy (composite score compatibility)
  riskScore: number;
  riskLevel: RiskLevel;
  attackAccuracy: number;
  baselineAccuracy: number;
  infoGain: number;
  featureImportance: { qi: string; importance: number }[];
  perSA: { sa: string; attackAccuracy: number; baselineAccuracy: number; infoGain: number; riskLevel: string }[];
  accuracyComparison: { name: string; value: number }[];
  totalRecords: number;

  // Spec §8 fields
  sampleN: number;
  quasiIdentifiers: string[];
  sensitiveAttributes: string[];
  overallFormARisk: number;             // mean(formA.datasetRisk) across all SAs
  highestFormARisk: number;
  highestFormARiskSA: string;
  highestFormBLift: number;
  highestFormBLiftSA: string;
  formBComputedCount: number;
  hiddenRiskECs: number;                // ECs that PASS L-Div but formA conf > 0.7
  smallSampleWarning: boolean;
  perSAResults: PerSAInferenceResult[];
  recommendations: string[];
}

// ─── Decision Tree (from existing implementation, kept for Form B) ────────────

interface TreeNode {
  attribute?: string;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  prediction?: string;
  gini?: number;
  samples?: number;
}

function giniImpurity(labels: string[]): number {
  if (labels.length === 0) return 0;
  const counts = new Map<string, number>();
  labels.forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1));
  const n = labels.length;
  let sum = 0;
  counts.forEach((c) => { sum += (c / n) ** 2; });
  return 1 - sum;
}

function mostCommon(labels: string[]): string {
  const counts = new Map<string, number>();
  labels.forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1));
  let best = ""; let bestC = 0;
  counts.forEach((c, l) => { if (c > bestC) { best = l; bestC = c; } });
  return best;
}

function buildTree(
  X: number[][], y: string[], depth: number, maxDepth: number, attrs: string[]
): TreeNode {
  if (depth >= maxDepth || new Set(y).size === 1 || y.length < 4) {
    return { prediction: mostCommon(y), gini: giniImpurity(y), samples: y.length };
  }

  const parentGini = giniImpurity(y);
  let bestGain = -Infinity, bestAttr = -1, bestThreshold = 0;

  for (let a = 0; a < (X[0]?.length ?? 0); a++) {
    const vals = Array.from(new Set(X.map((r) => r[a]))).sort((p, q) => p - q);
    const thresholds = vals.slice(0, -1).map((v, i) => (v + vals[i + 1]) / 2);
    for (const t of thresholds.slice(0, 10)) {
      const leftY = y.filter((_, i) => X[i][a] <= t);
      const rightY = y.filter((_, i) => X[i][a] > t);
      if (!leftY.length || !rightY.length) continue;
      const gain = parentGini -
        (leftY.length / y.length) * giniImpurity(leftY) -
        (rightY.length / y.length) * giniImpurity(rightY);
      if (gain > bestGain) { bestGain = gain; bestAttr = a; bestThreshold = t; }
    }
  }

  if (bestAttr === -1 || bestGain <= 0)
    return { prediction: mostCommon(y), samples: y.length };

  const leftIdx  = X.map((_, i) => i).filter((i) => X[i][bestAttr] <= bestThreshold);
  const rightIdx = X.map((_, i) => i).filter((i) => X[i][bestAttr] > bestThreshold);

  return {
    attribute: attrs[bestAttr], threshold: bestThreshold, gini: parentGini, samples: y.length,
    left:  buildTree(leftIdx.map((i) => X[i]),  leftIdx.map((i) => y[i]),  depth + 1, maxDepth, attrs),
    right: buildTree(rightIdx.map((i) => X[i]), rightIdx.map((i) => y[i]), depth + 1, maxDepth, attrs),
  };
}

function predictTree(node: TreeNode, x: number[], attrs: string[]): string {
  if (node.prediction !== undefined) return node.prediction;
  const attrIdx = attrs.indexOf(node.attribute ?? "");
  if (attrIdx === -1) return "";
  return x[attrIdx] <= (node.threshold ?? 0)
    ? predictTree(node.left!, x, attrs)
    : predictTree(node.right!, x, attrs);
}

function computeGiniImportance(
  node: TreeNode, importance: Map<string, number>, totalSamples: number
): void {
  if (!node.attribute) return;
  const w = ((node.gini ?? 0) * (node.samples ?? 0)) / totalSamples;
  const lc = node.left  ? ((node.left.gini  ?? 0) * (node.left.samples  ?? 0)) / totalSamples : 0;
  const rc = node.right ? ((node.right.gini ?? 0) * (node.right.samples ?? 0)) / totalSamples : 0;
  importance.set(node.attribute, (importance.get(node.attribute) ?? 0) + Math.max(0, w - lc - rc));
  if (node.left)  computeGiniImportance(node.left,  importance, totalSamples);
  if (node.right) computeGiniImportance(node.right, importance, totalSamples);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function encodeQIs(data: DataRow[], qis: string[]): number[][] {
  const encodings = new Map<string, Map<string, number>>();
  qis.forEach((qi) => {
    const freq = new Map<string, number>();
    data.forEach((r) => { const v = String(r[qi] ?? ""); freq.set(v, (freq.get(v) ?? 0) + 1); });
    const total = data.length;
    const enc = new Map<string, number>();
    freq.forEach((cnt, v) => enc.set(v, cnt / total));
    encodings.set(qi, enc);
  });
  return data.map((row) =>
    qis.map((qi) => encodings.get(qi)?.get(String(row[qi] ?? "")) ?? 0)
  );
}

function formAStatus(risk: number): "CRITICAL" | "MEDIUM" | "LOW" {
  return risk >= FORM_A_HIGH ? "CRITICAL" : risk >= FORM_A_MEDIUM ? "MEDIUM" : "LOW";
}

function liftStatus(lift: number): "CRITICAL" | "MEDIUM" | "LOW" {
  return lift > LIFT_CRITICAL ? "CRITICAL" : lift > LIFT_MEDIUM ? "MEDIUM" : "LOW";
}

// ─── Main function ────────────────────────────────────────────────────────────

export function runInferenceAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  sensitiveAttributes: string[],
  lThreshold = 3,
): InferenceResult {
  const n = data.length;
  if (n === 0 || quasiIdentifiers.length === 0 || sensitiveAttributes.length === 0)
    return emptyResult(quasiIdentifiers, sensitiveAttributes);

  const smallSampleWarning = n < 50;

  // ── Build EC map (key → record indices) ──────────────────────────────────
  const ecMap = new Map<string, { indices: number[]; qiValues: Record<string, string> }>();
  data.forEach((row, idx) => {
    const key = quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|");
    if (!ecMap.has(key)) {
      const qiValues: Record<string, string> = {};
      quasiIdentifiers.forEach((qi) => { qiValues[qi] = String(row[qi] ?? ""); });
      ecMap.set(key, { indices: [], qiValues });
    }
    ecMap.get(key)!.indices.push(idx);
  });

  // ── QI encoding for Form B ────────────────────────────────────────────────
  const X = encodeQIs(data, quasiIdentifiers);

  const perSAResults: PerSAInferenceResult[] = [];
  const importanceAgg = new Map<string, number>();
  let legacyOverallAcc = 0, legacyOverallBaseline = 0;

  for (const sa of sensitiveAttributes) {
    // ── FORM A ─────────────────────────────────────────────────────────────
    const ecBreakdown: EcBreakdown[] = [];
    const confidencesPerRecord: number[] = new Array(n);

    ecMap.forEach(({ indices, qiValues }) => {
      const vals = indices.map((i) => String(data[i][sa] ?? ""));
      const counts = new Map<string, number>();
      vals.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
      let maxCount = 0; let modeVal = "";
      counts.forEach((c, v) => { if (c > maxCount) { maxCount = c; modeVal = v; } });
      const confidence = maxCount / indices.length;

      // L-Diversity check for this EC
      const lDivDistinct = counts.size;
      const lDivStatus: "PASS" | "FAIL" = lDivDistinct >= lThreshold ? "PASS" : "FAIL";
      const flag: EcBreakdown["flag"] =
        lDivStatus === "PASS" && confidence > FORM_A_HIGH ? "HIDDEN_RISK" :
        lDivStatus === "FAIL" ? "ALREADY_FLAGGED" : "SAFE";

      const dist: Record<string, number> = {};
      counts.forEach((c, v) => { dist[v] = c; });

      const qiCombo = quasiIdentifiers.map((qi) => `${qi}=${qiValues[qi]}`).join(", ");
      ecBreakdown.push({ qiCombo, qiValues, ecSize: indices.length, mostCommonValue: modeVal, confidence, distribution: dist, lDivDistinct, lDivStatus, flag });

      indices.forEach((i) => { confidencesPerRecord[i] = confidence; });
    });

    const datasetRisk = confidencesPerRecord.reduce((s, v) => s + v, 0) / n;
    const highRiskCount = confidencesPerRecord.filter((c) => c >= FORM_A_HIGH).length;
    const highRiskRecordPct = (highRiskCount / n) * 100;

    // Confidence distribution
    const confBuckets = [
      { bucket: "0.90–1.00", min: 0.90, max: 1.01, meaning: "Attacker near-certain of SA value" },
      { bucket: "0.70–0.89", min: 0.70, max: 0.90, meaning: "Attacker likely correct" },
      { bucket: "0.50–0.69", min: 0.50, max: 0.70, meaning: "Attacker better than random" },
      { bucket: "< 0.50",    min: 0.00, max: 0.50, meaning: "SA well-protected within group" },
    ];
    const confidenceDistribution = confBuckets.map(({ bucket, min, max, meaning }) => {
      const matchingECs = ecBreakdown.filter((e) => e.confidence >= min && e.confidence < max);
      const numRecords = matchingECs.reduce((s, e) => s + e.ecSize, 0);
      return {
        bucket, numECs: matchingECs.length, numRecords,
        pct: n > 0 ? ((numRecords / n) * 100).toFixed(1) + "%" : "0%",
        meaning,
      };
    });

    const formA: FormAResult = {
      datasetRisk,
      ecBreakdown: [...ecBreakdown].sort((a, b) => b.confidence - a.confidence),
      confidenceDistribution,
      highRiskRecordPct,
    };

    // ── FORM B ─────────────────────────────────────────────────────────────
    let formB: FormBResult;
    const y = data.map((r) => String(r[sa] ?? ""));
    const classCounts = new Map<string, number>();
    y.forEach((l) => classCounts.set(l, (classCounts.get(l) ?? 0) + 1));
    const minClassCount = Math.min(...Array.from(classCounts.values()));
    const baselineAcc = Math.max(...Array.from(classCounts.values())) / n;

    if (minClassCount < 10 || n < 10) {
      formB = {
        status: "insufficient_data",
        message: `Insufficient data to compute Form B inference for "${sa}" — minimum 10 records per category required. Smallest category has ${minClassCount} record${minClassCount !== 1 ? "s" : ""}. Form A (group-based) results above remain valid.`,
      };
    } else {
      const useLOOCV = n < 50;
      let correct = 0;
      const localImportance = new Map<string, number>();

      if (useLOOCV) {
        // Leave-One-Out CV
        for (let i = 0; i < n; i++) {
          const trainIdx = Array.from(Array(n).keys()).filter((j) => j !== i);
          const X_train = trainIdx.map((j) => X[j]);
          const y_train = trainIdx.map((j) => y[j]);
          const tree = buildTree(X_train, y_train, 0, 4, quasiIdentifiers);
          computeGiniImportance(tree, localImportance, trainIdx.length);
          if (predictTree(tree, X[i], quasiIdentifiers) === y[i]) correct++;
        }
      } else {
        // 5-fold CV
        const indices = shuffle(Array.from(Array(n).keys()));
        const foldSize = Math.floor(n / 5);
        for (let fold = 0; fold < 5; fold++) {
          const valIdx   = indices.slice(fold * foldSize, (fold + 1) * foldSize);
          const trainIdx = indices.filter((_, i) => i < fold * foldSize || i >= (fold + 1) * foldSize);
          if (trainIdx.length < 6) continue;
          const tree = buildTree(trainIdx.map((i) => X[i]), trainIdx.map((i) => y[i]), 0, 4, quasiIdentifiers);
          computeGiniImportance(tree, localImportance, trainIdx.length);
          valIdx.forEach((vi) => {
            if (predictTree(tree, X[vi], quasiIdentifiers) === y[vi]) correct++;
          });
        }
      }

      const attackerAcc = correct / n;
      const lift = attackerAcc - baselineAcc;

      localImportance.forEach((v, k) => { importanceAgg.set(k, (importanceAgg.get(k) ?? 0) + v); });

      formB = {
        status: "ok",
        baselineAccuracy: parseFloat((baselineAcc * 100).toFixed(1)),
        attackerAccuracy: parseFloat((attackerAcc * 100).toFixed(1)),
        inferenceLift: parseFloat((lift * 100).toFixed(1)),
        cvMethod: useLOOCV ? "LOOCV (N<50)" : "5-fold CV",
        liftStatus: liftStatus(lift),
      };

      legacyOverallAcc += attackerAcc;
      legacyOverallBaseline += baselineAcc;
    }

    perSAResults.push({
      sa, formA, formB,
      formAStatus: formAStatus(datasetRisk),
    });
  }

  // ── Aggregate metrics ─────────────────────────────────────────────────────
  const overallFormARisk = perSAResults.length > 0
    ? perSAResults.reduce((s, r) => s + r.formA.datasetRisk, 0) / perSAResults.length
    : 0;

  const highestFormARiskItem = [...perSAResults].sort((a, b) => b.formA.datasetRisk - a.formA.datasetRisk)[0];
  const highestFormARisk     = highestFormARiskItem?.formA.datasetRisk ?? 0;
  const highestFormARiskSA   = highestFormARiskItem?.sa ?? "—";

  const formBItems = perSAResults.filter((r) => r.formB.status === "ok" && r.formB.inferenceLift !== undefined);
  const highestFormBLiftItem = [...formBItems].sort((a, b) => (b.formB.inferenceLift ?? 0) - (a.formB.inferenceLift ?? 0))[0];
  const highestFormBLift     = highestFormBLiftItem?.formB.inferenceLift ?? 0;
  const highestFormBLiftSA   = highestFormBLiftItem?.sa ?? "—";
  const formBComputedCount   = formBItems.length;

  const hiddenRiskECs = perSAResults.reduce((total, r) =>
    total + r.formA.ecBreakdown.filter((e) => e.flag === "HIDDEN_RISK").length, 0
  );

  // ── Feature importance ────────────────────────────────────────────────────
  const totalImp = Array.from(importanceAgg.values()).reduce((a, b) => a + b, 0);
  const featureImportance = quasiIdentifiers.map((qi) => ({
    qi,
    importance: parseFloat((totalImp > 0 ? (importanceAgg.get(qi) ?? 0) / totalImp : 0).toFixed(3)),
  })).sort((a, b) => b.importance - a.importance);

  // ── Legacy PerSA ──────────────────────────────────────────────────────────
  const perSA = perSAResults.map((r) => ({
    sa: r.sa,
    attackAccuracy: r.formB.status === "ok" ? r.formB.attackerAccuracy ?? 0 : 0,
    baselineAccuracy: r.formB.status === "ok" ? r.formB.baselineAccuracy ?? 0 : 0,
    infoGain: r.formB.status === "ok" ? Math.max(0, r.formB.inferenceLift ?? 0) : 0,
    riskLevel: r.formAStatus,
  }));

  const saCount = sensitiveAttributes.length;
  const avgAcc = saCount > 0 ? legacyOverallAcc / saCount : 0;
  const avgBase = saCount > 0 ? legacyOverallBaseline / saCount : 0;
  const avgIG   = Math.max(0, avgAcc - avgBase);

  // ── Recommendations ───────────────────────────────────────────────────────
  const recommendations: string[] = [];

  perSAResults.forEach((r) => {
    if (r.formA.datasetRisk >= FORM_A_HIGH) {
      const n_ec = r.formA.ecBreakdown.filter((e) => e.confidence >= FORM_A_HIGH).length;
      recommendations.push(
        `🔴 CRITICAL — Form A confidence for "${r.sa}" is ${(r.formA.datasetRisk * 100).toFixed(1)}% on average. ${n_ec} equivalence class${n_ec !== 1 ? "es" : ""} have near-uniform "${r.sa}" values. Consider: adding noise/perturbation, suppressing "${r.sa}" for high-confidence ECs, or broader generalisation of [${quasiIdentifiers.join(", ")}].`
      );
    } else if (r.formA.datasetRisk >= FORM_A_MEDIUM) {
      recommendations.push(
        `🟡 MEDIUM — Form A confidence for "${r.sa}" is ${(r.formA.datasetRisk * 100).toFixed(1)}%. Some equivalence classes have skewed distributions — consider l-diversity enforcement.`
      );
    }
    if (r.formB.status === "ok" && (r.formB.inferenceLift ?? 0) > LIFT_MEDIUM * 100) {
      recommendations.push(
        `🟡 MEDIUM — Form B Inference Lift for "${r.sa}" is +${r.formB.inferenceLift}pp. QIs are strong predictors of "${r.sa}" across the WHOLE dataset. Consider removing or coarsening the most predictive QI.`
      );
    }
  });

  if (hiddenRiskECs > 0) {
    recommendations.push(
      `🔵 INFO — ${hiddenRiskECs} EC${hiddenRiskECs !== 1 ? "s" : ""} PASS L-Diversity but show Form A confidence > 70%. Review the "Form A vs L-Diversity Cross-Check" table — these groups give a false sense of security.`
    );
  }

  const insufficientSAs = perSAResults.filter((r) => r.formB.status === "insufficient_data").map((r) => r.sa);
  if (insufficientSAs.length > 0) {
    recommendations.push(
      `ℹ️ NOTE — Form B could not be computed for [${insufficientSAs.join(", ")}] due to insufficient data (minimum 10 records/category). Re-run with a larger dataset for more reliable global predictive estimates.`
    );
  }

  if (smallSampleWarning) {
    recommendations.push(
      `ℹ️ SAMPLE SIZE — With only ${n} records, Form A Inference Confidence scores near 1.0 may reflect small-sample noise rather than a genuine population-level pattern. Form B results (where computable) are more reliable.`
    );
  }

  recommendations.push(
    `ℹ️ NEXT STEP — Go to "Privacy Enhancement" → "Attribute Perturbation" or "Sensitive Attribute Generalisation" to address Form A risks directly; re-run this assessment afterward to verify confidence scores have decreased.`
  );

  return {
    riskScore: overallFormARisk,
    riskLevel: getRiskLevel(overallFormARisk),
    attackAccuracy: parseFloat((avgAcc * 100).toFixed(1)),
    baselineAccuracy: parseFloat((avgBase * 100).toFixed(1)),
    infoGain: parseFloat((avgIG * 100).toFixed(1)),
    featureImportance,
    perSA,
    accuracyComparison: [
      { name: "Attack Accuracy",   value: parseFloat((avgAcc  * 100).toFixed(1)) },
      { name: "Baseline (Random)", value: parseFloat((avgBase * 100).toFixed(1)) },
    ],
    totalRecords: n,
    sampleN: n,
    quasiIdentifiers,
    sensitiveAttributes,
    overallFormARisk,
    highestFormARisk,
    highestFormARiskSA,
    highestFormBLift,
    highestFormBLiftSA,
    formBComputedCount,
    hiddenRiskECs,
    smallSampleWarning,
    perSAResults,
    recommendations,
  };
}

function emptyResult(qis: string[], sas: string[]): InferenceResult {
  return {
    riskScore: 0, riskLevel: "LOW", attackAccuracy: 0, baselineAccuracy: 0, infoGain: 0,
    featureImportance: [], perSA: [], accuracyComparison: [], totalRecords: 0,
    sampleN: 0, quasiIdentifiers: qis, sensitiveAttributes: sas,
    overallFormARisk: 0, highestFormARisk: 0, highestFormARiskSA: "—",
    highestFormBLift: 0, highestFormBLiftSA: "—", formBComputedCount: 0,
    hiddenRiskECs: 0, smallSampleWarning: false, perSAResults: [],
    recommendations: ["Select quasi-identifiers and sensitive attributes to run inference attack."],
  };
}
