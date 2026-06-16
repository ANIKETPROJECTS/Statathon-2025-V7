import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Shield, Lock, Database, Shuffle, Sparkles, Play, Loader2,
  CheckCircle, Download, Info, Network, Key, Server,
  GitMerge, BarChart3, ChevronRight, AlertTriangle, Zap, ArrowLeft,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Dataset, PrivacyOperation } from "@shared/schema";
import type { DataRow } from "@/lib/attacks/utils";
import type { PrivacyResult } from "@/lib/privacy/types";
import { downloadCSV } from "@/lib/privacy/types";
import {
  applyKAnonymity, applyLDiversity, applyTCloseness,
  applyRankSwapping, applyMicroaggregation, applyPRAM, applyTopBottomCoding,
  applyNoiseAddition, applyExplicitSuppression, applyGeneralisation,
  applyDataShuffling, applyCellSuppression,
} from "@/lib/privacy/sdc";
import type { GeneralisationColConfig } from "@/lib/privacy/sdc";
import { applyLaplace, applyGaussian, applyExponential, applyMixed, epsilonLabel, epsilonBadgeClass, type SensitivityMode } from "@/lib/privacy/dp";
import { applyStatisticalSDG, applyDPSDG, computeSigmaFromEpsilon, computeEpsilonFromSigma } from "@/lib/privacy/synthetic";
import { applyHomomorphicEncryption, applySMPC } from "@/lib/privacy/crypto";
import { applyFederatedLearning, type FLParams } from "@/lib/privacy/federated";
import { ATTACK_MATRIX, ATTACK_COLUMNS, countMitigations, type MitigationLevel } from "@/lib/privacy/attackMatrix";

// ─── Technique catalogue ─────────────────────────────────────────────────────
const FAMILIES = [
  { id: "sdc",       label: "Statistical Disclosure Control", icon: Shield,    color: "text-blue-600 dark:text-blue-400" },
  { id: "dp",        label: "Differential Privacy",           icon: Lock,      color: "text-purple-600 dark:text-purple-400" },
  { id: "synthetic", label: "Synthetic Data Generation",      icon: Sparkles,  color: "text-emerald-600 dark:text-emerald-400" },
  { id: "crypto",    label: "Cryptographic PETs",             icon: Key,       color: "text-amber-600 dark:text-amber-400" },
  { id: "federated", label: "Federated Learning",             icon: Network,   color: "text-rose-600 dark:text-rose-400" },
  { id: "matrix",    label: "Attack Mitigation Matrix",       icon: BarChart3, color: "text-slate-600 dark:text-slate-400" },
] as const;

type FamilyId = typeof FAMILIES[number]["id"];

const SDC_TECHNIQUES = [
  { id: "k-anonymity",         label: "K-Anonymity",           subtitle: "Mondrian Greedy Partitioning",   needsQI: true,  needsSA: false },
  { id: "l-diversity",         label: "L-Diversity",           subtitle: "Entropy / Distinct / Recursive", needsQI: true,  needsSA: true  },
  { id: "t-closeness",         label: "T-Closeness",           subtitle: "Earth Mover's Distance (EMD)",   needsQI: true,  needsSA: true  },
  { id: "rank-swapping",       label: "Rank Swapping",         subtitle: "Rank-bounded value exchange",    needsQI: false, needsSA: false },
  { id: "microagg",            label: "Microaggregation",      subtitle: "MDAV centroid replacement",      needsQI: false, needsSA: false },
  { id: "pram",                label: "PRAM",                  subtitle: "Post Randomisation Method",      needsQI: false, needsSA: false },
  { id: "topbottom",           label: "Top/Bottom Coding",     subtitle: "Percentile capping + noise",     needsQI: false, needsSA: false },
  { id: "noise-addition",      label: "Noise Addition",        subtitle: "Gaussian / Laplace / Uniform",   needsQI: false, needsSA: false },
  { id: "explicit-suppression",label: "Explicit Suppression",  subtitle: "Row / cell / threshold rules",   needsQI: false, needsSA: false },
  { id: "generalisation",      label: "Generalisation",        subtitle: "Bin / Round / Top-K per column", needsQI: false, needsSA: false },
  { id: "data-shuffling",      label: "Data Shuffling",        subtitle: "Full / Within-group / Rank",     needsQI: false, needsSA: false },
  { id: "cell-suppression",    label: "Cell Suppression",      subtitle: "Statistical table protection",   needsQI: false, needsSA: false },
];

// ─── Technique column config (spec A0) ───────────────────────────────────────
type TcFilter = "numeric" | "categorical" | "any" | null;
type TriBool = boolean | "cond";
const TECHNIQUE_CONFIG: Record<string, { qi: TriBool; sa: TriBool; tc: TriBool; tcFilter: TcFilter }> = {
  "k-anonymity":          { qi: true,   sa: false,  tc: false,  tcFilter: null },
  "l-diversity":          { qi: true,   sa: true,   tc: false,  tcFilter: null },
  "t-closeness":          { qi: true,   sa: true,   tc: false,  tcFilter: null },
  "rank-swapping":        { qi: false,  sa: false,  tc: true,   tcFilter: "numeric" },
  "microagg":             { qi: false,  sa: false,  tc: true,   tcFilter: "numeric" },
  "pram":                 { qi: false,  sa: false,  tc: true,   tcFilter: "categorical" },
  "topbottom":            { qi: false,  sa: false,  tc: true,   tcFilter: "numeric" },
  "noise-addition":       { qi: false,  sa: false,  tc: true,   tcFilter: "numeric" },
  "explicit-suppression": { qi: "cond", sa: "cond", tc: "cond", tcFilter: "numeric" },
  "generalisation":       { qi: false,  sa: false,  tc: false,  tcFilter: null },
  "data-shuffling":       { qi: false,  sa: false,  tc: true,   tcFilter: "any" },
  "cell-suppression":     { qi: false,  sa: false,  tc: false,  tcFilter: null },
};

const DP_TECHNIQUES = [
  { id: "laplace",     label: "Laplace Mechanism",    subtitle: "ε-DP on numeric queries" },
  { id: "gaussian",    label: "Gaussian Mechanism",   subtitle: "(ε,δ)-DP relaxed guarantee" },
  { id: "exponential", label: "Exponential Mechanism",subtitle: "ε-DP for categorical outputs" },
];
const SDG_TECHNIQUES = [
  { id: "stat-sdg", label: "Statistical SDG",       subtitle: "Marginal distribution sampling" },
  { id: "dp-sdg",   label: "DP-SDG (DP-CTGAN)",    subtitle: "DP-SGD gradient clipping + noise" },
];
const CRYPTO_TECHNIQUES = [
  { id: "he",   label: "Homomorphic Encryption", subtitle: "Paillier additive HE (simulation)" },
  { id: "smpc", label: "Secure MPC (SMPC)",       subtitle: "Additive secret sharing" },
];
const FED_TECHNIQUES = [
  { id: "fedavg", label: "FedAvg / DP-FedAvg", subtitle: "Federated Averaging (McMahan et al.)" },
];

// ─── Math formula display ─────────────────────────────────────────────────────
const FORMULAS: Record<string, { title: string; latex: string; desc: string }> = {
  "k-anonymity":        { title: "K-Anonymity (Mondrian)", latex: "|E| ≥ k  for all equivalence classes E", desc: "Every individual is indistinguishable from at least k−1 others. Mondrian recursively splits on the widest-range QI column." },
  "l-diversity":        { title: "Entropy L-Diversity", latex: "−Σ p(s) log p(s) ≥ log(l)", desc: "Shannon entropy of sensitive attribute distribution per equivalence class must be ≥ log(l), preventing attribute-homogeneity attacks." },
  "t-closeness":        { title: "T-Closeness (EMD)", latex: "D[P, Q] ≤ t  (Earth Mover's Distance)", desc: "The distance between the local sensitive-attribute distribution P and the global distribution Q must not exceed t." },
  "rank-swapping":      { title: "Rank Swapping", latex: "|rank(rᵢ) − rank(rⱼ)| ≤ p", desc: "Numeric values are swapped between pairs of records whose rank indices differ by at most p = swapFraction × N, preserving marginals." },
  "microagg":           { title: "Microaggregation (MDAV)", latex: "x̄ = (1/k) Σᵢ xᵢ  (cluster centroid)", desc: "Records are grouped into clusters of size ≥ k using MDAV. Each record's numeric values are replaced by the cluster centroid." },
  "pram":               { title: "PRAM Transition Matrix", latex: "M[i,j] = p_ret  if i=j;  (1−p_ret)/(|S|−1)  otherwise", desc: "Each categorical value is independently perturbed according to a Markov transition matrix M with retention probability p_ret." },
  "topbottom":          { title: "Top/Bottom Coding + Noise", latex: "v′ = clip(v, q_bot, q_top) + N(0, λ²·σ²)", desc: "Values outside [q_bot, q_top] are capped at those percentile thresholds. Optional Gaussian noise σ_noise = λ × col_std is added." },
  "laplace":            { title: "Laplace Mechanism", latex: "M(D) = f(D) + Lap(0, Δf/ε)  →  ε-DP", desc: "Noise drawn from Lap(0, Δf/ε) is added to each numeric value. Global sensitivity Δf = column range. Guarantees ε-differential privacy." },
  "gaussian":           { title: "Gaussian Mechanism", latex: "σ ≥ Δf · √(2 ln(1.25/δ)) / ε  →  (ε,δ)-DP", desc: "Gaussian N(0,σ²) noise provides (ε,δ)-DP. Weaker than Laplace per unit ε but often more numerically stable for composition." },
  "exponential":        { title: "Exponential Mechanism", latex: "P[output = r] ∝ exp(ε·u(D,r) / 2Δu)", desc: "Categorical outputs are sampled proportionally to exp(ε·utility/2Δu), where utility = normalised frequency. Gives ε-DP for categorical data." },
  "stat-sdg":           { title: "Statistical Marginal Sampling", latex: "x̃ ~ P̂(X)  (empirical marginal + Box-Muller)", desc: "New records are sampled independently from each column's empirical distribution. Optionally preserves pairwise Pearson correlations." },
  "dp-sdg":             { title: "DP-SDG (DP-SGD Gradient Clipping)", latex: "g̃ = (1/B) Σ [gt/max(1,‖gt‖/C)] + N(0,σ²C²I)", desc: "Gradients are clipped to norm C and Gaussian noise N(0,σ²C²I) is injected. σ ≥ C·√(2ln(1.25/δ))/ε gives (ε,δ)-DP on the generated model." },
  "he":                 { title: "Paillier Homomorphic Encryption", latex: "E(m₁) · E(m₂) ≡ E(m₁ + m₂) (mod n²)", desc: "Additive partially-homomorphic encryption. Computations on ciphertexts equal encryption of the computed result — data is never decrypted at the analyst." },
  "smpc":               { title: "Additive Secret Sharing (Shamir)", latex: "s₁ + s₂ + … + sₖ ≡ v (mod P)  ∀P prime", desc: "Each value is split into k additive shares over a prime field. Any individual share is information-theoretically random. Threshold t shares reconstruct the original." },
  "fedavg":             { title: "Federated Averaging (FedAvg)", latex: "w_{t+1} = Σₖ (nₖ/n) · wₖₜ", desc: "Each node trains locally on its shard and sends only model updates (gradients). FedAvg computes the weighted average of local model weights across K nodes." },
  "noise-addition":     { title: "Noise Addition", latex: "x′ = x + ε,  ε ~ D(0, λ·σ_col)",  desc: "Noise proportional to each column's standard deviation is injected. λ controls the noise-to-signal ratio. Distributions: Gaussian N(0,σ²), Laplace Lap(0,b), Uniform U(−δ,+δ)." },
  "explicit-suppression": { title: "Explicit Suppression", latex: "Suppress record rᵢ if criterion(rᵢ) = TRUE", desc: "Records or cells are removed based on disclosure-risk criteria: uniqueness (|EC| < k), outlier (|z| > z₀), sensitive-value membership, or threshold violation." },
  "generalisation":     { title: "Generalisation (Bin / Round / Top-K)", latex: "x → ⌊x/w⌋·w  (round);  x → [lo, lo+w)  (bin);  v → 'Other' if rank > K  (top-k)", desc: "Values are replaced by less specific representations. Binning groups numeric values into intervals; rounding reduces precision; Top-K maps rare categories to 'Other'." },
  "data-shuffling":     { title: "Data Shuffling", latex: "π: {1…N} → {1…N}  (permutation  of target column values)", desc: "Column values are permuted independently of other columns to sever quasi-identifier ↔ sensitive-attribute linkages. Marginal distributions are exactly preserved." },
  "cell-suppression":   { title: "Cell Suppression (n-rule + p%-dominance)", latex: "Suppress cell(r,c) if count < n  OR  Σᵢ₌₁ᵏ xᵢ / Σⱼ xⱼ > p/100", desc: "Primary cells are suppressed if they fail the minimum-frequency rule or if the top-k contributors dominate. Secondary suppression prevents back-calculation from marginals." },
};

// ─── Column classification type ───────────────────────────────────────────────
type ColClass = "DIRECT_ID" | "QUASI_ID" | "SENSITIVE" | "IGNORE";
interface ColProfile {
  isNum: boolean;
  uniqueCount: number;
  entropy: number;
  classification: ColClass;
}

// ─── Auto-suggest hints ───────────────────────────────────────────────────────
interface AutoSuggest {
  k?: number;
  suppLimit?: number;
  l?: number;
  lVariant?: "entropy" | "distinct" | "recursive";
  t?: number;
  swapFrac?: number;
  microK?: number;
  pramRet?: number;
  noiseLambda?: number;
  reason?: string;
}

// ─── Result summary component ─────────────────────────────────────────────────
function ResultCard({ result }: { result: PrivacyResult }) {
  const lossColor = result.informationLoss < 0.15 ? "text-emerald-600" : result.informationLoss < 0.35 ? "text-amber-500" : "text-rose-500";
  const lossLabel = result.informationLoss < 0.15 ? "Low" : result.informationLoss < 0.35 ? "Moderate" : "High";
  const retainedPct = result.originalCount > 0 ? (result.processedCount / result.originalCount * 100).toFixed(1) : "100";

  function downloadReport() {
    if (!result.report) return;
    const blob = new Blob([result.report], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.technique.replace(/\s+/g, "_")}_report.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {result.compliancePassed !== undefined && result.compliancePassed !== null && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
          result.compliancePassed
            ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30"
        }`}>
          <CheckCircle className={`h-5 w-5 shrink-0 ${result.compliancePassed ? "text-emerald-600" : "text-rose-600"}`} />
          <div className="flex-1">
            <p className={`text-sm font-semibold ${result.compliancePassed ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
              Compliance: {result.compliancePassed ? "PASS" : "FAIL"}
            </p>
            <p className="text-xs text-muted-foreground">{result.technique} · {result.family}</p>
          </div>
          <Badge variant="outline" className={`text-xs font-bold ${result.compliancePassed ? "border-emerald-400 text-emerald-700 dark:text-emerald-400" : "border-rose-400 text-rose-700 dark:text-rose-400"}`}>
            {result.compliancePassed ? "✓ PASS" : "✗ FAIL"}
          </Badge>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Information Loss</p>
          <p className={`text-xl font-bold ${lossColor}`}>{(result.informationLoss * 100).toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">{lossLabel}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Records Retained</p>
          <p className="text-xl font-bold text-foreground">{retainedPct}%</p>
          <p className="text-xs text-muted-foreground">{result.processedCount} of {result.originalCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Suppressed</p>
          <p className="text-xl font-bold text-foreground">{result.recordsSuppressed}</p>
          <p className="text-xs text-muted-foreground">records removed</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Execution</p>
          <p className="text-xl font-bold text-foreground">{result.executionMs}ms</p>
          <p className="text-xs text-muted-foreground">{result.family}</p>
        </div>
      </div>

      {result.interpretation && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1 uppercase tracking-wide">Interpretation</p>
          <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">{result.interpretation}</p>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Algorithm Statistics</div>
        <div className="divide-y text-sm">
          {Object.entries(result.stats).map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
              <span className={`font-mono text-xs font-medium max-w-[60%] text-right break-all ${
                String(v) === "YES" ? "text-emerald-600 dark:text-emerald-400" :
                String(v) === "NO"  ? "text-rose-600 dark:text-rose-400" : ""
              }`}>{String(v)}</span>
            </div>
          ))}
        </div>
      </div>

      {result.colStats && Object.keys(result.colStats).length > 0 && (
        <div className="rounded-lg border overflow-hidden min-w-0">
          <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-Column Statistics</div>
          <div className="h-[200px] overflow-auto">
            <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-muted/20">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap bg-muted/20">Column</th>
                  {Object.values(result.colStats)[0] && Object.keys(Object.values(result.colStats)[0]).map((metric) => (
                    <th key={metric} className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap bg-muted/20">{metric}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.colStats).map(([col, metrics]) => (
                  <tr key={col} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap">{col}</td>
                    {Object.values(metrics).map((v, mi) => (
                      <td key={mi} className="px-3 py-1.5 font-mono text-right whitespace-nowrap">{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="space-y-2">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
            </div>
          ))}
        </div>
      )}

      {result.processedData.length > 0 && (
        <div className="rounded-lg border overflow-hidden min-w-0">
          <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            <span>Sample Output (first 5 records)</span>
            <Badge variant="outline" className="text-xs">{result.processedData.length} records</Badge>
          </div>
          <div className="h-[160px] overflow-auto">
            <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-background">
                  {Object.keys(result.processedData[0]).slice(0, 8).map((col) => (
                    <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap bg-background">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.processedData.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                    {Object.keys(result.processedData[0]).slice(0, 8).map((col) => (
                      <td key={col} className="px-3 py-1.5 font-mono whitespace-nowrap">{String(row[col] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline" className="flex-1"
          onClick={() => downloadCSV(result.processedData, `${result.technique.replace(/\s+/g, "_")}_output.csv`)}
          disabled={result.processedData.length === 0}
          data-testid="button-download-result"
        >
          <Download className="mr-2 h-4 w-4" />
          Download CSV ({result.processedData.length} records)
        </Button>
        {result.report && (
          <Button variant="outline" className="flex-1" onClick={downloadReport} data-testid="button-download-report">
            <ChevronRight className="mr-2 h-4 w-4" />
            Download Report (HTML)
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Formula box ──────────────────────────────────────────────────────────────
function FormulaBox({ id }: { id: string }) {
  const f = FORMULAS[id];
  if (!f) return null;
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-1">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-blue-500 shrink-0" />
        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">{f.title}</p>
      </div>
      <code className="block text-xs font-mono bg-blue-100 dark:bg-blue-900/40 rounded px-2 py-1 text-blue-800 dark:text-blue-300">
        {f.latex}
      </code>
      <p className="text-xs text-blue-700 dark:text-blue-400">{f.desc}</p>
    </div>
  );
}

// ─── Attack mitigation badge ──────────────────────────────────────────────────
function MitigationBadge({ level }: { level: MitigationLevel }) {
  const styles: Record<MitigationLevel, string> = {
    Stops:   "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    Partial: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    Fails:   "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    "N/A":   "bg-muted text-muted-foreground",
  };
  return <span className={`inline-block text-xs font-medium border rounded px-1.5 py-0.5 ${styles[level]}`}>{level}</span>;
}

// ─── Technique selector list ──────────────────────────────────────────────────
function TechList({ items, selected, onSelect }: {
  items: { id: string; label: string; subtitle: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      {items.map((tech) => (
        <div
          key={tech.id}
          className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
            selected === tech.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50 border border-transparent"
          }`}
          onClick={() => onSelect(tech.id)}
          data-testid={`technique-${tech.id}`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{tech.label}</p>
            <p className="text-xs text-muted-foreground truncate">{tech.subtitle}</p>
          </div>
          {selected === tech.id && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
        </div>
      ))}
    </div>
  );
}

// ─── Helper: Slider field with optional auto-suggest badge ────────────────────
function SliderField({ label, value, onChange, min, max, step, format, helpText, suggested }: {
  label: string; value: number[]; onChange: (v: number[]) => void;
  min: number; max: number; step: number;
  format: (v: number) => string; helpText?: string;
  suggested?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <div className="flex items-center gap-1.5">
          {suggested && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
              ⚡ {suggested}
            </span>
          )}
          <Badge variant="outline" className="font-mono text-xs">{format(value[0])}</Badge>
        </div>
      </div>
      <Slider value={value} onValueChange={onChange} min={min} max={max} step={step} />
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}

// ─── Helper: Run button ───────────────────────────────────────────────────────
function RunButton({ running, onRun, disabled }: { running: boolean; onRun: () => void; disabled: boolean }) {
  return (
    <Button className="w-full" onClick={onRun} disabled={running || disabled} data-testid="button-apply-privacy">
      {running ? (
        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
      ) : (
        <><Play className="mr-2 h-4 w-4" />Apply Technique</>
      )}
    </Button>
  );
}

// ─── Helper: Seed input ───────────────────────────────────────────────────────
function SeedInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">Random Seed</Label>
      <input
        type="number" min={0} max={9999} step={1}
        className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(9999, parseInt(e.target.value) || 0)))}
        data-testid="input-random-seed"
      />
      <p className="text-xs text-muted-foreground">Range 0–9999. Same seed → reproducible result.</p>
    </div>
  );
}

// ─── Pre-flight check item ────────────────────────────────────────────────────
type CheckStatus = "pass" | "warn" | "fail";
interface PreFlightCheck { label: string; status: CheckStatus; message: string }

function PreFlightPanel({ checks }: { checks: PreFlightCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        <Zap className="h-3.5 w-3.5" />
        Pre-Flight Check
      </div>
      <div className="divide-y">
        {checks.map((c, i) => (
          <div key={i} className={`flex items-start gap-2 px-3 py-2 text-xs ${
            c.status === "pass" ? "bg-emerald-50/50 dark:bg-emerald-950/10" :
            c.status === "warn" ? "bg-amber-50/50 dark:bg-amber-950/10" :
            "bg-rose-50/50 dark:bg-rose-950/10"
          }`}>
            <span className="shrink-0 mt-0.5">
              {c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️" : "❌"}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`font-medium ${
                c.status === "pass" ? "text-emerald-700 dark:text-emerald-400" :
                c.status === "warn" ? "text-amber-700 dark:text-amber-400" :
                "text-rose-700 dark:text-rose-400"
              }`}>{c.label}</p>
              {c.message && <p className="text-muted-foreground mt-0.5">{c.message}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helper: Add Generalisation column row ────────────────────────────────────
function AddGenColRow({
  allCols, existing, onAdd,
}: {
  allCols: string[];
  existing: string[];
  onAdd: (cfg: GeneralisationColConfig) => void;
}) {
  const [col,      setCol]      = useState("");
  const [type,     setType]     = useState<"bin"|"round"|"topk">("bin");
  const [binWidth, setBinWidth] = useState("");
  const [roundTo,  setRoundTo]  = useState("");
  const [topK,     setTopK]     = useState("10");
  const available = allCols.filter((c) => !existing.includes(c));

  function handleAdd() {
    if (!col) return;
    const cfg: GeneralisationColConfig = { col, type };
    if (type === "bin"   && binWidth) cfg.binWidth = parseFloat(binWidth);
    if (type === "round" && roundTo)  cfg.roundTo  = parseFloat(roundTo);
    if (type === "topk"  && topK)     cfg.topK     = parseInt(topK);
    onAdd(cfg);
    setCol("");
  }

  if (available.length === 0) return <p className="text-xs text-muted-foreground italic">All columns already configured.</p>;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Column</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Column</Label>
          <Select value={col} onValueChange={setCol}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-gen-col"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>{available.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-gen-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bin">Bin (numeric)</SelectItem>
              <SelectItem value="round">Round (numeric)</SelectItem>
              <SelectItem value="topk">Top-K (categorical)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {type === "bin" && (
        <div className="space-y-1">
          <Label className="text-xs">Bin Width (blank = auto)</Label>
          <input className="w-full rounded-md border bg-background px-3 py-1 text-xs font-mono" type="number" min="0.001" step="any" placeholder="auto (Sturges rule)" value={binWidth} onChange={(e) => setBinWidth(e.target.value)} data-testid="input-gen-bin-width" />
        </div>
      )}
      {type === "round" && (
        <div className="space-y-1">
          <Label className="text-xs">Round To (nearest)</Label>
          <input className="w-full rounded-md border bg-background px-3 py-1 text-xs font-mono" type="number" min="1" step="any" placeholder="10" value={roundTo} onChange={(e) => setRoundTo(e.target.value)} data-testid="input-gen-round-to" />
        </div>
      )}
      {type === "topk" && (
        <div className="space-y-1">
          <Label className="text-xs">Top-K (keep most frequent K values)</Label>
          <input className="w-full rounded-md border bg-background px-3 py-1 text-xs font-mono" type="number" min="1" step="1" placeholder="10" value={topK} onChange={(e) => setTopK(e.target.value)} data-testid="input-gen-top-k" />
        </div>
      )}
      <Button size="sm" className="w-full h-7 text-xs" onClick={handleAdd} disabled={!col} data-testid="button-add-gen-col">
        + Add Column
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function PrivacyPage() {
  const { toast } = useToast();

  // ── Dataset selection ──────────────────────────────────────────────────────
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [quasiIdentifiers, setQuasiIdentifiers] = useState<string[]>([]);
  const [sensitiveAttr,    setSensitiveAttr]    = useState<string>("");
  const [targetCols,       setTargetCols]       = useState<string[]>([]);

  const { data: datasets }  = useQuery<Dataset[]>({ queryKey: ["/api/datasets"] });
  const { data: datasetFull } = useQuery<{ data: DataRow[] }>({
    queryKey: ["/api/data", selectedDataset],
    enabled: !!selectedDataset,
  });
  const { data: operations } = useQuery<PrivacyOperation[]>({
    queryKey: ["/api/privacy/operations"],
    refetchInterval: false,
  });
  const rawData: DataRow[] = (datasetFull?.data as DataRow[]) ?? [];
  const selectedDS = datasets?.find((d) => d.id.toString() === selectedDataset);
  const allCols    = selectedDS?.columns ?? [];

  // ── UI state ───────────────────────────────────────────────────────────────
  const [family,     setFamily]     = useState<FamilyId>("sdc");
  const [sdcTech,    setSdcTech]    = useState("k-anonymity");
  const [dpTech,     setDpTech]     = useState("laplace");
  const [sdgTech,    setSdgTech]    = useState("stat-sdg");
  const [cryptoTech, setCryptoTech] = useState("he");
  const [fedTech]                   = useState("fedavg");

  // ── Results ────────────────────────────────────────────────────────────────
  const [result,  setResult]  = useState<PrivacyResult | null>(null);
  const [running, setRunning] = useState(false);

  // ── SDC parameters ─────────────────────────────────────────────────────────
  const [kVal,         setKVal]         = useState([5]);
  const [suppLimit,    setSuppLimit]    = useState([5]);
  const [genMethod,    setGenMethod]    = useState<"midpoint"|"range">("range");
  const [lVal,         setLVal]         = useState([3]);
  const [lMethod,      setLMethod]      = useState<"entropy"|"distinct"|"recursive">("entropy");
  const [lKBase,       setLKBase]       = useState([3]);
  const [cRecursive,   setCRecursive]   = useState([0.5]);
  const [tVal,         setTVal]         = useState([0.3]);
  const [tKBase,       setTKBase]       = useState([3]);
  const [tDistMetric,  setTDistMetric]  = useState<"emd" | "tvd">("emd");
  const [swapFrac,     setSwapFrac]     = useState([0.1]);
  const [swapSeed,     setSwapSeed]     = useState(42);
  const [microK,       setMicroK]       = useState([5]);
  const [microDist,    setMicroDist]    = useState<"euclidean"|"manhattan">("euclidean");
  const [pramRetention,setPramRetention]= useState([0.7]);
  const [pramVariant,  setPramVariant]  = useState<"simple"|"unbiased">("simple");
  const [pramSeed,     setPramSeed]     = useState(42);
  const [topPct,       setTopPct]       = useState([95]);
  const [botPct,       setBotPct]       = useState([5]);
  const [addNoise,     setAddNoise]     = useState(false);
  const [noiseLevel,   setNoiseLevel]   = useState([0.1]);

  // ── Noise Addition ─────────────────────────────────────────────────────────
  const [noiseDist,    setNoiseDist]    = useState<"gaussian"|"laplace"|"uniform">("gaussian");
  const [noiseLambda,  setNoiseLambda]  = useState([0.1]);
  const [noiseClip,    setNoiseClip]    = useState(true);
  const [noiseSeed,    setNoiseSeed]    = useState(42);

  // ── Explicit Suppression ───────────────────────────────────────────────────
  const [suppMode,       setSuppMode]       = useState<"row"|"cell"|"both">("row");
  const [suppCriterion,  setSuppCriterion]  = useState<"uniqueness"|"outlier"|"sensitive_value"|"threshold">("uniqueness");
  const [suppBudget,     setSuppBudget]     = useState([10]);
  const [suppMinGroup,   setSuppMinGroup]   = useState([2]);
  const [suppZThreshold, setSuppZThreshold] = useState([3.0]);
  const [suppSACol,      setSuppSACol]      = useState("");
  const [suppRiskVals,   setSuppRiskVals]   = useState("");
  const [suppLower,      setSuppLower]      = useState("");
  const [suppUpper,      setSuppUpper]      = useState("");
  const [suppMinCellFreq,setSuppMinCellFreq]= useState([3]);

  // ── Generalisation ─────────────────────────────────────────────────────────
  const [genColConfigs, setGenColConfigs] = useState<GeneralisationColConfig[]>([]);

  // ── Data Shuffling ─────────────────────────────────────────────────────────
  const [shuffleVariant,   setShuffleVariant]   = useState<"full"|"within_group"|"rank_preserving">("full");
  const [shuffleGroupCol,  setShuffleGroupCol]  = useState("");
  const [shuffleRankDelta, setShuffleRankDelta] = useState([0.1]);
  const [shuffleSeed,      setShuffleSeed]      = useState(42);

  // ── Cell Suppression ───────────────────────────────────────────────────────
  const [csRowCol,    setCsRowCol]    = useState("");
  const [csColCol,    setCsColCol]    = useState("");
  const [csValCol,    setCsValCol]    = useState("");
  const [csAggregate, setCsAggregate] = useState<"count"|"sum"|"mean">("count");
  const [csNMin,      setCsNMin]      = useState([3]);
  const [csPPct,      setCsPPct]      = useState([70]);
  const [csKDom,      setCsKDom]      = useState([2]);
  const [csSecondary, setCsSecondary] = useState(true);

  // ── DP parameters ──────────────────────────────────────────────────────────
  const [epsilon,           setEpsilon]           = useState([1.0]);
  const [delta,             setDelta]             = useState([1e-5]);
  const [dpSensitivityMode, setDpSensitivityMode] = useState<SensitivityMode>("iqr");
  const [dpPostClamp,       setDpPostClamp]       = useState(true);
  const [dpSeedEnabled,     setDpSeedEnabled]     = useState(false);
  const [dpSeed,            setDpSeed]            = useState(42);
  const [dpBudgetMode,      setDpBudgetMode]      = useState<"global"|"equal"|"proportional">("global");
  const [dpCompositionMode, setDpCompositionMode] = useState<"basic"|"advanced"|"renyi">("advanced");
  const [dpProtectCategorical, setDpProtectCategorical] = useState(true);

  // ── SDG parameters ─────────────────────────────────────────────────────────
  const [synthSize,         setSynthSize]         = useState([100]);
  const [preserveCorr,      setPreserveCorr]      = useState(true);
  const [synthBandwidthRule, setSynthBandwidthRule] = useState<"silverman"|"scott"|"fixed">("silverman");
  const [synthSeedEnabled,  setSynthSeedEnabled]  = useState(false);
  const [synthSeed,         setSynthSeed]          = useState(42);
  const [dpSgdClip,         setDpSgdClip]         = useState([1.0]);
  const [dpSgdEpochs,       setDpSgdEpochs]       = useState(300);
  const [dpSgdBatchSize,    setDpSgdBatchSize]     = useState(500);

  // ── Crypto parameters ──────────────────────────────────────────────────────
  const [heKeySize,     setHeKeySize]     = useState("1024");
  const [smpcShares,    setSmpcShares]    = useState([3]);
  const [smpcThreshold, setSmpcThreshold] = useState([2]);

  // ── Federated parameters ───────────────────────────────────────────────────
  const [fedNodes,       setFedNodes]       = useState([3]);
  const [fedRounds,      setFedRounds]      = useState([10]);
  const [fedDP,          setFedDP]          = useState(false);
  const [fedEps,         setFedEps]         = useState([2.0]);
  const [fedGenSynth,    setFedGenSynth]    = useState(true);
  const [fedLocalEpochs, setFedLocalEpochs] = useState([5]);
  const [fedLocalLR,     setFedLocalLR]     = useState([0.01]);
  const [fedBatchSize,   setFedBatchSize]   = useState([4]);
  const [fedPartition,   setFedPartition]   = useState<"iid" | "noniid">("iid");
  const [fedDelta,       setFedDelta]       = useState([1e-5]);
  const [fedClipNorm,    setFedClipNorm]    = useState([1.0]);
  const [fedSynthSize,   setFedSynthSize]   = useState([100]);
  const [fedSeed,        setFedSeed]        = useState(42);

  // ── Auto-assist state ──────────────────────────────────────────────────────
  const [autoSuggestions, setAutoSuggestions] = useState<AutoSuggest>({});
  const [autoAssistMsg,   setAutoAssistMsg]   = useState<string>("");
  const autoAssistDoneRef = useRef<string>("");  // "techId:dataLen"

  // ── Column profiles ────────────────────────────────────────────────────────
  const colProfiles = useMemo<Record<string, ColProfile>>(() => {
    if (rawData.length === 0 || allCols.length === 0) return {};
    const N = rawData.length;
    const profiles: Record<string, ColProfile> = {};
    for (const col of allCols) {
      const vals = rawData.map((r) => r[col]);
      // Bug 1 fix: use Number() not parseFloat() — parseFloat("21.5 acres") = 21.5 (wrong!),
      // Number("21.5 acres") = NaN (correct). This prevents mixed-unit strings like
      // "21.5 acres" from being classified as numeric columns.
      const numVals = vals.map((v) => { const s = String(v ?? "").trim(); return s === "" ? NaN : Number(s); }).filter((v) => !isNaN(v));
      const isNum   = numVals.length > 0.7 * N;
      const strVals = vals.map((v) => String(v ?? ""));
      const uniq    = new Set(strVals);
      const uniqueCount = uniq.size;
      const freq    = new Map<string, number>();
      strVals.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
      let entropy = 0;
      freq.forEach((cnt) => { const p = cnt / N; if (p > 0) entropy -= p * Math.log2(p); });
      const colLower = col.toLowerCase();
      let classification: ColClass;
      if (uniqueCount > 0.8 * N || /\b(id|serial|no|number|code)\b/i.test(colLower)) {
        classification = "DIRECT_ID";
      } else if (uniqueCount < 2) {
        classification = "IGNORE";
      } else if (/income|salary|wage|earning|expenditure|health|disease|illness|medical|diagnosis|sensitive|religion|caste|disability/i.test(colLower)) {
        classification = "SENSITIVE";
      } else {
        classification = "QUASI_ID";
      }
      profiles[col] = { isNum, uniqueCount, entropy, classification };
    }
    return profiles;
  }, [rawData, allCols]);

  // ── DP Column Preview — per-column Δf, noise scale, risk color ───────────────
  const dpColumnPreview = useMemo(() => {
    if (rawData.length === 0 || allCols.length === 0) return { numCols: [] as { col: string; sensitivity: number; noiseScale: number; meanVal: number; ratio: number; risk: "high"|"med"|"low" }[], catCols: [] as { col: string; uniqueCount: number; entropy: number }[] };
    const eps = epsilon[0];
    const numCols = allCols.filter((c) => colProfiles[c]?.isNum).map((c) => {
      const vals = rawData.map((r) => { const n = Number(r[c]); return isNaN(n) ? null : n; }).filter((v): v is number => v !== null);
      if (vals.length === 0) return { col: c, sensitivity: 0, noiseScale: 0, meanVal: 0, ratio: 0, risk: "low" as const };
      const sorted = [...vals].sort((a, b) => a - b);
      const n = sorted.length;
      let lo: number, hi: number;
      const rawRange = sorted[n - 1] - sorted[0];
      const useIQR = dpSensitivityMode === "iqr" || (dpSensitivityMode === "auto" && rawRange > 100000);
      if (useIQR) {
        const q1 = sorted[Math.floor(n * 0.25)]; const q3 = sorted[Math.floor(n * 0.75)];
        const iqr = q3 - q1; lo = q1 - 1.5 * iqr; hi = q3 + 1.5 * iqr;
      } else if (dpSensitivityMode === "percentile") {
        lo = sorted[Math.max(0, Math.floor(n * 0.01))]; hi = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
      } else { lo = sorted[0]; hi = sorted[n - 1]; }
      const sensitivity = Math.max(hi - lo, 1e-9);
      const noiseScale = sensitivity / Math.max(eps, 0.01);
      const meanVal = vals.reduce((s, v) => s + v, 0) / vals.length;
      const ratio = Math.abs(meanVal) > 1e-9 ? noiseScale / Math.abs(meanVal) : (noiseScale > 0 ? Infinity : 0);
      const risk: "high"|"med"|"low" = ratio > 10 ? "high" : ratio > 1 ? "med" : "low";
      return { col: c, sensitivity, noiseScale, meanVal, ratio, risk };
    });
    const catCols = allCols.filter((c) => !colProfiles[c]?.isNum).map((c) => ({
      col: c, uniqueCount: colProfiles[c]?.uniqueCount ?? 0, entropy: colProfiles[c]?.entropy ?? 0,
    }));
    return { numCols, catCols };
  }, [rawData, allCols, colProfiles, dpSensitivityMode, epsilon]);

  // ── Auto-assist effect — runs when technique or data changes ────────────────
  useEffect(() => {
    const key = `${sdcTech}:${rawData.length}`;
    if (autoAssistDoneRef.current === key || rawData.length === 0 || allCols.length === 0 || Object.keys(colProfiles).length === 0) return;
    autoAssistDoneRef.current = key;

    const cfg = TECHNIQUE_CONFIG[sdcTech];
    if (!cfg) return;
    const N = rawData.length;

    const newSuggest: AutoSuggest = {};
    const reasons: string[] = [];

    // ── Auto-select QI
    if (cfg.qi === true) {
      const qiCols = allCols.filter((c) => colProfiles[c]?.classification === "QUASI_ID");
      if (qiCols.length > 0) { setQuasiIdentifiers(qiCols); }
    }

    // ── Auto-select SA
    if (cfg.sa === true) {
      const sensitiveCols = allCols.filter((c) => colProfiles[c]?.classification === "SENSITIVE");
      if (sensitiveCols.length > 0) {
        const best = sensitiveCols.reduce((a, b) =>
          (colProfiles[a]?.entropy ?? 0) >= (colProfiles[b]?.entropy ?? 0) ? a : b
        );
        setSensitiveAttr(best);
      }
    }

    // ── Auto-select target cols
    if (cfg.tc === true) {
      let tcCols: string[] = [];
      if (cfg.tcFilter === "numeric") {
        tcCols = allCols.filter((c) => colProfiles[c]?.isNum && (colProfiles[c]?.uniqueCount ?? 0) > 5 && colProfiles[c]?.classification !== "DIRECT_ID");
      } else if (cfg.tcFilter === "categorical") {
        tcCols = allCols.filter((c) => !colProfiles[c]?.isNum && (colProfiles[c]?.uniqueCount ?? 0) >= 2 && (colProfiles[c]?.uniqueCount ?? 0) <= 50 && colProfiles[c]?.classification !== "DIRECT_ID");
      } else if (cfg.tcFilter === "any") {
        const sens = allCols.filter((c) => colProfiles[c]?.classification === "SENSITIVE");
        const qi   = allCols.filter((c) => colProfiles[c]?.classification === "QUASI_ID");
        tcCols = sens.length > 0 ? sens : qi;
      }
      if (tcCols.length > 0) setTargetCols(tcCols);
    }

    // ── Suggest parameters
    if (sdcTech === "k-anonymity") {
      const qiCols = allCols.filter((c) => colProfiles[c]?.classification === "QUASI_ID");
      if (qiCols.length > 0) {
        const suggestedK = Math.max(2, Math.min(10, Math.round(Math.sqrt(N / 10))));
        const pctUnique = allCols.filter((c) => (colProfiles[c]?.uniqueCount ?? 0) > 0.5 * N).length;
        const suppLimitSug = pctUnique > 0.5 * allCols.length ? 15 : 5;
        setKVal([suggestedK]);
        setSuppLimit([suppLimitSug]);
        newSuggest.k = suggestedK;
        newSuggest.suppLimit = suppLimitSug;
        reasons.push(`k=${suggestedK} (≈√(N/10)), suppression limit=${suppLimitSug}%`);
      }
    } else if (sdcTech === "l-diversity") {
      const sugK = Math.max(2, Math.min(10, Math.round(Math.sqrt(N / 10))));
      const sugL = Math.max(2, Math.min(5, Math.floor(sugK / 2)));
      setLVal([sugL]); setLKBase([sugK]);
      newSuggest.l = sugL; newSuggest.k = sugK;
      reasons.push(`l=${sugL} (≈k/2), k=${sugK}`);
    } else if (sdcTech === "t-closeness") {
      const sugT = 0.30;
      const sugK = Math.max(2, Math.min(10, Math.round(Math.sqrt(N / 10))));
      setTVal([sugT]); setTKBase([sugK]);
      newSuggest.t = sugT; newSuggest.k = sugK;
      reasons.push(`t=0.30 (standard), k=${sugK}`);
    } else if (sdcTech === "rank-swapping") {
      const sugFrac = N < 100 ? 0.20 : N < 500 ? 0.15 : 0.10;
      setSwapFrac([sugFrac]);
      newSuggest.swapFrac = sugFrac;
      reasons.push(`swap ${(sugFrac * 100).toFixed(0)}% (p=${Math.round(sugFrac * N)} records)`);
    } else if (sdcTech === "microagg") {
      const sugK = Math.max(3, Math.min(20, Math.round(Math.sqrt(N / 10))));
      setMicroK([sugK]);
      newSuggest.microK = sugK;
      reasons.push(`cluster k=${sugK} (≈√(N/10))`);
    } else if (sdcTech === "pram") {
      const catCols = allCols.filter((c) => !colProfiles[c]?.isNum && (colProfiles[c]?.uniqueCount ?? 0) <= 50);
      const avgCats = catCols.length > 0
        ? catCols.reduce((s, c) => s + (colProfiles[c]?.uniqueCount ?? 2), 0) / catCols.length
        : 4;
      const sugRet = Math.max(0.50, Math.min(0.90, 1 - 1 / Math.max(2, avgCats)));
      setPramRetention([parseFloat(sugRet.toFixed(2))]);
      newSuggest.pramRet = sugRet;
      reasons.push(`retention=${sugRet.toFixed(2)} (based on avg ${avgCats.toFixed(1)} categories)`);
    } else if (sdcTech === "noise-addition") {
      const numCols = allCols.filter((c) => colProfiles[c]?.isNum);
      if (numCols.length > 0) {
        const avgCV = numCols.reduce((s, c) => {
          const vals = rawData.map((r) => parseFloat(String(r[c] ?? ""))).filter((v) => !isNaN(v));
          const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
          const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1));
          return s + (mean !== 0 ? std / Math.abs(mean) : 0.5);
        }, 0) / numCols.length;
        const sugLambda = Math.max(0.05, Math.min(0.30, avgCV * 0.2));
        setNoiseLambda([parseFloat(sugLambda.toFixed(2))]);
        newSuggest.noiseLambda = sugLambda;
        reasons.push(`λ=${sugLambda.toFixed(2)} (0.2 × avg CV)`);
      }
    }

    if (reasons.length > 0) {
      newSuggest.reason = reasons.join(" · ");
      setAutoSuggestions(newSuggest);
      setAutoAssistMsg(`Auto-suggested: ${reasons.join(" · ")}`);
    } else {
      setAutoSuggestions({});
      setAutoAssistMsg("");
    }
  }, [sdcTech, rawData.length, colProfiles]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived column lists ───────────────────────────────────────────────────
  const numericCols     = allCols.filter((c) => colProfiles[c]?.isNum     && colProfiles[c]?.classification !== "DIRECT_ID");
  const categoricalCols = allCols.filter((c) => !colProfiles[c]?.isNum    && (colProfiles[c]?.uniqueCount ?? 0) >= 2 && (colProfiles[c]?.uniqueCount ?? 0) <= 50 && colProfiles[c]?.classification !== "DIRECT_ID");
  const nonIdCols       = allCols.filter((c) => colProfiles[c]?.classification !== "DIRECT_ID");

  // ── Column toggles ─────────────────────────────────────────────────────────
  const toggleQI     = (col: string) => setQuasiIdentifiers((p) => p.includes(col) ? p.filter((c) => c !== col) : [...p, col]);
  const toggleTarget = (col: string) => setTargetCols((p) => p.includes(col) ? p.filter((c) => c !== col) : [...p, col]);

  // ── On dataset change ──────────────────────────────────────────────────────
  const handleDatasetChange = (id: string) => {
    setSelectedDataset(id);
    setQuasiIdentifiers([]);
    setSensitiveAttr("");
    setTargetCols([]);
    setResult(null);
    autoAssistDoneRef.current = "";
    setAutoAssistMsg("");
    setAutoSuggestions({});
  };

  // ── Derived: which sections to show in left panel ──────────────────────────
  const tcfg = TECHNIQUE_CONFIG[sdcTech] ?? { qi: false, sa: false, tc: false, tcFilter: null };

  const showQI = family === "sdc"
    ? (tcfg.qi === true || (tcfg.qi === "cond" && suppCriterion === "uniqueness"))
    : false;

  const showSA = family === "sdc"
    ? (tcfg.sa === true || (tcfg.sa === "cond" && suppCriterion === "sensitive_value"))
    : false;

  const showTC_SDC = family === "sdc" && (
    tcfg.tc === true ||
    (tcfg.tc === "cond" && (suppCriterion === "outlier" || suppCriterion === "threshold"))
  );

  const showTC_other = family === "crypto";

  // Filtered target columns per technique
  const filteredTargetCols: string[] = (() => {
    const filter = tcfg.tcFilter;
    if (filter === "numeric")      return numericCols;
    if (filter === "categorical")  return categoricalCols;
    if (filter === "any")          return nonIdCols;
    if (filter === "cond") {
      if (suppCriterion === "outlier" || suppCriterion === "threshold") return numericCols;
      return [];
    }
    return allCols;
  })();

  // ── Pre-flight checks ──────────────────────────────────────────────────────
  const preFlightChecks = useMemo<PreFlightCheck[]>(() => {
    if (!selectedDS || rawData.length === 0 || family !== "sdc") return [];
    const N = rawData.length;
    const checks: PreFlightCheck[] = [];
    const cfg = TECHNIQUE_CONFIG[sdcTech];
    if (!cfg) return [];

    if (cfg.qi === true) {
      if (quasiIdentifiers.length === 0) {
        checks.push({ label: "QI columns selected", status: "fail", message: "Select at least one quasi-identifier." });
      } else {
        checks.push({ label: `QI columns selected (${quasiIdentifiers.length})`, status: "pass", message: quasiIdentifiers.slice(0, 3).join(", ") + (quasiIdentifiers.length > 3 ? "…" : "") });
      }
    }
    if (cfg.sa === true) {
      if (!sensitiveAttr) {
        checks.push({ label: "SA column selected", status: "fail", message: "Select a sensitive attribute." });
      } else {
        const nUniq = colProfiles[sensitiveAttr]?.uniqueCount ?? 0;
        checks.push({ label: `SA column: ${sensitiveAttr}`, status: "pass", message: `${nUniq} unique values` });
        const lReq = sdcTech === "l-diversity" ? lVal[0] : 0;
        if (lReq > 0 && nUniq < lReq) {
          checks.push({ label: `SA unique values ≥ l=${lReq}`, status: "fail", message: `SA has ${nUniq} unique values — reduce l to ${nUniq}.` });
        } else if (lReq > 0) {
          checks.push({ label: `SA unique values ≥ l=${lReq}`, status: "pass", message: `${nUniq} ≥ ${lReq} ✅` });
        }
      }
    }
    if (cfg.tc === true) {
      const activeTarget = targetCols.length > 0 ? targetCols : filteredTargetCols;
      if (activeTarget.length === 0) {
        checks.push({ label: "Target columns", status: "fail", message: "No suitable columns available for this technique." });
      } else {
        checks.push({ label: `Target columns (${activeTarget.length})`, status: "pass", message: activeTarget.slice(0, 3).join(", ") + (activeTarget.length > 3 ? "…" : "") });
      }
      // Bug 1 fix: warn about any explicitly-selected columns that are non-numeric
      // for techniques that require numeric input (rank-swapping, microagg, noise, top/bottom).
      if (cfg.tcFilter === "numeric" && targetCols.length > 0) {
        const nonNumSelected = targetCols.filter((c) => !colProfiles[c]?.isNum);
        nonNumSelected.forEach((c) => {
          const sampleVal = rawData[0] ? String(rawData[0][c] ?? "") : "?";
          checks.push({
            label: `"${c}" — will be SKIPPED`,
            status: "warn",
            message: `Non-numeric column (sample value: "${sampleVal}"). ${sdcTech === "rank-swapping" ? "Rank Swapping" : "This technique"} requires pure numeric values. Deselect it or convert to numbers.`,
          });
        });
      }
    }
    if (sdcTech === "generalisation" && genColConfigs.length === 0) {
      checks.push({ label: "Generalisation columns", status: "fail", message: "Add at least one column configuration." });
    }
    if (sdcTech === "cell-suppression" && (!csRowCol || !csColCol || !csValCol)) {
      checks.push({ label: "Cell suppression variables", status: "fail", message: "Select Row, Column, and Value variables." });
    }

    const k = sdcTech === "k-anonymity" ? kVal[0] : sdcTech === "l-diversity" ? lKBase[0] : sdcTech === "t-closeness" ? tKBase[0] : sdcTech === "microagg" ? microK[0] : 2;
    if (N < 2 * k) {
      checks.push({ label: `Dataset size ≥ 2k=${2 * k}`, status: "fail", message: `Only ${N} rows — need at least ${2 * k}.` });
    } else if (N < 5 * k) {
      checks.push({ label: `Dataset size (${N} rows)`, status: "warn", message: `Small for k=${k}. High suppression likely.` });
    } else {
      checks.push({ label: `Dataset size (${N} rows)`, status: "pass", message: `Sufficient for k=${k}.` });
    }
    return checks;
  }, [selectedDS, rawData.length, sdcTech, family, quasiIdentifiers, sensitiveAttr, targetCols, filteredTargetCols, genColConfigs, csRowCol, csColCol, csValCol, kVal, lVal, lKBase, tKBase, microK, colProfiles, suppCriterion]);

  // ── Run algorithm ──────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (rawData.length === 0) {
      toast({ title: "No data", description: "Select a dataset first.", variant: "destructive" });
      return;
    }
    const activeTech =
      family === "sdc"       ? sdcTech :
      family === "dp"        ? dpTech  :
      family === "synthetic" ? sdgTech :
      family === "crypto"    ? cryptoTech :
      fedTech;

    const needsQI = [...SDC_TECHNIQUES].find((t) => t.id === activeTech)?.needsQI;
    const needsSA = [...SDC_TECHNIQUES].find((t) => t.id === activeTech)?.needsSA;
    if (needsQI && quasiIdentifiers.length === 0) {
      toast({ title: "Select quasi-identifiers", description: "This technique requires at least one QI column.", variant: "destructive" });
      return;
    }
    if (needsSA && !sensitiveAttr) {
      toast({ title: "Select sensitive attribute", description: "This technique requires a sensitive attribute.", variant: "destructive" });
      return;
    }

    // Use filtered cols if nothing explicitly selected
    const cols = targetCols.length > 0 ? targetCols : (filteredTargetCols.length > 0 ? filteredTargetCols : allCols);

    setRunning(true); setResult(null);
    await new Promise((r) => setTimeout(r, 30));

    try {
      let res: PrivacyResult;

      if (family === "sdc") {
        switch (sdcTech) {
          case "k-anonymity": {
            const directIdCols = allCols.filter((c) => colProfiles[c]?.classification === "DIRECT_ID");
            res = applyKAnonymity(rawData, quasiIdentifiers, kVal[0], suppLimit[0] / 100, genMethod, directIdCols);
            break;
          }
          case "l-diversity":
            res = applyLDiversity(rawData, quasiIdentifiers, sensitiveAttr, lVal[0], lMethod, lKBase[0], cRecursive[0]);
            break;
          case "t-closeness":
            res = applyTCloseness(rawData, quasiIdentifiers, sensitiveAttr, tVal[0], tKBase[0], tDistMetric);
            break;
          case "rank-swapping":
            res = applyRankSwapping(rawData, cols, swapFrac[0]);
            break;
          case "microagg":
            res = applyMicroaggregation(rawData, cols, microK[0], microDist);
            break;
          case "pram":
            res = applyPRAM(rawData, cols, pramRetention[0], pramVariant);
            break;
          case "topbottom":
            res = applyTopBottomCoding(rawData, cols, topPct[0], botPct[0], addNoise, noiseLevel[0]);
            break;
          case "noise-addition":
            res = applyNoiseAddition(rawData, cols, noiseDist, noiseLambda[0], noiseClip);
            break;
          case "explicit-suppression":
            res = applyExplicitSuppression(rawData, suppMode, suppCriterion, {
              qiCols: quasiIdentifiers,
              minGroupSize: suppMinGroup[0],
              zThreshold: suppZThreshold[0],
              targetCols: cols,
              saCol: suppSACol,
              riskValues: suppRiskVals.split(",").map((s) => s.trim()).filter(Boolean),
              lowerBound: suppLower !== "" ? parseFloat(suppLower) : undefined,
              upperBound: suppUpper !== "" ? parseFloat(suppUpper) : undefined,
              minCellFrequency: suppMinCellFreq[0],
            }, suppBudget[0] / 100);
            break;
          case "generalisation":
            if (genColConfigs.length === 0) {
              toast({ title: "No columns configured", description: "Add at least one column configuration for Generalisation.", variant: "destructive" });
              setRunning(false); return;
            }
            res = applyGeneralisation(rawData, genColConfigs);
            break;
          case "data-shuffling":
            res = applyDataShuffling(rawData, cols, shuffleVariant, shuffleGroupCol || null, shuffleRankDelta[0]);
            break;
          case "cell-suppression":
            if (!csRowCol || !csColCol || !csValCol) {
              toast({ title: "Missing columns", description: "Select Row, Column, and Value columns for Cell Suppression.", variant: "destructive" });
              setRunning(false); return;
            }
            res = applyCellSuppression(rawData, csRowCol, csColCol, csValCol, csAggregate, csNMin[0], csPPct[0], csKDom[0], csSecondary);
            break;
          default:
            throw new Error("Unknown SDC technique");
        }
      } else if (family === "dp") {
        const dpOpts = { sensitivityMode: dpSensitivityMode, postClamp: dpPostClamp, seed: dpSeedEnabled ? dpSeed : null };
        switch (dpTech) {
          case "laplace":
            res = (dpProtectCategorical && dpColumnPreview.catCols.length > 0)
              ? applyMixed(rawData, epsilon[0], 0, "laplace", cols, dpOpts)
              : applyLaplace(rawData, epsilon[0], cols, dpOpts);
            break;
          case "gaussian":
            res = (dpProtectCategorical && dpColumnPreview.catCols.length > 0)
              ? applyMixed(rawData, epsilon[0], delta[0], "gaussian", cols, dpOpts)
              : applyGaussian(rawData, epsilon[0], delta[0], cols, dpOpts);
            break;
          case "exponential": res = applyExponential(rawData, epsilon[0], cols, dpOpts); break;
          default: throw new Error("Unknown DP technique");
        }
      } else if (family === "synthetic") {
        switch (sdgTech) {
          case "stat-sdg": res = applyStatisticalSDG(rawData, {
            targetSize: synthSize[0], preserveCorrelations: preserveCorr,
            bandwidthRule: synthBandwidthRule, seed: synthSeedEnabled ? synthSeed : null,
          }); break;
          case "dp-sdg": res = applyDPSDG(rawData, {
            targetSize: synthSize[0], epsilon: epsilon[0], delta: delta[0],
            clipNorm: dpSgdClip[0], epochs: dpSgdEpochs, batchSize: dpSgdBatchSize,
            seed: synthSeedEnabled ? synthSeed : null,
          }); break;
          default: throw new Error("Unknown SDG technique");
        }
      } else if (family === "crypto") {
        const activeCryptoCols = targetCols.length > 0 ? targetCols : numericCols;
        switch (cryptoTech) {
          case "he":   res = applyHomomorphicEncryption(rawData, activeCryptoCols, parseInt(heKeySize)); break;
          case "smpc": res = applySMPC(rawData, activeCryptoCols, smpcShares[0], smpcThreshold[0]); break;
          default: throw new Error("Unknown crypto technique");
        }
      } else {
        const flParams: FLParams = {
          nodes: fedNodes[0], rounds: fedRounds[0],
          localEpochs: fedLocalEpochs[0], localLR: fedLocalLR[0],
          batchSize: fedBatchSize[0], partition: fedPartition,
          dp: fedDP ? { epsilon: fedEps[0], delta: fedDelta[0], clipNorm: fedClipNorm[0] } : null,
          generateSynthetic: fedGenSynth, synthSize: fedSynthSize[0],
          seed: fedSeed,
        };
        res = applyFederatedLearning(rawData, flParams);
      }

      setResult(res!);
      toast({ title: `${res!.technique} complete`, description: `${res!.processedCount} records processed in ${res!.executionMs}ms.` });

      if (selectedDataset) {
        apiRequest("POST", "/api/privacy/save-result", {
          datasetId: selectedDataset,
          technique: res!.technique,
          method: family,
          parameters: { family, technique: activeTech, quasiIdentifiers, sensitiveAttr, k: kVal[0], suppressionLimit: suppLimit[0], l: lVal[0], lMethod, t: tVal[0], epsilon: epsilon[0], delta: delta[0] },
          processedData: res!.processedData.slice(0, 1000),
          recordsSuppressed: res!.recordsSuppressed,
          informationLoss: res!.informationLoss,
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/privacy/operations"] });
        }).catch(() => {});
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Processing failed.", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }, [family, sdcTech, dpTech, sdgTech, cryptoTech, fedTech, rawData, quasiIdentifiers, sensitiveAttr, targetCols, filteredTargetCols, allCols, numericCols, kVal, suppLimit, lVal, lMethod, lKBase, cRecursive, tVal, tKBase, swapFrac, microK, microDist, pramRetention, pramVariant, topPct, botPct, addNoise, noiseLevel, noiseDist, noiseLambda, noiseClip, suppMode, suppCriterion, suppBudget, suppMinGroup, suppZThreshold, suppSACol, suppRiskVals, suppLower, suppUpper, suppMinCellFreq, genColConfigs, shuffleVariant, shuffleGroupCol, shuffleRankDelta, csRowCol, csColCol, csValCol, csAggregate, csNMin, csPPct, csKDom, csSecondary, epsilon, delta, dpProtectCategorical, synthSize, preserveCorr, synthBandwidthRule, synthSeedEnabled, synthSeed, dpSgdClip, dpSgdEpochs, dpSgdBatchSize, heKeySize, smpcShares, smpcThreshold, fedNodes, fedRounds, fedDP, fedEps, fedGenSynth, fedLocalEpochs, fedLocalLR, fedBatchSize, fedPartition, fedDelta, fedClipNorm, fedSynthSize, fedSeed, selectedDataset, toast]);


  const poppins = { fontFamily: "'Poppins', sans-serif" };

  // ── Full-screen result view ─────────────────────────────────────────────────
  if (result) {
    return (
      <DashboardLayout fullHeight title="Privacy Enhancement" breadcrumbs={[{ label: "Privacy Enhancement" }]}>
        <div style={poppins} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="shrink-0 flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 px-6 py-3 bg-white dark:bg-slate-900">
            <button
              onClick={() => setResult(null)}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
              data-testid="button-back-to-config"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Configuration
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{result.technique}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <ResultCard result={result} />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Privacy Enhancement" breadcrumbs={[{ label: "Privacy Enhancement" }]}>
      <div style={poppins} className="flex min-h-[calc(100vh-120px)] -mx-6 -mt-2">

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div className="w-[300px] shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col overflow-y-auto">

          {/* Dataset */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Dataset</p>
            <Select value={selectedDataset} onValueChange={handleDatasetChange}>
              <SelectTrigger data-testid="select-dataset-privacy">
                <SelectValue placeholder="Choose a dataset…" />
              </SelectTrigger>
              <SelectContent>
                {datasets?.map((d) => (
                  <SelectItem key={d.id} value={d.id.toString()}>{d.originalName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedDS && (
              <div className="flex gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className="text-[11px]">{selectedDS.rowCount} rows</Badge>
                <Badge variant="outline" className="text-[11px]">{allCols.length} cols</Badge>
                {rawData.length === 0 && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</span>}
              </div>
            )}
          </div>

          {/* Privacy Family */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Privacy Family</p>
            <div className="space-y-0.5">
              {FAMILIES.map((f) => (
                <div
                  key={f.id}
                  onClick={() => { setFamily(f.id); setResult(null); }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    family === f.id
                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                  data-testid={`family-tab-${f.id}`}
                >
                  <f.icon className={`h-4 w-4 shrink-0 ${family === f.id ? "text-blue-600 dark:text-blue-400" : f.color}`} />
                  <span className="text-xs font-medium leading-snug">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Column Configuration — SDC family */}
          {selectedDS && family === "sdc" && (
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Column Configuration</p>
              {autoAssistMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 mb-3">
                  <Zap className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">{autoAssistMsg}</p>
                </div>
              )}

              {showQI && (
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide">Quasi-Identifiers (QI)</Label>
                    <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setQuasiIdentifiers([])} data-testid="button-uncheck-all-qi">Uncheck All</button>
                  </div>
                  <p className="text-xs text-muted-foreground">Auto-selected from column profiles.</p>
                  <ScrollArea className="h-[140px] rounded-md border p-2">
                    <div className="space-y-1">
                      {allCols.map((col) => {
                        const profile = colProfiles[col];
                        const cls = profile?.classification ?? "QUASI_ID";
                        const badge = cls === "DIRECT_ID" ? "🔴" : cls === "SENSITIVE" ? "🔵" : cls === "IGNORE" ? "⚪" : "🟡";
                        return (
                          <div key={col} className="flex items-center gap-2 py-0.5">
                            <Checkbox id={`qi-${col}`} checked={quasiIdentifiers.includes(col)} onCheckedChange={() => toggleQI(col)} data-testid={`checkbox-qi-${col}`} />
                            <label htmlFor={`qi-${col}`} className="text-xs cursor-pointer flex-1 truncate">{col}</label>
                            <span className="text-xs shrink-0" title={cls}>{badge}</span>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <p className="text-[10px] text-muted-foreground">🔴 Direct-ID  🟡 QI  🔵 Sensitive  ⚪ Ignore</p>
                </div>
              )}

              {showSA && (
                <div className="space-y-2 mb-4">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Sensitive Attribute (SA)</Label>
                  <p className="text-xs text-muted-foreground">Auto-selected highest-entropy sensitive column.</p>
                  <Select value={sensitiveAttr} onValueChange={setSensitiveAttr}>
                    <SelectTrigger data-testid="select-sa-col"><SelectValue placeholder="Select attribute…" /></SelectTrigger>
                    <SelectContent>
                      {allCols.map((col) => (
                        <SelectItem key={col} value={col}>{col}{colProfiles[col]?.classification === "SENSITIVE" ? " 🔵" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sensitiveAttr && colProfiles[sensitiveAttr] && (
                    <p className="text-xs text-muted-foreground">{colProfiles[sensitiveAttr].uniqueCount} unique values · entropy {colProfiles[sensitiveAttr].entropy.toFixed(2)} bits</p>
                  )}
                </div>
              )}

              {family === "sdc" && sdcTech === "explicit-suppression" && suppCriterion === "sensitive_value" && !showSA && (
                <div className="space-y-2 mb-4">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Sensitive Attribute Column</Label>
                  <Select value={suppSACol} onValueChange={setSuppSACol}>
                    <SelectTrigger data-testid="select-supp-sa-col"><SelectValue placeholder="Select column…" /></SelectTrigger>
                    <SelectContent>{allCols.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {showTC_SDC && filteredTargetCols.length > 0 && (
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide">
                      Target Columns
                      {tcfg.tcFilter === "numeric" && <span className="ml-1 font-normal text-muted-foreground">(numeric)</span>}
                      {tcfg.tcFilter === "categorical" && <span className="ml-1 font-normal text-muted-foreground">(categorical)</span>}
                    </Label>
                    <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setTargetCols([])} data-testid="button-uncheck-all-tc">All</button>
                  </div>
                  <p className="text-xs text-muted-foreground">All = none checked (applies to all eligible).</p>
                  <ScrollArea className="h-[140px] rounded-md border p-2">
                    <div className="space-y-1">
                      {filteredTargetCols.map((col) => {
                        const profile = colProfiles[col];
                        return (
                          <div key={col} className="flex items-center gap-2 py-0.5">
                            <Checkbox id={`tgt-${col}`} checked={targetCols.includes(col)} onCheckedChange={() => toggleTarget(col)} data-testid={`checkbox-target-${col}`} />
                            <label htmlFor={`tgt-${col}`} className="text-xs cursor-pointer flex-1 truncate">{col}</label>
                            {profile && <span className="text-[10px] text-muted-foreground shrink-0">{profile.uniqueCount}u</span>}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {family === "sdc" && sdcTech === "data-shuffling" && shuffleVariant === "within_group" && (
                <div className="space-y-2 mb-4">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Group Column</Label>
                  <Select value={shuffleGroupCol} onValueChange={setShuffleGroupCol}>
                    <SelectTrigger data-testid="select-shuffle-group-col"><SelectValue placeholder="Select grouping column…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None (full shuffle)</SelectItem>
                      {categoricalCols.map((c) => <SelectItem key={c} value={c}>{c} ({colProfiles[c]?.uniqueCount}u)</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {!showQI && !showSA && !showTC_SDC && sdcTech !== "data-shuffling" && sdcTech !== "generalisation" && sdcTech !== "cell-suppression" && (
                <p className="text-xs text-muted-foreground italic">Configure parameters on the right →</p>
              )}
              {sdcTech === "generalisation" && (
                <p className="text-xs text-muted-foreground italic">Generalisation is configured per-column on the right →</p>
              )}
              {sdcTech === "cell-suppression" && (
                <p className="text-xs text-muted-foreground italic">Select Row / Column / Value variables on the right →</p>
              )}
            </div>
          )}

          {/* Column config — Crypto family */}
          {selectedDS && family === "crypto" && showTC_other && (
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Columns to Encrypt / Share</p>
              <p className="text-xs text-muted-foreground mb-2">
                {cryptoTech === "he" ? "Paillier HE" : "Shamir SMPC"} operates on numeric columns only. All = none selected.
              </p>
              <ScrollArea className="h-[140px] rounded-md border p-2">
                <div className="space-y-1">
                  {numericCols.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic px-1">No numeric columns detected.</p>
                  ) : numericCols.map((col) => (
                    <div key={col} className="flex items-center gap-2 py-0.5">
                      <Checkbox id={`tgt2-${col}`} checked={targetCols.includes(col)} onCheckedChange={() => toggleTarget(col)} data-testid={`checkbox-target2-${col}`} />
                      <label htmlFor={`tgt2-${col}`} className="text-xs cursor-pointer flex-1 truncate">{col}</label>
                      <span className="text-[10px] text-muted-foreground shrink-0">{colProfiles[col]?.uniqueCount}u</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Recent operations */}
          {operations && operations.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Operations</p>
              <div className="space-y-1.5">
                {operations.slice(0, 5).map((op) => (
                  <div key={op.id} className="flex items-start justify-between rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-xs gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{op.technique}</p>
                      <p className="text-muted-foreground truncate text-[10px]">
                        {op.createdAt ? new Date(op.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] py-0 shrink-0 ${(op.informationLoss ?? 0) > 0.3 ? "border-rose-400 text-rose-600" : (op.informationLoss ?? 0) > 0.05 ? "border-amber-400 text-amber-600" : "border-emerald-400 text-emerald-600"}`}>
                      {((op.informationLoss ?? 0) * 100).toFixed(1)}% loss
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">

          {/* ══ ATTACK MITIGATION MATRIX ══════════════════════════════════════ */}
          {family === "matrix" && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Attack Mitigation Matrix</p>
                <p className="text-xs text-muted-foreground">NIST-aligned blueprint — 15 techniques × 10 attack types.</p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-xs border-collapse min-w-[900px]">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                      <th className="text-left px-3 py-2 font-semibold w-[180px]">Technique</th>
                      <th className="text-left px-2 py-2 font-semibold text-muted-foreground text-xs w-[80px]">Family</th>
                      {ATTACK_COLUMNS.map((col) => (
                        <th key={col.key} className="px-2 py-2 font-semibold text-center whitespace-nowrap">{col.short}</th>
                      ))}
                      <th className="px-2 py-2 font-semibold text-center whitespace-nowrap">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ATTACK_MATRIX.map((row) => {
                      const counts = countMitigations(row);
                      const score = counts.stops + counts.partial * 0.5;
                      return (
                        <tr key={row.technique} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-3 py-2 font-medium">{row.technique}</td>
                          <td className="px-2 py-2">
                            <Badge variant="outline" className="text-[10px] py-0">{row.family}</Badge>
                          </td>
                          {ATTACK_COLUMNS.map((col) => (
                            <td key={col.key} className="px-2 py-2 text-center">
                              <MitigationBadge level={row.attacks[col.key]} />
                            </td>
                          ))}
                          <td className="px-2 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(score / 10) * 100}%` }} />
                              </div>
                              <span className="text-[10px] font-mono">{score.toFixed(1)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {ATTACK_COLUMNS.map((col) => {
                  const stopsCount   = ATTACK_MATRIX.filter((r) => r.attacks[col.key] === "Stops").length;
                  const partialCount = ATTACK_MATRIX.filter((r) => r.attacks[col.key] === "Partial").length;
                  return (
                    <div key={col.key} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                      <p className="text-xs font-semibold truncate">{col.label}</p>
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{stopsCount}</p>
                      <p className="text-xs text-muted-foreground">{stopsCount} stop · {partialCount} partial</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══ FAMILY 1: SDC ═════════════════════════════════════════════════ */}
          {family === "sdc" && (
            <div className="flex gap-6">
              <div className="w-[185px] shrink-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Technique</p>
                <TechList items={SDC_TECHNIQUES} selected={sdcTech} onSelect={(id) => {
                  setSdcTech(id); setResult(null);
                  setTargetCols([]); setQuasiIdentifiers([]); setSensitiveAttr("");
                  autoAssistDoneRef.current = "";
                }} />
              </div>
              <div className="flex-1 min-w-0 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {SDC_TECHNIQUES.find((t) => t.id === sdcTech)?.label} Parameters
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{SDC_TECHNIQUES.find((t) => t.id === sdcTech)?.subtitle}</p>
                </div>
                <FormulaBox id={sdcTech} />

                {sdcTech === "k-anonymity" && (<>
                  <SliderField label="K Value" value={kVal} onChange={setKVal} min={2} max={25} step={1} format={(v) => String(v)}
                    helpText={`Each record hidden in a group of ≥ ${kVal[0]} identical QI tuples`}
                    suggested={autoSuggestions.k ? `Suggested ${autoSuggestions.k}` : undefined} />
                  <SliderField label="Suppression Limit" value={suppLimit} onChange={setSuppLimit} min={0} max={30} step={1} format={(v) => `${v}%`}
                    helpText="Maximum % of records to delete if they cannot form a group of size k"
                    suggested={autoSuggestions.suppLimit !== undefined ? `Suggested ${autoSuggestions.suppLimit}%` : undefined} />
                  <div className="space-y-2">
                    <Label className="text-sm">Generalisation Method</Label>
                    <RadioGroup value={genMethod} onValueChange={(v) => setGenMethod(v as "midpoint" | "range")} className="flex gap-4">
                      {[["midpoint","Midpoint"],["range","Range"]].map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`gm-${v}`} data-testid={`radio-genmethod-${v}`} />
                          <label htmlFor={`gm-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground">Midpoint: replace range with midpoint · Range: keep as [lo, hi] interval</p>
                  </div>
                </>)}

                {sdcTech === "l-diversity" && (<>
                  <SliderField label="l Value" value={lVal} onChange={setLVal} min={2} max={10} step={1} format={(v) => String(v)}
                    helpText={`Each QI group must have ≥ ${lVal[0]} diverse sensitive values`}
                    suggested={autoSuggestions.l ? `Suggested ${autoSuggestions.l}` : undefined} />
                  <SliderField label="Base K (min group size)" value={lKBase} onChange={setLKBase} min={2} max={20} step={1} format={(v) => String(v)}
                    suggested={autoSuggestions.k ? `Suggested ${autoSuggestions.k}` : undefined} />
                  <div className="space-y-2">
                    <Label className="text-sm">L-Diversity Variant</Label>
                    <RadioGroup value={lMethod} onValueChange={(v) => setLMethod(v as typeof lMethod)} className="space-y-1">
                      {([
                        ["entropy",   "Entropy  — H(SA|group) ≥ log(l)"],
                        ["distinct",  "Distinct  — ≥ l unique SA values per group"],
                        ["recursive", "Recursive  — top-SA value ≤ c · (sum of remaining)"],
                      ] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`lm-${v}`} data-testid={`radio-lmethod-${v}`} />
                          <label htmlFor={`lm-${v}`} className="text-xs cursor-pointer font-mono">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  {lMethod === "recursive" && (
                    <SliderField label="Recursive c (dominance bound)" value={cRecursive} onChange={setCRecursive} min={0.1} max={0.9} step={0.05} format={(v) => v.toFixed(2)}
                      helpText={`c=${cRecursive[0].toFixed(2)}: top SA value ≤ ${cRecursive[0].toFixed(2)} × sum of remaining SA values`} />
                  )}
                </>)}

                {sdcTech === "t-closeness" && (<>
                  <SliderField label="t Value" value={tVal} onChange={setTVal} min={0.05} max={0.5} step={0.01} format={(v) => v.toFixed(2)}
                    helpText={`SA distribution per group within t=${tVal[0].toFixed(2)} of overall distribution`}
                    suggested={autoSuggestions.t ? `Suggested ${autoSuggestions.t}` : undefined} />
                  <SliderField label="Base K" value={tKBase} onChange={setTKBase} min={2} max={20} step={1} format={(v) => String(v)}
                    suggested={autoSuggestions.k ? `Suggested ${autoSuggestions.k}` : undefined} />
                  <div className="space-y-2">
                    <Label className="text-sm">Distance Metric</Label>
                    <RadioGroup value={tDistMetric} onValueChange={(v) => setTDistMetric(v as "emd" | "tvd")} className="flex gap-4">
                      {([["emd","EMD (Earth Mover's Distance)"],["tvd","TVD (Total Variation Distance)"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`tdm-${v}`} />
                          <label htmlFor={`tdm-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </>)}

                {sdcTech === "rank-swapping" && (<>
                  <SliderField label="Swap Fraction" value={swapFrac} onChange={setSwapFrac} min={0.01} max={0.5} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`}
                    helpText={`Each value swaps within ±${Math.round(swapFrac[0] * (rawData.length || 100))} positions`}
                    suggested={autoSuggestions.swapFrac ? `Suggested ${(autoSuggestions.swapFrac * 100).toFixed(0)}%` : undefined} />
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Privacy guarantee</p>
                    <p>Values swapped between rank-neighbors only. Order statistics preserved within ±p×N positions.</p>
                    <p>· Marginal distributions preserved: ✅</p>
                  </div>
                  <SeedInput value={swapSeed} onChange={setSwapSeed} />
                </>)}

                {sdcTech === "microagg" && (<>
                  <SliderField label="Cluster Size (k)" value={microK} onChange={setMicroK} min={2} max={20} step={1} format={(v) => String(v)}
                    helpText="Minimum cluster size for MDAV. Values replaced with cluster centroid."
                    suggested={autoSuggestions.microK ? `Suggested ${autoSuggestions.microK}` : undefined} />
                  <div className="space-y-2">
                    <Label className="text-sm">Distance Metric</Label>
                    <RadioGroup value={microDist} onValueChange={(v) => setMicroDist(v as typeof microDist)} className="flex gap-4">
                      {([["euclidean","Euclidean (L2)"],["manhattan","Manhattan (L1)"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`md-${v}`} />
                          <label htmlFor={`md-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </>)}

                {sdcTech === "pram" && (<>
                  <SliderField label="Retention Probability" value={pramRetention} onChange={setPramRetention} min={0.1} max={0.99} step={0.01} format={(v) => v.toFixed(2)}
                    helpText={`P(keep original) = ${pramRetention[0].toFixed(2)}, P(perturb) = ${(1 - pramRetention[0]).toFixed(2)}`}
                    suggested={autoSuggestions.pramRet ? `Suggested ${autoSuggestions.pramRet.toFixed(2)}` : undefined} />
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    P(keep original) = {pramRetention[0].toFixed(2)} · P(perturb) = {(1 - pramRetention[0]).toFixed(2)}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">PRAM Variant</Label>
                    <RadioGroup value={pramVariant} onValueChange={(v) => setPramVariant(v as typeof pramVariant)} className="flex gap-4">
                      {([["simple","Simple PRAM"],["unbiased","Unbiased PRAM"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`pv-${v}`} />
                          <label htmlFor={`pv-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground">Unbiased: post-processing correction to restore marginal distributions</p>
                  </div>
                  <SeedInput value={pramSeed} onChange={setPramSeed} />
                </>)}

                {sdcTech === "topbottom" && (<>
                  <SliderField label="Top Percentile Cap" value={topPct} onChange={setTopPct} min={80} max={99} step={1} format={(v) => `${v}th`} helpText="Values above this percentile are capped" />
                  <SliderField label="Bottom Percentile Cap" value={botPct} onChange={setBotPct} min={1} max={20} step={1} format={(v) => `${v}th`} helpText="Values below this percentile are capped" />
                  {botPct[0] >= topPct[0] && (
                    <p className="text-xs text-rose-500">⚠ Bottom percentile must be less than top percentile.</p>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Add Gaussian Noise</Label>
                      <p className="text-xs text-muted-foreground">Inject N(0, λ²σ²) noise after coding</p>
                    </div>
                    <Switch checked={addNoise} onCheckedChange={setAddNoise} />
                  </div>
                  {addNoise && (
                    <SliderField label="Noise Level (λ)" value={noiseLevel} onChange={setNoiseLevel} min={0.01} max={0.5} step={0.01} format={(v) => v.toFixed(2)} helpText={`σ_noise = ${noiseLevel[0].toFixed(2)} × column_std`} />
                  )}
                </>)}

                {sdcTech === "noise-addition" && (<>
                  <div className="space-y-2">
                    <Label className="text-sm">Noise Distribution</Label>
                    <RadioGroup value={noiseDist} onValueChange={(v) => setNoiseDist(v as typeof noiseDist)} className="space-y-1">
                      {([["gaussian","Gaussian  N(0, σ²)  — smooth symmetric"],["laplace","Laplace  Lap(0, b)  — heavier tails, stronger DP"],["uniform","Uniform  U(−δ, +δ)  — bounded support"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`nd-${v}`} />
                          <label htmlFor={`nd-${v}`} className="text-xs cursor-pointer font-mono">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <SliderField label="Noise Multiplier (λ)" value={noiseLambda} onChange={setNoiseLambda} min={0.01} max={1.0} step={0.01} format={(v) => v.toFixed(2)}
                    helpText={`σ_noise = λ × col_std. SNR = 1/λ² = ${(1 / noiseLambda[0] ** 2).toFixed(1)}`}
                    suggested={autoSuggestions.noiseLambda ? `Suggested ${autoSuggestions.noiseLambda.toFixed(2)}` : undefined} />
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                    <p>Estimated MAE ≈ {(0.798 * noiseLambda[0]).toFixed(3)} × σ_col (Gaussian)</p>
                    <p>Compliance: Pearson r ≥ 0.85 and λ ≤ 0.5</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Clip to Column Range</Label>
                      <p className="text-xs text-muted-foreground">Clamp noisy values to [min, max] of original</p>
                    </div>
                    <Switch checked={noiseClip} onCheckedChange={setNoiseClip} />
                  </div>
                  <SeedInput value={noiseSeed} onChange={setNoiseSeed} />
                </>)}

                {sdcTech === "explicit-suppression" && (<>
                  <div className="space-y-2">
                    <Label className="text-sm">Suppression Mode</Label>
                    <RadioGroup value={suppMode} onValueChange={(v) => setSuppMode(v as typeof suppMode)} className="flex gap-4">
                      {([["row","Row"],["cell","Cell"],["both","Both"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`sm-${v}`} />
                          <label htmlFor={`sm-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Suppression Criterion</Label>
                    <RadioGroup value={suppCriterion} onValueChange={(v) => setSuppCriterion(v as typeof suppCriterion)} className="space-y-1">
                      {([
                        ["uniqueness","Uniqueness  — suppress if QI group size < min"],
                        ["outlier","Outlier  — suppress if |z-score| > threshold"],
                        ["sensitive_value","Sensitive Value  — suppress if SA ∈ risk list"],
                        ["threshold","Threshold  — suppress if value out of bounds"],
                      ] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`sc-${v}`} />
                          <label htmlFor={`sc-${v}`} className="text-xs cursor-pointer font-mono">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <SliderField label="Suppression Budget" value={suppBudget} onChange={setSuppBudget} min={1} max={50} step={1} format={(v) => `${v}%`} helpText={`Max ${suppBudget[0]}% of records may be suppressed.`} />
                  {suppCriterion === "uniqueness" && (
                    <SliderField label="Min Group Size" value={suppMinGroup} onChange={setSuppMinGroup} min={2} max={10} step={1} format={(v) => String(v)} helpText={`Suppress records whose QI group has < ${suppMinGroup[0]} members`} />
                  )}
                  {suppCriterion === "outlier" && (
                    <SliderField label="Z-Score Threshold" value={suppZThreshold} onChange={setSuppZThreshold} min={1.0} max={5.0} step={0.1} format={(v) => v.toFixed(1)} helpText={`Suppress records with |z| > ${suppZThreshold[0].toFixed(1)}`} />
                  )}
                  {suppCriterion === "sensitive_value" && (
                    <div className="space-y-2">
                      <Label className="text-sm">Risk Values (comma-separated)</Label>
                      <input
                        className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono"
                        placeholder="e.g. HIV, Cancer, Fraud"
                        value={suppRiskVals}
                        onChange={(e) => setSuppRiskVals(e.target.value)}
                        data-testid="input-risk-values"
                      />
                    </div>
                  )}
                  {suppCriterion === "threshold" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Lower Bound</Label>
                        <input className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono" type="number" placeholder="−∞" value={suppLower} onChange={(e) => setSuppLower(e.target.value)} data-testid="input-supp-lower" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Upper Bound</Label>
                        <input className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono" type="number" placeholder="+∞" value={suppUpper} onChange={(e) => setSuppUpper(e.target.value)} data-testid="input-supp-upper" />
                      </div>
                    </div>
                  )}
                </>)}

                {sdcTech === "generalisation" && (
                  <div className="space-y-3">
                    {genColConfigs.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No columns configured yet. Add one below.</p>
                    ) : (
                      <div className="rounded-lg border overflow-hidden">
                        <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configured Columns</div>
                        <div className="divide-y">
                          {genColConfigs.map((cfg, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                              <span className="font-medium">{cfg.col}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground font-mono">{cfg.type}{cfg.binWidth ? ` w=${cfg.binWidth}` : cfg.roundTo ? ` r=${cfg.roundTo}` : cfg.topK ? ` k=${cfg.topK}` : ""}</span>
                                <button className="text-rose-500 hover:text-rose-700 text-xs" onClick={() => setGenColConfigs((p) => p.filter((_, j) => j !== i))}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <AddGenColRow allCols={allCols} existing={genColConfigs.map((c) => c.col)} onAdd={(cfg) => setGenColConfigs((p) => [...p, cfg])} />
                  </div>
                )}

                {sdcTech === "data-shuffling" && (<>
                  <div className="space-y-2">
                    <Label className="text-sm">Shuffle Variant</Label>
                    <RadioGroup value={shuffleVariant} onValueChange={(v) => setShuffleVariant(v as typeof shuffleVariant)} className="space-y-1">
                      {([
                        ["full","Full Shuffle  — completely random permutation"],
                        ["within_group","Within-Group  — shuffle only within each group"],
                        ["rank_preserving","Rank-Preserving  — limit displacement by δ × N"],
                      ] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`sv-${v}`} />
                          <label htmlFor={`sv-${v}`} className="text-xs cursor-pointer font-mono">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  {shuffleVariant === "rank_preserving" && (
                    <SliderField label="Rank Delta (δ)" value={shuffleRankDelta} onChange={setShuffleRankDelta} min={0.01} max={0.5} step={0.01} format={(v) => v.toFixed(2)} helpText={`Max rank displacement = δ×N = ${Math.round(shuffleRankDelta[0] * (rawData.length || 100))} positions.`} />
                  )}
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Privacy guarantee</p>
                    <p>All marginal distributions are exactly preserved. QI↔SA linkage is broken.</p>
                  </div>
                  <SeedInput value={shuffleSeed} onChange={setShuffleSeed} />
                </>)}

                {sdcTech === "cell-suppression" && (<>
                  <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">Table Builder</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">Select row/column variables and an aggregate column to build the cross-tabulation.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Row Variable</Label>
                    <Select value={csRowCol} onValueChange={setCsRowCol}>
                      <SelectTrigger data-testid="select-cs-row-col"><SelectValue placeholder="Select column…" /></SelectTrigger>
                      <SelectContent>{allCols.filter((c) => c !== csColCol).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Column Variable</Label>
                    <Select value={csColCol} onValueChange={setCsColCol}>
                      <SelectTrigger data-testid="select-cs-col-col"><SelectValue placeholder="Select column…" /></SelectTrigger>
                      <SelectContent>{allCols.filter((c) => c !== csRowCol).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Value / Aggregate Column</Label>
                    <Select value={csValCol} onValueChange={setCsValCol}>
                      <SelectTrigger data-testid="select-cs-val-col"><SelectValue placeholder="Select column…" /></SelectTrigger>
                      <SelectContent>{allCols.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Aggregation</Label>
                    <RadioGroup value={csAggregate} onValueChange={(v) => setCsAggregate(v as typeof csAggregate)} className="flex gap-4">
                      {([["count","Count"],["sum","Sum"],["mean","Mean"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`ag-${v}`} />
                          <label htmlFor={`ag-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <SliderField label="Min Frequency (n-rule)" value={csNMin} onChange={setCsNMin} min={1} max={10} step={1} format={(v) => String(v)} helpText={`Suppress cells with fewer than ${csNMin[0]} records`} />
                  <SliderField label="Dominance Threshold (p%)" value={csPPct} onChange={setCsPPct} min={50} max={95} step={1} format={(v) => `${v}%`} helpText={`Suppress if top-k contributors exceed ${csPPct[0]}%`} />
                  <SliderField label="Dominance k" value={csKDom} onChange={setCsKDom} min={1} max={3} step={1} format={(v) => String(v)} helpText="Number of top contributors to check" />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Apply Secondary Suppression</Label>
                      <p className="text-xs text-muted-foreground">Greedy secondary to prevent back-calculation</p>
                    </div>
                    <Switch checked={csSecondary} onCheckedChange={setCsSecondary} />
                  </div>
                </>)}

                {preFlightChecks.length > 0 && <PreFlightPanel checks={preFlightChecks} />}

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <RunButton running={running} onRun={handleRun} disabled={!selectedDataset || rawData.length === 0} />
                </div>
              </div>
            </div>
          )}

          {/* ══ FAMILY 2: DIFFERENTIAL PRIVACY ════════════════════════════════ */}
          {family === "dp" && (
            <div className="flex gap-6">
              <div className="w-[185px] shrink-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Mechanism</p>
                <TechList items={DP_TECHNIQUES} selected={dpTech} onSelect={(id) => { setDpTech(id); setResult(null); }} />
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Column Config</p>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${epsilonBadgeClass(epsilon[0])}`}>ε = {epsilon[0].toFixed(1)}</span>
                      <span className="font-medium">{epsilonLabel(epsilon[0])}</span>
                    </div>
                    <p className="text-muted-foreground">Δf: {dpSensitivityMode === "auto" ? "Auto" : dpSensitivityMode === "iqr" ? "IQR" : "P1–P99"}</p>
                  </div>
                  {(dpTech === "laplace" || dpTech === "gaussian") && dpColumnPreview.numCols.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Numeric Cols ({dpColumnPreview.numCols.length})</p>
                      <div className="space-y-0.5">
                        {dpColumnPreview.numCols.slice(0, 8).map(({ col, sensitivity, risk }) => {
                          const dot = risk === "high" ? "🔴" : risk === "med" ? "🟡" : "🟢";
                          const fmtNum = (v: number) => v >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toFixed(2);
                          return (
                            <div key={col} className="flex items-center gap-1 text-[10px] py-0.5 border-b border-border/30 last:border-0">
                              <span className="shrink-0">{dot}</span>
                              <span className="font-medium w-16 truncate" title={col}>{col}</span>
                              <span className="text-muted-foreground flex-1 text-right font-mono">Δf={fmtNum(sensitivity)}</span>
                            </div>
                          );
                        })}
                        {dpColumnPreview.numCols.length > 8 && <p className="text-[9px] text-muted-foreground">+{dpColumnPreview.numCols.length - 8} more</p>}
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1">🔴 &gt;10× · 🟡 1–10× · 🟢 &lt;1×</p>
                    </div>
                  )}
                  {dpColumnPreview.catCols.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Categorical ({dpColumnPreview.catCols.length})</p>
                      <div className="space-y-0.5">
                        {dpColumnPreview.catCols.slice(0, 5).map(({ col, uniqueCount, entropy }) => (
                          <div key={col} className="flex items-center gap-1 text-[10px] py-0.5 border-b border-border/30 last:border-0">
                            <span className="font-medium w-16 truncate" title={col}>{col}</span>
                            <span className="text-muted-foreground flex-1 text-right">{uniqueCount}v</span>
                            <span className="font-mono text-violet-600 dark:text-violet-400 shrink-0">{entropy.toFixed(1)}b</span>
                          </div>
                        ))}
                        {dpColumnPreview.catCols.length > 5 && <p className="text-[9px] text-muted-foreground">+{dpColumnPreview.catCols.length - 5} more</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {DP_TECHNIQUES.find((t) => t.id === dpTech)?.label} Parameters
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{DP_TECHNIQUES.find((t) => t.id === dpTech)?.subtitle}</p>
                </div>
                <FormulaBox id={dpTech} />
                <div className="space-y-2">
                  <Label className="text-sm">Privacy Budget (ε)</Label>
                  <Slider value={epsilon} onValueChange={setEpsilon} min={0.1} max={10} step={0.1} data-testid="slider-epsilon" />
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono text-xs">ε = {epsilon[0].toFixed(1)}</Badge>
                    <span className="text-xs text-muted-foreground">{epsilonLabel(epsilon[0])}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {([0.1, 0.5, 1.0, 2.0, 5.0] as number[]).map((v) => (
                      <button key={v} data-testid={`dp-epsilon-preset-${v}`} onClick={() => setEpsilon([v])}
                        className={`rounded px-2 py-0.5 text-[10px] font-mono border transition-colors ${epsilon[0] === v ? "bg-purple-600 text-white border-purple-600" : "border-border text-muted-foreground hover:border-purple-400 hover:text-purple-600"}`}
                      >{v}</button>
                    ))}
                  </div>
                </div>
                {dpTech === "gaussian" && (
                  <div className="space-y-2">
                    <Label className="text-sm">Delta (δ) <span className="text-muted-foreground text-xs">— failure probability</span></Label>
                    <RadioGroup value={String(delta[0])} onValueChange={(v) => setDelta([parseFloat(v)])} className="flex flex-wrap gap-3">
                      {([["1e-5","1×10⁻⁵ (recommended)"],["1e-6","1×10⁻⁶ (stricter)"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-1.5">
                          <RadioGroupItem value={v} id={`dp-delta-${v}`} data-testid={`dp-delta-${v}`} />
                          <label htmlFor={`dp-delta-${v}`} className="text-xs font-mono cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground font-mono">
                      σ = <strong>{(Math.sqrt(2 * Math.log(1.25 / delta[0])) / epsilon[0]).toFixed(3)} × Δf</strong>
                    </p>
                  </div>
                )}
                {dpTech === "exponential" && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Categorical columns only</p>
                    <p>Pr[output = r] ∝ exp(ε·freq(r) / 2Δu). Higher ε = output biased toward common categories.</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm">Sensitivity / Clipping Strategy</Label>
                  <RadioGroup value={dpSensitivityMode} onValueChange={(v) => setDpSensitivityMode(v as SensitivityMode)} className="space-y-1.5">
                    {([
                      ["auto",       "Auto (Min–Max)",       "Δf = max − min. Exact but outliers inflate noise."],
                      ["iqr",        "IQR-based (Robust)",   "Clips to 1.5×IQR. Outlier-resistant, lower noise."],
                      ["percentile", "Percentile (1%–99%)", "Δf = P99 − P01. Good balance."],
                    ] as [SensitivityMode, string, string][]).map(([val, title, desc]) => (
                      <div key={val} className="flex items-start gap-1.5">
                        <RadioGroupItem value={val} id={`dp-clip-${val}`} data-testid={`dp-clip-${val}`} className="mt-0.5 shrink-0" />
                        <label htmlFor={`dp-clip-${val}`} className="cursor-pointer">
                          <span className="text-[11px] font-medium">{title}</span>
                          <span className="block text-[9px] text-muted-foreground leading-tight">{desc}</span>
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Budget (ε) Allocator</Label>
                  {(() => {
                    const nCols = dpTech === "exponential" ? dpColumnPreview.catCols.length : dpColumnPreview.numCols.length;
                    const epsilonPerCol = nCols > 0 ? epsilon[0] / nCols : epsilon[0];
                    const totalBasic = epsilon[0] * nCols;
                    const spent = dpBudgetMode === "equal" ? epsilon[0] : totalBasic;
                    const budgetPct = Math.min(100, (spent / Math.max(epsilon[0], 0.01)) * 100);
                    return (<>
                      <RadioGroup value={dpBudgetMode} onValueChange={(v) => setDpBudgetMode(v as typeof dpBudgetMode)} className="space-y-1.5">
                        {([
                          ["global",       "Global ε",       `Each col uses full ε = ${epsilon[0].toFixed(1)} (total = ${totalBasic.toFixed(1)})`],
                          ["equal",        "Equal split",    `ε per col = ${epsilonPerCol.toFixed(3)}`],
                          ["proportional", "Proportional",   "Low-sensitivity cols get more ε"],
                        ] as [typeof dpBudgetMode, string, string][]).map(([val, title, desc]) => (
                          <div key={val} className="flex items-start gap-1.5">
                            <RadioGroupItem value={val} id={`dp-budget-${val}`} data-testid={`dp-budget-${val}`} className="mt-0.5 shrink-0" />
                            <label htmlFor={`dp-budget-${val}`} className="cursor-pointer">
                              <span className="text-[11px] font-medium">{title}</span>
                              <span className="block text-[9px] text-muted-foreground leading-tight">{desc}</span>
                            </label>
                          </div>
                        ))}
                      </RadioGroup>
                      <div className="h-2 rounded-full bg-muted overflow-hidden mt-1">
                        <div className={`h-full rounded-full transition-all ${budgetPct > 100 ? "bg-rose-500" : budgetPct > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(budgetPct, 100)}%` }} />
                      </div>
                    </>);
                  })()}
                </div>
                {(dpTech === "laplace" || dpTech === "gaussian") && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label className="text-sm font-medium">Clamp output to valid range</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Clamp noisy values back to [lo, hi] bounds.</p>
                    </div>
                    <Switch checked={dpPostClamp} onCheckedChange={setDpPostClamp} data-testid="dp-postclamp-toggle" />
                  </div>
                )}
                {(dpTech === "laplace" || dpTech === "gaussian") && dpColumnPreview.catCols.length > 0 && (
                  <div className="flex items-center justify-between rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 p-3">
                    <div>
                      <Label className="text-sm font-medium">Also protect categorical columns</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Adds Exponential Mechanism to {dpColumnPreview.catCols.length} categorical col{dpColumnPreview.catCols.length !== 1 ? "s" : ""} (Mixed DP).</p>
                    </div>
                    <Switch checked={dpProtectCategorical} onCheckedChange={setDpProtectCategorical} data-testid="dp-protect-categorical-toggle" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm">Composition Accounting</Label>
                  <RadioGroup value={dpCompositionMode} onValueChange={(v) => setDpCompositionMode(v as typeof dpCompositionMode)} className="space-y-1.5">
                    {([
                      ["basic",    "Basic (sequential)",  "ε_total = Σεᵢ — simple, conservative"],
                      ["advanced", "Advanced (moments)",  "Tighter via moment generating functions"],
                      ["renyi",    "Rényi DP",            "Tightest — uses Rényi divergence"],
                    ] as [typeof dpCompositionMode, string, string][]).map(([val, title, desc]) => (
                      <div key={val} className="flex items-start gap-1.5">
                        <RadioGroupItem value={val} id={`dp-comp-${val}`} data-testid={`dp-comp-${val}`} className="mt-0.5 shrink-0" />
                        <label htmlFor={`dp-comp-${val}`} className="cursor-pointer">
                          <span className="text-[11px] font-medium">{title}</span>
                          <span className="block text-[9px] text-muted-foreground leading-tight">{desc}</span>
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Fixed Random Seed</Label>
                    <p className="text-xs text-muted-foreground">Reproducible noise across runs</p>
                  </div>
                  <Switch checked={dpSeedEnabled} onCheckedChange={setDpSeedEnabled} data-testid="dp-seed-toggle" />
                </div>
                {dpSeedEnabled && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Seed Value</Label>
                    <Input type="number" value={dpSeed} onChange={(e) => setDpSeed(parseInt(e.target.value) || 42)} className="h-8 text-xs font-mono w-32" data-testid="dp-seed-input" />
                  </div>
                )}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <RunButton running={running} onRun={handleRun} disabled={!selectedDataset || rawData.length === 0} />
                </div>
              </div>
            </div>
          )}

          {/* ══ FAMILY 3: SYNTHETIC DATA GENERATION ═══════════════════════════ */}
          {family === "synthetic" && (
            <div className="flex gap-6">
              <div className="w-[185px] shrink-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Generator</p>
                <TechList items={SDG_TECHNIQUES} selected={sdgTech} onSelect={(id) => { setSdgTech(id); setResult(null); }} />
              </div>
              <div className="flex-1 min-w-0 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {SDG_TECHNIQUES.find((t) => t.id === sdgTech)?.label} Parameters
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{SDG_TECHNIQUES.find((t) => t.id === sdgTech)?.subtitle}</p>
                </div>
                <FormulaBox id={sdgTech} />
                <SliderField label="Synthetic Dataset Size" value={synthSize} onChange={setSynthSize} min={10} max={Math.max(500, rawData.length)} step={10}
                  format={(v) => String(v)} helpText={`Generate ${synthSize[0]} synthetic records (original: ${rawData.length} rows)`} />
                {sdgTech === "stat-sdg" && (<>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Preserve Correlations</Label>
                      <p className="text-xs text-muted-foreground">Gaussian Copula via Cholesky decomposition</p>
                    </div>
                    <Switch checked={preserveCorr} onCheckedChange={setPreserveCorr} data-testid="sdg-corr-toggle" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Bandwidth Rule (KDE)</Label>
                    <RadioGroup value={synthBandwidthRule} onValueChange={(v) => setSynthBandwidthRule(v as typeof synthBandwidthRule)} className="space-y-1">
                      {([["silverman","Silverman (default)"],["scott","Scott"],["fixed","Fixed h=0.5"]] as [string,string][]).map(([v, label]) => (
                        <div key={v} className="flex items-center gap-2">
                          <RadioGroupItem value={v} id={`bw-${v}`} data-testid={`sdg-bandwidth-${v}`} />
                          <label htmlFor={`bw-${v}`} className="text-xs cursor-pointer">{label}</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </>)}
                {sdgTech === "dp-sdg" && (<>
                  <SliderField label="Privacy Budget (ε)" value={epsilon} onChange={setEpsilon} min={0.1} max={10} step={0.1} format={(v) => v.toFixed(1)}
                    helpText={`ε=${epsilon[0].toFixed(1)} — lower = more private, more noise`} />
                  <SliderField label="Gradient Clip Norm (C)" value={dpSgdClip} onChange={setDpSgdClip} min={0.1} max={5.0} step={0.1} format={(v) => v.toFixed(1)}
                    helpText={`Gradient clipping: ΔW̃ = ΔW / max(1, ‖ΔW‖ / C)`} />
                  <div className="space-y-2">
                    <Label className="text-sm">Training Epochs</Label>
                    <Input type="number" value={dpSgdEpochs} onChange={(e) => setDpSgdEpochs(Math.max(10, Math.min(1000, parseInt(e.target.value) || 300)))}
                      className="h-8 text-xs font-mono w-28" data-testid="dp-sgd-epochs-input" />
                    <p className="text-xs text-muted-foreground">Range 10–1000. Fewer = faster but less accurate.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Batch Size</Label>
                    <Input type="number" value={dpSgdBatchSize} onChange={(e) => setDpSgdBatchSize(Math.max(8, Math.min(4096, parseInt(e.target.value) || 500)))}
                      className="h-8 text-xs font-mono w-28" data-testid="dp-sgd-batch-input" />
                  </div>
                  {(() => {
                    const N = rawData.length || 1;
                    const B = dpSgdBatchSize;
                    const effectiveB = Math.min(B, N);
                    const q = effectiveB / N;
                    const T = dpSgdEpochs * Math.ceil(N / effectiveB);
                    const sigma = computeSigmaFromEpsilon(epsilon[0], delta[0], T, q);
                    const epsActual = computeEpsilonFromSigma(sigma, delta[0], T, q);
                    const puIndex = Math.min(1, (1 - epsilon[0] / 10) * 0.5 + (1 - sigma / (sigma + 1)) * 0.5);
                    return (
                      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2">
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Live Privacy Budget (RDP)</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                          <span className="text-muted-foreground">Target ε</span><span className="font-semibold">{epsilon[0].toFixed(1)}</span>
                          <span className="text-muted-foreground">Required σ</span><span className="font-semibold text-amber-600">{sigma.toFixed(3)}</span>
                          <span className="text-muted-foreground">Achieved ε</span><span className={`font-semibold ${epsActual <= epsilon[0] * 1.05 ? "text-emerald-600" : "text-red-500"}`}>{epsActual.toFixed(3)}</span>
                          <span className="text-muted-foreground">Privacy-Utility</span><span className="font-semibold">{(puIndex * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })()}
                </>)}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Fixed Random Seed</Label>
                    <p className="text-xs text-muted-foreground">Reproducible generation across runs</p>
                  </div>
                  <Switch checked={synthSeedEnabled} onCheckedChange={setSynthSeedEnabled} data-testid="sdg-seed-toggle" />
                </div>
                {synthSeedEnabled && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Seed Value</Label>
                    <Input type="number" value={synthSeed} onChange={(e) => setSynthSeed(parseInt(e.target.value) || 42)} className="h-8 text-xs font-mono w-32" data-testid="sdg-seed-input" />
                  </div>
                )}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <RunButton running={running} onRun={handleRun} disabled={!selectedDataset || rawData.length === 0} />
                </div>
              </div>
            </div>
          )}

          {/* ══ FAMILY 4: CRYPTOGRAPHIC PETs ══════════════════════════════════ */}
          {family === "crypto" && (
            <div className="flex gap-6">
              <div className="w-[185px] shrink-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Protocol</p>
                <TechList items={CRYPTO_TECHNIQUES} selected={cryptoTech} onSelect={(id) => { setCryptoTech(id); setResult(null); }} />
              </div>
              <div className="flex-1 min-w-0 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {CRYPTO_TECHNIQUES.find((t) => t.id === cryptoTech)?.label} Parameters
                  </p>
                </div>
                <FormulaBox id={cryptoTech} />
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    <strong>Educational Simulation.</strong> Demonstrates mathematical properties of the cryptographic protocol.
                  </p>
                </div>
                {cryptoTech === "he" && (
                  <div className="space-y-2">
                    <Label className="text-sm">Key Size</Label>
                    <RadioGroup value={heKeySize} onValueChange={setHeKeySize} className="flex gap-4">
                      {["512","1024","2048"].map((v) => (
                        <div key={v} className="flex items-center gap-1.5">
                          <RadioGroupItem value={v} id={`ks-${v}`} />
                          <label htmlFor={`ks-${v}`} className="text-xs font-mono cursor-pointer">{v}-bit</label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
                {cryptoTech === "smpc" && (<>
                  <SliderField label="Number of Shares (k)" value={smpcShares} onChange={setSmpcShares} min={2} max={5} step={1} format={(v) => String(v)} helpText="Each value is split into k additive shares over Z_p" />
                  <SliderField label="Reconstruction Threshold (t)" value={smpcThreshold} onChange={(v) => setSmpcThreshold([Math.min(v[0], smpcShares[0])])} min={2} max={smpcShares[0]} step={1} format={(v) => String(v)} helpText={`t=${smpcThreshold[0]} of k=${smpcShares[0]} shares needed to reconstruct`} />
                </>)}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <RunButton running={running} onRun={handleRun} disabled={!selectedDataset || rawData.length === 0} />
                </div>
              </div>
            </div>
          )}

          {/* ══ FAMILY 5: FEDERATED LEARNING ══════════════════════════════════ */}
          {family === "federated" && (
            <div className="flex gap-6">
              <div className="w-[185px] shrink-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Algorithm</p>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
                  <GitMerge className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-xs font-medium">FedAvg</p>
                    <p className="text-[10px] text-muted-foreground">McMahan et al. 2017</p>
                  </div>
                </div>
                {selectedDS && rawData.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Dataset Info</p>
                    {[
                      ["Records (n)", rawData.length.toLocaleString("en-IN")],
                      ["Columns (d)", String(allCols.length)],
                      ["Numeric cols", String(numericCols.length)],
                      [`Nodes (K=${fedNodes[0]})`, `~${Math.ceil(rawData.length / fedNodes[0])} rec/node`],
                      ["Partition", fedPartition === "noniid" ? "Non-IID" : "IID"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">FedAvg Parameters</p>
                  <p className="text-xs text-muted-foreground mt-0.5">McMahan et al. 2017 — Federated Averaging with optional DP</p>
                </div>
                <FormulaBox id="fedavg" />
                <SliderField label="Federated Nodes (K)" value={fedNodes} onChange={setFedNodes} min={2} max={10} step={1} format={(v) => String(v)} helpText={`Dataset partitioned across ${fedNodes[0]} simulated clients.`} />
                <SliderField label="Communication Rounds (T)" value={fedRounds} onChange={setFedRounds} min={1} max={30} step={1} format={(v) => String(v)} helpText="Global FedAvg aggregation rounds" />
                <div className="space-y-2">
                  <Label className="text-sm">Partition Strategy</Label>
                  <RadioGroup value={fedPartition} onValueChange={(v) => setFedPartition(v as "iid" | "noniid")} className="flex gap-5">
                    <div className="flex items-center gap-1.5"><RadioGroupItem value="iid" id="fed-iid" /><label htmlFor="fed-iid" className="text-xs cursor-pointer">IID (random shuffle)</label></div>
                    <div className="flex items-center gap-1.5"><RadioGroupItem value="noniid" id="fed-noniid" /><label htmlFor="fed-noniid" className="text-xs cursor-pointer">Non-IID (sorted skew)</label></div>
                  </RadioGroup>
                </div>
                <SliderField label="Local Epochs (E)" value={fedLocalEpochs} onChange={setFedLocalEpochs} min={1} max={10} step={1} format={(v) => String(v)} helpText={`${fedLocalEpochs[0]} local SGD epoch(s) per node per round`} />
                <SliderField label="Local Learning Rate (η)" value={fedLocalLR} onChange={setFedLocalLR} min={0.001} max={0.1} step={0.001} format={(v) => v.toFixed(3)} helpText="SGD learning rate on local data" />
                <SliderField label="Mini-Batch Size (B)" value={fedBatchSize} onChange={setFedBatchSize} min={2} max={16} step={2} format={(v) => String(v)} helpText={`${fedBatchSize[0]} records per mini-batch`} />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Enable DP-FedAvg</Label>
                    <p className="text-xs text-muted-foreground">Gaussian noise on gradient aggregation</p>
                  </div>
                  <Switch checked={fedDP} onCheckedChange={setFedDP} data-testid="fed-dp-toggle" />
                </div>
                {fedDP && (<>
                  <SliderField label="Privacy Budget (ε)" value={fedEps} onChange={setFedEps} min={0.1} max={10} step={0.1} format={(v) => v.toFixed(1)} helpText={`ε=${fedEps[0].toFixed(1)}`} />
                  <SliderField label="Clip Norm (C)" value={fedClipNorm} onChange={setFedClipNorm} min={0.1} max={5.0} step={0.1} format={(v) => v.toFixed(1)} helpText="Update clipping norm" />
                  <div className="rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-400">
                    <p className="font-medium">Calibrated σ ≈ {(Math.sqrt(2 * fedRounds[0] * fedNodes[0] * Math.log(1 / fedDelta[0])) / fedEps[0]).toFixed(3)}</p>
                    <p className="mt-0.5 opacity-80">σ = √(2TK·ln(1/δ)) / ε  (RDP composition bound)</p>
                  </div>
                </>)}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Generate Synthetic Output</Label>
                    <p className="text-xs text-muted-foreground">Sample new records from trained decoder</p>
                  </div>
                  <Switch checked={fedGenSynth} onCheckedChange={setFedGenSynth} data-testid="fed-synth-toggle" />
                </div>
                {fedGenSynth && (
                  <SliderField label="Synthetic Records" value={fedSynthSize} onChange={setFedSynthSize} min={10} max={500} step={10} format={(v) => String(v)} helpText={`Generate ${fedSynthSize[0]} synthetic records from decoder`} />
                )}
                <div className="space-y-1.5">
                  <Label className="text-sm">Random Seed</Label>
                  <Input type="number" value={fedSeed} onChange={(e) => setFedSeed(parseInt(e.target.value) || 42)} className="h-8 text-xs font-mono w-32" data-testid="fed-seed-input" />
                  <p className="text-xs text-muted-foreground">Reproducible node partitioning and weight initialisation</p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <RunButton running={running} onRun={handleRun} disabled={!selectedDataset || rawData.length === 0} />
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}
