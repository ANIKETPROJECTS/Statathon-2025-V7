import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, Shield, Users, Fingerprint, BarChart3, Play, Loader2,
  CheckCircle, XCircle, Target, Eye, Brain, UserCheck, Network, Info,
  Download, ChevronLeft, ChevronRight, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Dataset } from "@shared/schema";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend, ReferenceLine,
} from "recharts";

import { runProsecutorAttack, type ProsecutorResult } from "@/lib/attacks/prosecutorAttack";
import { runJournalistAttack, type JournalistResult } from "@/lib/attacks/journalistAttack";
import { runMarketerAttack, type MarketerResult } from "@/lib/attacks/marketerAttack";
import { runSingleOutAttack, type SingleOutResult } from "@/lib/attacks/singleOutAttack";
import { runInferenceAttack, type InferenceResult } from "@/lib/attacks/inferenceAttack";
import { runMembershipAttack, type MembershipResult } from "@/lib/attacks/membershipAttack";
import { runRecordLinkageAttack, type RecordLinkageResult, type LinkageOutcome } from "@/lib/attacks/recordLinkageAttack";
import { runAttributeDisclosureAttack, type AttributeDisclosureResult, type DisclosureLabel } from "@/lib/attacks/attributeDisclosureAttack";
import { runDifferencingAttack, type DifferencingResult, type DiffLabel } from "@/lib/attacks/differencingAttack";
import { runModelInversionAttack, type ModelInversionResult } from "@/lib/attacks/modelInversionAttack";
import { computeCompositeScore, type CompositeResult } from "@/lib/attacks/compositeScore";
import { sampleData, type DataRow, RISK_COLORS, type RiskLevel } from "@/lib/attacks/utils";
import { runAutoAssist, type AutoAssistResult, type ColumnClass } from "@/lib/autoAssist";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AllResults {
  prosecutor?: ProsecutorResult;
  journalist?: JournalistResult;
  marketer?: MarketerResult;
  singlingOut?: SingleOutResult;
  inference?: InferenceResult;
  membership?: MembershipResult;
  recordLinkage?: RecordLinkageResult;
  attributeDisclosure?: AttributeDisclosureResult;
  differencing?: DifferencingResult;
  modelInversion?: ModelInversionResult;
  composite?: CompositeResult;
}

type AttackId = "prosecutor" | "journalist" | "marketer" | "singlingOut" | "inference" | "membership" | "recordLinkage" | "attributeDisclosure" | "differencing" | "modelInversion";

const ATTACKS: { id: AttackId; label: string; short: string; icon: React.ReactNode; description: string }[] = [
  { id: "prosecutor",           label: "Prosecutor Attack",           short: "Prosecutor",      icon: <Target className="h-4 w-4" />,      description: "Within-Dataset Re-ID — Attacker knows target is in dataset, uses QIs to isolate" },
  { id: "journalist",           label: "Journalist Attack",           short: "Journalist",      icon: <Eye className="h-4 w-4" />,         description: "Probabilistic Re-ID — Information-theoretic risk via Shannon entropy and EC analysis" },
  { id: "marketer",             label: "Marketer Attack",             short: "Marketer",        icon: <Users className="h-4 w-4" />,       description: "Group Targeting — L-Diversity & T-Closeness: attacker targets groups, not individuals" },
  { id: "singlingOut",          label: "Singling Out Attack",         short: "Singling Out",    icon: <Fingerprint className="h-4 w-4" />, description: "GDPR Article 4(1) — Minimal attribute combination sufficient to isolate one record" },
  { id: "inference",            label: "Inference Attack",            short: "Inference",       icon: <Brain className="h-4 w-4" />,       description: "ML Prediction — CART decision tree predicts sensitive attributes from quasi-identifiers" },
  { id: "membership",           label: "Membership Attack",           short: "Membership",      icon: <UserCheck className="h-4 w-4" />,   description: "Presence Detection — AUC-based test: can attacker tell if a record is in the dataset?" },
  { id: "recordLinkage",        label: "Record Linkage Attack",       short: "Rec. Linkage",    icon: <Network className="h-4 w-4" />,     description: "External Re-ID — Links anonymized records to an external dataset using quasi-identifiers" },
  { id: "attributeDisclosure",  label: "Attribute Disclosure Attack", short: "Attr. Disclose",  icon: <Shield className="h-4 w-4" />,      description: "Sensitive Inference — Even without re-ID: attacker infers sensitive values from EC distributions" },
  { id: "differencing",         label: "Differencing Attack",         short: "Differencing",    icon: <BarChart3 className="h-4 w-4" />,   description: "Aggregate Leakage — Comparing Q1 vs Q2 (with/without one record) reveals individual contribution" },
  { id: "modelInversion",       label: "Model Inversion Attack",      short: "Model Inversion", icon: <AlertTriangle className="h-4 w-4" />, description: "Reconstruction Attack — Naïve Bayes MAP recovers sensitive attribute values from QI combinations" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskBadge(level: RiskLevel | string) {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-700 border-red-300",
    HIGH: "bg-orange-100 text-orange-700 border-orange-300",
    MEDIUM: "bg-amber-100 text-amber-700 border-amber-300",
    LOW: "bg-green-100 text-green-700 border-green-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${colors[level] || colors.LOW}`}>
      {level}
    </span>
  );
}

function kpiCard(title: string, value: string | number, sub: string, icon: React.ReactNode, color = "text-foreground") {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

// ─── Attack Report Components ─────────────────────────────────────────────────

const EC_BUCKET_COLORS = ["#DC2626", "#EA580C", "#D97706", "#16A34A", "#16A34A"];

function statusLabel(atRisk: boolean, linkScore: number, kThreshold: number, ecSize: number) {
  if (linkScore === 1.0) return { label: "🔴 UNIQUELY IDENTIFIABLE", cls: "text-red-600 font-bold" };
  if (ecSize < kThreshold) return { label: "🟡 LOW PROTECTION", cls: "text-amber-600 font-semibold" };
  return { label: "🟢 PROTECTED", cls: "text-green-600" };
}

function downloadRecordCSV(r: ProsecutorResult) {
  const qis = r.quasiIdentifiers;
  const header = ["Row#", ...qis, "EC_Size", "Link_Score", "Status"].join(",");
  const rows = r.recordTable.map((row) => {
    const st = row.linkScore === 1.0 ? "UNIQUELY_IDENTIFIABLE" : row.atRisk ? "LOW_PROTECTION" : "PROTECTED";
    return [row.rowIdx, ...qis.map((qi) => `"${row.qiValues[qi] ?? ""}"`), row.ecSize, row.linkScore, st].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "prosecutor_attack_record_level.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 50;

function ProsecutorReport({ r, kThreshold }: { r: ProsecutorResult; kThreshold: number }) {
  const [filterMode, setFilterMode] = useState<"all" | "atRisk" | "protected">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const qis = r.quasiIdentifiers;

  const filtered = r.recordTable.filter((row) => {
    if (filterMode === "atRisk" && !row.atRisk) return false;
    if (filterMode === "protected" && row.atRisk) return false;
    if (search) {
      const haystack = qis.map((qi) => row.qiValues[qi] ?? "").join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const riskColor = r.reIdRisk > 0.2 ? "text-red-600" : r.reIdRisk > 0.05 ? "text-amber-600" : "text-green-600";
  const riskLabel = r.reIdRisk > 0.2 ? "HIGH" : r.reIdRisk > 0.05 ? "MEDIUM" : "LOW";

  const topRecord = r.topVulnerableRecord;

  return (
    <div className="space-y-6">

      {/* ── §4.1 Attack Summary Banner ─────────────────────────────────────── */}
      <div className={`rounded-lg border-2 p-4 ${r.reIdRisk > 0.2 ? "border-red-400 bg-red-50 dark:bg-red-950/20" : r.reIdRisk > 0.05 ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : "border-green-400 bg-green-50 dark:bg-green-950/20"}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-sm uppercase tracking-wider">🎯 Prosecutor Attack Results</span>
          <span className={`text-xs font-bold px-2 py-1 rounded border ${r.reIdRisk > 0.2 ? "bg-red-100 text-red-700 border-red-300" : r.reIdRisk > 0.05 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-green-100 text-green-700 border-green-300"}`}>
            RISK LEVEL: {riskLabel}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          Rows analysed: <strong>{r.sampleN}</strong> &nbsp;|&nbsp; QIs used: <strong>{qis.join(", ") || "—"}</strong>
        </div>
        <p className="text-sm leading-relaxed">
          An attacker who already knows a person is in this dataset can correctly identify{" "}
          <strong className={riskColor}>{(r.reIdRisk * 100).toFixed(1)}%</strong> of individuals using only{" "}
          <em>{qis.slice(0, 3).join(", ")}{qis.length > 3 ? `, +${qis.length - 3} more` : ""}</em>.{" "}
          Out of <strong>{r.sampleN}</strong> records,{" "}
          <strong className="text-red-600">{r.uniqueRecordsCount}</strong>{" "}
          {r.uniqueRecordsCount === 1 ? "person is" : "people are"} completely unique —{" "}
          {r.uniqueRecordsCount === 0
            ? "no singleton records found."
            : `${r.uniqueRecordsCount === 1 ? "they can" : "they can each"} be pinpointed with 100% certainty.`}
        </p>
      </div>

      {/* ── §4.2 Key Metrics Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Re-ID Risk", `${(r.reIdRisk * 100).toFixed(1)}%`, "Avg chance attacker correctly IDs a person", <Target className="h-4 w-4" />, r.reIdRisk > 0.2 ? "text-red-600" : r.reIdRisk > 0.05 ? "text-amber-600" : "text-green-600")}
        {kpiCard("Unique Records", r.uniqueRecordsCount, "Singletons — 100% identifiable (k=1)", <Fingerprint className="h-4 w-4" />, r.uniqueRecordsCount > 0 ? "text-red-600" : "text-green-600")}
        {kpiCard("Avg EC Size", r.avgEcSize.toFixed(1), "Mean group size sharing same QI values", <Users className="h-4 w-4" />, r.avgEcSize < kThreshold ? "text-red-600" : "text-green-600")}
        {kpiCard("Min-K", r.minK, "Smallest group — worst-case exposure", <AlertTriangle className="h-4 w-4" />, r.minK < kThreshold ? "text-red-600" : "text-green-600")}
      </div>

      {/* ── §4.3 Record-Level Attack Trace Table ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">Record-Level Attack Trace ({filtered.length} records)</CardTitle>
            <Button size="sm" variant="outline" onClick={() => downloadRecordCSV(r)} className="h-7 text-xs gap-1">
              <Download className="h-3 w-3" /> Download CSV
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <div className="flex gap-1">
              {(["all", "atRisk", "protected"] as const).map((m) => (
                <button key={m} onClick={() => { setFilterMode(m); setPage(1); }}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${filterMode === m ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                  {m === "all" ? "Show All" : m === "atRisk" ? "🔴 At Risk Only" : "🟢 Protected Only"}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[140px]">
              <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search QI values..." className="h-7 text-xs pl-6" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2">Row #</th>
                  {qis.map((qi) => <th key={qi} className="text-left px-2 py-2 truncate max-w-[100px]" title={qi}>{qi.length > 12 ? qi.slice(0, 12) + "…" : qi}</th>)}
                  <th className="text-right px-3 py-2">Group Size</th>
                  <th className="text-right px-3 py-2">Link Score</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan={qis.length + 4} className="text-center py-8 text-muted-foreground">No records match the current filter.</td></tr>
                ) : pageRows.map((row) => {
                  const { label, cls } = statusLabel(row.atRisk, row.linkScore, kThreshold, row.ecSize);
                  return (
                    <tr key={row.rowIdx} className="border-b border-muted hover:bg-muted/20">
                      <td className="px-3 py-1.5 text-muted-foreground">{row.rowIdx}</td>
                      {qis.map((qi) => <td key={qi} className="px-2 py-1.5 truncate max-w-[100px]" title={row.qiValues[qi]}>{row.qiValues[qi] ?? ""}</td>)}
                      <td className="px-3 py-1.5 text-right font-medium">{row.ecSize}</td>
                      <td className={`px-3 py-1.5 text-right font-bold ${row.linkScore >= 0.5 ? "text-red-600" : row.linkScore >= 0.2 ? "text-amber-600" : "text-green-600"}`}>{row.linkScore.toFixed(2)}</td>
                      <td className={`px-3 py-1.5 text-xs ${cls}`}>{label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
              <span>Page {safePage} of {totalPages} ({filtered.length} records)</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}><ChevronLeft className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── §4.4 Attack Narrative ─────────────────────────────────────────────── */}
      {topRecord && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-orange-800 dark:text-orange-200">🔍 Attack Simulation — How the Attack Works on YOUR Data</CardTitle>
          </CardHeader>
          <CardContent className="text-xs font-mono space-y-2 text-orange-900 dark:text-orange-100">
            <div><strong>Step 1 — Attacker's Knowledge</strong><br />
              The attacker knows a specific person is in this dataset. From a public record they know:<br />
              {qis.map((qi) => <span key={qi} className="block ml-4">{qi} = {topRecord.qiValues[qi]}</span>)}
            </div>
            <div><strong>Step 2 — Database Query</strong><br />
              Attacker queries: "Show me all records where {qis.map((qi, i) => `${qi}=${topRecord.qiValues[qi]}`).join(" AND ")}"<br />
              <span className="ml-4">Result: <strong>{topRecord.ecSize} record{topRecord.ecSize > 1 ? "s" : ""} found.</strong> (Row #{topRecord.rowIdx})</span>
            </div>
            <div><strong>Step 3 — Re-identification</strong><br />
              {topRecord.ecSize === 1
                ? <span>Since only 1 record matches, the attacker has identified this person with <strong className="text-red-600">100% certainty</strong>. They now know all sensitive attributes for this individual.</span>
                : <span>With {topRecord.ecSize} records matching, the attacker has a <strong>{(topRecord.linkScore * 100).toFixed(0)}%</strong> chance of correctly identifying this person.</span>}
            </div>
            <div><strong>Step 4 — Scale</strong><br />
              This attack was possible (link score ≥ 0.5) on <strong>{r.recordTable.filter((x) => x.linkScore >= 0.5).length}</strong> out of <strong>{r.sampleN}</strong> records.<br />
              <strong>{(r.uniqueRecordsCount / r.sampleN * 100).toFixed(1)}%</strong> of your dataset is fully re-identifiable (singleton records).
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── §4.5 Equivalence Class Distribution ──────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">EC Size Distribution (Chart)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={r.histogram} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={75} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Records">
                  {r.histogram.map((_, i) => <Cell key={i} fill={EC_BUCKET_COLORS[i] ?? "#16A34A"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">EC Size Distribution (Table)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-2">EC Size</th><th className="text-right pb-2"># ECs</th><th className="text-right pb-2"># Records</th><th className="text-right pb-2">% Dataset</th></tr></thead>
              <tbody>
                {r.ecSizeTable.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1.5 font-medium" style={{ color: EC_BUCKET_COLORS[i] }}>{row.label}</td>
                    <td className="py-1.5 text-right">{row.numECs}</td>
                    <td className="py-1.5 text-right">{row.numRecords}</td>
                    <td className="py-1.5 text-right font-bold" style={{ color: EC_BUCKET_COLORS[i] }}>{row.pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── §4.6 Link Score Distribution ─────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Link Score Distribution — Attacker Certainty by Record</CardTitle></CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={r.linkScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {r.linkScoreDistribution.map((_, i) => <Cell key={i} fill={["#DC2626","#EA580C","#D97706","#16A34A","#16A34A"][i] ?? "#16A34A"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="text-xs self-start">
              <thead><tr className="border-b"><th className="text-left pb-2">Score Range</th><th className="text-right pb-2"># Records</th><th className="text-left pb-2 pl-3">Meaning</th></tr></thead>
              <tbody>
                {r.linkScoreDistribution.map((row, i) => {
                  const meanings = ["Attacker is 100% certain","More likely correct than not","Coin-flip or worse for attacker","Attacker has <25% chance","Effectively anonymous"];
                  return (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-medium" style={{ color: ["#DC2626","#EA580C","#D97706","#16A34A","#16A34A"][i] }}>{row.bucket}</td>
                      <td className="py-1.5 text-right font-bold">{row.count}</td>
                      <td className="py-1.5 pl-3 text-muted-foreground">{meanings[i]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── §4.7 L-Diversity Results ──────────────────────────────────────────── */}
      {r.lDiversityResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">L-Diversity Check (threshold l = {r.lDiversityResults[0] ? "see config" : "—"})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Singleton-EC artifact caveat */}
            {r.lDiversityResults[0] && r.lDiversityResults[0].totalEcs >= r.sampleN * 0.9 && (
              <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — L-Diversity failures are not an independent risk signal here</div>
                All {r.lDiversityResults[0].totalEcs} equivalence classes are singletons (each record forms its own unique group due to the highly granular QI selection: {qis.join(", ")}). A group of 1 person can only contain 1 distinct SA value, so L-Diversity l≥2 failures are a mathematical inevitability — <strong>not evidence of a homogeneity attack</strong>. L-Diversity becomes meaningful only when ECs contain ≥ 2 records. To resolve: reduce the number or specificity of the selected quasi-identifiers.
              </div>
            )}
            {r.lDiversityResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Min distinct values in any EC: <strong>{res.minL}</strong></div>
                  <div>ECs violating l-diversity: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong> ({res.totalEcs > 0 ? ((res.violatingEcs/res.totalEcs)*100).toFixed(0) : 0}%)</div>
                  {res.status === "FAIL" && res.totalEcs < r.sampleN * 0.9 && <div className="italic mt-1">In some groups, all records share the same {res.sa} value. An attacker who identifies the group learns {res.sa} with certainty.</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── §4.8 T-Closeness Results ──────────────────────────────────────────── */}
      {r.tClosenessResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">T-Closeness Check (Total Variation Distance)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Singleton-EC artifact caveat */}
            {r.tClosenessResults[0] && r.tClosenessResults[0].totalEcs >= r.sampleN * 0.9 && (
              <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — T-Closeness high TVD is caused by singleton ECs, not targeted disclosure</div>
                Singleton ECs always deviate maximally (TVD → 1.0) from the global SA distribution by construction: a single record is 100% one value, so the local distribution is always a point mass. The T-Closeness failures below are a direct consequence of the singleton EC structure — <strong>not evidence of attribute inference within groups</strong>. T-Closeness thresholds are designed for multi-record equivalence classes.
              </div>
            )}
            {r.tClosenessResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Maximum EC deviation from global distribution: <strong className={res.maxDistance > 0.3 ? "text-red-600" : "text-green-600"}>{res.maxDistance}</strong></div>
                  <div>ECs violating t-closeness: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong></div>
                  {res.status === "FAIL" && res.totalEcs < r.sampleN * 0.9 && <div className="italic mt-1">The distribution of {res.sa} inside individual groups is very different from the overall dataset. This reveals information even without direct re-identification.</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── §4.9 Risk-Protection Donut (real counts) ─────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Risk–Protection Split (Real Record Counts)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={[
                  { name: `At Risk (${r.atRiskCount})`, value: r.atRiskCount },
                  { name: `Protected (${r.protectedCount})`, value: r.protectedCount },
                ]} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  <Cell fill="#DC2626" />
                  <Cell fill="#16A34A" />
                </Pie>
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v} records`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center text-xs text-muted-foreground mt-2">
              At Risk: {r.atRiskCount} records ({r.sampleN > 0 ? ((r.atRiskCount/r.sampleN)*100).toFixed(1) : 0}%) — EC size &lt; k={kThreshold}<br/>
              Protected: {r.protectedCount} records ({r.sampleN > 0 ? ((r.protectedCount/r.sampleN)*100).toFixed(1) : 0}%) — EC size ≥ k
            </div>
          </CardContent>
        </Card>

        {/* ── §4.10 Top 10 Vulnerable Records ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top 10 Vulnerable Records (Highest Risk)</CardTitle>
            <CardDescription className="text-xs">These rows should be suppressed or generalized before releasing this dataset.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-1">Rank</th><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">Link Score</th><th className="text-right pb-1">EC Size</th></tr></thead>
                <tbody>
                  {r.topVulnerable.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-1 pr-2 text-muted-foreground truncate max-w-[160px]" title={row.qiCombo}>{row.qiCombo.slice(0, 40)}{row.qiCombo.length > 40 ? "…" : ""}</td>
                      <td className="py-1 text-right font-bold text-red-600">{row.linkScore.toFixed(2)}</td>
                      <td className="py-1 text-right">{row.ecSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function JournalistReport({ r, kThreshold }: { r: JournalistResult; kThreshold: number }) {
  const [filterMode, setFilterMode] = useState<"all" | "atRisk" | "protected">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const qis = r.quasiIdentifiers;
  const riskColor = r.reIdRisk > 0.2 ? "text-red-600" : r.reIdRisk > 0.05 ? "text-amber-600" : "text-green-600";
  const riskLabel = r.reIdRisk > 0.2 ? "HIGH" : r.reIdRisk > 0.05 ? "MEDIUM" : "LOW";
  const bannerBorder = r.reIdRisk > 0.2
    ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : r.reIdRisk > 0.05
    ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
    : "border-green-400 bg-green-50 dark:bg-green-950/20";

  const filtered = r.recordTable.filter((row) => {
    if (filterMode === "atRisk" && !row.atRisk) return false;
    if (filterMode === "protected" && row.atRisk) return false;
    if (search) {
      const haystack = qis.map((qi) => row.qiValues[qi] ?? "").join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const riskReductionPp = ((r.prosecutorReIdRisk - r.reIdRisk) * 100).toFixed(1);
  const commonQIs = qis.slice(0, 3).join(", ") + (qis.length > 3 ? `, +${qis.length - 3} more` : "");

  return (
    <div className="space-y-6">

      {/* ── §6.1 Attack Summary Banner ─────────────────────────────────────── */}
      <div className={`rounded-lg border-2 p-4 ${bannerBorder}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-sm uppercase tracking-wider">📰 Journalist Attack Results</span>
          <span className={`text-xs font-bold px-2 py-1 rounded border ${r.reIdRisk > 0.2 ? "bg-red-100 text-red-700 border-red-300" : r.reIdRisk > 0.05 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-green-100 text-green-700 border-green-300"}`}>
            RISK LEVEL: {riskLabel}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mb-2 flex flex-wrap gap-3">
          <span>Rows analysed: <strong>{r.sampleN}</strong></span>
          <span>QIs used: <strong>{qis.join(", ") || "—"}</strong></span>
          <span>Population method: <strong>{r.multiplierUsed ? "Multiplier_comb (expansion factors)" : `Sampling fraction (${(r.samplingFraction * 100).toFixed(0)}%)`}</strong></span>
        </div>
        <p className="text-sm leading-relaxed">
          A journalist with access to a public population register (but who does <em>NOT</em> know if their target is in this dataset) can correctly identify{" "}
          <strong className={riskColor}>{(r.reIdRisk * 100).toFixed(1)}%</strong> of individuals using only <em>{commonQIs}</em>.
          {" "}This is{" "}
          {r.reIdRisk < r.prosecutorReIdRisk
            ? <><strong className="text-green-600">{riskReductionPp}pp lower</strong> than the Prosecutor risk of <strong>{(r.prosecutorReIdRisk * 100).toFixed(1)}%</strong>, because {r.sampleN - r.populationUniqueCount} records that may look unique in this sample correspond to combinations shared by multiple people in the wider population.</>
            : <><strong>equal</strong> to the Prosecutor risk — the sampling fraction is 100% or Multiplier_comb collapses to the sample size.</>}
        </p>
      </div>

      {/* ── §6.2 Key Metrics Row (5 cards) ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpiCard("Journalist Re-ID Risk", `${(r.reIdRisk * 100).toFixed(1)}%`, "Avg chance journalist correctly IDs a person, accounting for sampling", <Eye className="h-4 w-4" />, r.reIdRisk > 0.2 ? "text-red-600" : r.reIdRisk > 0.05 ? "text-amber-600" : "text-green-600")}
        <Card className="border-dashed opacity-80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Prosecutor Risk (ref.)</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{(r.prosecutorReIdRisk * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">Worst-case if attacker knows target is sampled</p>
          </CardContent>
        </Card>
        {kpiCard("Population-Unique", r.populationUniqueCount, "Records unique even in the full population", <Fingerprint className="h-4 w-4" />, r.populationUniqueCount > 0 ? "text-red-600" : "text-green-600")}
        {kpiCard("Avg Population EC", r.avgPopulationEcSize.toFixed(1), "Mean group size sharing same QIs in population", <Users className="h-4 w-4" />, r.avgPopulationEcSize < kThreshold ? "text-red-600" : "text-green-600")}
        {kpiCard("Min Population EC", r.minPopulationEcSize.toFixed(1), "Smallest estimated population group — worst-case", <AlertTriangle className="h-4 w-4" />, r.minPopulationEcSize < kThreshold ? "text-red-600" : "text-green-600")}
      </div>

      {/* ── §6.3 Record-Level Attack Trace Table ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">Record-Level Attack Trace — Dual Status View ({filtered.length} records)</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Each record shows both its <strong>sample EC size</strong> (Prosecutor view) and its <strong>estimated population EC size</strong> (Journalist view).
            A record can be "At Risk" under Prosecutor but "Protected" under Journalist — this dual status is the core insight.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <div className="flex gap-1">
              {(["all", "atRisk", "protected"] as const).map((m) => (
                <button key={m} onClick={() => { setFilterMode(m); setPage(1); }}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${filterMode === m ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                  {m === "all" ? "Show All" : m === "atRisk" ? "🔴 At Risk (Population)" : "🟢 Protected (Population)"}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[140px]">
              <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search QI values..." className="h-7 text-xs pl-6" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2">Row #</th>
                  {qis.map((qi) => <th key={qi} className="text-left px-2 py-2 truncate max-w-[80px]" title={qi}>{qi.length > 10 ? qi.slice(0, 10) + "…" : qi}</th>)}
                  <th className="text-right px-2 py-2">Sample EC</th>
                  <th className="text-right px-2 py-2">Pop. EC</th>
                  <th className="text-right px-2 py-2">Prosecutor</th>
                  <th className="text-right px-2 py-2">Journalist</th>
                  <th className="text-left px-3 py-2">Dual Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan={qis.length + 7} className="text-center py-8 text-muted-foreground">No records match the current filter.</td></tr>
                ) : pageRows.map((row) => {
                  const prosecutorAtRisk = row.atRiskProsecutor;
                  const journalistAtRisk = row.atRisk;
                  let dualLabel: string;
                  let dualCls: string;
                  if (row.prosecutorLinkScore === 1.0 && row.journalistLinkScore < 0.5) {
                    dualLabel = "🟡 SAMPLE-UNIQUE / POP-SAFE";
                    dualCls = "text-amber-600 font-semibold";
                  } else if (row.journalistLinkScore >= 0.5) {
                    dualLabel = "🔴 AT RISK (both models)";
                    dualCls = "text-red-600 font-bold";
                  } else if (prosecutorAtRisk && !journalistAtRisk) {
                    dualLabel = "🟡 REDUCED RISK (journalist)";
                    dualCls = "text-amber-600";
                  } else {
                    dualLabel = "🟢 PROTECTED";
                    dualCls = "text-green-600";
                  }
                  return (
                    <tr key={row.rowIdx} className="border-b border-muted hover:bg-muted/20">
                      <td className="px-3 py-1.5 text-muted-foreground">{row.rowIdx}</td>
                      {qis.map((qi) => <td key={qi} className="px-2 py-1.5 truncate max-w-[80px]">{row.qiValues[qi] ?? ""}</td>)}
                      <td className="px-2 py-1.5 text-right font-medium">{row.ecSizeSample}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-blue-600">{row.ecSizePopulation}</td>
                      <td className={`px-2 py-1.5 text-right font-bold ${row.prosecutorLinkScore >= 0.5 ? "text-red-600" : row.prosecutorLinkScore >= 0.2 ? "text-amber-600" : "text-green-600"}`}>{row.prosecutorLinkScore.toFixed(3)}</td>
                      <td className={`px-2 py-1.5 text-right font-bold ${row.journalistLinkScore >= 0.5 ? "text-red-600" : row.journalistLinkScore >= 0.2 ? "text-amber-600" : "text-green-600"}`}>{row.journalistLinkScore.toFixed(3)}</td>
                      <td className={`px-3 py-1.5 text-xs ${dualCls}`}>{dualLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
              <span>Page {safePage} of {totalPages} ({filtered.length} records)</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}><ChevronLeft className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── §6.4 Attack Narrative ─────────────────────────────────────────────── */}
      {r.topVulnerableRecord && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-800 dark:text-blue-200">📰 Attack Simulation — How the Journalist Attack Works on YOUR Data</CardTitle>
          </CardHeader>
          <CardContent className="text-xs font-mono space-y-2 text-blue-900 dark:text-blue-100">
            <div><strong>Step 1 — Attacker's Knowledge</strong><br />
              The journalist knows person X exists in the general population (e.g., via Census/voter records) with:<br />
              {qis.map((qi) => <span key={qi} className="block ml-4">{qi} = {r.topVulnerableRecord!.qiValues[qi]}</span>)}
              They do <em>NOT</em> know if X is in this particular survey sample.
            </div>
            <div><strong>Step 2 — Population Estimate</strong><br />
              Using {r.multiplierUsed ? "Multiplier_comb (expansion weights)" : `a ${(r.samplingFraction * 100).toFixed(0)}% sampling fraction`}, an estimated{" "}
              <strong>{r.topVulnerableRecord!.ecSizePopulation}</strong> people in the full population share this exact QI combination.
            </div>
            <div><strong>Step 3 — Sample Match</strong><br />
              In the released sample, <strong>{r.topVulnerableRecord!.ecSizeSample}</strong> record(s) match this QI combination (Prosecutor view: 100% certainty).
            </div>
            <div><strong>Step 4 — Re-identification Confidence</strong><br />
              Even with {r.topVulnerableRecord!.ecSizeSample === 1 ? "a singleton match" : `${r.topVulnerableRecord!.ecSizeSample} matching records`} in the sample, the journalist can only be{" "}
              <strong className={r.topVulnerableRecord!.journalistLinkScore >= 0.5 ? "text-red-600" : "text-amber-600"}>
                {(r.topVulnerableRecord!.journalistLinkScore * 100).toFixed(1)}%
              </strong>{" "}
              confident this record is person X, because {Math.max(0, r.topVulnerableRecord!.ecSizePopulation - 1).toFixed(1)} other people in the population share the same QI combination.
            </div>
            <div><strong>Step 5 — Scale</strong><br />
              <strong>{r.populationUniqueCount}</strong> out of <strong>{r.sampleN}</strong> records remain unique at population level (Prosecutor-level risk even under the Journalist model).<br />
              <strong>{r.sampleN > 0 ? (((r.sampleN - r.atRiskCount) / r.sampleN) * 100).toFixed(1) : 0}%</strong> of the dataset shows reduced risk under the Journalist model vs the Prosecutor model.
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── §6.5 Prosecutor vs Journalist Comparison Chart ───────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Prosecutor vs Journalist Link Score Distribution</CardTitle>
          <p className="text-xs text-muted-foreground">Sampling provides "plausible deniability" — records shift from high-risk Prosecutor buckets to lower-risk Journalist buckets.</p>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.comparisonChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend />
                <Bar dataKey="prosecutorCount" name="Prosecutor" fill="#DC2626" radius={[4, 4, 0, 0]} />
                <Bar dataKey="journalistCount" name="Journalist" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <table className="text-xs self-start">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-2">Score Range</th>
                  <th className="text-right pb-2"># Prosecutor</th>
                  <th className="text-right pb-2"># Journalist</th>
                  <th className="text-right pb-2">Δ Reduction</th>
                </tr>
              </thead>
              <tbody>
                {r.comparisonChart.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1.5 font-medium" style={{ color: ["#DC2626","#EA580C","#D97706","#16A34A","#16A34A"][i] }}>{row.bucket}</td>
                    <td className="py-1.5 text-right font-bold text-red-600">{row.prosecutorCount}</td>
                    <td className="py-1.5 text-right font-bold text-blue-600">{row.journalistCount}</td>
                    <td className={`py-1.5 text-right font-bold ${row.delta > 0 ? "text-green-600" : row.delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {row.delta > 0 ? `−${row.delta}` : row.delta < 0 ? `+${Math.abs(row.delta)}` : "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── §6.6 Population EC Size Distribution ─────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Population EC Size Distribution (Chart)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={r.populationHistogram} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={75} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="numRecords" radius={[0, 4, 4, 0]} name="Records">
                  {r.populationHistogram.map((_, i) => <Cell key={i} fill={EC_BUCKET_COLORS[i] ?? "#16A34A"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Population EC Size Distribution (Table)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-2">Pop. EC Size</th><th className="text-right pb-2"># ECs</th><th className="text-right pb-2"># Records</th><th className="text-right pb-2">% Dataset</th></tr></thead>
              <tbody>
                {r.populationHistogram.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1.5 font-medium" style={{ color: EC_BUCKET_COLORS[i] }}>{row.label}</td>
                    <td className="py-1.5 text-right">{row.numECs}</td>
                    <td className="py-1.5 text-right">{row.numRecords}</td>
                    <td className="py-1.5 text-right font-bold" style={{ color: EC_BUCKET_COLORS[i] }}>{row.pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── §6.7 L-Diversity Results (sample-based, identical to Prosecutor) ─── */}
      {r.lDiversityResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">L-Diversity Check (sample-based — independent of attacker model)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Singleton-EC artifact caveat */}
            {r.lDiversityResults[0] && r.lDiversityResults[0].totalEcs >= r.sampleN * 0.9 && (
              <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — L-Diversity failures are not an independent risk signal here</div>
                All {r.lDiversityResults[0].totalEcs} sample equivalence classes are singletons (each record is unique in the sample under the selected QIs). A group of 1 person can only contain 1 distinct SA value, so L-Diversity l≥2 failures are a mathematical inevitability — <strong>not evidence of a homogeneity attack</strong>. The core journalist risk score above already accounts for this; these failures should not be treated as additional privacy violations. To make L-Diversity meaningful: reduce QI granularity so that groups of ≥ 2 records form.
              </div>
            )}
            {r.lDiversityResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Min distinct values in any EC: <strong>{res.minL}</strong></div>
                  <div>ECs violating l-diversity: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong> ({res.totalEcs > 0 ? ((res.violatingEcs/res.totalEcs)*100).toFixed(0) : 0}%)</div>
                  {res.status === "FAIL" && res.totalEcs < r.sampleN * 0.9 && <div className="italic mt-1">In some groups, all records share the same {res.sa} value — an attacker who links to the group learns {res.sa} with certainty, regardless of journalist/prosecutor model.</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── §6.8 T-Closeness Results ──────────────────────────────────────────── */}
      {r.tClosenessResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">T-Closeness Check (Total Variation Distance — sample-based)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Singleton-EC artifact caveat */}
            {r.tClosenessResults[0] && r.tClosenessResults[0].totalEcs >= r.sampleN * 0.9 && (
              <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — High TVD is caused by singleton ECs, not targeted attribute disclosure</div>
                Singleton ECs always deviate maximally from the global SA distribution (TVD → 1.0): a single record is 100% one SA value, so the local distribution is always a point mass. The T-Closeness violations shown below are a direct consequence of the same singleton EC structure identified above — <strong>not evidence of distributional skew within real groups</strong>. T-Closeness thresholds are designed for multi-record equivalence classes.
              </div>
            )}
            {r.tClosenessResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Maximum EC deviation from global distribution: <strong className={res.maxDistance > 0.3 ? "text-red-600" : "text-green-600"}>{res.maxDistance}</strong></div>
                  <div>ECs violating t-closeness: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong></div>
                  {res.status === "FAIL" && res.totalEcs < r.sampleN * 0.9 && <div className="italic mt-1">The distribution of {res.sa} inside some groups differs significantly from the overall dataset distribution.</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── §6.9 Methodology Disclosure (mandatory) ──────────────────────────── */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/10 dark:border-blue-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <Info className="h-4 w-4" /> ℹ️ Methodology Note — Population Estimation
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-blue-800 dark:text-blue-200 space-y-2">
          <p>Population EC sizes in this report are <strong>estimates</strong> based on:</p>
          <div className="ml-2 space-y-1">
            <div className={`flex items-center gap-2 ${r.multiplierUsed ? "font-semibold" : "text-muted-foreground"}`}>
              {r.multiplierUsed ? "✓" : "○"} <span>Multiplier_comb column (NSS survey expansion factors)</span>
            </div>
            <div className={`flex items-center gap-2 ${!r.multiplierUsed ? "font-semibold" : "text-muted-foreground"}`}>
              {!r.multiplierUsed ? "✓" : "○"} <span>Global sampling fraction = {(r.samplingFraction * 100).toFixed(0)}% (Multiplier_comb {r.multiplierUsed ? "used above" : "not available"})</span>
            </div>
          </div>
          <p className="mt-2">
            These estimates assume the sampling design is <strong>uniform across QI groups</strong>.
            Actual population uniqueness may differ. Treat Journalist Re-ID Risk as an{" "}
            <strong>indicative lower bound</strong>, not an exact figure.
            The Prosecutor Re-ID Risk ({(r.prosecutorReIdRisk * 100).toFixed(1)}%) remains the exact, conservative upper bound.
          </p>
        </CardContent>
      </Card>

      {/* ── §6.10 Risk–Protection Donut (population-based) ───────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Risk–Protection Split — Population Model (Real Counts)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={[
                  { name: `At Risk (${r.atRiskCount})`, value: r.atRiskCount },
                  { name: `Protected (${r.protectedCount})`, value: r.protectedCount },
                ]} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  <Cell fill="#DC2626" />
                  <Cell fill="#16A34A" />
                </Pie>
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v} records`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center text-xs text-muted-foreground mt-2">
              At Risk: {r.atRiskCount} records ({r.sampleN > 0 ? ((r.atRiskCount / r.sampleN) * 100).toFixed(1) : 0}%) — Population EC &lt; k={kThreshold}<br />
              Protected: {r.protectedCount} records ({r.sampleN > 0 ? ((r.protectedCount / r.sampleN) * 100).toFixed(1) : 0}%) — Population EC ≥ k
            </div>
          </CardContent>
        </Card>

        {/* ── §6.11 Top Vulnerable Records ────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top 10 Vulnerable Records (by Journalist Score)</CardTitle>
            <p className="text-xs text-muted-foreground">Ranked by journalist link score. Records with population-unique QI combos are listed first.</p>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pb-1">Rank</th>
                    <th className="text-left pb-1">QI Combination</th>
                    <th className="text-right pb-1">Sample EC</th>
                    <th className="text-right pb-1">Pop. EC</th>
                    <th className="text-right pb-1">J. Score</th>
                  </tr>
                </thead>
                <tbody>
                  {r.topVulnerable.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-1 pr-2 text-muted-foreground truncate max-w-[130px]" title={row.qiCombo}>{row.qiCombo.slice(0, 35)}{row.qiCombo.length > 35 ? "…" : ""}</td>
                      <td className="py-1 text-right">{row.ecSizeSample}</td>
                      <td className="py-1 text-right text-blue-600 font-medium">{row.ecSizePopulation}</td>
                      <td className="py-1 text-right font-bold text-red-600">{row.journalistLinkScore.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ── §6.12 Recommendations ─────────────────────────────────────────────── */}
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function marketerRiskLevel(rate: number): { level: string; color: string; bg: string } {
  if (rate > 0.2) return { level: "HIGH",   color: "#DC2626", bg: "bg-red-50 border-red-200" };
  if (rate > 0.05) return { level: "MEDIUM", color: "#D97706", bg: "bg-amber-50 border-amber-200" };
  return               { level: "LOW",    color: "#16A34A", bg: "bg-green-50 border-green-200" };
}

function marketerValueColor(stars: string): string {
  if (stars === "★★★★★") return "#DC2626";
  if (stars === "★★★★☆") return "#EA580C";
  if (stars === "★★★☆☆") return "#D97706";
  if (stars === "★★☆☆☆") return "#65A30D";
  return "#16A34A";
}

function MarketerReport({ r }: { r: MarketerResult }) {
  const [recordFilter, setRecordFilter] = useState<"all"|"unique"|"partial"|"protected">("all");
  const [recordPage, setRecordPage] = useState(0);
  const PAGE_SIZE = 50;

  const rl = marketerRiskLevel(r.marketerReIdRate);
  const commercialLow  = (r.expectedCorrectReIds * 0.05).toFixed(2);
  const commercialHigh = (r.expectedCorrectReIds * 2.00).toFixed(2);

  const filteredRows = r.recordTable.filter((row) => {
    if (recordFilter === "unique")    return row.ecSize === 1;
    if (recordFilter === "partial")   return row.ecSize > 1 && row.atRisk;
    if (recordFilter === "protected") return !row.atRisk;
    return true;
  });
  const pagedRows = filteredRows.slice(recordPage * PAGE_SIZE, (recordPage + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  // EC distribution chart data
  const ecChartData = r.ecSizeTable.map((row) => ({
    label: row.label,
    records: row.numRecords,
    ecs: row.numECs,
    marketerValue: row.marketerValue,
  }));

  // Donut data
  const donutData = [
    { name: "At Risk",   value: r.atRiskCount,   fill: "#DC2626" },
    { name: "Protected", value: r.protectedCount, fill: "#16A34A" },
  ].filter((d) => d.value > 0);

  const qiList = r.quasiIdentifiers.join(", ") || "—";

  return (
    <div className="space-y-6">

      {/* ── §4.1 Attack Summary Banner ───────────────────────────────────────── */}
      <Card className={`border-2 ${rl.bg}`}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="text-2xl">🔴</div>
              <div>
                <div className="font-bold text-base">MARKETER ATTACK RESULTS</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Dataset rows analysed: <strong>{r.sampleN.toLocaleString()}</strong> &nbsp;|&nbsp;
                  QIs used: <strong>{qiList}</strong> &nbsp;|&nbsp;
                  Population assumption: <strong>{r.populationSize.toLocaleString()}</strong> &nbsp;|&nbsp;
                  Sampling fraction: <strong>{(r.samplingFraction * 100).toFixed(1)}%</strong>
                </div>
              </div>
            </div>
            <Badge className="text-sm px-3 py-1" style={{ backgroundColor: rl.color, color: "#fff" }}>
              RISK: {rl.level}
            </Badge>
          </div>
          <div className="mt-3 p-3 bg-white/60 dark:bg-black/20 rounded text-sm border">
            A data broker who obtained this dataset could correctly re-identify an estimated{" "}
            <strong>{r.expectedCorrectReIds.toLocaleString()}</strong> out of{" "}
            <strong>{r.sampleN.toLocaleString()}</strong> people (
            <strong>{(r.marketerReIdRate * 100).toFixed(1)}%</strong>) by matching records against
            external databases. For every 100 people in the broader population of{" "}
            <strong>{r.populationSize.toLocaleString()}</strong>, roughly{" "}
            <strong>{(r.marketerSuccessRate * 100).toFixed(2)}</strong> can be successfully linked
            to their record here.
          </div>
        </CardContent>
      </Card>

      {/* ── §4.2 Key Metrics Row (6 cards) ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCard(
          "Marketer Re-ID Rate",
          `${(r.marketerReIdRate * 100).toFixed(1)}%`,
          "% of dataset linkable in bulk attack",
          <Users className="h-4 w-4" />,
          r.marketerReIdRate > 0.2 ? "text-red-600" : r.marketerReIdRate > 0.05 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Expected Re-IDs",
          r.expectedCorrectReIds.toLocaleString(),
          "People a data broker correctly identifies",
          <Target className="h-4 w-4" />,
          r.expectedCorrectReIds > r.sampleN * 0.05 ? "text-red-600" : "text-amber-600"
        )}
        {kpiCard(
          "Success Rate vs Pop.",
          `${(r.marketerSuccessRate * 100).toFixed(2)}%`,
          "Chance any random person from pop. is linked",
          <Network className="h-4 w-4" />,
          r.marketerSuccessRate > 0.02 ? "text-red-600" : r.marketerSuccessRate > 0.005 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Unique Records",
          r.numSingletons.toLocaleString(),
          "Records with no look-alike — highest value targets",
          <Fingerprint className="h-4 w-4" />,
          r.numSingletons > 0 ? "text-red-600" : "text-green-600"
        )}
        {kpiCard(
          "Avg EC Size",
          r.avgEcSize.toFixed(1),
          "Average group size sharing same QI values",
          <BarChart3 className="h-4 w-4" />,
          r.avgEcSize < 3 ? "text-red-600" : "text-green-600"
        )}
        {kpiCard(
          "Min-K",
          r.minK,
          "Smallest group found",
          <Shield className="h-4 w-4" />,
          r.minK < 3 ? "text-red-600" : "text-green-600"
        )}
      </div>

      {/* ── §4.3 Record-Level Attack Trace Table ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Record-Level Attack Trace Table</CardTitle>
          <CardDescription className="text-xs">
            Every record with what a data broker sees when attempting bulk linkage.
            Paginated at 50 rows. Download for full export.
          </CardDescription>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["all","unique","partial","protected"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={recordFilter === f ? "default" : "outline"}
                className="text-xs h-7"
                onClick={() => { setRecordFilter(f); setRecordPage(0); }}
              >
                {f === "all" && "Show All"}
                {f === "unique" && "🔴 Uniquely Linkable"}
                {f === "partial" && "🟡 Partially Linkable"}
                {f === "protected" && "🟢 Protected"}
              </Button>
            ))}
            <div className="ml-auto text-xs text-muted-foreground self-center">
              {filteredRows.length} rows
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-1">Row #</th>
                  {r.quasiIdentifiers.slice(0, 4).map((qi) => (
                    <th key={qi} className="text-left pb-1 truncate max-w-[80px]">{qi}</th>
                  ))}
                  <th className="text-right pb-1">Group Size</th>
                  <th className="text-right pb-1">Link Score</th>
                  <th className="text-right pb-1">Mkt. Value</th>
                  <th className="text-right pb-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const status = row.ecSize === 1
                    ? { label: "🔴 UNIQUELY LINKABLE", color: "#DC2626" }
                    : row.atRisk
                      ? { label: "🟡 PARTIALLY LINKABLE", color: "#D97706" }
                      : { label: "🟢 PROTECTED", color: "#16A34A" };
                  return (
                    <tr key={row.rowIdx} className="border-b border-muted hover:bg-muted/30">
                      <td className="py-1 text-muted-foreground">{row.rowIdx}</td>
                      {r.quasiIdentifiers.slice(0, 4).map((qi) => (
                        <td key={qi} className="py-1 truncate max-w-[80px] text-muted-foreground">
                          {row.qiValues[qi] ?? "—"}
                        </td>
                      ))}
                      <td className="py-1 text-right">{row.ecSize}</td>
                      <td className="py-1 text-right font-mono font-bold" style={{ color: row.linkScore >= 1 ? "#DC2626" : row.linkScore >= 0.5 ? "#EA580C" : "#16A34A" }}>
                        {row.linkScore.toFixed(2)}
                      </td>
                      <td className="py-1 text-right font-mono" style={{ color: marketerValueColor(row.marketerValue) }}>
                        {row.marketerValue}
                      </td>
                      <td className="py-1 text-right text-xs font-medium" style={{ color: status.color }}>
                        {status.label}
                      </td>
                    </tr>
                  );
                })}
                {pagedRows.length === 0 && (
                  <tr><td colSpan={8 + r.quasiIdentifiers.slice(0,4).length} className="py-4 text-center text-muted-foreground">No records match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setRecordPage(p => Math.max(0, p - 1))} disabled={recordPage === 0}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span>Page {recordPage + 1} / {totalPages}</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setRecordPage(p => Math.min(totalPages - 1, p + 1))} disabled={recordPage === totalPages - 1}>
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── §4.4 Attack Narrative ────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Attack Simulation — How the Marketer Attack Works on YOUR Data</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-3">
            <div className="p-3 bg-muted/40 rounded border-l-4 border-red-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 1 — The Data Broker's Starting Point</div>
              A commercial attacker acquires this dataset (purchased, leaked, or obtained via a freedom-of-information request).
              They do <strong>NOT</strong> know in advance who is in it. They have access to external databases: voter rolls,
              telecom directories, credit bureau records, social media profiles.
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-orange-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 2 — Bulk Matching</div>
              The attacker runs an automated join: <em>"Match all records where {qiList} aligns with records in the voter roll database."</em><br />
              This dataset has <strong>{r.numDistinctEcs.toLocaleString()}</strong> distinct QI combinations.
              Each distinct combination gives the attacker one expected correct match.
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-amber-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 3 — Scale of Success</div>
              Expected correct re-identifications: <strong>{r.expectedCorrectReIds.toLocaleString()}</strong> out of{" "}
              <strong>{r.sampleN.toLocaleString()}</strong> records = <strong>{(r.marketerReIdRate * 100).toFixed(1)}%</strong> of this dataset.<br />
              Out of <strong>{r.numSingletons.toLocaleString()}</strong> singleton records: each can be matched with <strong>100% certainty</strong>.
              A data broker pays a premium for these "gold" records.
            </div>
            {r.attrDisclosure.length > 0 && (
              <div className="p-3 bg-muted/40 rounded border-l-4 border-blue-500">
                <div className="font-semibold text-xs text-muted-foreground mb-1">Step 4 — Attribute Harvesting</div>
                Once linked, the attacker reads sensitive attributes:
                <ul className="mt-1 space-y-0.5">
                  {r.attrDisclosure.map((a) => (
                    <li key={a.sa}>• <strong>{a.sa}</strong>: average inference accuracy = <strong>{(a.avgDisclosureRisk * 100).toFixed(1)}%</strong></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="p-3 bg-muted/40 rounded border-l-4 border-purple-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 5 — Commercial Outcome</div>
              A dataset of <strong>{r.sampleN.toLocaleString()}</strong> records with{" "}
              <strong>{(r.marketerReIdRate * 100).toFixed(1)}%</strong> linkability can yield{" "}
              <strong>{r.expectedCorrectReIds.toLocaleString()}</strong> verified profiles.<br />
              At typical data broker prices ($0.05–$2.00 per verified record), this dataset's re-identification value is estimated at{" "}
              <strong className="text-red-600">${commercialLow} – ${commercialHigh}</strong>.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── §4.5 EC Distribution + Marketer Value annotation ─────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Equivalence Class Distribution (with Marketer Value)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ecChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="records" name="Records" radius={[4,4,0,0]}>
                  {ecChartData.map((entry, i) => {
                    const fills = ["#DC2626","#EA580C","#D97706","#65A30D","#16A34A"];
                    return <Cell key={i} fill={fills[i] ?? "#16A34A"} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs mt-3">
              <thead><tr className="border-b"><th className="text-left pb-1">EC Size</th><th className="text-right pb-1"># ECs</th><th className="text-right pb-1"># Records</th><th className="text-right pb-1">% Dataset</th><th className="text-right pb-1">Mkt. Value</th></tr></thead>
              <tbody>
                {r.ecSizeTable.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1">{row.label}</td>
                    <td className="py-1 text-right">{row.numECs}</td>
                    <td className="py-1 text-right">{row.numRecords}</td>
                    <td className="py-1 text-right">{row.pct}</td>
                    <td className="py-1 text-right font-mono" style={{ color: marketerValueColor(row.marketerValue) }}>{row.marketerValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* ── §4.6 Link Score Distribution ─────────────────────────────────── */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Link Score Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.linkScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4,4,0,0]}>
                  {r.linkScoreDistribution.map((_, i) => {
                    const fills = ["#DC2626","#EA580C","#D97706","#65A30D","#16A34A"];
                    return <Cell key={i} fill={fills[i] ?? "#16A34A"} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs mt-3">
              <thead><tr className="border-b"><th className="text-left pb-1">Score Range</th><th className="text-right pb-1">Records</th><th className="text-left pb-1 pl-2">Interpretation</th></tr></thead>
              <tbody>
                {r.linkScoreDistribution.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1 font-mono text-xs">{row.bucket}</td>
                    <td className="py-1 text-right font-bold">{row.count}</td>
                    <td className="py-1 pl-2 text-muted-foreground">{row.interpretation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── §4.7 Attribute Disclosure Risk (Marketer-Specific) ───────────────── */}
      {r.attrDisclosure.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Attribute Disclosure Risk (Marketer-Specific)</CardTitle>
            <CardDescription className="text-xs">
              How accurately a data broker can infer each sensitive attribute — even without full re-identification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {r.attrDisclosure.map((a) => {
              const statusColor = a.status === "FAIL" ? "#DC2626" : a.status === "WARN" ? "#D97706" : "#16A34A";
              const statusEmoji = a.status === "FAIL" ? "🔴 FAIL" : a.status === "WARN" ? "🟡 WARN" : "🟢 PASS";
              return (
                <div key={a.sa} className="p-3 rounded border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{a.sa}</span>
                    <Badge style={{ backgroundColor: statusColor, color: "#fff" }}>{statusEmoji}</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Avg inference accuracy</div>
                      <div className="font-bold text-sm" style={{ color: statusColor }}>{(a.avgDisclosureRisk * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">ECs with 100% certainty</div>
                      <div className="font-bold text-sm">{a.pctEcsFullDisclosure.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Min inference (safest EC)</div>
                      <div className="font-bold text-sm">{(a.minDisclosureRisk * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Max inference (most exposed)</div>
                      <div className="font-bold text-sm">{(a.maxDisclosureRisk * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    For <strong>{a.pctEcsFullDisclosure.toFixed(1)}%</strong> of groups in this dataset, every record shares the{" "}
                    <strong>SAME {a.sa}</strong> value. An attacker who links any member of such a group immediately learns{" "}
                    <strong>{a.sa}</strong> for everyone in that group.
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── §4.8 Population Inference Risk (Marketer-Specific) ──────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Population Inference Risk (Marketer-Specific)</CardTitle>
          <CardDescription className="text-xs">
            Singletons reveal that certain QI combinations are rare or unique in the real world — itself sensitive information.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-muted/40 rounded text-center">
              <div className="text-xs text-muted-foreground">Dataset Size</div>
              <div className="font-bold text-lg">{r.sampleN.toLocaleString()}</div>
            </div>
            <div className="p-3 bg-muted/40 rounded text-center">
              <div className="text-xs text-muted-foreground">Population</div>
              <div className="font-bold text-lg">{r.populationSize.toLocaleString()}</div>
            </div>
            <div className="p-3 bg-muted/40 rounded text-center">
              <div className="text-xs text-muted-foreground">Sampling Fraction</div>
              <div className="font-bold text-lg">{(r.samplingFraction * 100).toFixed(1)}%</div>
            </div>
            <div className="p-3 bg-muted/40 rounded text-center border border-red-200">
              <div className="text-xs text-muted-foreground">Singletons</div>
              <div className="font-bold text-lg text-red-600">{r.numSingletons} ({(r.populationInferenceRisk * 100).toFixed(1)}%)</div>
            </div>
          </div>
          {r.topSingletons.length > 0 && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 text-xs">
              <div className="font-semibold mb-2">Top singleton examples (unique in dataset → likely rare in population of {r.populationSize.toLocaleString()}):</div>
              {r.topSingletons.map((s, i) => (
                <div key={i} className="py-0.5">
                  Row {s.rowIdx}: {Object.entries(s.qiValues).map(([k, v]) => `${k}=${v}`).join(", ")} → <span className="text-red-600 font-semibold">unique in dataset → likely rare in population</span>
                </div>
              ))}
            </div>
          )}
          <div className="p-3 bg-muted/40 rounded text-xs">
            <div className="font-semibold mb-1">Marketer Success Rate (with population prior):</div>
            <div className="font-mono">
              = (N / P) × Marketer Re-ID Rate<br />
              = ({r.sampleN.toLocaleString()} / {r.populationSize.toLocaleString()}) × {(r.marketerReIdRate * 100).toFixed(1)}%<br />
              = <strong className={r.marketerSuccessRate > 0.02 ? "text-red-600" : "text-green-600"}>{(r.marketerSuccessRate * 100).toFixed(2)}%</strong>
            </div>
            <div className="mt-2 text-muted-foreground">
              If a data broker randomly picks any person from the population of {r.populationSize.toLocaleString()}, there is a{" "}
              <strong>{(r.marketerSuccessRate * 100).toFixed(2)}%</strong> chance they can correctly find and link that person's record in this dataset.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── §4.9 L-Diversity + §4.10 T-Closeness ───────────────────────────── */}
      {(r.lDiversityResults.length > 0 || r.tClosenessResults.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">L-Diversity Check</CardTitle>
              <CardDescription className="text-xs">
                Marketer framing: attacker who links any record in a uniform-SA EC learns that attribute for ALL matched records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {r.lDiversityResults.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4">No sensitive attributes selected.</div>
              ) : (
                <div className="space-y-3">
                  {/* Singleton-EC artifact caveat */}
                  {r.lDiversityResults[0] && r.lDiversityResults[0].totalEcs >= r.sampleN * 0.9 && (
                    <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                      <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — L-Diversity failures are not an independent risk signal here</div>
                      All {r.lDiversityResults[0].totalEcs} equivalence classes are singletons. A group of 1 record can only contain 1 distinct SA value — L-Diversity l≥2 failures are mathematically inevitable here, <strong>not evidence of homogeneity</strong>. Reduce QI granularity to create multi-record ECs for a meaningful L-Diversity assessment.
                    </div>
                  )}
                  {r.lDiversityResults.map((ld) => (
                    <div key={ld.sa} className="p-3 rounded border">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-sm">{ld.sa}</span>
                        <Badge className={ld.status === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                          {ld.status === "PASS" ? "🟢 PASS" : "🔴 FAIL"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Min distinct values</div><div className="font-bold">{ld.minL}</div></div>
                        <div><div className="text-muted-foreground">Violating ECs</div><div className="font-bold text-red-600">{ld.violatingEcs}/{ld.totalEcs}</div></div>
                        <div><div className="text-muted-foreground">Records in viol. ECs</div><div className="font-bold">{ld.violatingRecordPct}%</div></div>
                      </div>
                      {ld.status === "FAIL" && ld.totalEcs < r.sampleN * 0.9 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          In {ld.violatingEcs} EC{ld.violatingEcs > 1 ? "s" : ""}, all records share the same <strong>{ld.sa}</strong> value.
                          A data broker who links any record from such a group learns <strong>{ld.sa}</strong> for the ENTIRE group — bulk attribute disclosure.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">T-Closeness Check</CardTitle>
              <CardDescription className="text-xs">
                Marketer framing: SA distribution skew within ECs allows higher-accuracy inference than guessing from the global average.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {r.tClosenessResults.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4">No sensitive attributes selected.</div>
              ) : (
                <div className="space-y-3">
                  {/* Singleton-EC artifact caveat */}
                  {r.tClosenessResults[0] && r.tClosenessResults[0].totalEcs >= r.sampleN * 0.9 && (
                    <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                      <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — High TVD caused by singleton ECs, not distributional skew within groups</div>
                      A single-record EC is always 100% one SA value → TVD against the global distribution is always near 1.0. These T-Closeness violations are a structural inevitability of singleton groups, <strong>not evidence that a data broker can exploit distributional skew</strong>.
                    </div>
                  )}
                  {r.tClosenessResults.map((tc) => (
                    <div key={tc.sa} className="p-3 rounded border">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-sm">{tc.sa}</span>
                        <Badge className={tc.status === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                          {tc.status === "PASS" ? "🟢 PASS" : "🔴 FAIL"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Max EC deviation (TVD)</div><div className="font-bold">{tc.maxDistance}</div></div>
                        <div><div className="text-muted-foreground">Violating ECs</div><div className="font-bold text-red-600">{tc.violatingEcs}/{tc.totalEcs}</div></div>
                      </div>
                      {tc.status === "FAIL" && tc.totalEcs < r.sampleN * 0.9 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          The distribution of <strong>{tc.sa}</strong> inside individual QI groups is very different from its distribution in the overall dataset.
                          A data broker can use this skew to infer <strong>{tc.sa}</strong> with higher accuracy than guessing from the global average.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── §4.11 Risk Protection Donut ─────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Risk–Protection Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                    {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toLocaleString()} records`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-600" />
                  <span>At Risk: <strong>{r.atRiskCount.toLocaleString()}</strong> ({r.sampleN > 0 ? ((r.atRiskCount / r.sampleN) * 100).toFixed(1) : 0}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-600" />
                  <span>Protected: <strong>{r.protectedCount.toLocaleString()}</strong> ({r.sampleN > 0 ? ((r.protectedCount / r.sampleN) * 100).toFixed(1) : 0}%)</span>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  <strong>At Risk:</strong> Commercially valuable — QI combination rare enough to allow confident linkage.<br />
                  <strong>Protected:</strong> Shares QI with ≥ k others — individual linkage unprofitable.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── §4.12 Top Vulnerable Records ──────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top 10 Most Vulnerable Records (★ Value)</CardTitle>
            <CardDescription className="text-xs">Highest commercial re-identification value. Suppress or generalise before release.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pb-1">Rank</th>
                    <th className="text-left pb-1">QI Combination</th>
                    <th className="text-right pb-1">Link Score</th>
                    <th className="text-right pb-1">EC</th>
                    <th className="text-right pb-1">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {r.topVulnerable.map((rec, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1">{i + 1}</td>
                      <td className="py-1 truncate max-w-[140px] text-muted-foreground" title={rec.qiCombo}>{rec.qiCombo.slice(0, 40)}</td>
                      <td className="py-1 text-right font-mono font-bold" style={{ color: rec.linkScore >= 1 ? "#DC2626" : "#D97706" }}>{rec.linkScore.toFixed(2)}</td>
                      <td className="py-1 text-right">{rec.ecSize}</td>
                      <td className="py-1 text-right font-mono" style={{ color: marketerValueColor(rec.marketerValue) }}>{rec.marketerValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ── §4.13 Recommendations ───────────────────────────────────────────── */}
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function SinglingOutReport({ r }: { r: SingleOutResult }) {
  const [recordFilter, setRecordFilter] = useState<"all" | "singled" | "partial" | "protected">("all");
  const [recordPage, setRecordPage] = useState(0);
  const PAGE_SIZE = 50;

  const qiList = r.quasiIdentifiers.join(", ") || "—";
  const riskColor = r.riskLevel === "HIGH" ? "#DC2626" : r.riskLevel === "MEDIUM" ? "#D97706" : "#16A34A";
  const riskEmoji = r.riskLevel === "HIGH" ? "🔴" : r.riskLevel === "MEDIUM" ? "🟡" : "🟢";

  const soRateColor = (rate: number) => rate > 20 ? "#DC2626" : rate > 5 ? "#D97706" : "#16A34A";

  // Top solo column
  const topSoloEntry = Object.entries(r.soloSoCounts).sort((a, b) => b[1] - a[1])[0];
  // Top dangerous pair
  const topPairSubset = r.topDangerousSubsets.find((s) => s.subsetSize === 2);
  // Top narrative subset (most singling-out records)
  const topNarrativeSubset = r.topDangerousSubsets[0];
  const topVulnRecord = r.topVulnerable[0];

  // Filtered + paginated records
  const filteredRecords = r.allRecords.filter((rec) => {
    if (recordFilter === "singled") return rec.status === "SINGLED_OUT";
    if (recordFilter === "partial") return rec.status === "PARTIALLY_ISOLATED";
    if (recordFilter === "protected") return rec.status === "PROTECTED";
    return true;
  });
  const pageCount = Math.ceil(filteredRecords.length / PAGE_SIZE);
  const pageRecords = filteredRecords.slice(recordPage * PAGE_SIZE, (recordPage + 1) * PAGE_SIZE);

  // Donut data
  const donutData = [
    { name: "Singled Out", value: r.atRiskCount, fill: "#DC2626" },
    { name: "Protected", value: r.protectedCount, fill: "#16A34A" },
  ];

  // EC dist chart data
  const ecChartData = r.ecDistribution.map((b) => ({
    name: b.sizeLabel,
    records: b.numRecords,
    ecs: b.numECs,
    fill: b.minSize === 1 ? "#DC2626" : b.minSize <= 4 ? "#EA580C" : b.minSize <= 10 ? "#D97706" : "#16A34A",
  }));

  // SO score dist chart
  const soScoreChartData = r.soScoreDistribution.map((b, i) => ({
    name: b.label.split(" ")[0],
    count: b.count,
    fill: ["#DC2626", "#EA580C", "#D97706", "#2563EB", "#16A34A"][i],
  }));

  // Solo column chart
  const soloChartData = Object.entries(r.soloSoCounts)
    .map(([col, cnt]) => ({ col, rate: r.N > 0 ? Math.round((cnt / r.N) * 1000) / 10 : 0 }))
    .sort((a, b) => b.rate - a.rate);

  return (
    <div className="space-y-6">

      {/* §4.1 Attack Summary Banner */}
      <Card className="border-2" style={{ borderColor: riskColor }}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="text-2xl">{riskEmoji}</div>
              <div>
                <div className="font-bold text-base">SINGLING OUT ATTACK RESULTS</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Dataset: <strong>{r.N.toLocaleString()} rows analysed</strong> &nbsp;|&nbsp;
                  QIs used: <strong>{qiList}</strong> &nbsp;|&nbsp;
                  Subsets tested: <strong>{r.totalSubsetsTested}</strong> (max 3 columns)
                </div>
              </div>
            </div>
            <Badge style={{ backgroundColor: riskColor, color: "#fff" }} className="text-sm px-3 py-1">
              RISK LEVEL: {r.riskLevel}
            </Badge>
          </div>
          <div className="mt-3 p-3 bg-white/60 dark:bg-black/20 rounded text-sm border">
            An attacker with <strong>only the released CSV file</strong> (no external data needed) can write a simple database query
            that isolates exactly ONE person for <strong style={{ color: riskColor }}>{r.predicateSoRate.toFixed(1)}%</strong> of records
            — that is <strong>{r.atRiskCount.toLocaleString()}</strong> out of <strong>{r.N.toLocaleString()}</strong> individuals.{" "}
            <strong>{r.numSingletons}</strong> records are uniquely identified by their combination of all selected QI values alone.
          </div>
        </CardContent>
      </Card>

      {/* §4.2 Key Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCard(
          "Predicate SO Rate",
          `${r.predicateSoRate.toFixed(1)}%`,
          "% isolatable by a simple predicate query",
          <Fingerprint className="h-4 w-4" />,
          r.predicateSoRate > 20 ? "text-red-600" : r.predicateSoRate > 5 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Probabilistic SO Rate",
          `${r.probSoRate.toFixed(1)}%`,
          "Expected % isolatable via statistical inference",
          <Brain className="h-4 w-4" />,
          r.probSoRate > 20 ? "text-red-600" : r.probSoRate > 5 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Singled-Out Records",
          r.atRiskCount.toLocaleString(),
          "Isolated by at least one QI subset",
          <AlertTriangle className="h-4 w-4" />,
          r.atRiskCount > 0 ? "text-red-600" : "text-green-600"
        )}
        {kpiCard(
          "Full-QI Singletons",
          r.numSingletons.toLocaleString(),
          "Unique under ALL selected QIs",
          <Target className="h-4 w-4" />,
          r.numSingletons > 0 ? "text-red-600" : "text-green-600"
        )}
        {kpiCard(
          "Subsets Tested",
          r.totalSubsetsTested.toLocaleString(),
          "QI combinations evaluated",
          <BarChart3 className="h-4 w-4" />,
          "text-blue-600"
        )}
        {kpiCard(
          "Min-K",
          r.minK,
          "Smallest equivalence class found",
          <Shield className="h-4 w-4" />,
          r.minK < 2 ? "text-red-600" : r.minK < 5 ? "text-amber-600" : "text-green-600"
        )}
      </div>

      {/* §4.11 Risk Protection Donut + §4.5 EC Distribution */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Singled Out vs Protected</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `${v.toLocaleString()} records`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-xs text-muted-foreground mt-2 text-center">
              <span className="text-red-600 font-semibold">{r.atRiskCount.toLocaleString()} Singled Out</span>
              {" — isolated by at least one QI predicate. "}
              <span className="text-green-600 font-semibold">{r.protectedCount.toLocaleString()} Protected</span>
              {" — no combination of up to 3 QI columns tested isolates these records."}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Equivalence Class Size Distribution</CardTitle>
            <CardDescription className="text-xs">
              ← 🔴 Size=1 records can be isolated by a single predicate query. No external data needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={ecChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={115} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="records" name="Records" radius={[0, 4, 4, 0]}>
                  {ecChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs mt-2">
              <thead><tr className="border-b">
                <th className="text-left pb-1">EC Size</th>
                <th className="text-right pb-1"># ECs</th>
                <th className="text-right pb-1"># Records</th>
                <th className="text-right pb-1">% Dataset</th>
              </tr></thead>
              <tbody>
                {r.ecDistribution.map((b, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1 font-medium">{b.sizeLabel}</td>
                    <td className="py-1 text-right">{b.numECs}</td>
                    <td className="py-1 text-right font-bold">{b.numRecords}</td>
                    <td className="py-1 text-right">{b.pctDataset}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* §4.4 Attack Narrative */}
      {topNarrativeSubset && topVulnRecord && (
        <Card>
          <CardHeader><CardTitle className="text-sm">🔍 Attack Simulation — How the Singling Out Attack Works on YOUR Data</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="p-3 bg-muted/40 rounded border-l-4 border-purple-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 1 — Attacker's Starting Point</div>
              The attacker has <strong>ONLY the released CSV file</strong>. No external databases. No knowledge of who is in the dataset.
              They write automated queries — trying every 1-column, 2-column, and 3-column combination of [<em>{qiList}</em>] to find queries that return exactly 1 row.
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-red-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 2 — Finding a Singling-Out Predicate</div>
              The attacker tests the combination: <strong>[{topNarrativeSubset.subset.join(", ")}]</strong>
              <br />Query: "Show me records where {topNarrativeSubset.subset.map((c) => `${c} = [value]`).join(" AND ")}"
              <br />Result: <strong>{topNarrativeSubset.soCount} record{topNarrativeSubset.soCount !== 1 ? "s" : ""} singled out</strong> ({topNarrativeSubset.soRate.toFixed(1)}% of dataset) — exactly ONE match for each.
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-orange-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 3 — What the Attacker Now Knows</div>
              Without any external data, the attacker has isolated unique individuals.
              From each record, they can now read <strong>all columns — including sensitive ones</strong>.
              Even if these columns were anonymised, the attacker can track these unique profiles across future dataset releases.
              <br />Most isolating predicate found: <code className="text-xs bg-muted px-1 rounded">{topVulnRecord.mostIsolatingPredicate}</code>
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-amber-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 4 — Scale of Singling Out</div>
              The attacker ran <strong>{r.totalSubsetsTested}</strong> queries automatically.{" "}
              <strong>{r.atRiskCount} records ({r.predicateSoRate.toFixed(1)}%)</strong> were singled out by at least one of these queries.
              {topPairSubset && (
                <> The most dangerous column pair found: <strong>[{topPairSubset.subset.join(", ")}]</strong> — singles out <strong>{topPairSubset.soCount} records</strong> with just 2 columns.</>
              )}
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-blue-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 5 — Why This Requires No External Data</div>
              Unlike the Prosecutor or Marketer attacks, the attacker here never leaves the dataset. The risk is entirely internal — a consequence of rare or unique QI combinations within the released file itself.
            </div>
          </CardContent>
        </Card>
      )}

      {/* §4.7 Dangerous Column Combinations */}
      {r.topDangerousSubsets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Dangerous Column Combinations (Ranked by Records Singled Out)</CardTitle>
            <CardDescription className="text-xs">
              Columns at the top are the ones the data custodian should prioritise for generalisation or suppression.
              Even a single high-cardinality column can single out every record on its own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-2">Rank</th>
                  <th className="text-left pb-2">Column Combination</th>
                  <th className="text-right pb-2"># Records Singled Out</th>
                  <th className="text-right pb-2">SO Rate</th>
                  <th className="text-right pb-2">Subset Size</th>
                  <th className="text-right pb-2">Min EC Size</th>
                </tr>
              </thead>
              <tbody>
                {r.topDangerousSubsets.map((s, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1.5 font-bold text-muted-foreground">#{i + 1}</td>
                    <td className="py-1.5 font-medium">{s.subset.join(" + ")}</td>
                    <td className="py-1.5 text-right font-bold" style={{ color: soRateColor(s.soRate) }}>
                      {s.soCount.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right">
                      <Badge variant="outline" style={{ color: soRateColor(s.soRate), borderColor: soRateColor(s.soRate) }} className="text-xs">
                        {s.soRate.toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="py-1.5 text-right">{s.subsetSize}</td>
                    <td className="py-1.5 text-right">{s.minEcSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* §4.8 Per-Column Singling Out Power */}
      {soloChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Per-Column Singling Out Power</CardTitle>
            <CardDescription className="text-xs">
              Records singled out when ONLY this column is used as the predicate.
              A column with Solo SO Rate &gt; 0% is a de-facto direct identifier — it alone can isolate unique individuals without combining with any other column.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(120, soloChartData.length * 28)}>
              <BarChart data={soloChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 10 }} unit="%" tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="col" tick={{ fontSize: 10 }} width={130} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="rate" name="Solo SO Rate" radius={[0, 4, 4, 0]}>
                  {soloChartData.map((entry, i) => (
                    <Cell key={i} fill={soRateColor(entry.rate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs mt-3">
              <thead><tr className="border-b">
                <th className="text-left pb-1">Column</th>
                <th className="text-right pb-1">Records Singled Out (solo)</th>
                <th className="text-right pb-1">Solo SO Rate</th>
                <th className="text-right pb-1">Verdict</th>
              </tr></thead>
              <tbody>
                {soloChartData.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1 font-medium">{row.col}</td>
                    <td className="py-1 text-right">{(r.soloSoCounts[row.col] ?? 0).toLocaleString()}</td>
                    <td className="py-1 text-right font-bold" style={{ color: soRateColor(row.rate) }}>{row.rate.toFixed(1)}%</td>
                    <td className="py-1 text-right text-xs">
                      {row.rate > 20 ? <span className="text-red-600 font-semibold">🔴 Direct Identifier</span>
                        : row.rate > 5 ? <span className="text-amber-600">🟡 High Cardinality</span>
                        : row.rate > 0 ? <span className="text-amber-500">🟡 Some Risk</span>
                        : <span className="text-green-600">🟢 Safe alone</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* §4.6 SO Score Distribution */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">SO Score Distribution</CardTitle>
            <CardDescription className="text-xs">Fraction of tested QI subsets that isolate each record</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={soScoreChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {soScoreChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs mt-2">
              <thead><tr className="border-b">
                <th className="text-left pb-1">SO Score Range</th>
                <th className="text-right pb-1"># Records</th>
                <th className="text-left pb-1 pl-2">Meaning</th>
              </tr></thead>
              <tbody>
                {r.soScoreDistribution.map((b, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1 font-mono text-xs">{b.label}</td>
                    <td className="py-1 text-right font-bold">{b.count}</td>
                    <td className="py-1 pl-2 text-muted-foreground">{b.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Attack Effort Curve</CardTitle>
            <CardDescription className="text-xs">Cumulative % of records singulable using ≤k columns</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={r.effortCurve}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="k" tick={{ fontSize: 11 }} label={{ value: "# Columns", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="pct" stroke="#DC2626" strokeWidth={2} dot name="% Singulable" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* §4.12 Top Vulnerable Records */}
      {r.topVulnerable.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top Vulnerable Records (Highest SO Score)</CardTitle>
            <CardDescription className="text-xs">
              These rows are the highest priority for suppression or generalisation.
              "Most Isolating Predicate" shows exactly what query an attacker would write to find them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[240px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pb-1">Rank</th>
                    <th className="text-right pb-1">EC Size</th>
                    <th className="text-right pb-1">SO Score</th>
                    <th className="text-right pb-1">Prob SO Score</th>
                    <th className="text-left pb-1 pl-2">Most Isolating Predicate</th>
                    <th className="text-right pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.topVulnerable.map((rec, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-bold text-muted-foreground">#{i + 1}</td>
                      <td className="py-1.5 text-right">{rec.ecSize}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: soRateColor(rec.soScore * 100) }}>
                        {rec.soScore.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right">{rec.probSoScore.toFixed(2)}</td>
                      <td className="py-1.5 pl-2 font-mono text-xs truncate max-w-[200px]" title={rec.mostIsolatingPredicate}>
                        {rec.mostIsolatingPredicate}
                      </td>
                      <td className="py-1.5 text-right text-xs font-semibold">
                        {rec.status === "SINGLED_OUT"       && <span className="text-red-600">🔴 SINGLED OUT</span>}
                        {rec.status === "PARTIALLY_ISOLATED" && <span className="text-amber-600">🟡 PARTIALLY ISOLATED</span>}
                        {rec.status === "PROTECTED"          && <span className="text-green-600">🟢 PROTECTED</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* §4.3 Record-Level Trace Table */}
      {r.allRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Record-Level Singling Out Trace</CardTitle>
            <CardDescription className="text-xs">
              Full dataset trace — EC Size, SO Score, Prob SO Score, and isolation status for every record.
            </CardDescription>
            <div className="flex flex-wrap gap-2 mt-2">
              {(["all", "singled", "partial", "protected"] as const).map((f) => (
                <Button key={f} size="sm" variant={recordFilter === f ? "default" : "outline"} className="text-xs h-7"
                  onClick={() => { setRecordFilter(f); setRecordPage(0); }}>
                  {f === "all" ? "Show All" : f === "singled" ? "🔴 Singled Out" : f === "partial" ? "🟡 Partially Isolated" : "🟢 Protected"}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground self-center ml-2">{filteredRecords.length} records</span>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-right pb-1">Row #</th>
                    {r.quasiIdentifiers.slice(0, 4).map((qi) => (
                      <th key={qi} className="text-right pb-1 pl-1">{qi}</th>
                    ))}
                    <th className="text-right pb-1">EC Size</th>
                    <th className="text-right pb-1">SO Score</th>
                    <th className="text-right pb-1">Prob SO</th>
                    <th className="text-right pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((rec, i) => (
                    <tr key={i} className={`border-b border-muted ${rec.status === "SINGLED_OUT" ? "bg-red-50 dark:bg-red-950/20" : rec.status === "PARTIALLY_ISOLATED" ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                      <td className="py-1 text-right text-muted-foreground">{rec.rowIndex}</td>
                      {r.quasiIdentifiers.slice(0, 4).map((qi) => (
                        <td key={qi} className="py-1 text-right pl-1 truncate max-w-[80px]" title={rec.qiValues[qi]}>
                          {(rec.qiValues[qi] ?? "").slice(0, 12)}
                        </td>
                      ))}
                      <td className="py-1 text-right font-medium">{rec.ecSize}</td>
                      <td className="py-1 text-right font-bold" style={{ color: soRateColor(rec.soScore * 100) }}>
                        {rec.soScore.toFixed(2)}
                      </td>
                      <td className="py-1 text-right">{rec.probSoScore.toFixed(2)}</td>
                      <td className="py-1 text-right text-xs font-semibold">
                        {rec.status === "SINGLED_OUT"        && <span className="text-red-600">🔴</span>}
                        {rec.status === "PARTIALLY_ISOLATED"  && <span className="text-amber-600">🟡</span>}
                        {rec.status === "PROTECTED"           && <span className="text-green-600">🟢</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {pageCount > 1 && (
              <div className="flex items-center justify-between mt-3 text-xs">
                <Button size="sm" variant="outline" className="h-7" disabled={recordPage === 0} onClick={() => setRecordPage(p => p - 1)}>
                  <ChevronLeft className="h-3 w-3 mr-1" /> Prev
                </Button>
                <span className="text-muted-foreground">Page {recordPage + 1} of {pageCount}</span>
                <Button size="sm" variant="outline" className="h-7" disabled={recordPage >= pageCount - 1} onClick={() => setRecordPage(p => p + 1)}>
                  Next <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* §4.9 L-Diversity per SA */}
      {Object.keys(r.lDiversity).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">L-Diversity Check (per Sensitive Attribute)</CardTitle>
            <CardDescription className="text-xs">
              Combined Singling Out + L-Diversity risk = records that are BOTH isolated AND in L-Diversity-violating ECs.
              For these records, an attacker can isolate the individual AND read their sensitive attribute value with 100% certainty.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(r.lDiversity).map(([sa, res]) => {
              const pct = res.totalECs > 0 ? Math.round(res.violatingECs / res.totalECs * 1000) / 10 : 0;
              const ldStatus = res.violatingECs === 0 ? "PASS" : res.violatingECs / res.totalECs < 0.5 ? "WARN" : "FAIL";
              return (
                <div key={sa} className={`p-3 rounded border ${ldStatus === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : ldStatus === "WARN" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-xs">SA: {sa}</div>
                    <Badge variant="outline" className={`text-xs ${ldStatus === "FAIL" ? "text-red-600 border-red-400" : ldStatus === "WARN" ? "text-amber-600 border-amber-400" : "text-green-600 border-green-400"}`}>
                      {ldStatus === "FAIL" ? "🔴 FAIL" : ldStatus === "WARN" ? "🟡 WARN" : "🟢 PASS"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div><div className="text-muted-foreground">Min L (distinct values)</div><div className="font-bold">{res.minL}</div></div>
                    <div><div className="text-muted-foreground">ECs violating L-Div</div><div className="font-bold text-red-600">{res.violatingECs} / {res.totalECs} ({pct}%)</div></div>
                    <div><div className="text-muted-foreground">Combined Singling+SA Risk</div><div className="font-bold text-red-600">{res.combinedSinglingRisk} records</div></div>
                    <div><div className="text-muted-foreground">Consequence</div><div className="text-xs text-muted-foreground">{res.combinedSinglingRisk > 0 ? `Attacker can isolate & read ${sa} with 100% certainty for ${res.combinedSinglingRisk} records` : "No combined risk"}</div></div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* §4.10 T-Closeness per SA */}
      {Object.keys(r.tCloseness).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">T-Closeness Check (per Sensitive Attribute)</CardTitle>
            <CardDescription className="text-xs">
              ECs with high T-Closeness deviation that are also size-1 allow the attacker to infer the SA value with certainty — no distributional uncertainty remains when there is only 1 record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left pb-1">Sensitive Attribute</th>
                <th className="text-right pb-1">Max TVD</th>
                <th className="text-right pb-1">ECs Violating T</th>
                <th className="text-right pb-1">Total ECs</th>
                <th className="text-right pb-1">Status</th>
              </tr></thead>
              <tbody>
                {Object.entries(r.tCloseness).map(([sa, res]) => {
                  const tStatus = res.violatingECs === 0 ? "PASS" : res.violatingECs / res.totalECs < 0.5 ? "WARN" : "FAIL";
                  return (
                    <tr key={sa} className="border-b border-muted">
                      <td className="py-2 font-medium">{sa}</td>
                      <td className="py-2 text-right font-mono">{res.maxDistance.toFixed(4)}</td>
                      <td className="py-2 text-right font-bold text-red-600">{res.violatingECs}</td>
                      <td className="py-2 text-right">{res.totalECs}</td>
                      <td className="py-2 text-right">
                        {tStatus === "FAIL" ? <span className="text-red-600 font-semibold">🔴 FAIL</span>
                          : tStatus === "WARN" ? <span className="text-amber-600 font-semibold">🟡 WARN</span>
                          : <span className="text-green-600 font-semibold">🟢 PASS</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* §4.13 Recommendations */}
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function inferenceFormAColor(risk: number): string {
  return risk >= 0.70 ? "#DC2626" : risk >= 0.40 ? "#D97706" : "#16A34A";
}
function inferenceFormABg(risk: number): string {
  return risk >= 0.70 ? "bg-red-50 border-red-200" : risk >= 0.40 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200";
}
function inferenceFormAEmoji(status: string): string {
  return status === "CRITICAL" ? "🔴" : status === "MEDIUM" ? "🟡" : "🟢";
}
function inferenceLiftEmoji(status?: string): string {
  return status === "CRITICAL" ? "🔴" : status === "MEDIUM" ? "🟡" : "🟢";
}

function InferenceReport({ r }: { r: InferenceResult }) {
  const [selectedSA, setSelectedSA] = useState(0);

  const qiList = r.quasiIdentifiers.join(", ") || "—";
  const saList = r.sensitiveAttributes.join(", ") || "—";

  // Worst EC for narrative
  const worstEC = r.perSAResults.length > 0
    ? r.perSAResults[0]?.formA.ecBreakdown[0]
    : null;
  const narrativeSA = r.perSAResults[0];

  // §8.8 high-risk record % per SA
  const riskSummaryBars = r.perSAResults.map((sa) => ({
    label: sa.sa,
    pct: sa.formA.highRiskRecordPct,
    status: sa.formAStatus,
  }));

  // All ECs from selected SA for cross-check table
  const crossCheckSA = r.perSAResults[selectedSA];

  return (
    <div className="space-y-6">

      {/* ── §8.1 Attack Summary Banner ───────────────────────────────────────── */}
      <Card className={`border-2 ${inferenceFormABg(r.overallFormARisk)}`}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="text-2xl">🟣</div>
              <div>
                <div className="font-bold text-base">INFERENCE ATTACK RESULTS</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Rows analysed: <strong>{r.sampleN.toLocaleString()}</strong> &nbsp;|&nbsp;
                  QIs used: <strong>{qiList}</strong> &nbsp;|&nbsp;
                  Sensitive Attributes analysed: <strong>{saList}</strong>
                </div>
              </div>
            </div>
            <Badge style={{ backgroundColor: inferenceFormAColor(r.overallFormARisk), color: "#fff" }} className="text-sm px-3 py-1">
              RISK: {r.overallFormARisk >= 0.70 ? "HIGH" : r.overallFormARisk >= 0.40 ? "MEDIUM" : "LOW"}
            </Badge>
          </div>
          {r.smallSampleWarning && (
            <div className="mt-2 p-2 bg-amber-100 dark:bg-amber-900/30 rounded text-xs border border-amber-300 text-amber-800 dark:text-amber-200">
              ⚠️ Sample size too small for robust statistical inference — results are indicative only. Form A confidence scores near 1.0 may simply reflect small-sample noise.
            </div>
          )}
          <div className="mt-3 p-3 bg-white/60 dark:bg-black/20 rounded text-sm border">
            An attacker who knows someone's <strong>{qiList}</strong> — WITHOUT needing to find that person's exact row — can guess their{" "}
            <strong>{r.highestFormARiskSA}</strong> correctly{" "}
            <strong>{(r.highestFormARisk * 100).toFixed(1)}%</strong> of the time on average (Form A).
            {r.formBComputedCount > 0 && (
              <> Additionally, knowing QIs improves prediction accuracy of <strong>{r.highestFormBLiftSA}</strong>{" "}
              by <strong>+{r.highestFormBLift.toFixed(1)}pp</strong> over a naive guess (Form B Inference Lift).</>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── §8.2 Key Metrics Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpiCard(
          "Highest Form A Risk",
          `${(r.highestFormARisk * 100).toFixed(1)}%`,
          `Worst-case SA: ${r.highestFormARiskSA}`,
          <Brain className="h-4 w-4" />,
          r.highestFormARisk >= 0.70 ? "text-red-600" : r.highestFormARisk >= 0.40 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Avg Form A Risk",
          `${(r.overallFormARisk * 100).toFixed(1)}%`,
          "Overall attribute-guessing risk across all SAs",
          <AlertTriangle className="h-4 w-4" />,
          r.overallFormARisk >= 0.70 ? "text-red-600" : r.overallFormARisk >= 0.40 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Highest Form B Lift",
          r.formBComputedCount > 0 ? `+${r.highestFormBLift.toFixed(1)}pp` : "N/A",
          r.formBComputedCount > 0 ? `Worst SA: ${r.highestFormBLiftSA}` : "Insufficient data for all SAs",
          <BarChart3 className="h-4 w-4" />,
          r.highestFormBLift > 30 ? "text-red-600" : r.highestFormBLift > 10 ? "text-amber-600" : "text-green-600"
        )}
        {kpiCard(
          "Form B Computed",
          `${r.formBComputedCount} / ${r.sensitiveAttributes.length}`,
          "SAs with enough data for global model",
          <CheckCircle className="h-4 w-4" />,
          "text-blue-600"
        )}
        {kpiCard(
          "Hidden Risk ECs",
          r.hiddenRiskECs,
          "ECs that PASS L-Diversity but have Form A > 70%",
          <Eye className="h-4 w-4" />,
          r.hiddenRiskECs > 0 ? "text-red-600" : "text-green-600"
        )}
      </div>

      {/* ── §8.3 Per-SA Breakdown ─────────────────────────────────────────────── */}
      {r.perSAResults.map((sa, saIdx) => (
        <Card key={sa.sa} className={`border ${inferenceFormABg(sa.formA.datasetRisk)}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold tracking-wide">
                SENSITIVE ATTRIBUTE: {sa.sa}
              </CardTitle>
              <Badge style={{ backgroundColor: inferenceFormAColor(sa.formA.datasetRisk), color: "#fff" }}>
                {inferenceFormAEmoji(sa.formAStatus)} {sa.formAStatus}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Form A */}
            <div className="p-3 rounded border bg-white/50 dark:bg-black/20">
              <div className="font-semibold text-xs mb-2 text-muted-foreground uppercase tracking-wider">Form A — Group-Based Inference</div>
              {(() => {
                const isContinuous = sa.formA.saType === "continuous";
                const isLowCard = sa.formA.saType === "binary" || sa.formA.distinctCount <= 5;
                // Show baseline KPIs for non-continuous SAs; for continuous, show a note instead
                // For singleton artifacts: only suppress baseline for high-cardinality/continuous
                const showBaseline = !isContinuous;
                const suppressForSingleton = sa.formA.allSingletonArtifact && !isLowCard;
                const lift = sa.formA.inferenceFormALift;
                return (
                  <>
                    <div className="flex items-center gap-4 mb-3 flex-wrap">
                      <div>
                        <div className="text-xs text-muted-foreground">Dataset-wide avg confidence</div>
                        <div className="text-2xl font-bold" style={{ color: inferenceFormAColor(sa.formA.datasetRisk) }}>
                          {(sa.formA.datasetRisk * 100).toFixed(1)}%
                        </div>
                      </div>
                      {showBaseline && (
                        <>
                          <div>
                            <div className="text-xs text-muted-foreground">Majority-class baseline</div>
                            <div className="text-2xl font-bold text-slate-500">{sa.formA.majorityClassPct.toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Attacker lift vs baseline</div>
                            <div className={`text-xl font-bold ${lift > 10 ? "text-red-600" : lift > 0 ? "text-amber-600" : "text-green-600"}`}>
                              {lift > 0 ? "+" : ""}{lift.toFixed(1)} pp
                            </div>
                          </div>
                        </>
                      )}
                      {isContinuous && (
                        <div className="text-xs text-slate-500 italic self-end pb-1">
                          Baseline comparison not applicable for continuous attributes
                        </div>
                      )}
                      <div>
                        <div className="text-xs text-muted-foreground">Records in high-risk groups (≥70%)</div>
                        <div className="text-xl font-bold text-red-600">{sa.formA.highRiskRecordPct.toFixed(1)}%</div>
                      </div>
                    </div>

                    {/* Continuous SA guidance */}
                    {isContinuous && (
                      <div className="mb-2 p-2 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 rounded text-xs text-slate-700 dark:text-slate-300">
                        ℹ️ <strong>Continuous attribute:</strong> Majority-class baseline is not meaningful here — every unique decimal value counts as its own category (e.g. 37.4 acres ≠ 37.5 acres). To reduce inference risk, use <strong>range bucketing</strong> (e.g. 0–10, 10–25, 25–50 acres) or add <strong>calibrated noise</strong> (±X acres perturbation).
                      </div>
                    )}

                    {/* Lift context notes — only for non-continuous, non-suppressed-singleton */}
                    {showBaseline && !suppressForSingleton && lift <= 5 && sa.formA.datasetRisk >= 0.5 && (
                      <div className="mb-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 rounded text-xs text-green-800 dark:text-green-200">
                        ℹ️ <strong>Low attacker lift:</strong> Form A confidence of {(sa.formA.datasetRisk * 100).toFixed(1)}% is only {lift.toFixed(1)} pp above the majority-class baseline of {sa.formA.majorityClassPct.toFixed(1)}%. A random guesser predicting the majority class would already be right ~{sa.formA.majorityClassPct.toFixed(0)}% of the time — QI groups provide minimal additional inference power.
                      </div>
                    )}
                    {showBaseline && !suppressForSingleton && lift > 10 && (
                      <div className="mb-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded text-xs text-red-800 dark:text-red-200">
                        🔴 <strong>Significant attacker lift:</strong> Form A gives +{lift.toFixed(1)} pp above the {sa.formA.majorityClassPct.toFixed(1)}% majority-class baseline — knowing which QI group a person belongs to meaningfully increases the attacker's ability to infer "{sa.sa}".
                      </div>
                    )}

                    {/* For binary/low-cardinality singletons: show lift notes but add singleton caveat */}
                    {showBaseline && sa.formA.allSingletonArtifact && isLowCard && lift > 10 && (
                      <div className="mb-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded text-xs text-amber-800 dark:text-amber-200">
                        ⚠️ <strong>Singleton caveat:</strong> The +{lift.toFixed(1)} pp lift above baseline is meaningful for this {sa.formA.saType} attribute, but all ECs are currently singletons. Coarsen QIs to form multi-record groups to confirm this risk holds before taking remediation action.
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ── Structural artifact warning when ALL ECs are singletons ── */}
              {sa.formA.ecBreakdown.length > 0 && sa.formA.ecBreakdown.every((ec) => ec.ecSize === 1) && (
                <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/25 border border-amber-300 rounded text-xs text-amber-900 dark:text-amber-200">
                  <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — Form A confidence of 100% is a mathematical artifact, not evidence of group-level inference risk</div>
                  All {sa.formA.ecBreakdown.length} equivalence classes are singletons (each record is unique under the selected QIs).
                  When an EC contains exactly 1 record, its dominant SA value confidence is always 1/1 = 100% <em>by mathematical definition</em> —
                  not because the group is homogeneous, but because there is only one group member.
                  <strong> A genuinely dangerous Form A result would be 100% confidence on ECs of size ≥ 2</strong>, where multiple
                  different people share the same QI profile yet all have the same sensitive value.
                  <div className="mt-1 font-semibold">Fix: Reduce the number or specificity of the selected quasi-identifiers so that multi-record equivalence classes form before interpreting Form A confidence scores.</div>
                </div>
              )}

              {/* ── Per-SA small sample warning ── */}
              {r.smallSampleWarning && (
                <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded text-xs text-amber-800 dark:text-amber-200">
                  ⚠️ Small sample ({r.sampleN} records): Form A confidence scores for "<strong>{sa.sa}</strong>" near 1.0 may reflect small-sample noise rather than a genuine population-level pattern.
                </div>
              )}

              <div className="text-xs font-semibold text-muted-foreground mb-1">Worst Equivalence Classes (top 10 by confidence):</div>
              <ScrollArea className="h-[160px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left pb-1">QI Combination</th>
                      <th className="text-right pb-1">EC Size</th>
                      <th className="text-right pb-1">Most Common {sa.sa}</th>
                      <th className="text-right pb-1">Confidence</th>
                      <th className="text-left pb-1 pl-2">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sa.formA.ecBreakdown.slice(0, 10).map((ec, i) => (
                      <tr key={i} className="border-b border-muted">
                        <td className="py-1 truncate max-w-[150px] text-muted-foreground" title={ec.qiCombo}>{ec.qiCombo.slice(0, 35)}</td>
                        <td className="py-1 text-right">{ec.ecSize}</td>
                        <td className="py-1 text-right font-medium">{ec.mostCommonValue}</td>
                        <td className="py-1 text-right font-bold" style={{ color: inferenceFormAColor(ec.confidence) }}>
                          {(ec.confidence * 100).toFixed(0)}%
                        </td>
                        <td className="py-1 pl-2 text-muted-foreground">
                          {"{" + Object.entries(ec.distribution).map(([k, v]) => `${k}:${v}`).join(", ") + "}"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>

            {/* Form B */}
            <div className="p-3 rounded border bg-white/50 dark:bg-black/20">
              <div className="font-semibold text-xs mb-2 text-muted-foreground uppercase tracking-wider">Form B — Global Predictive Inference</div>
              {sa.formB.status === "insufficient_data" && (
                <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded text-xs text-amber-800 dark:text-amber-200">
                  ⚠️ {sa.formB.message}
                </div>
              )}
              {sa.formB.status === "ok" && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Baseline accuracy</div>
                    <div className="font-bold text-lg text-green-600">{sa.formB.baselineAccuracy}%</div>
                    <div className="text-xs text-muted-foreground">Always-guess-mode</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Attacker accuracy</div>
                    <div className="font-bold text-lg" style={{ color: inferenceFormAColor((sa.formB.attackerAccuracy ?? 0) / 100) }}>
                      {sa.formB.attackerAccuracy}%
                    </div>
                    <div className="text-xs text-muted-foreground">QI→SA model</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Inference Lift</div>
                    <div className="font-bold text-lg" style={{ color: (sa.formB.inferenceLift ?? 0) > 10 ? "#DC2626" : "#16A34A" }}>
                      {(sa.formB.inferenceLift ?? 0) >= 0 ? "+" : ""}{sa.formB.inferenceLift}pp
                    </div>
                    <div className="text-xs font-medium">{inferenceLiftEmoji(sa.formB.liftStatus)} {sa.formB.liftStatus}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">CV Method</div>
                    <div className="font-bold text-sm">{sa.formB.cvMethod}</div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* ── §8.4 Attack Narrative ────────────────────────────────────────────── */}
      {narrativeSA && worstEC && (
        <Card>
          <CardHeader><CardTitle className="text-sm">🔍 Attack Simulation — Inference Attack Walkthrough</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="p-3 bg-muted/40 rounded border-l-4 border-purple-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Scenario</div>
              An attacker (e.g., a data broker, employer, or insurer) has access to this released dataset. They know ONE thing about a person — their{" "}
              <strong>{qiList}</strong> value: <em>perhaps from a job application form.</em> They do NOT know which row in this dataset belongs to that person, and they don't need to.
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-red-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 1 — Filter by known QI</div>
              The attacker filters the dataset to all <strong>{worstEC.ecSize}</strong> records where <strong>{worstEC.qiCombo}</strong>. (No re-identification — just a group filter.)
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-orange-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 2 — Read off the dominant Sensitive Attribute value</div>
              Within this group, <strong>{worstEC.distribution[worstEC.mostCommonValue] ?? "?"}</strong> out of{" "}
              <strong>{worstEC.ecSize}</strong> records have <strong>{narrativeSA.sa} = {worstEC.mostCommonValue}</strong>. The attacker concludes:{" "}
              <em>"{(worstEC.confidence * 100).toFixed(0)}% chance this person's {narrativeSA.sa} is {worstEC.mostCommonValue}."</em>
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-amber-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 3 — Use the inference</div>
              The attacker now has a high-confidence guess about this person's <strong>{narrativeSA.sa}</strong> (e.g., Social_Group, Religion, Land holdings) <strong>WITHOUT EVER KNOWING WHICH ROW BELONGED TO THEM</strong>. K-anonymity, which only protects against row-identification, provides NO protection against this.
            </div>
            <div className="p-3 bg-muted/40 rounded border-l-4 border-blue-500">
              <div className="font-semibold text-xs text-muted-foreground mb-1">Step 4 — Scale</div>
              {narrativeSA.formA.ecBreakdown.filter((e) => e.confidence >= 0.80).length} out of{" "}
              {narrativeSA.formA.ecBreakdown.length} equivalence classes have Form A confidence ≥ 80% for{" "}
              <strong>{narrativeSA.sa}</strong>.{" "}
              <strong>{narrativeSA.formA.highRiskRecordPct.toFixed(1)}%</strong> of records fall into high-inference-risk groups.
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── §8.5 Form A Confidence Distribution Chart (per SA, tabbed) ──────── */}
      {r.perSAResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Form A Confidence Distribution by Sensitive Attribute</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              {r.perSAResults.map((sa, i) => (
                <Button key={sa.sa} size="sm" variant={selectedSA === i ? "default" : "outline"} className="text-xs h-7"
                  onClick={() => setSelectedSA(i)}>{sa.sa}</Button>
              ))}
            </div>
          </CardHeader>
          {r.perSAResults[selectedSA] && (
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={r.perSAResults[selectedSA].formA.confidenceDistribution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Bar dataKey="numRecords" name="Records" radius={[4, 4, 0, 0]}>
                    {r.perSAResults[selectedSA].formA.confidenceDistribution.map((_, i) => {
                      const fills = ["#DC2626", "#EA580C", "#D97706", "#16A34A"];
                      return <Cell key={i} fill={fills[i] ?? "#16A34A"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="w-full text-xs mt-3">
                <thead><tr className="border-b">
                  <th className="text-left pb-1">Confidence Range</th>
                  <th className="text-right pb-1"># ECs</th>
                  <th className="text-right pb-1"># Records</th>
                  <th className="text-right pb-1">% Dataset</th>
                  <th className="text-left pb-1 pl-2">Meaning</th>
                </tr></thead>
                <tbody>
                  {r.perSAResults[selectedSA].formA.confidenceDistribution.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 font-mono">{row.bucket}</td>
                      <td className="py-1 text-right">{row.numECs}</td>
                      <td className="py-1 text-right font-bold">{row.numRecords}</td>
                      <td className="py-1 text-right">{row.pct}</td>
                      <td className="py-1 pl-2 text-muted-foreground">{row.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── §8.6 Form A vs L-Diversity Cross-Check Table ────────────────────── */}
      {crossCheckSA && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Form A vs L-Diversity Cross-Check Table</CardTitle>
            <CardDescription className="text-xs">
              🔴 HIDDEN RISK = L-Diversity PASSES but Form A confidence &gt; 70% — these are l-diversity blind spots.
            </CardDescription>
            <div className="flex flex-wrap gap-2 mt-2">
              {r.perSAResults.map((sa, i) => (
                <Button key={sa.sa} size="sm" variant={selectedSA === i ? "default" : "outline"} className="text-xs h-7"
                  onClick={() => setSelectedSA(i)}>{sa.sa}</Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[260px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pb-1">QI Combination</th>
                    <th className="text-right pb-1">EC Size</th>
                    <th className="text-right pb-1">L-Div Distinct</th>
                    <th className="text-right pb-1">L-Div Status</th>
                    <th className="text-right pb-1">Form A Confidence</th>
                    <th className="text-right pb-1">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {crossCheckSA.formA.ecBreakdown.map((ec, i) => (
                    <tr key={i} className={`border-b border-muted ${ec.flag === "HIDDEN_RISK" ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                      <td className="py-1 truncate max-w-[160px] text-muted-foreground" title={ec.qiCombo}>{ec.qiCombo.slice(0, 40)}</td>
                      <td className="py-1 text-right">{ec.ecSize}</td>
                      <td className="py-1 text-right">{ec.lDivDistinct}</td>
                      <td className="py-1 text-right">
                        {ec.lDivStatus === "PASS"
                          ? <span className="text-green-600 font-medium">✅ PASS</span>
                          : <span className="text-red-600 font-medium">❌ FAIL</span>
                        }
                      </td>
                      <td className="py-1 text-right font-bold" style={{ color: inferenceFormAColor(ec.confidence) }}>
                        {(ec.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="py-1 text-right text-xs font-semibold">
                        {ec.flag === "HIDDEN_RISK"    && <span className="text-red-600">🔴 HIDDEN RISK</span>}
                        {ec.flag === "ALREADY_FLAGGED" && <span className="text-orange-600">⚠️ Already flagged</span>}
                        {ec.flag === "SAFE"            && <span className="text-green-600">✅ Genuinely safe</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── §8.7 Form B Model Performance Table ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Form B — Global Predictive Inference Summary</CardTitle>
          <CardDescription className="text-xs">Decision tree (max depth=4) vs naive baseline. Insufficient data = min class count &lt; 10.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left pb-2">Sensitive Attribute</th>
                <th className="text-right pb-2">Baseline Acc.</th>
                <th className="text-right pb-2">Attacker Acc.</th>
                <th className="text-right pb-2">Inference Lift</th>
                <th className="text-right pb-2">CV Method</th>
                <th className="text-right pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {r.perSAResults.map((sa, i) => (
                <tr key={i} className="border-b border-muted">
                  <td className="py-2 font-medium">{sa.sa}</td>
                  {sa.formB.status === "ok" ? (
                    <>
                      <td className="py-2 text-right">{sa.formB.baselineAccuracy}%</td>
                      <td className="py-2 text-right">{sa.formB.attackerAccuracy}%</td>
                      <td className="py-2 text-right font-bold" style={{ color: (sa.formB.inferenceLift ?? 0) > 10 ? "#DC2626" : "#16A34A" }}>
                        {(sa.formB.inferenceLift ?? 0) >= 0 ? "+" : ""}{sa.formB.inferenceLift}pp
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{sa.formB.cvMethod}</td>
                      <td className="py-2 text-right">{inferenceLiftEmoji(sa.formB.liftStatus)} {sa.formB.liftStatus}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-2 text-amber-600 italic">⚠️ insufficient data</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── §8.8 Inference Risk Summary — horizontal bars per SA ────────────── */}
      {riskSummaryBars.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Inference Risk Summary — % Records in High-Risk Groups (Form A ≥ 70%)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {riskSummaryBars.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium">{item.label}</span>
                  <span className="font-bold" style={{ color: inferenceFormAColor(item.pct / 100) }}>
                    {inferenceFormAEmoji(item.status)} {item.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-3">
                  <div
                    className="h-3 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, item.pct)}%`,
                      backgroundColor: inferenceFormAColor(item.pct / 100),
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="flex gap-4 text-xs text-muted-foreground mt-2">
              <span><span className="inline-block w-3 h-3 rounded bg-red-600 mr-1" />≥ 70% 🔴 HIGH</span>
              <span><span className="inline-block w-3 h-3 rounded bg-amber-500 mr-1" />40–70% 🟡 MEDIUM</span>
              <span><span className="inline-block w-3 h-3 rounded bg-green-600 mr-1" />&lt; 40% 🟢 LOW</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── §8.9 Recommendations ────────────────────────────────────────────── */}
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function MembershipReport({ r }: { r: MembershipResult }) {
  const [traceFilter, setTraceFilter] = useState<"all" | "high" | "low">("all");
  const [tracePage, setTracePage] = useState(0);
  const PAGE_SIZE = 15;

  const fAColor = (s: number) => s >= 0.7 ? "#DC2626" : s >= 0.5 ? "#EA580C" : s >= 0.3 ? "#D97706" : "#16A34A";
  const fAEmoji = (s: number) => s >= 0.7 ? "🔴" : s >= 0.5 ? "🟠" : s >= 0.3 ? "🟡" : "🟢";
  const statusBadge = (st: string) =>
    st === "HIGH" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
    : st === "MEDIUM" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
    : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";

  const riskColor = r.pctHighRisk > 20 ? "text-red-600" : r.pctHighRisk > 5 ? "text-amber-600" : "text-green-600";
  const riskLabel = r.pctHighRisk > 20 ? "HIGH RISK" : r.pctHighRisk > 5 ? "MEDIUM RISK" : "LOW RISK";
  const bannerClass = r.pctHighRisk > 20
    ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : r.pctHighRisk > 5 ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
    : "border-green-400 bg-green-50 dark:bg-green-950/20";
  const riskBadgeClass = r.pctHighRisk > 20 ? "bg-red-600 text-white" : r.pctHighRisk > 5 ? "bg-amber-600 text-white" : "bg-green-600 text-white";

  const mostDistinctive = r.top10Distinctive[0];
  const conflictRows = r.crossCheck.filter((c) => c.conflict);
  const profileCols = r.profileAttributesUsed.slice(0, 3);

  const filteredRecords = r.records.filter((rec) =>
    traceFilter === "high" ? rec.highRisk : traceFilter === "low" ? !rec.highRisk : true
  );
  const totalPages = Math.ceil(filteredRecords.length / PAGE_SIZE);
  const pageRecords = filteredRecords.slice(tracePage * PAGE_SIZE, (tracePage + 1) * PAGE_SIZE);

  const BUCKET_FILLS = ["#16A34A", "#65A30D", "#D97706", "#EA580C", "#DC2626"];

  const formAChartData = r.formADistribution.map((b, i) => ({
    range: ["0–0.19","0.2–0.39","0.4–0.59","0.6–0.79","0.8–1.0"][i],
    count: b.count, fill: BUCKET_FILLS[i],
  }));

  return (
    <div className="space-y-6">

      {/* ── §8.1 Attack Summary Banner ─────────────────────────────────────────────── */}
      <div className={`p-4 rounded-lg border-2 ${bannerClass}`}>
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="min-w-0">
            <div className="font-bold text-lg">🟤 MEMBERSHIP INFERENCE ATTACK RESULTS</div>
            <div className="text-sm text-muted-foreground mt-1">
              Rows analysed: <strong>{r.N}</strong> &nbsp;|&nbsp;
              Profile attributes used (QI ∪ SA, direct identifiers excluded): <strong>{r.profileAttributesUsed.length}</strong>
            </div>
            {r.profileAttributesUsed.length > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
                [{r.profileAttributesUsed.join(", ")}]
              </div>
            )}
          </div>
          <Badge className={`shrink-0 text-sm px-3 py-1 ${riskBadgeClass}`}>{riskLabel}</Badge>
        </div>
        <p className="text-sm leading-relaxed">
          This attack asks a different question than the others: NOT "which row is this person" or "what is their attribute",
          but <strong>"is this person's data in this dataset AT ALL"</strong>.{" "}
          <strong className={riskColor}>{r.pctHighRisk}% of records ({r.highRiskCount} out of {r.N})</strong> have
          profiles distinctive enough — either standing out within this dataset (Form A) or rare in the wider population
          (Form B) — that an attacker with a matching external profile could confidently confirm this person participated,
          even without knowing which row is theirs.
        </p>
        <div className="mt-3 p-2 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 rounded text-xs text-amber-900 dark:text-amber-200">
          ⚠️ <strong>Why this matters even if Prosecutor/Journalist risk is LOW:</strong> Membership Inference does NOT
          require finding "your" row. Even a perfectly k-anonymous dataset (every EC size ≥ k) can leak
          the fact that "someone with profile P participated" if profile P is unusual enough overall.
        </div>
        {r.configConflicts.length > 0 && (
          <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 rounded text-xs text-orange-800 dark:text-orange-200">
            ⚠️ <strong>{r.configConflicts.join(", ")}</strong> {r.configConflicts.length === 1 ? "is" : "are"} flagged as
            a direct identifier AND selected as QI/SA — excluded from Form A distance calculation to avoid artificially
            inflating outlier scores. Consider deselecting or binning into ranges first.
          </div>
        )}
        {r.smallSampleWarning && (
          <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded text-xs text-amber-800 dark:text-amber-200">
            ⚠️ With only {r.N} records, results are highly sensitive to individual records. Treat as illustrative only.
          </div>
        )}
      </div>

      {/* ── §8.2 KPI Cards ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Avg Form A Outlier Score</div>
          <div className="text-2xl font-bold mt-1" style={{ color: fAColor(r.avgFormAScore) }}>{r.avgFormAScore.toFixed(3)}</div>
          <div className="text-xs text-muted-foreground">within-dataset distinctiveness</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Avg Form B Population Rarity</div>
          {r.formBStatus === "ok" && r.avgFormBScore !== null
            ? <div className="text-2xl font-bold mt-1" style={{ color: fAColor(r.avgFormBScore) }}>{r.avgFormBScore.toFixed(3)}</div>
            : <div className="text-2xl font-bold mt-1 text-muted-foreground">N/A</div>}
          <div className="text-xs text-muted-foreground">via Multiplier_comb rarity</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">High-Risk Records</div>
          <div className={`text-2xl font-bold mt-1 ${r.highRiskCount > 0 ? "text-red-600" : "text-green-600"}`}>
            {r.highRiskCount} <span className="text-sm">({r.pctHighRisk}%)</span>
          </div>
          <div className="text-xs text-muted-foreground">Form A ≥ 0.7 OR Form B ≥ 0.7</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Most Distinctive Record</div>
          <div className="text-2xl font-bold mt-1 text-red-600">Row #{r.mostDistinctiveRowIdx + 1}</div>
          <div className="text-xs text-muted-foreground">score {r.mostDistinctiveFormAScore.toFixed(3)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Profile Attributes Used</div>
          <div className="text-2xl font-bold mt-1 text-blue-600">{r.profileAttributesUsed.length}</div>
          <div className="text-xs text-muted-foreground">columns in Gower distance</div>
        </CardContent></Card>
      </div>

      {/* ── §8.4 Attack Simulation Narrative ───────────────────────────────────────── */}
      {mostDistinctive && (
        <Card>
          <CardHeader><CardTitle className="text-sm">🔍 ATTACK SIMULATION — Membership Inference Walkthrough</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              <strong>Scenario:</strong> An attacker has obtained a profile of a specific person — from a leaked HR
              database, social media, or another linked dataset — containing:{" "}
              <span className="font-mono text-foreground text-xs">
                {Object.entries(mostDistinctive.profileValues).map(([k, v]) => `${k}=${v}`).join(", ")}
              </span>
            </p>
            <p className="text-muted-foreground text-xs">
              The attacker does <strong>NOT</strong> know if this person took part in this particular survey. They want to find out.
            </p>
            <div className="space-y-2 pl-4 border-l-2 border-muted text-xs">
              <div>
                <strong>Step 1 — Search for a close match</strong>
                <p className="text-muted-foreground mt-0.5">
                  The attacker scans this dataset's {r.profileAttributesUsed.length} profile attributes for records similar to the target profile using Gower distance.
                </p>
              </div>
              <div>
                <strong>Step 2 — Evaluate the closest match</strong>
                <p className="text-muted-foreground mt-0.5">
                  Row #{mostDistinctive.nearestNeighborIdx + 1} is the closest match, with a Gower distance of{" "}
                  <strong style={{ color: fAColor(mostDistinctive.formAScore) }}>{mostDistinctive.formAScore.toFixed(3)}</strong> —
                  meaning the two profiles are {(mostDistinctive.formAScore * 100).toFixed(0)}% different across all profile attributes.
                </p>
                {mostDistinctive.formAScore >= 0.7 ? (
                  <p className="text-amber-700 dark:text-amber-300 mt-1">
                    ⚠️ This is a poor match — no record closely resembles the target. However, if the attacker knows this dataset
                    is meant to be representative of people like their target, the presence of such a distinctive profile confirms
                    "someone like this is in the data."
                  </p>
                ) : (
                  <p className="text-green-700 dark:text-green-300 mt-1">
                    ✅ Multiple records closely resemble this profile. The attacker CANNOT confidently distinguish "my target's data"
                    from "a similar-looking other person's data" — this provides plausible deniability.
                  </p>
                )}
              </div>
              {r.formBStatus === "ok" && mostDistinctive.formBScore !== null && (
                <div>
                  <strong>Step 3 — Population context (Form B)</strong>
                  <p className="text-muted-foreground mt-0.5">
                    This profile's estimated population rarity score is{" "}
                    <strong style={{ color: fAColor(mostDistinctive.formBScore) }}>{mostDistinctive.formBScore.toFixed(3)}</strong> (via Multiplier_comb).{" "}
                    {mostDistinctive.formBScore >= 0.7
                      ? "This profile is RARE in the general population — finding any closely-matching record strongly suggests their target participated."
                      : "This profile is relatively common in the general population, reducing Form B membership confidence."}
                  </p>
                </div>
              )}
              <div>
                <strong>Step {r.formBStatus === "ok" ? "4" : "3"} — Scale</strong>
                <p className="text-muted-foreground mt-0.5">
                  <strong className={riskColor}>{r.highRiskCount} out of {r.N} records ({r.pctHighRisk}%)</strong> have
                  high membership-inference risk (Form A ≥ 0.7 OR Form B ≥ 0.7).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── §8.5 Form A + §8.6 Form B Distribution ─────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Form A Outlier Score Distribution</CardTitle>
            <CardDescription className="text-xs">⚠️ HIGH score = HIGH risk (inverted from Prosecutor EC-size charts)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={formAChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="range" type="category" tick={{ fontSize: 10 }} width={58} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[0, 4, 4, 0]}>
                  {formAChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs mt-2">
              <thead><tr className="border-b"><th className="text-left pb-1">Range</th><th className="text-right pb-1">#</th><th className="text-right pb-1">%</th><th className="text-left pb-1 pl-2">Meaning</th></tr></thead>
              <tbody>
                {r.formADistribution.map((b, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-0.5 font-mono text-[10px]">{b.range}</td>
                    <td className="py-0.5 text-right">{b.count}</td>
                    <td className="py-0.5 text-right">{b.pct}%</td>
                    <td className="py-0.5 pl-2 text-muted-foreground truncate max-w-[160px]">{b.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Form B Population Rarity Distribution</CardTitle>
            <CardDescription className="text-xs">
              {r.formBStatus === "ok"
                ? "LOW Multiplier_comb = rare in population = HIGH Form B risk (inverse of Journalist)"
                : "Requires Multiplier_comb column to be present in dataset"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {r.formBStatus === "ok" ? (
              <>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={r.formBDistribution.map((b, i) => ({ ...b, fill: BUCKET_FILLS[i] }))} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="range" type="category" tick={{ fontSize: 10 }} width={58} />
                    <Tooltip {...CHART_TOOLTIP} />
                    <Bar dataKey="count" name="Records" radius={[0, 4, 4, 0]}>
                      {r.formBDistribution.map((_, i) => <Cell key={i} fill={BUCKET_FILLS[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ Form B treats Multiplier_comb as a PROXY for population rarity. With only {r.N} records,
                  scores are relative WITHIN THIS SAMPLE only — not absolute population-level probabilities.
                </div>
              </>
            ) : (
              <div className="p-6 text-sm text-muted-foreground border border-dashed rounded text-center space-y-2">
                <div className="text-3xl">📊</div>
                <div>⚠️ Form B requires the <strong>Multiplier_comb</strong> column.</div>
                <div className="text-xs">
                  This column was not found in your dataset. Form A results above are the primary risk indicator.
                  If you have a population expansion weight column, rename it to <code>Multiplier_comb</code> and re-run.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── §8.7 Top 10 Most Distinctive Records ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top 10 Most Distinctive Records (by Form A Outlier Score)</CardTitle>
          <CardDescription className="text-xs">
            These records are statistically distinctive within the dataset. While they may not be directly re-identifiable
            (check Prosecutor results separately), their unusual combination of attributes makes it easier for an attacker
            to confirm whether "someone like this" is included, even without knowing which row is theirs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[240px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-2 pr-2">Rank</th>
                  <th className="text-left pb-2 pr-2">Row #</th>
                  {profileCols.map((c) => (
                    <th key={c} className="text-left pb-2 pr-2 truncate max-w-[80px]">{c}</th>
                  ))}
                  <th className="text-right pb-2 pr-2">Form A</th>
                  {r.formBStatus === "ok" && <th className="text-right pb-2 pr-2">Form B</th>}
                  <th className="text-right pb-2 pr-2">Nearest Neighbour</th>
                  <th className="text-right pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.top10Distinctive.map((rec, i) => (
                  <tr key={i} className={`border-b border-muted ${rec.highRisk ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                    <td className="py-1.5 pr-2 font-bold text-muted-foreground">#{i + 1}</td>
                    <td className="py-1.5 pr-2 font-mono">Row {rec.rowIdx + 1}</td>
                    {profileCols.map((c) => (
                      <td key={c} className="py-1.5 pr-2 truncate max-w-[80px] text-muted-foreground">{rec.profileValues[c] ?? "—"}</td>
                    ))}
                    <td className="py-1.5 pr-2 text-right font-bold" style={{ color: fAColor(rec.formAScore) }}>{rec.formAScore.toFixed(3)}</td>
                    {r.formBStatus === "ok" && (
                      <td className="py-1.5 pr-2 text-right" style={{ color: rec.formBScore !== null ? fAColor(rec.formBScore) : undefined }}>
                        {rec.formBScore !== null ? rec.formBScore.toFixed(3) : "—"}
                      </td>
                    )}
                    <td className="py-1.5 pr-2 text-right text-muted-foreground">
                      Row {rec.nearestNeighborIdx + 1} <span className="text-[10px]">(d={rec.nearestNeighborDist.toFixed(3)})</span>
                    </td>
                    <td className="py-1.5 text-right">
                      <Badge className={`text-[10px] ${statusBadge(rec.status)}`}>{fAEmoji(rec.formAScore)} {rec.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── §8.8 Cross-Check: Membership vs Prosecutor (k-anonymity) ───────────────── */}
      <Card className={conflictRows.length > 0 ? "border-red-400 dark:border-red-600" : ""}>
        <CardHeader>
          <CardTitle className="text-sm">
            {conflictRows.length > 0 ? "🚨" : "🔵"} Cross-Check: Membership Risk vs Re-Identification Risk
          </CardTitle>
          <CardDescription className="text-xs">
            The single most important insight: a record can simultaneously be PROTECTED from row-level re-identification
            (k-anonymity satisfied) and HIGH RISK for membership inference. K-anonymity provides <strong>zero</strong> guarantee against this attack.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {r.crossCheck.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center border border-dashed rounded">
              ℹ️ Run the <strong>Prosecutor Attack</strong> assessment alongside Membership Inference to see
              how these results compare against your dataset's k-anonymity protections.
            </div>
          ) : (
            <>
              {conflictRows.length > 0 && (
                <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-300 rounded text-xs text-red-900 dark:text-red-200">
                  <strong>⚠️ {conflictRows.length} CONFLICT{conflictRows.length > 1 ? "S" : ""} DETECTED:</strong>{" "}
                  {conflictRows.length === 1 ? "1 record is" : `${conflictRows.length} records are`} PROTECTED by k-anonymity
                  (EC size ≥ 3, QIs shared with ≥ 3 others) but HIGH RISK for membership inference (Form A ≥ 0.7).
                  This proves k-anonymity does NOT protect against membership inference operating on the full QI+SA profile.
                </div>
              )}
              <ScrollArea className="h-[200px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left pb-2">Row #</th>
                      <th className="text-right pb-2">EC Size</th>
                      <th className="text-center pb-2">Prosecutor Status</th>
                      <th className="text-right pb-2">Form A Score</th>
                      <th className="text-center pb-2">Membership Status</th>
                      <th className="text-center pb-2">Conflict?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.crossCheck.map((c, i) => (
                      <tr key={i} className={`border-b border-muted ${c.conflict ? "bg-red-50/60 dark:bg-red-950/15" : ""}`}>
                        <td className="py-1.5 font-mono">Row {c.rowIdx + 1}</td>
                        <td className="py-1.5 text-right">{c.ecSize}</td>
                        <td className="py-1.5 text-center">
                          <Badge className={`text-[10px] ${c.prosecutorStatus === "PROTECTED" ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"}`}>
                            {c.prosecutorStatus === "PROTECTED" ? "🟢 PROTECTED" : "🔴 VULNERABLE"}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-right font-bold" style={{ color: fAColor(c.formAScore) }}>{c.formAScore.toFixed(3)}</td>
                        <td className="py-1.5 text-center">
                          <Badge className={`text-[10px] ${statusBadge(c.membershipStatus)}`}>
                            {fAEmoji(c.formAScore)} {c.membershipStatus}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-center font-bold">
                          {c.conflict ? <span className="text-red-600">⚠️ YES</span> : <span className="text-muted-foreground text-[10px]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── §8.3 Record-Level Membership Trace ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Record-Level Membership Trace</CardTitle>
          <CardDescription className="text-xs">
            Per-record Form A outlier score and Form B population rarity, with nearest-neighbour identity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {(["all", "high", "low"] as const).map((f) => (
              <Button key={f} size="sm" variant={traceFilter === f ? "default" : "outline"} className="h-7 text-xs"
                onClick={() => { setTraceFilter(f); setTracePage(0); }}>
                {f === "all" ? "Show All" : f === "high" ? "🔴 High Risk Only" : "🟢 Low Risk Only"}
                <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1">
                  {f === "all" ? r.records.length : f === "high" ? r.records.filter((x) => x.highRisk).length : r.records.filter((x) => !x.highRisk).length}
                </Badge>
              </Button>
            ))}
          </div>
          <ScrollArea className="h-[280px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-2 pr-2">Row #</th>
                  {profileCols.map((c) => (
                    <th key={c} className="text-left pb-2 pr-2 truncate max-w-[80px]">{c}</th>
                  ))}
                  <th className="text-right pb-2 pr-2">Form A</th>
                  {r.formBStatus === "ok" && <th className="text-right pb-2 pr-2">Form B</th>}
                  <th className="text-right pb-2 pr-2">Nearest Neighbour</th>
                  <th className="text-center pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((rec, i) => (
                  <tr key={i} className={`border-b border-muted ${rec.highRisk ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}>
                    <td className="py-1 pr-2 font-mono">{rec.rowIdx + 1}</td>
                    {profileCols.map((c) => (
                      <td key={c} className="py-1 pr-2 truncate max-w-[80px] text-muted-foreground">{rec.profileValues[c] ?? "—"}</td>
                    ))}
                    <td className="py-1 pr-2 text-right font-bold" style={{ color: fAColor(rec.formAScore) }}>{rec.formAScore.toFixed(3)}</td>
                    {r.formBStatus === "ok" && (
                      <td className="py-1 pr-2 text-right" style={{ color: rec.formBScore !== null ? fAColor(rec.formBScore) : undefined }}>
                        {rec.formBScore !== null ? rec.formBScore.toFixed(3) : "—"}
                      </td>
                    )}
                    <td className="py-1 pr-2 text-right text-muted-foreground">Row {rec.nearestNeighborIdx + 1}</td>
                    <td className="py-1 text-center">
                      <Badge className={`text-[10px] ${statusBadge(rec.status)}`}>{fAEmoji(rec.formAScore)} {rec.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={tracePage === 0}
                onClick={() => setTracePage((p) => p - 1)}>
                <ChevronLeft className="h-3 w-3 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {tracePage + 1} of {totalPages}</span>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={tracePage >= totalPages - 1}
                onClick={() => setTracePage((p) => p + 1)}>
                Next <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── §8.9 Recommendations ───────────────────────────────────────────────────── */}
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

const OUTCOME_COLOR: Record<LinkageOutcome, string> = {
  Certain:   "#DC2626",
  Probable:  "#EA580C",
  Possible:  "#D97706",
  Protected: "#16A34A",
};
const OUTCOME_BG: Record<LinkageOutcome, string> = {
  Certain:   "bg-red-100 text-red-700",
  Probable:  "bg-orange-100 text-orange-700",
  Possible:  "bg-amber-100 text-amber-700",
  Protected: "bg-green-100 text-green-700",
};

function RecordLinkageReport({ r, kThreshold }: { r: RecordLinkageResult; kThreshold: number }) {
  const [filterMode, setFilterMode] = useState<"all" | "Certain" | "Probable" | "Possible" | "Protected">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const qis = r.quasiIdentifiers;
  const eclrPct = (r.eclr * 100).toFixed(1);
  const wclrPct = (r.wclr * 100).toFixed(1);
  const riskColor = r.eclr > 0.2 ? "text-red-600" : r.eclr > 0.05 ? "text-amber-600" : "text-green-600";
  const riskLabel = r.eclr > 0.2 ? "HIGH" : r.eclr > 0.05 ? "MEDIUM" : "LOW";
  const bannerBorder = r.eclr > 0.2
    ? "border-red-400 bg-red-50 dark:bg-red-950/20"
    : r.eclr > 0.05
    ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
    : "border-green-400 bg-green-50 dark:bg-green-950/20";

  const filtered = r.recordTable.filter((row) => {
    if (filterMode !== "all" && row.linkageOutcome !== filterMode) return false;
    if (search) {
      const haystack = qis.map((qi) => row.qiValues[qi] ?? "").join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const csvExport = () => {
    const header = ["Row", ...qis, "EC Size", "Link Score", "Outcome"].join(",");
    const rows = r.recordTable.map((row) =>
      [row.rowIdx, ...qis.map((qi) => `"${row.qiValues[qi] ?? ""}"`), row.ecSize, row.linkScore, row.linkageOutcome].join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "record_linkage_trace.csv";
    a.click();
  };

  const donutData = [
    { name: `Certain (${r.numUniqueRecords})`,  value: r.numUniqueRecords,  fill: "#DC2626" },
    { name: `Probable (${r.numProbable})`,       value: r.numProbable,       fill: "#EA580C" },
    { name: `Possible (${r.numPossible})`,       value: r.numPossible,       fill: "#D97706" },
    { name: `Protected (${r.numProtected})`,     value: r.numProtected,      fill: "#16A34A" },
  ];

  const topRecord = r.topVulnerableRecord;

  return (
    <div className="space-y-6">

      {/* ── §5.1 Attack Summary Banner ─────────────────────────────────────── */}
      <div className={`rounded-lg border-2 p-4 ${bannerBorder}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-sm uppercase tracking-wider">🔗 Record Linkage Attack Results</span>
          <span className={`text-xs font-bold px-2 py-1 rounded border ${r.eclr > 0.2 ? "bg-red-100 text-red-700 border-red-300" : r.eclr > 0.05 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-green-100 text-green-700 border-green-300"}`}>
            RISK LEVEL: {riskLabel}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mb-2 flex flex-wrap gap-3">
          <span>Records analysed: <strong>{r.N}</strong></span>
          <span>QIs used: <strong>{qis.join(", ") || "—"}</strong></span>
          <span>Distinct ECs: <strong>{r.distinctEcs}</strong></span>
          <span>Min-K: <strong>{r.minK}</strong></span>
        </div>
        <p className="text-sm leading-relaxed">
          An attacker with access to an external database (voter roll, census, social-media dump) can correctly
          re-identify <strong className={riskColor}>{eclrPct}%</strong> of individuals by matching on{" "}
          <em>{qis.slice(0, 3).join(", ")}{qis.length > 3 ? ` +${qis.length - 3} more` : ""}</em>.{" "}
          {r.numUniqueRecords > 0
            ? <><strong className="text-red-600">{r.numUniqueRecords} record{r.numUniqueRecords !== 1 ? "s" : ""}</strong> can be re-identified with <em>certainty</em> (EC size = 1). Worst-case single-record linkage risk is <strong className="text-red-600">{wclrPct}%</strong>.</>
            : <>No records are uniquely identifiable (min-K = {r.minK}). Worst-case linkage risk is <strong className={riskColor}>{wclrPct}%</strong>.</>}
        </p>
      </div>

      {/* ── §5.2 KPI Row (6 cards) ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {kpiCard("ECLR", `${eclrPct}%`, "Expected Correct Linkage Rate = ECs/N", <Network className="h-4 w-4" />, r.eclr > 0.2 ? "text-red-600" : r.eclr > 0.05 ? "text-amber-600" : "text-green-600")}
        {kpiCard("WCLR", `${wclrPct}%`, "Worst-Case Linkage Risk = 1/Min-K", <Target className="h-4 w-4" />, r.wclr > 0.5 ? "text-red-600" : r.wclr > 0.2 ? "text-amber-600" : "text-green-600")}
        {kpiCard("Min-K", r.minK, `Smallest EC size (target ≥ ${kThreshold})`, <Shield className="h-4 w-4" />, r.minK < kThreshold ? "text-red-600" : "text-green-600")}
        {kpiCard("Distinct ECs", r.distinctEcs, `Amplification: ${r.amplificationFactor}×`, <BarChart3 className="h-4 w-4" />)}
        {kpiCard("Certain Links", r.numUniqueRecords, "EC size = 1 (100% re-ID probability)", <Fingerprint className="h-4 w-4" />, r.numUniqueRecords > 0 ? "text-red-600" : "text-green-600")}
        {kpiCard("Protected", r.numProtected, `EC size ≥ k=${kThreshold}`, <Users className="h-4 w-4" />, r.numProtected === r.N ? "text-green-600" : "text-amber-600")}
      </div>

      {/* ── §5.3 Linkage Outcome Donut + Breakdown ───────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Linkage Outcome Distribution (4-Level)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                  {donutData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v} records`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Outcome Level Definitions</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-2">Outcome</th><th className="text-right pb-2">EC Size</th><th className="text-right pb-2">Records</th><th className="text-right pb-2">%</th><th className="text-left pb-2 pl-3">Attacker Certainty</th></tr></thead>
              <tbody>
                {[
                  { label: "Certain",   ecRange: "= 1",                  count: r.numUniqueRecords, meaning: "100% — uniquely identifiable" },
                  { label: "Probable",  ecRange: "2–3",                  count: r.numProbable,      meaning: "33–50% — likely correct link" },
                  { label: "Possible",  ecRange: `4–${kThreshold - 1}`,  count: r.numPossible,      meaning: `${(100 / kThreshold).toFixed(0)}–25% — below k threshold` },
                  { label: "Protected", ecRange: `≥ ${kThreshold}`,      count: r.numProtected,     meaning: `≤ ${(100 / kThreshold).toFixed(0)}% — meets k-anonymity` },
                ].map((row, i) => {
                  const outcomes: LinkageOutcome[] = ["Certain", "Probable", "Possible", "Protected"];
                  return (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5"><span className={`text-xs font-bold px-1.5 py-0.5 rounded ${OUTCOME_BG[outcomes[i]]}`}>{row.label}</span></td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground">{row.ecRange}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: OUTCOME_COLOR[outcomes[i]] }}>{row.count}</td>
                      <td className="py-1.5 text-right">{r.N > 0 ? ((row.count / r.N) * 100).toFixed(1) : 0}%</td>
                      <td className="py-1.5 pl-3 text-muted-foreground">{row.meaning}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── §5.4 Record-Level Trace Table ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">Record-Level Linkage Trace ({r.N} records)</CardTitle>
            <button onClick={csvExport} className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors flex items-center gap-1" data-testid="button-rl-csv-export">
              ⬇ Export CSV
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["all", "Certain", "Probable", "Possible", "Protected"] as const).map((mode) => (
              <button key={mode} onClick={() => { setFilterMode(mode); setPage(1); }}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${filterMode === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                data-testid={`button-rl-filter-${mode}`}>
                {mode === "all" ? `All (${r.N})` : `${mode} (${mode === "Certain" ? r.numUniqueRecords : mode === "Probable" ? r.numProbable : mode === "Possible" ? r.numPossible : r.numProtected})`}
              </button>
            ))}
            <input
              className="text-xs px-2 py-0.5 rounded border bg-background ml-auto w-36"
              placeholder="Search QI values…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              data-testid="input-rl-search"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[260px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b">
                  <th className="text-left py-2 px-3">#</th>
                  {qis.map((qi) => <th key={qi} className="text-left py-2 px-2">{qi}</th>)}
                  <th className="text-right py-2 px-2">EC Size</th>
                  <th className="text-right py-2 px-2">Link Score</th>
                  <th className="text-left py-2 px-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.rowIdx} className="border-b border-muted hover:bg-muted/30">
                    <td className="py-1.5 px-3 text-muted-foreground">{row.rowIdx}</td>
                    {qis.map((qi) => <td key={qi} className="py-1.5 px-2 truncate max-w-[100px]">{row.qiValues[qi] ?? "—"}</td>)}
                    <td className="py-1.5 px-2 text-right font-mono">{row.ecSize}</td>
                    <td className="py-1.5 px-2 text-right font-bold" style={{ color: OUTCOME_COLOR[row.linkageOutcome] }}>{row.linkScore.toFixed(3)}</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${OUTCOME_BG[row.linkageOutcome]}`}>{row.linkageOutcome}</span>
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={qis.length + 4} className="py-6 text-center text-muted-foreground">No records match the current filter.</td></tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t text-xs">
              <span className="text-muted-foreground">{filtered.length} records · Page {safePage}/{totalPages}</span>
              <div className="flex gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="px-2 py-0.5 rounded border disabled:opacity-40 hover:bg-muted" data-testid="button-rl-prev">‹ Prev</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="px-2 py-0.5 rounded border disabled:opacity-40 hover:bg-muted" data-testid="button-rl-next">Next ›</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── §5.5 Attack Simulation Narrative ──────────────────────────────── */}
      {topRecord && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-800 dark:text-red-200 flex items-center gap-2">
              <Target className="h-4 w-4" /> Attack Simulation Narrative — Highest-Risk Record
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-red-900 dark:text-red-100 leading-relaxed space-y-2">
            <p>
              <strong>Step 1 — Attacker acquires external dataset</strong>: The adversary downloads a publicly available
              database (e.g., a voter roll, hospital discharge register, or social-media profile dump) that contains the
              same quasi-identifier fields: <em>{qis.join(", ")}</em>.
            </p>
            <p>
              <strong>Step 2 — Attacker issues a JOIN query</strong>: The adversary executes:
            </p>
            <pre className="text-xs bg-red-100 dark:bg-red-900/40 rounded p-2 font-mono overflow-x-auto">
              {`SELECT target.*, external.name\nFROM target_dataset JOIN external_db\n  ON ${qis.map((qi) => `target.${qi} = external.${qi}`).join("\n     AND ")}\nWHERE ${qis.map((qi) => `target.${qi} = '${topRecord.qiValues[qi]}'`).join(" AND ")};`}
            </pre>
            <p>
              <strong>Step 3 — Result</strong>: The query returns <strong>{topRecord.ecSize}</strong> match
              {topRecord.ecSize !== 1 ? "es" : ""}. Link score = 1/{topRecord.ecSize} ={" "}
              <strong className={topRecord.ecSize === 1 ? "text-red-600" : "text-amber-600"}>{topRecord.linkScore.toFixed(3)}</strong>.{" "}
              Outcome: <span className={`font-bold ${topRecord.ecSize === 1 ? "text-red-600" : "text-amber-600"}`}>{topRecord.linkageOutcome}</span>.{" "}
              {topRecord.ecSize === 1
                ? "This record is uniquely identifiable — the attacker can re-identify this individual with 100% certainty."
                : `The attacker has a 1-in-${topRecord.ecSize} chance (${(topRecord.linkScore * 100).toFixed(1)}%) of correct re-identification.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── §5.6 EC Size Distribution ─────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">EC Size Distribution (Chart)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={r.ecSizeTable} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={80} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="numRecords" radius={[0, 4, 4, 0]} name="Records">
                  {r.ecSizeTable.map((row, i) => <Cell key={i} fill={["#DC2626","#EA580C","#D97706","#16A34A","#0EA5E9"][i] ?? "#16A34A"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">EC Size Distribution (Table)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-2">EC Size</th><th className="text-right pb-2"># ECs</th><th className="text-right pb-2"># Records</th><th className="text-right pb-2">% Dataset</th><th className="text-right pb-2">Risk Level</th></tr></thead>
              <tbody>
                {r.ecSizeTable.map((row, i) => {
                  const colors = ["#DC2626","#EA580C","#D97706","#16A34A","#0EA5E9"];
                  return (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-medium" style={{ color: colors[i] }}>{row.label}</td>
                      <td className="py-1.5 text-right">{row.numECs}</td>
                      <td className="py-1.5 text-right">{row.numRecords}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: colors[i] }}>{row.pct}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{row.risk}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── §5.7 Link Score Distribution ──────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Link Score Distribution — Attacker Certainty by Record</CardTitle></CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={r.linkScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {r.linkScoreDistribution.map((_, i) => <Cell key={i} fill={["#DC2626","#EA580C","#D97706","#16A34A","#16A34A"][i] ?? "#16A34A"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="text-xs self-start">
              <thead><tr className="border-b"><th className="text-left pb-2">Score Range</th><th className="text-right pb-2"># Records</th><th className="text-left pb-2 pl-3">Meaning</th></tr></thead>
              <tbody>
                {r.linkScoreDistribution.map((row, i) => {
                  const meanings = ["Attacker is certain (EC = 1)","Probable linkage (EC 2–3)","Possible linkage (EC 4–k)","Low risk (EC just above k)","Effectively anonymous (large EC)"];
                  return (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-medium" style={{ color: ["#DC2626","#EA580C","#D97706","#16A34A","#16A34A"][i] }}>{row.bucket}</td>
                      <td className="py-1.5 text-right font-bold">{row.count}</td>
                      <td className="py-1.5 pl-3 text-muted-foreground">{meanings[i]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── §5.8 L-Diversity Results ───────────────────────────────────────── */}
      {r.lDiversityResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">L-Diversity Check (threshold l = {r.lDiversityResults[0] ? "see config" : "—"})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {r.lDiversityResults[0] && r.lDiversityResults[0].totalEcs >= r.N * 0.9 && (
              <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — L-Diversity failures are caused by singleton ECs</div>
                All {r.lDiversityResults[0].totalEcs} equivalence classes are singletons. A group of 1 can only contain 1 distinct SA value, so L-Diversity l≥2 failures are a mathematical inevitability. Reduce the number of quasi-identifiers to form multi-record ECs.
              </div>
            )}
            {r.lDiversityResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">SA: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Min distinct SA values in any EC: <strong>{res.minL}</strong></div>
                  <div>ECs violating l-diversity: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} of {res.totalEcs}</strong> ({res.totalEcs > 0 ? ((res.violatingEcs / res.totalEcs) * 100).toFixed(0) : 0}%)</div>
                  <div>Records in violating ECs: <strong>{res.recordsInViolatingEcs}</strong></div>
                  {res.status === "FAIL" && res.totalEcs < r.N * 0.9 && <div className="italic mt-1">In some groups, all records share the same {res.sa} value — an attacker who links a record to its group learns {res.sa} with certainty.</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── §5.9 T-Closeness Results ───────────────────────────────────────── */}
      {r.tClosenessResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">T-Closeness Check (Total Variation Distance)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {r.tClosenessResults[0] && r.tClosenessResults[0].totalEcs >= r.N * 0.9 && (
              <div className="p-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-bold mb-1">⚠️ STRUCTURAL ARTIFACT — T-Closeness high TVD is caused by singleton ECs</div>
                Singleton ECs always deviate maximally (TVD → 1.0) from the global SA distribution. These failures are structural — not evidence of attribute inference within groups.
              </div>
            )}
            {r.tClosenessResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">SA: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Max TVD from global distribution: <strong className={res.maxDistance > 0.3 ? "text-red-600" : "text-green-600"}>{res.maxDistance}</strong></div>
                  <div>ECs violating t-closeness: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} of {res.totalEcs}</strong></div>
                  {res.globalDist.length > 0 && (
                    <div className="mt-1">
                      Global distribution of <code>{res.sa}</code>:{" "}
                      {res.globalDist.slice(0, 5).map((g) => `${g.value}: ${g.pct}%`).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── §5.10 Top 10 Vulnerable Records ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top 10 Vulnerable Records (Highest Link Score)</CardTitle>
          <CardDescription className="text-xs">These rows should be suppressed or generalised before releasing this dataset.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px]">
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-1">Rank</th><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">EC Size</th><th className="text-right pb-1">Link Score</th><th className="text-left pb-1 pl-2">Outcome</th></tr></thead>
              <tbody>
                {r.topVulnerable.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1 pr-2 text-muted-foreground">{row.rank}</td>
                    <td className="py-1 pr-2 text-muted-foreground truncate max-w-[180px]" title={row.qiCombo}>{row.qiCombo.slice(0, 50)}{row.qiCombo.length > 50 ? "…" : ""}</td>
                    <td className="py-1 text-right">{row.ecSize}</td>
                    <td className="py-1 text-right font-bold text-red-600">{row.linkScore.toFixed(3)}</td>
                    <td className="py-1 pl-2"><span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${OUTCOME_BG[row.outcome]}`}>{row.outcome}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── §5.11 QI Contribution Analysis ────────────────────────────────── */}
      {r.qiContribution.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">QI Contribution Analysis — Impact of Each Quasi-Identifier on ECLR</CardTitle>
            <CardDescription className="text-xs">Delta = ECLR (full) − ECLR (without this QI). Higher delta = this QI drives more linkage risk.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={Math.max(120, r.qiContribution.length * 32)}>
                <BarChart data={r.qiContribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} />
                  <YAxis type="category" dataKey="qi" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${(v * 100).toFixed(2)}%`} />
                  <Bar dataKey="delta" name="ECLR Delta" radius={[0, 4, 4, 0]}>
                    {r.qiContribution.map((row, i) => (
                      <Cell key={i} fill={row.delta > 0.3 ? "#DC2626" : row.delta > 0.1 ? "#EA580C" : row.delta > 0 ? "#D97706" : "#16A34A"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="text-xs self-start">
                <thead><tr className="border-b"><th className="text-left pb-2">QI</th><th className="text-right pb-2">ECLR w/o</th><th className="text-right pb-2">Delta</th><th className="text-left pb-2 pl-3">Recommendation</th></tr></thead>
                <tbody>
                  {r.qiContribution.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-medium">{row.qi}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{(row.eclrWithout * 100).toFixed(1)}%</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: row.delta > 0.1 ? "#DC2626" : row.delta > 0 ? "#D97706" : "#16A34A" }}>+{(row.delta * 100).toFixed(2)}%</td>
                      <td className="py-1.5 pl-3 text-muted-foreground">{row.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

// ─── Helpers for AttributeDisclosureReport ───────────────────────────────────

function disclosureLabelBadge(label: DisclosureLabel) {
  const cfg: Record<DisclosureLabel, { bg: string; text: string }> = {
    Guaranteed: { bg: "bg-red-100 dark:bg-red-900/30",    text: "text-red-700 dark:text-red-400" },
    High:       { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-400" },
    Moderate:   { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-400" },
    Safe:       { bg: "bg-green-100 dark:bg-green-900/30",  text: "text-green-700 dark:text-green-400" },
  };
  const c = cfg[label];
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.bg} ${c.text}`}>{label}</span>;
}

function disclosureLabelColor(label: DisclosureLabel): string {
  return label === "Guaranteed" ? "#DC2626" : label === "High" ? "#EA580C" : label === "Moderate" ? "#D97706" : "#16A34A";
}

function ADRBadge({ adr }: { adr: number }) {
  if (adr > 0.6) return <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-bold">🔴 HIGH</span>;
  if (adr >= 0.2) return <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs font-bold">🟡 MEDIUM</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold">🟢 LOW</span>;
}

function AttributeDisclosureReport({ r }: { r: AttributeDisclosureResult }) {
  const [recordFilter, setRecordFilter] = useState<"all" | DisclosureLabel>("all");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordPage, setRecordPage] = useState(0);
  const PAGE_SIZE = 50;

  // Filtered record table
  const filteredRows = useMemo(() => {
    let rows = r.recordTable;
    if (recordFilter !== "all") {
      rows = rows.filter((row) =>
        r.sensitiveAttributes.some((sa) => row.disclosureLabels[sa] === recordFilter)
      );
    }
    if (recordSearch.trim()) {
      const q = recordSearch.toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row.qiValues).some((v) => v.toLowerCase().includes(q)) ||
        Object.values(row.saValues).some((v) => v.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [r.recordTable, recordFilter, recordSearch, r.sensitiveAttributes]);

  const pageRows = filteredRows.slice(recordPage * PAGE_SIZE, (recordPage + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);

  // CSV export
  const exportCSV = () => {
    if (!filteredRows.length) return;
    const qiCols = r.quasiIdentifiers;
    const saCols = r.sensitiveAttributes;
    const header = ["Row#", ...qiCols, "EC_Size", ...saCols.map((s) => `${s}_Value`), ...saCols.map((s) => `${s}_DomValue`), ...saCols.map((s) => `${s}_DomFreq`), ...saCols.map((s) => `${s}_Label`), "MaxDiscRisk", "AtRisk"];
    const lines = filteredRows.map((row) => [
      row.rowIdx, ...qiCols.map((q) => row.qiValues[q] ?? ""), row.ecSize,
      ...saCols.map((s) => row.saValues[s] ?? ""),
      ...saCols.map((s) => row.dominantValues[s] ?? ""),
      ...saCols.map((s) => (row.dominantFreqs[s] ?? 0).toFixed(4)),
      ...saCols.map((s) => row.disclosureLabels[s] ?? ""),
      row.maxDisclosureRisk.toFixed(4), row.atRisk ? "At Risk" : "Safe",
    ].join(","));
    const blob = new Blob([header.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "attribute_disclosure_trace.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // SA donut data builder
  const buildDonutData = (psa: typeof r.perSAResults[0]) => [
    { name: "Guaranteed", value: psa.guaranteedRecords, fill: "#DC2626" },
    { name: "High",       value: psa.highRiskRecords,   fill: "#EA580C" },
    { name: "Moderate",   value: psa.moderateRiskRecords, fill: "#D97706" },
    { name: "Safe",       value: psa.safeRecords,       fill: "#16A34A" },
  ].filter((d) => d.value > 0);

  const overallLabel = r.overallAdr > 0.6 ? "HIGH" : r.overallAdr >= 0.2 ? "MEDIUM" : "LOW";
  const worstSA = r.saSensitivityRanking[0];

  return (
    <div className="space-y-6">

      {/* §5.1 Summary Banner */}
      <Card className={`border-l-4 ${r.overallAdr > 0.6 ? "border-l-red-500" : r.overallAdr >= 0.2 ? "border-l-yellow-500" : "border-l-green-500"}`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 text-2xl`}>{r.overallAdr > 0.6 ? "🔴" : r.overallAdr >= 0.2 ? "🟡" : "🟢"}</div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-base">Attribute Disclosure Risk: {overallLabel}</h3>
                <ADRBadge adr={r.overallAdr} />
              </div>
              <p className="text-sm text-muted-foreground">
                Even though your dataset may satisfy k-anonymity, an attacker who knows which equivalence class a
                person belongs to can correctly guess their{" "}
                <strong>{worstSA?.sa ?? "sensitive attribute"}</strong> value{" "}
                <strong>{(r.overallAdr * 100).toFixed(1)}%</strong> of the time.
                {worstSA && worstSA.guaranteedRecords > 0 && (
                  <> <strong className="text-red-600 dark:text-red-400">{worstSA.guaranteedRecords} records</strong> sit in completely
                  homogeneous groups — their sensitive attribute is disclosed with <strong>100% certainty</strong>.</>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                This attack does <strong>NOT</strong> require re-identification. Knowing a person's
                quasi-identifiers (e.g., region + age group) is enough to learn their sensitive information.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Results based on <strong>{r.N.toLocaleString()}</strong> rows &nbsp;|&nbsp;
                QIs: <strong>{r.quasiIdentifiers.join(", ")}</strong> &nbsp;|&nbsp;
                SAs assessed: <strong>{r.sensitiveAttributes.join(", ")}</strong>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* §5.2 Key Metrics Row per SA */}
      {r.perSAResults.map((psa) => (
        <Card key={psa.sa}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-600" /> Sensitive Attribute: <strong>{psa.sa}</strong>
              <ADRBadge adr={psa.adr} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              {kpiCard("ADR", `${(psa.adr * 100).toFixed(1)}%`, "Avg disclosure probability", <Target className="h-4 w-4" />, psa.adr > 0.6 ? "text-red-600" : psa.adr >= 0.2 ? "text-yellow-600" : "text-green-600")}
              {kpiCard("Guaranteed Disclosure", psa.guaranteedRecords.toLocaleString(), "100% certain — homogeneous ECs", <AlertTriangle className="h-4 w-4" />, psa.guaranteedRecords > 0 ? "text-red-600" : "text-green-600")}
              {kpiCard("Homogeneous ECs", `${psa.homogeneousEcs} / ${psa.totalEcs}`, "All records share same SA value", <XCircle className="h-4 w-4" />, psa.homogeneousEcs > 0 ? "text-orange-600" : "text-green-600")}
              {kpiCard("L-Violating ECs", `${psa.lViolatingEcs} / ${psa.totalEcs}`, `Fewer than l distinct SA values`, <BarChart3 className="h-4 w-4" />, psa.lViolatingEcs > 0 ? "text-orange-600" : "text-green-600")}
              {kpiCard("Safe Records", `${psa.safeRecords.toLocaleString()} (${r.N > 0 ? ((psa.safeRecords / r.N) * 100).toFixed(0) : 0}%)`, "In l-diverse ECs", <CheckCircle className="h-4 w-4" />, psa.safeRecords === r.N ? "text-green-600" : "text-muted-foreground")}
            </div>

            {/* §5.3 Disclosure Risk Distribution + §5.7 Global SA Distribution side-by-side */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">§5.3 Disclosure Risk Distribution</p>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={buildDonutData(psa)} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="value">
                      {buildDonutData(psa).map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v} records`} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">§5.7 Global SA Distribution</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={psa.globalDist} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                    <YAxis type="category" dataKey="value" tick={{ fontSize: 9 }} width={90} />
                    <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
                    <Bar dataKey="pct" fill="#7C3AED" radius={[0, 4, 4, 0]} name="% of Records" />
                  </BarChart>
                </ResponsiveContainer>
                {psa.homogeneousEcsByValue.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Fully homogeneous ECs: {psa.homogeneousEcsByValue.map((h) => `${h.value} (${h.count})`).join(", ")}
                  </p>
                )}
              </div>
            </div>

            {/* §5.6 EC Homogeneity Heatmap */}
            {psa.topEcs.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">§5.6 EC Homogeneity Heatmap — Top {Math.min(psa.topEcs.length, 20)} ECs by Disclosure Risk</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <ScrollArea className="h-[200px]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b sticky top-0 bg-card">
                          <th className="text-left pb-1 pr-2">EC</th>
                          <th className="text-left pb-1 pr-2">QI Combination</th>
                          <th className="text-right pb-1 pr-1">Size</th>
                          <th className="text-right pb-1 pr-1">Distinct SA</th>
                          <th className="text-right pb-1 pr-1">Dom. Value</th>
                          <th className="text-right pb-1 pr-1">Dom. Freq</th>
                          <th className="text-right pb-1">Label</th>
                        </tr>
                      </thead>
                      <tbody>
                        {psa.topEcs.map((ec, i) => (
                          <tr key={i} className="border-b border-muted">
                            <td className="py-0.5 pr-2 text-muted-foreground">{ec.ecId}</td>
                            <td className="py-0.5 pr-2 text-muted-foreground truncate max-w-[120px]">{ec.qiCombo.slice(0, 35)}</td>
                            <td className="py-0.5 text-right pr-1">{ec.ecSize}</td>
                            <td className="py-0.5 text-right pr-1">{ec.distinctSaValues}</td>
                            <td className="py-0.5 text-right pr-1 text-muted-foreground">{ec.dominantValue.slice(0, 12)}</td>
                            <td className="py-0.5 text-right pr-1 font-bold" style={{ color: disclosureLabelColor(ec.disclosureLabel) }}>{(ec.dominantFreq * 100).toFixed(0)}%</td>
                            <td className="py-0.5 text-right">{disclosureLabelBadge(ec.disclosureLabel)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={psa.topEcs.slice(0, 15)} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 10 }} domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                      <YAxis type="category" dataKey="ecId" tick={{ fontSize: 9 }} width={38} />
                      <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                      <ReferenceLine x={1 / 3} stroke="#6366F1" strokeDasharray="4 4" label={{ value: "1/l threshold", fontSize: 9, fill: "#6366F1" }} />
                      <Bar dataKey="dominantFreq" radius={[0, 3, 3, 0]} name="Dominant Freq">
                        {psa.topEcs.slice(0, 15).map((ec, i) => (
                          <Cell key={i} fill={disclosureLabelColor(ec.disclosureLabel)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* §5.8 L-Diversity + §5.9 T-Closeness side-by-side */}
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className={`rounded-lg border p-3 ${psa.lStatus === "FAIL" ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20" : "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold">§5.8 L-Diversity Check</span>
                  <span className={`text-xs font-bold ${psa.lStatus === "FAIL" ? "text-red-600" : "text-green-600"}`}>{psa.lStatus === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-1 text-muted-foreground">
                  <div>Min distinct SA values in any EC: <strong className={psa.minL < 2 ? "text-red-600" : ""}>{psa.minL}</strong></div>
                  <div>ECs violating l-diversity: <strong>{psa.lViolatingEcs} / {psa.totalEcs}</strong> ({psa.totalEcs > 0 ? ((psa.lViolatingEcs / psa.totalEcs) * 100).toFixed(0) : 0}%)</div>
                  <div>Records in l-violating ECs: <strong>{psa.recordsInLViolatingEcs.toLocaleString()}</strong> ({r.N > 0 ? ((psa.recordsInLViolatingEcs / r.N) * 100).toFixed(0) : 0}%)</div>
                  {psa.lStatus === "FAIL" && (
                    <p className="mt-1 text-red-700 dark:text-red-400">In {psa.lViolatingEcs} equivalence classes, fewer than l distinct {psa.sa} values exist. The attacker can infer {psa.sa} with confidence above 1/l for these records.</p>
                  )}
                </div>
              </div>
              <div className={`rounded-lg border p-3 ${psa.tStatus === "FAIL" ? "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20" : "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold">§5.9 T-Closeness Check</span>
                  <span className={`text-xs font-bold ${psa.tStatus === "FAIL" ? "text-orange-600" : "text-green-600"}`}>{psa.tStatus === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-1 text-muted-foreground">
                  <div>Max EC deviation (TVD): <strong className={psa.tStatus === "FAIL" ? "text-orange-600" : ""}>{psa.maxTvd.toFixed(4)}</strong></div>
                  <div>ECs violating t-closeness: <strong>{psa.tViolatingEcs} / {psa.totalEcs}</strong></div>
                  <div>Global dist: {psa.globalDist.slice(0, 3).map((d) => `${d.value} ${d.pct}%`).join(" · ")}</div>
                  {psa.tStatus === "FAIL" && (
                    <p className="mt-1 text-orange-700 dark:text-orange-400">In {psa.tViolatingEcs} groups, the internal distribution of {psa.sa} is far from the global baseline — attribute inference becomes easier.</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* §5.4 Record-Level Disclosure Trace Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">§5.4 Record-Level Disclosure Trace — {filteredRows.length.toLocaleString()} rows</CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportCSV}>
              <Download className="h-3 w-3 mr-1" /> Download Full Table (CSV)
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["all", "Guaranteed", "High", "Moderate", "Safe"] as const).map((f) => (
              <Button key={f} variant={recordFilter === f ? "default" : "outline"} size="sm" className="h-6 text-xs px-2"
                onClick={() => { setRecordFilter(f); setRecordPage(0); }}>
                {f === "all" ? "Show All" : f === "Guaranteed" ? "🔴 Guaranteed" : f === "High" ? "🟠 High" : f === "Moderate" ? "🟡 Moderate" : "🟢 Safe"}
              </Button>
            ))}
            <input
              className="ml-auto h-6 text-xs border rounded px-2 bg-background"
              placeholder="Search…" value={recordSearch}
              onChange={(e) => { setRecordSearch(e.target.value); setRecordPage(0); }}
            />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[320px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b sticky top-0 bg-card">
                  <th className="text-left pb-1 pr-2">Row #</th>
                  {r.quasiIdentifiers.slice(0, 3).map((qi) => (
                    <th key={qi} className="text-left pb-1 pr-2">{qi}</th>
                  ))}
                  <th className="text-right pb-1 pr-2">EC Size</th>
                  {r.sensitiveAttributes.map((sa) => (
                    <Fragment key={sa}>
                      <th className="text-right pb-1 pr-1">{sa} Value</th>
                      <th className="text-right pb-1 pr-1">Dom. SA</th>
                      <th className="text-right pb-1 pr-1">Dom. Freq</th>
                      <th className="text-right pb-1 pr-1">Label</th>
                    </Fragment>
                  ))}
                  <th className="text-right pb-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-0.5 pr-2 text-muted-foreground">{row.rowIdx}</td>
                    {r.quasiIdentifiers.slice(0, 3).map((qi) => (
                      <td key={qi} className="py-0.5 pr-2 truncate max-w-[80px]">{row.qiValues[qi]}</td>
                    ))}
                    <td className="py-0.5 text-right pr-2">{row.ecSize}</td>
                    {r.sensitiveAttributes.map((sa) => (
                      <Fragment key={sa}>
                        <td className="py-0.5 text-right pr-1">{(row.saValues[sa] ?? "").slice(0, 12)}</td>
                        <td className="py-0.5 text-right pr-1 text-muted-foreground">{(row.dominantValues[sa] ?? "").slice(0, 12)}</td>
                        <td className="py-0.5 text-right pr-1 font-bold" style={{ color: disclosureLabelColor(row.disclosureLabels[sa] ?? "Safe") }}>
                          {((row.dominantFreqs[sa] ?? 0) * 100).toFixed(0)}%
                        </td>
                        <td className="py-0.5 text-right pr-1">{disclosureLabelBadge(row.disclosureLabels[sa] ?? "Safe")}</td>
                      </Fragment>
                    ))}
                    <td className="py-0.5 text-right">{row.atRisk ? <span className="text-red-600 font-bold">🔴</span> : <span className="text-green-600">🟢</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>Page {recordPage + 1} of {totalPages} ({filteredRows.length.toLocaleString()} rows)</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-6 text-xs px-2" disabled={recordPage === 0} onClick={() => setRecordPage(p => p - 1)}>← Prev</Button>
                <Button variant="outline" size="sm" className="h-6 text-xs px-2" disabled={recordPage >= totalPages - 1} onClick={() => setRecordPage(p => p + 1)}>Next →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* §5.5 Attack Simulation Narrative */}
      {r.mostVulnerableEc && (
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.5 Attack Simulation — How the Attack Works on YOUR Data</CardTitle></CardHeader>
          <CardContent>
            <div className="font-mono text-xs bg-muted rounded-lg p-4 space-y-3 whitespace-pre-wrap">
              <div className="text-blue-600 dark:text-blue-400 font-bold">ATTRIBUTE DISCLOSURE SIMULATION — Step by Step</div>
              <div><span className="text-muted-foreground">Step 1 — Attacker's Starting Knowledge</span>{"\n"}  The attacker does NOT need to know who the target is.{"\n"}  They only need to know the target's quasi-identifier values,{"\n"}  which are often publicly available (e.g., region, age group, survey round):{"\n"}{r.mostVulnerableEc.qiCombo.split("|").map((v, i) => `    ${r.quasiIdentifiers[i] ?? `QI${i+1}`} = ${v}`).join("\n")}</div>
              <div><span className="text-muted-foreground">Step 2 — EC Lookup</span>{"\n"}  The attacker queries: "Which group do people with these QI values belong to?"{"\n"}  Result: {r.mostVulnerableEc.qiCombo.slice(0, 60)} — contains <strong>{r.mostVulnerableEc.ecSize}</strong> records.</div>
              <div><span className="text-muted-foreground">Step 3 — Sensitive Attribute Inference</span>{"\n"}  The attacker looks at the distribution of <strong>{r.mostVulnerableEc.saName}</strong> within this group:{"\n"}{r.mostVulnerableEc.saDistribution.map((d) => `    ${d.value}: ${d.count} records (${d.pct}%)`).join("\n")}{"\n"}{"\n"}  Dominant value: <strong>{r.mostVulnerableEc.dominantValue}</strong> — appears in <strong>{(r.mostVulnerableEc.dominantFreq * 100).toFixed(1)}%</strong> of records.</div>
              <div><span className={r.mostVulnerableEc.dominantFreq >= 1.0 ? "text-red-600 font-bold" : "text-orange-600 font-bold"}>  {r.mostVulnerableEc.dominantFreq >= 1.0 ? "⚠️ Since all" : "⚠️ Since"} {r.mostVulnerableEc.dominantFreq >= 1.0 ? r.mostVulnerableEc.ecSize : Math.round(r.mostVulnerableEc.dominantFreq * r.mostVulnerableEc.ecSize)} of {r.mostVulnerableEc.ecSize} records in this group have {r.mostVulnerableEc.saName} = {r.mostVulnerableEc.dominantValue},{"\n"}  the attacker knows this person's {r.mostVulnerableEc.saName} with <strong>{(r.mostVulnerableEc.dominantFreq * 100).toFixed(1)}%</strong> certainty{"\n"}  — WITHOUT knowing which specific record is theirs.</span></div>
              <div><span className="text-muted-foreground">Step 4 — No Re-identification Required</span>{"\n"}  The attacker did not learn the person's name, ID, or any unique identifier.{"\n"}  They only used the QI combination to place the target into a group.{"\n"}  Yet they now know: <strong>{r.mostVulnerableEc.saName} = {r.mostVulnerableEc.dominantValue}</strong>   ({(r.mostVulnerableEc.dominantFreq * 100).toFixed(1)}% confident)</div>
              {r.perSAResults[0] && (
                <div><span className="text-muted-foreground">Step 5 — Scale</span>{"\n"}  Records with guaranteed SA disclosure (EC fully homogeneous): <strong>{r.perSAResults[0].guaranteedRecords.toLocaleString()}</strong>{"\n"}  Records with high disclosure risk (≥75% dominant freq):       <strong>{r.perSAResults[0].highRiskRecords.toLocaleString()}</strong>{"\n"}  Total records with some disclosure risk (&gt;50%):               <strong>{(r.perSAResults[0].guaranteedRecords + r.perSAResults[0].highRiskRecords + r.perSAResults[0].moderateRiskRecords).toLocaleString()}</strong>{"\n"}  That is <strong>{r.N > 0 ? (((r.perSAResults[0].guaranteedRecords + r.perSAResults[0].highRiskRecords + r.perSAResults[0].moderateRiskRecords) / r.N) * 100).toFixed(1) : 0}%</strong> of your entire dataset.</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* §5.10 Top 10 Vulnerable Records */}
      {r.topVulnerable.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.10 Top Vulnerable Records</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-1 pr-2">Rank</th>
                  <th className="text-left pb-1 pr-2">QI Combination</th>
                  <th className="text-right pb-1 pr-2">EC Size</th>
                  <th className="text-right pb-1 pr-2">SA</th>
                  <th className="text-right pb-1 pr-2">SA Value</th>
                  <th className="text-right pb-1 pr-2">Dom. Freq</th>
                  <th className="text-right pb-1 pr-2">Label</th>
                  <th className="text-left pb-1">Why Vulnerable</th>
                </tr>
              </thead>
              <tbody>
                {r.topVulnerable.map((v, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1 pr-2 font-bold text-muted-foreground">{v.rank}</td>
                    <td className="py-1 pr-2 text-muted-foreground truncate max-w-[140px]">{v.qiCombo.slice(0, 50)}</td>
                    <td className="py-1 text-right pr-2">{v.ecSize}</td>
                    <td className="py-1 text-right pr-2 font-medium">{v.saName}</td>
                    <td className="py-1 text-right pr-2">{v.saValue.slice(0, 14)}</td>
                    <td className="py-1 text-right pr-2 font-bold" style={{ color: disclosureLabelColor(v.disclosureLabel) }}>{(v.dominantFreq * 100).toFixed(0)}%</td>
                    <td className="py-1 text-right pr-2">{disclosureLabelBadge(v.disclosureLabel)}</td>
                    <td className="py-1 text-muted-foreground">{v.whyVulnerable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2 italic">
              These records do not need to be uniquely re-identified for harm to occur. The attacker only needs to know the person's quasi-identifier combination to infer their sensitive attribute.
            </p>
          </CardContent>
        </Card>
      )}

      {/* §5.11 SA Sensitivity Ranking */}
      {r.saSensitivityRanking.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.11 Sensitive Attribute Sensitivity Ranking</CardTitle></CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pb-1">Rank</th>
                    <th className="text-left pb-1">Sensitive Attribute</th>
                    <th className="text-right pb-1">ADR</th>
                    <th className="text-right pb-1">Guaranteed</th>
                    <th className="text-right pb-1">Homo. ECs</th>
                    <th className="text-right pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.saSensitivityRanking.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 pr-2 font-bold text-muted-foreground">{row.rank}</td>
                      <td className="py-1.5 font-medium">{row.sa}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: row.adr > 0.6 ? "#DC2626" : row.adr >= 0.2 ? "#D97706" : "#16A34A" }}>{(row.adr * 100).toFixed(1)}%</td>
                      <td className="py-1.5 text-right">{row.guaranteedRecords.toLocaleString()}</td>
                      <td className="py-1.5 text-right">{row.homogeneousEcs}/{row.totalEcs}</td>
                      <td className="py-1.5 text-right">{riskBadge(row.riskLevel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ResponsiveContainer width="100%" height={Math.max(120, r.saSensitivityRanking.length * 36)}>
                <BarChart data={r.saSensitivityRanking.map((s) => ({ sa: s.sa, adr: parseFloat((s.adr * 100).toFixed(1)) }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                  <YAxis type="category" dataKey="sa" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="adr" radius={[0, 4, 4, 0]} name="ADR %">
                    {r.saSensitivityRanking.map((s, i) => (
                      <Cell key={i} fill={s.adr > 0.6 ? "#DC2626" : s.adr >= 0.2 ? "#D97706" : "#16A34A"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              The most exposed attribute is <strong>{r.saSensitivityRanking[0]?.sa}</strong> —{" "}
              <strong>{((r.saSensitivityRanking[0]?.adr ?? 0) * 100).toFixed(1)}%</strong> of records can have this value inferred without re-identification.
            </p>
          </CardContent>
        </Card>
      )}

      {/* §5.12 Recommendations */}
      <RecommendationsCard recs={r.recommendations} />

    </div>
  );
}

function DifferencingReport({ r }: { r: DifferencingResult }) {
  const [diffFilter, setDiffFilter] = useState<DiffLabel | "All">("All");
  const [diffSearch, setDiffSearch] = useState("");
  const [diffPage, setDiffPage] = useState(0);
  const PAGE_SIZE = 50;

  const diffLabelColor = (label: DiffLabel) =>
    label === "Exact Reconstruction" ? "#DC2626" : label === "Near-Exact" ? "#EA580C" : label === "Partial" ? "#D97706" : "#16A34A";
  const diffLabelBg = (label: DiffLabel) =>
    label === "Exact Reconstruction" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    : label === "Near-Exact" ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
    : label === "Partial" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
    : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";

  const filteredRecords = r.recordTable.filter((row) => {
    const matchFilter = diffFilter === "All" || row.diffLabel === diffFilter;
    const matchSearch = diffSearch === "" || r.quasiIdentifiers.some((qi) => String(row.qiValues[qi] ?? "").toLowerCase().includes(diffSearch.toLowerCase()));
    return matchFilter && matchSearch;
  });
  const pagedRecords = filteredRecords.slice(diffPage * PAGE_SIZE, (diffPage + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredRecords.length / PAGE_SIZE);

  const donutData = [
    { name: "Exact Reconstruction", value: r.exactCount, fill: "#DC2626" },
    { name: "Near-Exact", value: r.nearExactCount, fill: "#EA580C" },
    { name: "Partial", value: r.partialCount, fill: "#D97706" },
    { name: "Protected", value: r.protectedCount, fill: "#16A34A" },
  ].filter((d) => d.value > 0);

  const badgeColor = r.riskLevel === "HIGH" ? "bg-red-600" : r.riskLevel === "MEDIUM" ? "bg-yellow-500" : "bg-green-600";
  const badgeIcon  = r.riskLevel === "HIGH" ? "🔴" : r.riskLevel === "MEDIUM" ? "🟡" : "🟢";

  const exportCSV = () => {
    const qiCols = r.quasiIdentifiers.join(",");
    const header = `Row #,${qiCols},EC Size,Diff Risk,Vulnerability Label,Query Pair Possible?,At Risk\n`;
    const rows = r.recordTable.map((row) => {
      const qiVals = r.quasiIdentifiers.map((qi) => `"${row.qiValues[qi] ?? ""}"`).join(",");
      return `${row.rowIdx},${qiVals},${row.ecSize},${row.diffRisk},"${row.diffLabel}",${row.queryPairPossible ? "Yes" : "No"},${row.atRisk ? "At Risk" : "Protected"}`;
    });
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "differencing_trace.csv"; a.click();
  };

  const mv = r.mostVulnerableRecord;

  return (
    <div className="space-y-6">

      {/* §5.1 Summary banner */}
      <Card className={`border-l-4 ${r.riskLevel === "HIGH" ? "border-red-600" : r.riskLevel === "MEDIUM" ? "border-yellow-500" : "border-green-500"}`}>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-bold text-white px-2 py-0.5 rounded ${badgeColor}`}>{badgeIcon} Differencing Attack Risk: {r.riskLevel}</span>
          </div>
          <p className="text-sm">
            An attacker with access to aggregate query results (counts, sums, averages) over this dataset could reconstruct the sensitive
            attribute values of <strong>{r.exactCount}</strong> individuals exactly, and approximate values for <strong>{r.nearExactCount}</strong> more.
          </p>
          <p className="text-sm text-muted-foreground">
            This attack does <strong>NOT</strong> require access to raw records. It works by issuing two overlapping queries and subtracting
            the results to isolate a single person's data. <strong>{r.coverageRate.toFixed(1)}%</strong> of this dataset is reconstructable via differencing.
          </p>
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            k-anonymity and l-diversity do NOT prevent this attack. Differential Privacy noise addition is required.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Results based on {r.N} rows · QIs: {r.quasiIdentifiers.join(", ")} · SAs assessed: {r.sensitiveAttributes.join(", ") || "—"}
          </p>
        </CardContent>
      </Card>

      {/* §5.2 KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCard("DDR", `${(r.ddr * 100).toFixed(1)}%`, "Dataset Differencing Risk", <BarChart3 className="h-4 w-4" />, r.ddr > 0.2 ? "text-red-600" : r.ddr >= 0.05 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Exact Recon.", r.exactCount, "records (EC=1)", <XCircle className="h-4 w-4" />, r.exactCount > 0 ? "text-red-600" : "text-green-600")}
        {kpiCard("Near-Exact", r.nearExactCount, "records (EC 2–3)", <AlertTriangle className="h-4 w-4" />, r.nearExactCount > 0 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Total Reconstructable", `${r.exactCount + r.nearExactCount}`, `${r.coverageRate.toFixed(1)}% of dataset`, <Eye className="h-4 w-4" />, (r.exactCount + r.nearExactCount) > 0 ? "text-red-600" : "text-green-600")}
        {kpiCard("Min EC Size", r.minK, r.minK < 5 ? "Below k-threshold" : "OK", <Shield className="h-4 w-4" />, r.minK < 5 ? "text-red-600" : "text-green-600")}
        {kpiCard("Avg EC Size", r.avgEcSize.toFixed(1), "mean equivalence class", <Users className="h-4 w-4" />)}
      </div>

      {/* §5.3 Donut + §5.6 EC size distribution side by side */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.3 Vulnerability Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name" paddingAngle={2}>
                  {donutData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number, name: string) => [`${v} records`, name]} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.6 EC Size Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs mb-3">
                <thead><tr className="border-b text-muted-foreground">
                  <th className="text-left pb-1">EC Size</th>
                  <th className="text-right pb-1"># ECs</th>
                  <th className="text-right pb-1"># Records</th>
                  <th className="text-right pb-1">% of Data</th>
                  <th className="text-right pb-1">Diff Risk</th>
                </tr></thead>
                <tbody>
                  {r.ecSizeDistribution.map((b, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 font-medium" style={{ color: b.fill }}>{b.label}</td>
                      <td className="py-1 text-right">{b.ecCount}</td>
                      <td className="py-1 text-right">{b.recordCount}</td>
                      <td className="py-1 text-right">{b.pct}%</td>
                      <td className="py-1 text-right text-xs" style={{ color: b.fill }}>
                        {b.riskCategory === "Exact" ? "🔴 Certain" : b.riskCategory === "Near-Exact" ? "🟠 High accuracy" : b.riskCategory === "Partial" ? "🟡 Partial signal" : "🟢 Protected"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={r.ecSizeDistribution} layout="vertical" margin={{ left: 0, right: 10 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={110} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="recordCount" name="Records" radius={[0, 4, 4, 0]}>
                  {r.ecSizeDistribution.map((b, i) => <Cell key={i} fill={b.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* §5.4 Record trace table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">§5.4 Record-Level Differencing Trace Table ({filteredRecords.length} records)</CardTitle>
            <button onClick={exportCSV} className="text-xs px-2 py-1 rounded border border-muted hover:bg-muted transition-colors">⬇ Download Full Table (CSV)</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["All", "Exact Reconstruction", "Near-Exact", "Partial", "Protected"] as const).map((f) => (
              <button key={f} onClick={() => { setDiffFilter(f); setDiffPage(0); }}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${diffFilter === f ? "bg-primary text-primary-foreground border-primary" : "border-muted hover:bg-muted"}`}>
                {f === "Exact Reconstruction" ? "🔴 Exact" : f === "Near-Exact" ? "🟠 Near-Exact" : f === "Partial" ? "🟡 Partial" : f === "Protected" ? "🟢 Protected" : "Show All"}
              </button>
            ))}
            <input value={diffSearch} onChange={(e) => { setDiffSearch(e.target.value); setDiffPage(0); }}
              placeholder="Search QI values…" className="text-xs px-2 py-0.5 rounded border border-muted bg-background w-40" />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b">
                  <th className="text-left pb-1 pr-2">Row #</th>
                  {r.quasiIdentifiers.map((qi) => <th key={qi} className="text-left pb-1 pr-2">{qi}</th>)}
                  <th className="text-right pb-1 pr-2">EC Size</th>
                  <th className="text-right pb-1 pr-2">Diff Risk</th>
                  <th className="text-left pb-1 pr-2">Vulnerability</th>
                  <th className="text-center pb-1 pr-2">Query Pair?</th>
                  <th className="text-center pb-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedRecords.map((row, i) => (
                  <tr key={i} className="border-b border-muted hover:bg-muted/30">
                    <td className="py-1 pr-2">#{row.rowIdx}</td>
                    {r.quasiIdentifiers.map((qi) => <td key={qi} className="py-1 pr-2 text-muted-foreground">{row.qiValues[qi]}</td>)}
                    <td className="py-1 pr-2 text-right">{row.ecSize}</td>
                    <td className="py-1 pr-2 text-right font-bold" style={{ color: diffLabelColor(row.diffLabel) }}>{row.diffRisk.toFixed(2)}</td>
                    <td className="py-1 pr-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${diffLabelBg(row.diffLabel)}`}>{row.diffLabel}</span></td>
                    <td className="py-1 pr-2 text-center">{row.queryPairPossible ? <span className="text-red-600 font-bold">Yes</span> : <span className="text-green-600">No</span>}</td>
                    <td className="py-1 text-center">{row.atRisk ? "🔴 At Risk" : "🟢 Protected"}</td>
                  </tr>
                ))}
                {pagedRecords.length === 0 && <tr><td colSpan={r.quasiIdentifiers.length + 6} className="py-4 text-center text-muted-foreground">No records match filter.</td></tr>}
              </tbody>
            </table>
          </ScrollArea>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>Page {diffPage + 1} of {totalPages} ({filteredRecords.length} records)</span>
              <div className="flex gap-1">
                <button onClick={() => setDiffPage((p) => Math.max(0, p - 1))} disabled={diffPage === 0} className="px-2 py-0.5 border rounded disabled:opacity-40">← Prev</button>
                <button onClick={() => setDiffPage((p) => Math.min(totalPages - 1, p + 1))} disabled={diffPage >= totalPages - 1} className="px-2 py-0.5 border rounded disabled:opacity-40">Next →</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* §5.5 Attack Simulation Narrative */}
      {mv && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20">
          <CardHeader><CardTitle className="text-sm">§5.5 Attack Simulation — How This Attack Works on YOUR Data</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre-wrap leading-5">
{`DIFFERENCING ATTACK SIMULATION — Step by Step

Step 1 — Setup
  The attacker has access to a query interface over this dataset.
  They do NOT have access to individual records.
  They know that person X has these quasi-identifier values:
${r.quasiIdentifiers.map((qi) => `    ${qi} = ${mv.qiValues[qi] ?? "?"}`).join("\n")}

Step 2 — Query 1 (Full Group)
  Attacker issues: SELECT ${mv.isNumericSA ? "AVG" : "COUNT"} of ${mv.saName}
                   WHERE ${r.quasiIdentifiers.map((qi) => `${qi}='${mv.qiValues[qi]}'`).join(" AND ")}
  
  Result: ${mv.r1 !== null ? mv.r1 : "—"}   (based on ${mv.ecSize} records)

Step 3 — Query 2 (Group Minus Target)
  Attacker issues: SELECT ${mv.isNumericSA ? "AVG" : "COUNT"} of ${mv.saName}
                   WHERE ${r.quasiIdentifiers.map((qi) => `${qi}='${mv.qiValues[qi]}'`).join(" AND ")}
                   AND rowid != ${mv.rowIdx}   ← attacker excludes target using auxiliary fact
  
  Result: ${mv.r2 !== null ? mv.r2 : "—"}   (based on ${mv.ecSize - 1} records)

Step 4 — Reconstruction via Subtraction
  Person X's ${mv.saName} = (Query_1 × ${mv.ecSize}) − (Query_2 × ${mv.ecSize - 1})
                           = (${mv.r1} × ${mv.ecSize}) − (${mv.r2} × ${mv.ecSize - 1})
                           = ${mv.reconstructedValue ?? "—"}
  
  ✅ Attack successful. Person X's ${mv.saName} = ${mv.reconstructedValue ?? "—"}
     Reconstructed with ${(mv.diffRisk * 100).toFixed(0)}% certainty.

Step 5 — Scale
  Records reconstructable with certainty (EC=1):  ${r.exactCount}
  Records reconstructable with high accuracy:      ${r.exactCount + r.nearExactCount}
  Coverage rate:                                   ${r.coverageRate.toFixed(1)}%
  
  An attacker with query access could reconstruct the sensitive
  attributes of ${r.coverageRate.toFixed(1)}% of this dataset without ever
  seeing a single raw record.`}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* §5.7 SA Reconstruction Analysis */}
      {r.saReconstruction.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.7 SA Reconstruction Analysis</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {r.saReconstruction.map((sa) => (
              <div key={sa.sa} className="border rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{sa.sa}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{sa.isNumericSA ? "Numeric" : "Categorical / Binary"}</span>
                </div>
                {sa.isNumericSA ? (
                  <Fragment>
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <span>Global range: <strong className="text-foreground">{sa.saMin.toFixed(2)} – {sa.saMax.toFixed(2)}</strong> (range = {sa.saRange.toFixed(2)})</span>
                      <span>Global std dev: <strong className="text-foreground">{sa.saStd}</strong></span>
                      <span>ECs where exact recon possible: <strong className="text-red-600">{sa.exactReconEcs}</strong></span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b text-muted-foreground">
                          <th className="text-left pb-1">EC Size</th>
                          <th className="text-right pb-1">Recon Error (σ)</th>
                          <th className="text-right pb-1">Error as % of Range</th>
                          <th className="text-right pb-1">Verdict</th>
                        </tr></thead>
                        <tbody>
                          {sa.reconstructionTable.map((row) => (
                            <tr key={row.ecSize} className="border-b border-muted">
                              <td className="py-1">{row.ecSize}{row.ecSize === 1 ? " (Exact)" : ""}</td>
                              <td className="py-1 text-right">{row.ecSize === 1 ? "0" : `σ/√${row.ecSize} = ${row.reconError}`}</td>
                              <td className="py-1 text-right">{row.errorPct}%</td>
                              <td className="py-1 text-right">{row.verdict}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-xs bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded p-2 mt-1">
                      <strong>Required Noise for DP Protection:</strong> To prevent differencing on <em>{sa.sa}</em>, any published aggregate must include Laplace noise with std ≥ <strong>{sa.requiredNoiseStd.toFixed(2)}</strong> (at ε = 1.0). This corresponds to a ±{(sa.requiredNoiseStd * 2).toFixed(2)} uncertainty in any reported figure.
                    </div>
                  </Fragment>
                ) : (
                  <div className="text-xs space-y-1">
                    <p>Count-based differencing can reveal whether the target has a specific <em>{sa.sa}</em> value (e.g., Yes or No).</p>
                    <p>ECs where count differencing reveals SA value: <strong className="text-red-600">{sa.exactReconEcs}</strong></p>
                    <p>Required protection: Add ±1 count noise to all published group counts.</p>
                    <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded p-2">
                      Required noise std (at ε = 1.0): <strong>1.00</strong> (binary SA sensitivity = 1)
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* §5.8 DP Noise Sufficiency Check */}
      <Card className="border-yellow-200 dark:border-yellow-800">
        <CardHeader><CardTitle className="text-sm">§5.8 Differential Privacy Noise Sufficiency Check</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">For the differencing attack to be blocked, any aggregate release of this dataset must add noise with standard deviation at least equal to the SA sensitivity divided by the privacy budget ε.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b text-muted-foreground">
                <th className="text-left pb-1">Sensitive Attribute</th>
                <th className="text-right pb-1">SA Sensitivity</th>
                <th className="text-right pb-1">Required Noise Std (ε=1)</th>
                <th className="text-right pb-1">Current Protection</th>
              </tr></thead>
              <tbody>
                {r.saReconstruction.length > 0 ? r.saReconstruction.map((sa) => (
                  <tr key={sa.sa} className="border-b border-muted">
                    <td className="py-1 font-medium">{sa.sa}</td>
                    <td className="py-1 text-right">{sa.isNumericSA ? sa.saRange.toFixed(2) : "1 (binary)"}</td>
                    <td className="py-1 text-right font-bold text-orange-600">{sa.requiredNoiseStd.toFixed(2)}</td>
                    <td className="py-1 text-right text-red-600">❌ None added</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="py-2 text-muted-foreground text-center">No sensitive attributes selected.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-2">
            <span className="text-red-600 font-bold">🔴</span>
            <span>No differential privacy noise detected. Aggregates derived from this data are vulnerable to differencing.</span>
          </div>
          <p className="text-xs text-muted-foreground">Before publishing any aggregate statistics from this dataset, apply Laplace or Gaussian noise with the required std above. Use the Privacy Enhancement module to apply DP noise.</p>
        </CardContent>
      </Card>

      {/* §5.9 L-Diversity per SA */}
      {r.lDivResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.9 L-Diversity Check (Per Sensitive Attribute)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {r.lDivResults.map((res) => (
              <div key={res.sa} className="border rounded p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{res.sa}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${res.lStatus === "PASS" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}>{res.lStatus === "PASS" ? "🟢 PASS" : "🔴 FAIL"}</span>
                </div>
                <p>Minimum distinct SA values in any EC: <strong>{res.minL}</strong></p>
                <p>ECs violating l-diversity: <strong className={res.violatingEcs > 0 ? "text-red-600" : ""}>{res.violatingEcs}</strong> out of {res.totalEcs} ({res.totalEcs > 0 ? ((res.violatingEcs / res.totalEcs) * 100).toFixed(1) : 0}%)</p>
                <p className="text-muted-foreground italic">Note: L-Diversity does NOT prevent differencing attacks. Even if this check passes, differencing can still reconstruct SA values from aggregate queries on small ECs.</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* §5.10 T-Closeness per SA */}
      {r.tCloseResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">§5.10 T-Closeness Check (Per Sensitive Attribute)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {r.tCloseResults.map((res) => (
              <div key={res.sa} className="border rounded p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{res.sa}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${res.tStatus === "PASS" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}>{res.tStatus === "PASS" ? "🟢 PASS" : "🔴 FAIL"}</span>
                </div>
                <p>Maximum EC deviation (TVD): <strong>{res.maxDistance}</strong></p>
                <p>ECs violating t-closeness: <strong className={res.violatingEcs > 0 ? "text-red-600" : ""}>{res.violatingEcs}</strong> out of {res.totalEcs} ({res.totalEcs > 0 ? ((res.violatingEcs / res.totalEcs) * 100).toFixed(1) : 0}%)</p>
                <p className="text-muted-foreground italic">Note: T-Closeness does NOT prevent differencing attacks. Differencing exploits aggregate arithmetic, not distributional skewness. DP noise is the correct countermeasure.</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* §5.11 Top 10 vulnerable records */}
      <Card>
        <CardHeader><CardTitle className="text-sm">§5.11 Top Vulnerable Records</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-[220px]">
            <table className="w-full text-xs">
              <thead><tr className="border-b text-muted-foreground">
                <th className="text-left pb-1">Rank</th>
                <th className="text-left pb-1">QI Combination</th>
                <th className="text-right pb-1">EC Size</th>
                <th className="text-right pb-1">Diff Risk</th>
                <th className="text-left pb-1">Label</th>
                <th className="text-left pb-1">Why Vulnerable</th>
              </tr></thead>
              <tbody>
                {r.topVulnerable.map((row) => (
                  <tr key={row.rank} className="border-b border-muted">
                    <td className="py-1 font-bold">#{row.rank}</td>
                    <td className="py-1 font-mono text-muted-foreground max-w-[160px] truncate" title={row.qiCombo}>{row.qiCombo}</td>
                    <td className="py-1 text-right">{row.ecSize}</td>
                    <td className="py-1 text-right font-bold" style={{ color: diffLabelColor(row.diffLabel) }}>{row.diffRisk.toFixed(2)}</td>
                    <td className="py-1"><span className={`px-1.5 py-0.5 rounded text-[10px] ${diffLabelBg(row.diffLabel)}`}>{row.diffLabel}</span></td>
                    <td className="py-1 text-muted-foreground">{row.whyVulnerable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <p className="text-xs text-muted-foreground mt-2 italic">These records' sensitive attribute values can be reconstructed from aggregate query responses — no raw data access required. Apply differential privacy noise before publishing any statistics derived from this dataset.</p>
        </CardContent>
      </Card>

      {/* §5.12 Query Pair Catalogue */}
      {r.queryPairs.length > 0 && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader><CardTitle className="text-sm">§5.12 Query Pair Catalogue — Attacker's Playbook (Top {r.queryPairs.length} Most Vulnerable Records)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {r.queryPairs.map((qp) => (
              <div key={qp.rank} className="border rounded bg-muted/30">
                <div className="px-3 py-1.5 border-b bg-muted/50 text-xs font-bold">
                  Query Pair #{qp.rank} — Targets Row #{qp.rowIdx}  (EC size = {qp.ecSize}, Diff Risk = {qp.diffRisk.toFixed(2)})
                </div>
                <pre className="text-xs font-mono p-3 overflow-x-auto whitespace-pre-wrap leading-5">
{`Query A:  SELECT ${qp.r1 !== null ? "AVG" : "COUNT"}(${qp.saName})
          FROM dataset
          WHERE ${qp.qiConditions}
          → Result: ${qp.r1 !== null ? qp.r1 : "—"}  (n = ${qp.ecSize} records)

Query B:  SELECT ${qp.r1 !== null ? "AVG" : "COUNT"}(${qp.saName})
          FROM dataset
          WHERE ${qp.qiConditions}
          AND rowid != ${qp.rowIdx}
          → Result: ${qp.r2 !== null ? qp.r2 : "—"}  (n = ${qp.ecSize - 1} records)

Reconstruction:
  ${qp.formula}
  → Target ${qp.saName} = ${qp.reconstructedValue ?? "—"}`}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* §5.13 Recommendations */}
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function MIProtectionRow({
  label, param, stat, configuredVal,
}: {
  label: string; param: string; stat: ModelInversionResult["kAnalysis"]; configuredVal: number;
}) {
  const passPct = parseFloat((((stat.satisfying) / Math.max(stat.total, 1)) * 100).toFixed(1));
  const ok = stat.violating === 0;
  return (
    <div className={`rounded-lg border p-3 space-y-1.5 ${ok ? "border-green-300 bg-green-50 dark:bg-green-950/20" : stat.violatingPct > 10 ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-amber-300 bg-amber-50 dark:bg-amber-950/20"}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold">{label} ({param}={configuredVal})</span>
        <span className="text-lg">{ok ? "✅" : stat.violatingPct > 10 ? "❌" : "⚠️"}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-green-700 dark:text-green-400">{passPct}% of classes satisfy {param}≥{configuredVal}</span>
      </div>
      {stat.violating > 0 && (
        <div className="text-xs">
          <span className={stat.violatingPct > 10 ? "text-red-600 font-semibold" : "text-amber-600"}>
            {stat.violating} classes ({stat.violatingPct}%) violating → {stat.exposedRecords} records exposed ({stat.exposedPct}%)
          </span>
        </div>
      )}
    </div>
  );
}

const MI_VULN_COLORS = ["#16A34A", "#65A30D", "#D97706", "#EA580C", "#DC2626"];
const MI_PRIORITY_COLORS: Record<string, string> = { P1: "text-red-600", P2: "text-amber-600", P3: "text-green-700" };
const MI_PRIORITY_ICONS: Record<string, string> = { P1: "🔴", P2: "🟡", P3: "🟢" };

function ModelInversionReport({ r, kVal, lVal, tVal }: { r: ModelInversionResult; kVal: number; lVal: number; tVal: number }) {
  const [recPage, setRecPage] = useState(1);
  const [recFilter, setRecFilter] = useState<"all" | "HIGH" | "CRITICAL" | "MEDIUM">("all");
  const [recSearch, setRecSearch] = useState("");
  const REC_PAGE_SIZE = 50;

  const scoreColor = r.riskLevel === "CRITICAL" ? "text-red-600" : r.riskLevel === "HIGH" ? "text-orange-600" : r.riskLevel === "MEDIUM" ? "text-amber-600" : "text-green-600";
  const scoreBorder = r.riskLevel === "CRITICAL" ? "border-red-400 bg-red-50 dark:bg-red-950/20" : r.riskLevel === "HIGH" ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20" : r.riskLevel === "MEDIUM" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : "border-green-400 bg-green-50 dark:bg-green-950/20";

  const filteredRecords = r.perRecordTable.filter((row) => {
    if (recFilter !== "all" && row.riskLevel !== recFilter) return false;
    if (recSearch && !row.qiHash.toLowerCase().includes(recSearch.toLowerCase())) return false;
    return true;
  });
  const totalRecPages = Math.max(1, Math.ceil(filteredRecords.length / REC_PAGE_SIZE));
  const safeRecPage = Math.min(recPage, totalRecPages);
  const pageRecords = filteredRecords.slice((safeRecPage - 1) * REC_PAGE_SIZE, safeRecPage * REC_PAGE_SIZE);

  // Max MI per QI (for heatmap colour scaling)
  const maxMI = r.miLeakageMap.length > 0 ? Math.max(...r.miLeakageMap.map((e) => e.mi)) : 1;
  const uniqueQIs = Array.from(new Set(r.miLeakageMap.map((e) => e.qi)));
  const uniqueSAs = Array.from(new Set(r.miLeakageMap.map((e) => e.sa)));

  return (
    <div className="space-y-6">

      {/* ── §8.1 Overall MIRisk Score ─────────────────────────────────────────── */}
      <div className={`rounded-lg border-2 p-5 ${scoreBorder}`}>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">🔬 Model Inversion Attack — Overall Risk</div>
            <div className={`text-5xl font-black ${scoreColor}`}>{(r.datasetMIRisk * 100).toFixed(1)}<span className="text-xl font-normal text-muted-foreground">/100</span></div>
            <div className="mt-2">{riskBadge(r.riskLevel)}</div>
          </div>
          <div className="grid grid-cols-3 gap-4 flex-1">
            <div className="text-center rounded-lg bg-white/60 dark:bg-black/20 p-3 border border-muted">
              <div className="text-2xl font-bold">{r.totalRecords.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Records Assessed</div>
            </div>
            <div className="text-center rounded-lg bg-white/60 dark:bg-black/20 p-3 border border-muted">
              <div className={`text-2xl font-bold ${r.atRiskCount > 0 ? "text-red-600" : "text-green-600"}`}>{r.atRiskCount.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">At-Risk Records</div>
            </div>
            <div className="text-center rounded-lg bg-white/60 dark:bg-black/20 p-3 border border-muted">
              <div className={`text-2xl font-bold ${r.atRiskPct > 20 ? "text-red-600" : r.atRiskPct > 5 ? "text-amber-600" : "text-green-600"}`}>{r.atRiskPct}%</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Flagged At-Risk</div>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>LOW (0.00–0.30)</span><span>MEDIUM (0.31–0.60)</span><span>HIGH (0.61–0.80)</span><span>CRITICAL (0.81–1.00)</span>
          </div>
          <div className="relative h-3 rounded-full bg-gradient-to-r from-green-400 via-amber-400 via-orange-500 to-red-600 overflow-hidden">
            <div
              className="absolute top-0 h-full w-1 bg-white dark:bg-gray-900 shadow-lg rounded-full"
              style={{ left: `${Math.min(99, r.datasetMIRisk * 100)}%`, transform: "translateX(-50%)" }}
            />
          </div>
        </div>
      </div>

      {/* ── §8.2 Attribute Inference Vulnerability Breakdown ──────────────────── */}
      {r.perSAResults.length > 0 && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">§8.2 — Attribute Inference Vulnerability (Max P(S|Q) per Sensitive Attribute)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={r.perSAResults} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                  <YAxis type="category" dataKey="sa" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="maxConfidence" name="Max Inference Confidence" radius={[0, 4, 4, 0]}>
                    {r.perSAResults.map((sa, i) => (
                      <Cell key={i} fill={sa.maxConfidence > 80 ? "#DC2626" : sa.maxConfidence > 60 ? "#EA580C" : sa.maxConfidence > 40 ? "#D97706" : "#16A34A"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sensitive Attribute Inference Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-1.5 px-2">Sensitive Attribute</th>
                    <th className="text-right py-1.5 px-2">Max P(S|Q)</th>
                    <th className="text-right py-1.5 px-2">Mean P(S|Q)</th>
                    <th className="text-right py-1.5 px-2">At-Risk (&gt;85%)</th>
                    <th className="text-right py-1.5 px-2">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {r.perSAResults.map((sa, i) => (
                    <tr key={i} className="border-b border-muted hover:bg-muted/20">
                      <td className="py-1.5 px-2 font-medium truncate max-w-[100px]">{sa.sa}</td>
                      <td className="py-1.5 px-2 text-right font-bold" style={{ color: sa.maxConfidence > 80 ? "#DC2626" : sa.maxConfidence > 60 ? "#EA580C" : "#16A34A" }}>{sa.maxConfidence}%</td>
                      <td className="py-1.5 px-2 text-right">{sa.meanConfidence}%</td>
                      <td className="py-1.5 px-2 text-right">{sa.atRiskPct}%</td>
                      <td className="py-1.5 px-2 text-right">{riskBadge(sa.riskLevel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── §8.3 EC VulnScore Distribution ───────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">§8.3 — Equivalence Class Inversion Risk Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">VulnScore = max P(S=s | Q=v) per equivalence class</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={r.ecVulnDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} label={{ value: "VulnScore Range", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} label={{ value: "# ECs", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Equivalence Classes" radius={[4, 4, 0, 0]}>
                  {r.ecVulnDistribution.map((_, i) => (
                    <Cell key={i} fill={MI_VULN_COLORS[i] || "#DC2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── §8.5 Small-Cell Aggregate Inversion Risk ───────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">§8.5 — Small-Cell Aggregate Inversion Risk</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${r.smallCells.pct > 20 ? "bg-red-100 text-red-700 border-red-300" : r.smallCells.pct > 5 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-green-100 text-green-700 border-green-300"}`}>
                AggInvRisk: {(r.aggInvRisk * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">{r.smallCells.count}/{r.smallCells.totalCells} cells with n≤5 ({r.smallCells.pct}%)</span>
            </div>
          </CardHeader>
          <CardContent>
            {r.smallCells.highRiskCombos.length === 0 ? (
              <div className="flex items-center gap-2 py-6 text-green-600 text-sm">
                <CheckCircle className="h-5 w-5" />
                <span>No small cells detected — aggregate inversion risk is low.</span>
              </div>
            ) : (
              <ScrollArea className="h-[170px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-1 px-2">QI Combination</th>
                      <th className="text-right py-1 px-2">Cell Size</th>
                      <th className="text-right py-1 px-2">AggInvRisk</th>
                      <th className="text-right py-1 px-2">Threat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.smallCells.highRiskCombos.map((c, i) => (
                      <tr key={i} className="border-b border-muted hover:bg-muted/20">
                        <td className="py-1 px-2 text-muted-foreground truncate max-w-[150px]">{c.combo}</td>
                        <td className="py-1 px-2 text-right font-bold text-red-600">{c.size}</td>
                        <td className="py-1 px-2 text-right font-mono">{(c.aggRisk * 100).toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${c.size === 1 ? "bg-red-100 text-red-700 border-red-300" : "bg-amber-100 text-amber-700 border-amber-300"}`}>
                            {c.size === 1 ? "⚠️ Singleton" : "Small Cell"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── §8.4 k/l/t Protection Analysis ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">§8.4 — k-Anonymity / l-Diversity / t-Closeness Protection Analysis</CardTitle>
          <p className="text-xs text-muted-foreground">How well do configured privacy parameters protect against model inversion?</p>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <MIProtectionRow label="k-Anonymity" param="k" stat={r.kAnalysis} configuredVal={kVal} />
            <MIProtectionRow label="l-Diversity" param="l" stat={r.lAnalysis} configuredVal={lVal} />
            <MIProtectionRow label="t-Closeness" param="t" stat={r.tAnalysis} configuredVal={tVal} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            <strong>k-Anonymity</strong> bounds VulnScore ≤ 1/k when satisfied.&ensp;
            <strong>l-Diversity</strong> bounds max P(S|Q) ≤ 1/l, preventing attribute inference.&ensp;
            <strong>t-Closeness</strong> (EMD ≤ t) prevents exploitation of skewed group distributions.
          </p>
        </CardContent>
      </Card>

      {/* ── §8.7 Sensitive Attribute Leakage Map (Mutual Information) ────────── */}
      {r.miLeakageMap.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">§8.7 — Sensitive Attribute Leakage Map (Mutual Information)</CardTitle>
            <p className="text-xs text-muted-foreground">I(Q; S) — higher MI = stronger QI→SA statistical link = higher inversion risk</p>
          </CardHeader>
          <CardContent>
            {uniqueQIs.length <= 12 && uniqueSAs.length <= 6 ? (
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left pr-3 pb-2 text-muted-foreground">QI \ SA</th>
                      {uniqueSAs.map((sa) => (
                        <th key={sa} className="px-2 pb-2 text-center text-muted-foreground truncate max-w-[80px]">{sa.length > 10 ? sa.slice(0, 10) + "…" : sa}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueQIs.map((qi) => (
                      <tr key={qi}>
                        <td className="pr-3 py-1 text-muted-foreground truncate max-w-[100px] font-medium">{qi.length > 12 ? qi.slice(0, 12) + "…" : qi}</td>
                        {uniqueSAs.map((sa) => {
                          const entry = r.miLeakageMap.find((e) => e.qi === qi && e.sa === sa);
                          const mi = entry?.mi ?? 0;
                          const intensity = maxMI > 0 ? mi / maxMI : 0;
                          const bg = intensity > 0.8 ? "bg-red-500 text-white" : intensity > 0.6 ? "bg-orange-400 text-white" : intensity > 0.4 ? "bg-amber-300 text-gray-900" : intensity > 0.2 ? "bg-yellow-200 text-gray-800" : "bg-green-100 text-gray-700";
                          return (
                            <td key={sa} className={`px-3 py-1.5 text-center font-mono rounded-sm m-0.5 ${bg}`} title={`I(${qi};${sa}) = ${mi}`}>
                              {mi.toFixed(3)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
                  <span>MI scale:</span>
                  {["Low (0.0)", "Moderate", "Medium", "High", "Critical"].map((label, i) => (
                    <span key={i} className={`px-1.5 py-0.5 rounded ${["bg-green-100", "bg-yellow-200", "bg-amber-300", "bg-orange-400 text-white", "bg-red-500 text-white"][i]}`}>{label}</span>
                  ))}
                </div>
              </div>
            ) : (
              <ScrollArea className="h-[200px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-1.5 px-3">Quasi-Identifier</th>
                      <th className="text-left py-1.5 px-3">Sensitive Attribute</th>
                      <th className="text-right py-1.5 px-3">Mutual Information</th>
                      <th className="text-right py-1.5 px-3">Leakage Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.miLeakageMap.map((entry, i) => {
                      const intensity = maxMI > 0 ? entry.mi / maxMI : 0;
                      const level = intensity > 0.7 ? "HIGH" : intensity > 0.4 ? "MEDIUM" : "LOW";
                      return (
                        <tr key={i} className="border-b border-muted hover:bg-muted/20">
                          <td className="py-1.5 px-3">{entry.qi}</td>
                          <td className="py-1.5 px-3">{entry.sa}</td>
                          <td className="py-1.5 px-3 text-right font-mono">{entry.mi.toFixed(4)}</td>
                          <td className="py-1.5 px-3 text-right">{riskBadge(level as any)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── §8.6 Per-Record Inversion Risk Table ─────────────────────────────── */}
      {r.perRecordTable.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm">§8.6 — Per-Record Inversion Risk Drill-Down ({filteredRecords.length} records)</CardTitle>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <div className="flex gap-1">
                {(["all", "CRITICAL", "HIGH", "MEDIUM"] as const).map((m) => (
                  <button key={m} onClick={() => { setRecFilter(m); setRecPage(1); }}
                    className={`px-2 py-1 text-[10px] rounded border transition-colors ${recFilter === m ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                    {m === "all" ? "All" : m === "CRITICAL" ? "🔴 Critical" : m === "HIGH" ? "🟠 High" : "🟡 Medium"}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[120px]">
                <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input value={recSearch} onChange={(e) => { setRecSearch(e.target.value); setRecPage(1); }}
                  placeholder="Search QI values…" className="h-7 text-xs pl-6" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2">Row #</th>
                    <th className="text-left px-3 py-2">QI Combination</th>
                    <th className="text-right px-3 py-2">VulnScore</th>
                    <th className="text-right px-3 py-2">MIRisk</th>
                    <th className="text-center px-2 py-2">Risk</th>
                    <th className="text-center px-2 py-2">k-OK</th>
                    <th className="text-center px-2 py-2">l-OK</th>
                    <th className="text-center px-2 py-2">t-OK</th>
                    <th className="text-left px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No records match the current filter.</td></tr>
                  ) : pageRecords.map((row) => (
                    <tr key={row.rowIdx} className="border-b border-muted hover:bg-muted/20">
                      <td className="px-3 py-1.5 text-muted-foreground">R_{String(row.rowIdx).padStart(4, "0")}</td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[180px]">{row.qiHash}</td>
                      <td className="px-3 py-1.5 text-right font-mono" style={{ color: row.vulnScore > 80 ? "#DC2626" : row.vulnScore > 60 ? "#EA580C" : "#16A34A" }}>{row.vulnScore}%</td>
                      <td className="px-3 py-1.5 text-right font-bold" style={{ color: row.miRisk > 61 ? "#DC2626" : row.miRisk > 31 ? "#D97706" : "#16A34A" }}>{row.miRisk}%</td>
                      <td className="px-2 py-1.5 text-center">{riskBadge(row.riskLevel)}</td>
                      <td className="px-2 py-1.5 text-center">{row.kOk ? "✅" : "❌"}</td>
                      <td className="px-2 py-1.5 text-center">{row.lOk ? "✅" : "❌"}</td>
                      <td className="px-2 py-1.5 text-center">{row.tOk ? "✅" : "⚠️"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground text-[10px]">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalRecPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
                <span>Page {safeRecPage} of {totalRecPages}</span>
                <div className="flex gap-1">
                  <button onClick={() => setRecPage((p) => Math.max(1, p - 1))} disabled={safeRecPage === 1}
                    className="p-1 rounded border hover:bg-muted disabled:opacity-40"><ChevronLeft className="h-3 w-3" /></button>
                  <button onClick={() => setRecPage((p) => Math.min(totalRecPages, p + 1))} disabled={safeRecPage === totalRecPages}
                    className="p-1 rounded border hover:bg-muted disabled:opacity-40"><ChevronRight className="h-3 w-3" /></button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── §8.8 Recommended Mitigations ──────────────────────────────────────── */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <Info className="h-4 w-4" /> §8.8 — Recommended Mitigations (Priority Ordered)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {r.recommendations.map((rec, i) => (
              <div key={i} className="flex gap-3 items-start rounded-lg border border-amber-200 dark:border-amber-700 bg-white/60 dark:bg-black/20 p-3">
                <span className="text-lg shrink-0">{MI_PRIORITY_ICONS[rec.priority]}</span>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${MI_PRIORITY_COLORS[rec.priority]}`}>{rec.priority}</span>
                    <span className="text-sm font-semibold text-foreground">{rec.mitigation}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Target: {rec.target}</div>
                  <div className="text-xs text-green-700 dark:text-green-400 font-medium">Expected: {rec.reduction}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RecommendationsCard({ recs }: { recs: string[] }) {
  return (
    <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-200">
          <Info className="h-4 w-4" /> Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {recs.map((r, i) => (
            <li key={i} className="text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
              <span className="mt-0.5 text-amber-600">•</span> {r}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Comparison Dashboard ──────────────────────────────────────────────────────

function ComparisonDashboard({ results }: { results: AllResults }) {
  const c = results.composite;
  if (!c) return <div className="text-center text-muted-foreground py-12">Run all attacks to see comparison dashboard.</div>;

  const radarData = c.breakdown.map((b) => ({
    attack: b.attack,
    risk: b.enabled ? b.risk : 0,
    safe: b.enabled ? Math.max(0, 30 - b.risk) : 0,
  }));

  const barData = [...c.breakdown]
    .filter((b) => b.enabled)
    .sort((a, b) => b.risk - a.risk)
    .map((b) => ({
      name: b.attack,
      risk: b.risk,
      color: RISK_COLORS[b.risk >= 70 ? "CRITICAL" : b.risk >= 50 ? "HIGH" : b.risk >= 30 ? "MEDIUM" : "LOW"],
    }));

  const tableRows = [
    { attack: "Prosecutor",           result: results.prosecutor,           key: "prosecutor" as AttackId,           threat: "Within-dataset re-ID",       metric: results.prosecutor ? `${results.prosecutor.uniqueRecordsCount} unique records` : "—" },
    { attack: "Journalist",           result: results.journalist,           key: "journalist" as AttackId,           threat: "Pop. re-id risk",             metric: results.journalist ? `${results.journalist.atRiskCount} at-risk records` : "—" },
    { attack: "Marketer",             result: results.marketer,             key: "marketer" as AttackId,             threat: "Group attribute disclosure",   metric: results.marketer ? `${(results.marketer.lDiversityPassRate * 100).toFixed(0)}% L-div pass` : "—" },
    { attack: "Singling Out",         result: results.singlingOut,          key: "singlingOut" as AttackId,          threat: "GDPR/DPDP singling-out",      metric: results.singlingOut ? `${results.singlingOut.singulableCount} singulable` : "—" },
    { attack: "Inference",            result: results.inference,            key: "inference" as AttackId,            threat: "ML attribute prediction",     metric: results.inference ? `${results.inference.infoGain}% info gain` : "—" },
    { attack: "Membership",           result: results.membership,           key: "membership" as AttackId,           threat: "Presence detection",          metric: results.membership ? `AUC ${results.membership.aucScore.toFixed(2)}` : "—" },
    { attack: "Record Linkage",       result: results.recordLinkage,        key: "recordLinkage" as AttackId,        threat: "External dataset re-ID",      metric: results.recordLinkage ? `${results.recordLinkage.numUniqueRecords} certain links` : "—" },
    { attack: "Attr. Disclosure",     result: results.attributeDisclosure,  key: "attributeDisclosure" as AttackId,  threat: "Sensitive value inference",   metric: results.attributeDisclosure ? `ADR ${(results.attributeDisclosure.overallAdr * 100).toFixed(1)}%` : "—" },
    { attack: "Differencing",         result: results.differencing,         key: "differencing" as AttackId,         threat: "Aggregate query leakage",     metric: results.differencing ? `DDR ${(results.differencing.ddr * 100).toFixed(1)}%` : "—" },
    { attack: "Model Inversion",      result: results.modelInversion,       key: "modelInversion" as AttackId,       threat: "Attribute reconstruction",    metric: results.modelInversion ? `${results.modelInversion.inversionRate}% inverted` : "—" },
  ];

  const scoreColor = c.score >= 70 ? "text-red-600" : c.score >= 50 ? "text-orange-600" : c.score >= 30 ? "text-amber-600" : "text-green-600";

  const priorityActions: { emoji: string; label: string; action: string }[] = [];
  c.breakdown.sort((a, b) => b.risk - a.risk).forEach((b) => {
    if (b.risk >= 0.7) priorityActions.push({ emoji: "🔴", label: "URGENT", action: `Mitigate ${b.attack} attack (${(b.risk * 100).toFixed(0)}% risk) — highest priority` });
    else if (b.risk >= 0.5) priorityActions.push({ emoji: "🟡", label: "IMPORTANT", action: `Address ${b.attack} attack (${(b.risk * 100).toFixed(0)}% risk)` });
    else if (b.risk >= 0.3) priorityActions.push({ emoji: "🟢", label: "OPTIONAL", action: `Consider mitigating ${b.attack} attack (${(b.risk * 100).toFixed(0)}% risk)` });
  });

  return (
    <div className="space-y-6">
      {/* Composite Score */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="flex flex-col items-center justify-center p-6 text-center">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">NIST Composite Risk Score</div>
          <div className={`text-6xl font-black ${scoreColor}`}>{c.score}</div>
          <div className="text-sm text-muted-foreground mt-1">/ 100</div>
          <div className="mt-1 text-xs text-muted-foreground">{c.enabledCount} of 10 attacks run</div>
          <div className="mt-3">{riskBadge(c.riskLevel)}</div>
          <div className="mt-4 w-full">
            <Progress value={c.score} className="h-3" />
            <div className="flex justify-between text-xs mt-1 text-muted-foreground"><span>0 LOW</span><span>30 MED</span><span>50 HIGH</span><span>70 CRIT</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">6-Axis Risk Radar</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="attack" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name="Risk" dataKey="risk" stroke="#DC2626" fill="#DC2626" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Score Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {c.breakdown.map((b) => (
                <div key={b.attack} className="flex items-center gap-2">
                  <span className={`text-xs w-20 truncate ${b.enabled ? "" : "text-muted-foreground/50"}`}>{b.attack}</span>
                  {b.enabled ? (
                    <>
                      <Progress value={b.risk} className="flex-1 h-2" />
                      <span className="text-xs font-bold w-12 text-right" style={{ color: RISK_COLORS[b.risk >= 70 ? "CRITICAL" : b.risk >= 50 ? "HIGH" : b.risk >= 30 ? "MEDIUM" : "LOW"] }}>
                        {b.risk.toFixed(0)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 h-2 rounded-full bg-muted/30" />
                      <span className="text-xs text-muted-foreground/50 w-12 text-right italic">—</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Attack Risk Comparison (Sorted by Risk)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
              <Bar dataKey="risk" name="Risk Score" radius={[0, 4, 4, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Risk Summary Table</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead><tr className="border-b"><th className="text-left pb-2">Attack</th><th className="text-right pb-2">Risk Score</th><th className="text-right pb-2">Risk Level</th><th className="text-left pb-2 pl-4">Primary Threat</th><th className="text-right pb-2">Key Metric</th><th className="text-right pb-2">Status</th></tr></thead>
            <tbody>
              {tableRows.map((row, i) => {
                const risk = row.result ? row.result.riskScore : 0;
                const level = row.result ? row.result.riskLevel : "LOW";
                const status = risk >= 0.5 ? "❌ FAIL" : risk >= 0.3 ? "⚠️ WARN" : "✅ PASS";
                return (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-2 font-medium">{row.attack}</td>
                    <td className="py-2 text-right font-bold">{(risk * 100).toFixed(1)}%</td>
                    <td className="py-2 text-right">{riskBadge(level)}</td>
                    <td className="py-2 pl-4 text-muted-foreground">{row.threat}</td>
                    <td className="py-2 text-right text-muted-foreground">{row.metric}</td>
                    <td className="py-2 text-right">{status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Priority actions */}
      {priorityActions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Priority Action List</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {priorityActions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span>{a.emoji}</span>
                  <span className="font-semibold w-16 shrink-0">{a.label}:</span>
                  <span className="text-muted-foreground">{a.action}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function RiskPage() {
  const { toast } = useToast();
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [quasiIdentifiers, setQuasiIdentifiers] = useState<string[]>([]);
  const [sensitiveAttributes, setSensitiveAttributes] = useState<string[]>([]);
  const [kThreshold, setKThreshold] = useState([5]);
  const [lThreshold, setLThreshold] = useState([3]);
  const [tThreshold, setTThreshold] = useState([20]); // stored as int 1–50, divided by 100
  const [samplePct, setSamplePct] = useState([100]);
  const [selectedAttacks, setSelectedAttacks] = useState<AttackId[]>(ATTACKS.map((a) => a.id));
  const [results, setResults] = useState<AllResults>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [activeTab, setActiveTab] = useState("prosecutor");
  const [autoAssist, setAutoAssist] = useState<AutoAssistResult | null>(null);
  const [autoAssistLoading, setAutoAssistLoading] = useState(false);
  const appliedDataset = useRef<string>("");

  const { data: datasets, isLoading: datasetsLoading } = useQuery<Dataset[]>({ queryKey: ["/api/datasets"] });

  const selectedDatasetObj = datasets?.find((d) => d.id.toString() === selectedDataset);

  // Fetch full dataset data for client-side computation
  const { data: datasetData } = useQuery<{ data: DataRow[] }>({
    queryKey: ["/api/data", selectedDataset],
    enabled: !!selectedDataset,
  });

  // Run auto-assist whenever a new dataset's data loads
  useEffect(() => {
    if (!datasetData?.data?.length || !selectedDatasetObj) { setAutoAssist(null); return; }
    setAutoAssistLoading(true);
    const t = setTimeout(() => {
      try {
        const result = runAutoAssist(datasetData.data, selectedDatasetObj.columns ?? []);
        setAutoAssist(result);
        if (appliedDataset.current !== selectedDataset) {
          setQuasiIdentifiers(result.columnGroups.quasiIdentifiers);
          setSensitiveAttributes(result.columnGroups.sensitiveAttributes);
          setKThreshold([result.suggestedParams.k]);
          setLThreshold([Math.max(2, result.suggestedParams.l)]);
          setTThreshold([Math.round(result.suggestedParams.t * 100)]);
          setSamplePct([result.suggestedParams.samplePct]);
          appliedDataset.current = selectedDataset;
        }
      } catch (e) { console.error("auto-assist error", e); }
      setAutoAssistLoading(false);
    }, 80);
    return () => clearTimeout(t);
  }, [datasetData?.data, selectedDataset]);

  const applyAutoSuggestions = () => {
    if (!autoAssist) return;
    setQuasiIdentifiers(autoAssist.columnGroups.quasiIdentifiers);
    setSensitiveAttributes(autoAssist.columnGroups.sensitiveAttributes);
    setKThreshold([autoAssist.suggestedParams.k]);
    setLThreshold([Math.max(2, autoAssist.suggestedParams.l)]);
    setTThreshold([Math.round(autoAssist.suggestedParams.t * 100)]);
    setSamplePct([autoAssist.suggestedParams.samplePct]);
  };

  const toggleColumn = (col: string, type: "quasi" | "sensitive") => {
    if (type === "quasi") setQuasiIdentifiers((p) => p.includes(col) ? p.filter((c) => c !== col) : [...p, col]);
    else setSensitiveAttributes((p) => p.includes(col) ? p.filter((c) => c !== col) : [...p, col]);
  };

  const toggleAttack = (id: AttackId) =>
    setSelectedAttacks((p) => p.includes(id) ? p.filter((a) => a !== id) : [...p, id]);

  const handleRunAssessment = useCallback(async () => {
    if (!selectedDataset || quasiIdentifiers.length === 0) {
      toast({ title: "Configuration required", description: "Select a dataset and at least one quasi-identifier.", variant: "destructive" });
      return;
    }
    if (!datasetData?.data || datasetData.data.length === 0) {
      toast({ title: "Dataset not loaded", description: "Wait for dataset to load, then try again.", variant: "destructive" });
      return;
    }

    setRunning(true);
    setResults({});
    const newResults: AllResults = {};

    const rawData = sampleData(datasetData.data, samplePct[0]);
    const allCols = selectedDatasetObj?.columns || [];
    const tVal = tThreshold[0] / 100;

    const steps: { id: string; label: string; fn: () => void }[] = [];

    if (selectedAttacks.includes("prosecutor"))          steps.push({ id: "prosecutor",          label: "Prosecutor Attack (Within-Dataset Re-ID)...",         fn: () => { newResults.prosecutor          = runProsecutorAttack(rawData, quasiIdentifiers, kThreshold[0], sensitiveAttributes, lThreshold[0], tVal); } });
    if (selectedAttacks.includes("journalist"))          steps.push({ id: "journalist",          label: "Journalist Attack (Population-Based Re-ID)...",        fn: () => { newResults.journalist          = runJournalistAttack(rawData, quasiIdentifiers, kThreshold[0], sensitiveAttributes, lThreshold[0], tVal, samplePct[0]); } });
    if (selectedAttacks.includes("marketer"))            steps.push({ id: "marketer",            label: "Marketer Attack (Bulk Commercial Re-ID)...",           fn: () => { newResults.marketer            = runMarketerAttack(rawData, quasiIdentifiers, sensitiveAttributes, lThreshold[0], tVal, kThreshold[0]); } });
    if (selectedAttacks.includes("singlingOut"))         steps.push({ id: "singlingOut",         label: "Singling Out Attack (GDPR Singling-Out Standard)...",   fn: () => { newResults.singlingOut         = runSingleOutAttack(rawData, quasiIdentifiers, sensitiveAttributes, kThreshold[0], lThreshold[0], tVal); } });
    if (selectedAttacks.includes("inference"))           steps.push({ id: "inference",           label: "Inference Attack (Form A+B: EC Homogeneity & Predictive)...", fn: () => { newResults.inference           = runInferenceAttack(rawData, quasiIdentifiers, sensitiveAttributes, lThreshold[0]); } });
    if (selectedAttacks.includes("membership"))          steps.push({ id: "membership",          label: "Membership Inference Attack (Gower NN + Population Rarity)...", fn: () => { newResults.membership          = runMembershipAttack(rawData, quasiIdentifiers, sensitiveAttributes, autoAssist?.columnGroups.directIdentifiers ?? []); } });
    if (selectedAttacks.includes("recordLinkage"))       steps.push({ id: "recordLinkage",       label: "Record Linkage Attack (External Dataset Re-ID)...",          fn: () => { newResults.recordLinkage       = runRecordLinkageAttack(rawData, quasiIdentifiers, kThreshold[0], sensitiveAttributes, lThreshold[0], tVal); } });
    if (selectedAttacks.includes("attributeDisclosure")) steps.push({ id: "attributeDisclosure", label: "Attribute Disclosure Attack (Sensitive Inference)...",        fn: () => { newResults.attributeDisclosure = runAttributeDisclosureAttack(rawData, quasiIdentifiers, sensitiveAttributes, lThreshold[0], tVal); } });
    if (selectedAttacks.includes("differencing"))        steps.push({ id: "differencing",        label: "Differencing Attack (Aggregate Query Leakage)...",            fn: () => { newResults.differencing        = runDifferencingAttack(rawData, quasiIdentifiers, sensitiveAttributes, kThreshold[0], lThreshold[0], tVal); } });
    if (selectedAttacks.includes("modelInversion"))      steps.push({ id: "modelInversion",      label: "Model Inversion Attack (EC-Based Reconstruction)...",      fn: () => { newResults.modelInversion      = runModelInversionAttack(rawData, quasiIdentifiers, sensitiveAttributes, kThreshold[0], lThreshold[0], tVal); } });

    for (let i = 0; i < steps.length; i++) {
      setProgress({ step: `${i + 1}/${steps.length}: Running ${steps[i].label}`, pct: Math.round((i / steps.length) * 100) });
      await new Promise((r) => setTimeout(r, 50)); // yield to UI
      steps[i].fn();
      setResults({ ...newResults });
      await new Promise((r) => setTimeout(r, 20));
    }

    // Composite score — only pass scores for attacks that were actually run.
    // Unrun attacks are omitted (undefined) so they don't dilute the average.
    newResults.composite = computeCompositeScore({
      ...(newResults.prosecutor          && { prosecutor:          newResults.prosecutor.riskScore }),
      ...(newResults.journalist          && { journalist:          newResults.journalist.riskScore }),
      ...(newResults.marketer            && { marketer:            newResults.marketer.riskScore }),
      ...(newResults.singlingOut         && { singlingOut:         newResults.singlingOut.riskScore }),
      ...(newResults.inference           && { inference:           newResults.inference.riskScore }),
      ...(newResults.membership          && { membership:          newResults.membership.riskScore }),
      ...(newResults.recordLinkage       && { recordLinkage:       newResults.recordLinkage.riskScore }),
      ...(newResults.attributeDisclosure && { attributeDisclosure: newResults.attributeDisclosure.riskScore }),
      ...(newResults.differencing        && { differencing:        newResults.differencing.riskScore }),
      ...(newResults.modelInversion      && { modelInversion:      newResults.modelInversion.riskScore }),
    });

    setResults(newResults);
    setProgress(null);
    setRunning(false);
    setActiveTab(steps[0]?.id || "prosecutor");

    toast({ title: "Assessment complete", description: `Composite risk score: ${newResults.composite.score}/100 (${newResults.composite.riskLevel})` });
  }, [selectedDataset, datasetData, quasiIdentifiers, sensitiveAttributes, kThreshold, lThreshold, tThreshold, samplePct, selectedAttacks, selectedDatasetObj]);

  const hasResults = Object.keys(results).length > 0;

  return (
    <DashboardLayout title="Risk Assessment" breadcrumbs={[{ label: "Risk Assessment" }]}>
      <div className="grid gap-6 lg:grid-cols-4">
        {/* ── LEFT SIDEBAR ── */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" /> Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Dataset */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dataset</Label>
                <Select value={selectedDataset} onValueChange={(v) => { setSelectedDataset(v); setQuasiIdentifiers([]); setSensitiveAttributes([]); }}>
                  <SelectTrigger data-testid="select-dataset" className="h-8 text-sm">
                    <SelectValue placeholder="Choose a dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets?.map((d) => <SelectItem key={d.id} value={d.id.toString()}>{d.originalName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {selectedDatasetObj && (
                <>
                  {autoAssistLoading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Analysing columns…
                    </div>
                  )}

                  {/* Direct ID warnings */}
                  {autoAssist && autoAssist.columnGroups.directIdentifiers.length > 0 && (
                    <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/30 p-2 space-y-1">
                      <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Direct Identifiers Detected
                      </p>
                      {autoAssist.columnGroups.directIdentifiers.map((col) => (
                        <p key={col} className="text-xs text-orange-600 dark:text-orange-300 pl-1">⚠ {col}</p>
                      ))}
                      <p className="text-[10px] text-orange-500 dark:text-orange-400">Remove these before public release.</p>
                    </div>
                  )}

                  {/* QI × Direct Identifier conflict warning */}
                  {autoAssist && (() => {
                    const conflicts = quasiIdentifiers.filter((qi) =>
                      autoAssist.columnGroups.directIdentifiers.includes(qi)
                    );
                    if (conflicts.length === 0) return null;
                    return (
                      <div className="rounded-md border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-2 space-y-1">
                        <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> ⚠️ CONFIGURATION CONFLICT
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-300">
                          The following column{conflicts.length > 1 ? "s are" : " is"} flagged as a Direct Identifier AND selected as a Quasi-Identifier. Using a direct identifier as a QI in a privacy assessment is a configuration error — it inflates singularity and makes L-Diversity / T-Closeness results misleading:
                        </p>
                        {conflicts.map((col) => (
                          <p key={col} className="text-xs font-bold text-red-700 dark:text-red-400 pl-1">🔴 {col}</p>
                        ))}
                        <p className="text-[10px] text-red-500 dark:text-red-400">
                          Action: Remove {conflicts.length > 1 ? "these columns" : "this column"} from the QI list, OR suppress {conflicts.length > 1 ? "them" : "it"} from the dataset before running the assessment.
                        </p>
                      </div>
                    );
                  })()}

                  {/* QI columns */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quasi-Identifiers</Label>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] h-4 px-1">{quasiIdentifiers.length} sel.</Badge>
                        {quasiIdentifiers.length > 0 && (
                          <button
                            onClick={() => setQuasiIdentifiers([])}
                            className="text-[10px] text-muted-foreground hover:text-destructive underline leading-none"
                            title="Uncheck all quasi-identifiers"
                          >
                            Uncheck all
                          </button>
                        )}
                      </div>
                    </div>
                    <ScrollArea className="h-[120px] rounded-md border p-2">
                      <div className="space-y-1">
                        {selectedDatasetObj.columns?.map((col) => {
                          const cls = autoAssist?.classifications[col];
                          const badge = cls?.confidenceLabel === "HIGH" ? "🟢" : cls?.confidenceLabel === "MEDIUM" ? "🟡" : cls ? "🔵" : null;
                          return (
                            <div key={col} className="flex items-center gap-1.5" title={cls?.reason ?? col}>
                              <Checkbox id={`qi-${col}`} checked={quasiIdentifiers.includes(col)} onCheckedChange={() => toggleColumn(col, "quasi")} />
                              <label htmlFor={`qi-${col}`} className="text-xs cursor-pointer flex-1 truncate">{col}</label>
                              {badge && cls?.classification === "QUASI_ID" && <span className="text-[10px]">{badge}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* SA columns */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sensitive Attributes</Label>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] h-4 px-1">{sensitiveAttributes.length} sel.</Badge>
                        {sensitiveAttributes.length > 0 && (
                          <button
                            onClick={() => setSensitiveAttributes([])}
                            className="text-[10px] text-muted-foreground hover:text-destructive underline leading-none"
                            title="Uncheck all sensitive attributes"
                          >
                            Uncheck all
                          </button>
                        )}
                      </div>
                    </div>
                    <ScrollArea className="h-[100px] rounded-md border p-2">
                      <div className="space-y-1">
                        {selectedDatasetObj.columns?.map((col) => {
                          const cls = autoAssist?.classifications[col];
                          const badge = cls?.confidenceLabel === "HIGH" ? "🟢" : cls?.confidenceLabel === "MEDIUM" ? "🟡" : cls ? "🔵" : null;
                          return (
                            <div key={col} className="flex items-center gap-1.5" title={cls?.reason ?? col}>
                              <Checkbox id={`sa-${col}`} checked={sensitiveAttributes.includes(col)} onCheckedChange={() => toggleColumn(col, "sensitive")} />
                              <label htmlFor={`sa-${col}`} className="text-xs cursor-pointer flex-1 truncate">{col}</label>
                              {badge && cls?.classification === "SENSITIVE" && <span className="text-[10px]">{badge}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  {autoAssist && (
                    <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={applyAutoSuggestions}>
                      ↺ Reset to Auto-Suggestions
                    </Button>
                  )}
                </>
              )}

              {/* Sliders */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">K-Anonymity</Label>
                  <div className="flex items-center gap-1">
                    {autoAssist && <span className="text-[10px] text-muted-foreground">Sug: {autoAssist.suggestedParams.k}</span>}
                    <Badge variant="outline" className="text-xs">{kThreshold[0]}</Badge>
                  </div>
                </div>
                <Slider value={kThreshold} onValueChange={setKThreshold} min={2} max={25} step={1} />
                {autoAssist && <p className="text-[10px] text-muted-foreground leading-tight">{autoAssist.paramDetails.k.reason}</p>}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">L-Diversity</Label>
                  <div className="flex items-center gap-1">
                    {autoAssist && <span className="text-[10px] text-muted-foreground">Sug: {autoAssist.suggestedParams.l}</span>}
                    <Badge variant="outline" className="text-xs">{lThreshold[0]}</Badge>
                  </div>
                </div>
                <Slider value={lThreshold} onValueChange={setLThreshold} min={2} max={10} step={1} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">T-Closeness</Label>
                  <div className="flex items-center gap-1">
                    {autoAssist && <span className="text-[10px] text-muted-foreground">Sug: {autoAssist.suggestedParams.t.toFixed(2)}</span>}
                    <Badge variant="outline" className="text-xs">{(tThreshold[0] / 100).toFixed(2)}</Badge>
                  </div>
                </div>
                <Slider value={tThreshold} onValueChange={setTThreshold} min={5} max={50} step={5} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sample Size</Label>
                  <div className="flex items-center gap-1">
                    {autoAssist && <span className="text-[10px] text-muted-foreground">Sug: {autoAssist.suggestedParams.samplePct}%</span>}
                    <Badge variant="outline" className="text-xs">{samplePct[0]}%</Badge>
                  </div>
                </div>
                <Slider value={samplePct} onValueChange={setSamplePct} min={10} max={100} step={10} />
                {autoAssist && <p className="text-[10px] text-muted-foreground leading-tight">{autoAssist.paramDetails.sample.reason}</p>}
              </div>

              {/* Attack selection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attack Scenarios</Label>
                <div className="space-y-1.5">
                  {ATTACKS.map((a) => (
                    <div key={a.id} className="flex items-start gap-2">
                      <Checkbox id={`atk-${a.id}`} checked={selectedAttacks.includes(a.id)} onCheckedChange={() => toggleAttack(a.id)} />
                      <div>
                        <label htmlFor={`atk-${a.id}`} className="text-xs font-medium cursor-pointer flex items-center gap-1">{a.icon}{a.short}</label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Progress */}
              {progress && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">{progress.step}</div>
                  <Progress value={progress.pct} className="h-2" />
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleRunAssessment}
                disabled={running || !selectedDataset || quasiIdentifiers.length === 0}
                data-testid="button-run-assessment"
              >
                {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing...</> : <><Play className="mr-2 h-4 w-4" />Run Assessment</>}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="lg:col-span-3">
          {!hasResults ? (
            autoAssist ? (
              <div className="space-y-4">
                {/* Banner */}
                <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full bg-blue-100 dark:bg-blue-900 p-1.5"><Network className="h-4 w-4 text-blue-600 dark:text-blue-400" /></div>
                      <div>
                        <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">📋 Auto-Assist Column Analysis</p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                          Analysed <strong>{autoAssist.datasetInfo.rows}</strong> rows × <strong>{autoAssist.datasetInfo.columns}</strong> columns.
                          Pre-selected <strong>{autoAssist.columnGroups.quasiIdentifiers.length}</strong> QIs and <strong>{autoAssist.columnGroups.sensitiveAttributes.length}</strong> sensitive attributes.
                          Review and adjust in the left sidebar, then run the assessment.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 4-Quadrant Classification Grid */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Direct Identifiers */}
                  <Card className="border-orange-200 dark:border-orange-800">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-xs font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" /> DIRECT IDENTIFIERS
                      </CardTitle>
                      <CardDescription className="text-[10px]">May need removal before release</CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-3 space-y-1.5">
                      {autoAssist.columnGroups.directIdentifiers.length === 0
                        ? <p className="text-xs text-muted-foreground italic">None detected ✓</p>
                        : autoAssist.columnGroups.directIdentifiers.map((col) => {
                            const c = autoAssist.classifications[col];
                            return (
                              <div key={col} className="rounded bg-orange-50 dark:bg-orange-950/30 px-2 py-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-orange-800 dark:text-orange-300">{col}</span>
                                  <Badge className="text-[10px] h-4 px-1 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 border-0">{c.confidence}%</Badge>
                                </div>
                                <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5 leading-tight">{c.reason}</p>
                              </div>
                            );
                          })
                      }
                    </CardContent>
                  </Card>

                  {/* Quasi-Identifiers */}
                  <Card className="border-red-200 dark:border-red-800">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                        🔴 QUASI-IDENTIFIERS
                      </CardTitle>
                      <CardDescription className="text-[10px]">Can indirectly identify individuals</CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <ScrollArea className="h-[140px]">
                        <div className="space-y-1.5">
                          {autoAssist.columnGroups.quasiIdentifiers.length === 0
                            ? <p className="text-xs text-muted-foreground italic">None detected</p>
                            : autoAssist.columnGroups.quasiIdentifiers.map((col) => {
                                const c = autoAssist.classifications[col];
                                const contrib = autoAssist.qiContributions[col];
                                const badge = c.confidenceLabel === "HIGH" ? "🟢" : c.confidenceLabel === "MEDIUM" ? "🟡" : "🔵";
                                return (
                                  <div key={col} className="rounded bg-red-50 dark:bg-red-950/30 px-2 py-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-xs font-medium text-red-800 dark:text-red-300 truncate">{col}</span>
                                      <span className="text-[10px] shrink-0">{badge}</span>
                                    </div>
                                    <p className="text-[10px] text-red-500 dark:text-red-400 mt-0.5 leading-tight">{c.reason}</p>
                                    {contrib && <p className="text-[10px] text-red-400 dark:text-red-500 font-mono">+{contrib.marginalRiskPct}% marginal EC risk</p>}
                                  </div>
                                );
                              })
                          }
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {/* Sensitive Attributes */}
                  <Card className="border-amber-200 dark:border-amber-800">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        🟠 SENSITIVE ATTRIBUTES
                      </CardTitle>
                      <CardDescription className="text-[10px]">Disclosure could harm individuals</CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <ScrollArea className="h-[140px]">
                        <div className="space-y-1.5">
                          {autoAssist.columnGroups.sensitiveAttributes.length === 0
                            ? <p className="text-xs text-muted-foreground italic">None detected</p>
                            : autoAssist.columnGroups.sensitiveAttributes.map((col) => {
                                const c = autoAssist.classifications[col];
                                const badge = c.confidenceLabel === "HIGH" ? "🟢" : c.confidenceLabel === "MEDIUM" ? "🟡" : "🔵";
                                return (
                                  <div key={col} className="rounded bg-amber-50 dark:bg-amber-950/30 px-2 py-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-xs font-medium text-amber-800 dark:text-amber-300 truncate">{col}</span>
                                      <span className="text-[10px] shrink-0">{badge}</span>
                                    </div>
                                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight">{c.reason}</p>
                                  </div>
                                );
                              })
                          }
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {/* Ignore */}
                  <Card className="border-slate-200 dark:border-slate-700">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        ⚪ IGNORE
                      </CardTitle>
                      <CardDescription className="text-[10px]">No privacy relevance</CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <ScrollArea className="h-[140px]">
                        <div className="space-y-1">
                          {autoAssist.columnGroups.ignore.length === 0
                            ? <p className="text-xs text-muted-foreground italic">None</p>
                            : autoAssist.columnGroups.ignore.map((col) => {
                                const c = autoAssist.classifications[col];
                                return (
                                  <div key={col} className="flex items-center justify-between rounded bg-slate-50 dark:bg-slate-800/30 px-2 py-1">
                                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{col}</span>
                                    <span className="text-[10px] text-slate-400 shrink-0 ml-1">{c.confidence}%</span>
                                  </div>
                                );
                              })
                          }
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                {/* QI Contribution Table */}
                {Object.keys(autoAssist.qiContributions).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-600" /> QI Re-Identification Contribution Ranking</CardTitle>
                      <CardDescription className="text-xs">How much each quasi-identifier increases re-identification risk</CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      {/* High-risk warning */}
                      {Object.entries(autoAssist.qiContributions).some(([, v]) => v.marginalRiskPct > 30) && (
                        <div className="mb-3 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3">
                          <p className="text-xs font-semibold text-red-700 dark:text-red-400">⚠ High-Risk Quasi-Identifier Detected</p>
                          {Object.entries(autoAssist.qiContributions)
                            .filter(([, v]) => v.marginalRiskPct > 30)
                            .map(([col, v]) => (
                              <p key={col} className="text-xs text-red-600 dark:text-red-300 mt-1">
                                <strong>{col}</strong> alone contributes +{v.marginalRiskPct}% to re-identification risk ({v.soloUniqueValues} unique values).
                              </p>
                            ))}
                        </div>
                      )}
                      <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold">Column</th>
                              <th className="text-right px-3 py-2 font-semibold">Unique Values</th>
                              <th className="text-right px-3 py-2 font-semibold">Marginal Risk</th>
                              <th className="text-center px-3 py-2 font-semibold">Rank</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(autoAssist.qiContributions)
                              .sort((a, b) => a[1].riskRank - b[1].riskRank)
                              .map(([col, v]) => (
                                <tr key={col} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                                  <td className="px-3 py-2 font-medium truncate max-w-[120px]">{col}</td>
                                  <td className="px-3 py-2 text-right font-mono">{v.soloUniqueValues}</td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={v.marginalRiskPct > 30 ? "text-red-600 font-semibold" : v.marginalRiskPct > 10 ? "text-amber-600" : "text-green-600"}>
                                      +{v.marginalRiskPct}%
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={v.riskRank === 1 ? "text-red-600" : v.riskRank === 2 ? "text-amber-600" : "text-green-600"}>
                                      {v.riskRank === 1 ? "🔴" : v.riskRank === 2 ? "🟡" : "🟢"} #{v.riskRank}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Parameter Suggestion Panel */}
                <Card>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">⚙️ Auto-Suggested Privacy Parameters</CardTitle>
                    <CardDescription className="text-xs">Based on your data's equivalence class structure</CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "K-Anonymity", value: `k = ${autoAssist.suggestedParams.k}`, reason: autoAssist.paramDetails.k.reason, color: "blue" },
                        { label: "Sample Size", value: `${autoAssist.suggestedParams.samplePct}%`, reason: autoAssist.paramDetails.sample.reason, color: "purple" },
                      ].map(({ label, value, reason, color }) => (
                        <div key={label} className={`rounded-md border border-${color}-200 dark:border-${color}-800 bg-${color}-50 dark:bg-${color}-950/20 p-3`}>
                          <p className={`text-xs font-semibold text-${color}-700 dark:text-${color}-400`}>{label}</p>
                          <p className={`text-lg font-bold text-${color}-800 dark:text-${color}-300 mt-0.5`}>{value}</p>
                          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{reason}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-3">
                        <p className="text-xs font-semibold text-green-700 dark:text-green-400">L-Diversity</p>
                        <p className="text-lg font-bold text-green-800 dark:text-green-300 mt-0.5">l = {autoAssist.suggestedParams.l}</p>
                        {Object.values(autoAssist.paramDetails.l)[0] && (
                          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{Object.values(autoAssist.paramDetails.l)[0].reason}</p>
                        )}
                      </div>
                      <div className="rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/20 p-3">
                        <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">T-Closeness</p>
                        <p className="text-lg font-bold text-teal-800 dark:text-teal-300 mt-0.5">t = {autoAssist.suggestedParams.t.toFixed(2)}</p>
                        {Object.values(autoAssist.paramDetails.t)[0] && (
                          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{Object.values(autoAssist.paramDetails.t)[0].reason}</p>
                        )}
                      </div>
                    </div>
                    <Button className="w-full" variant="outline" onClick={applyAutoSuggestions}>
                      ← Use Suggested Values
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : (
            <Card className="flex flex-col items-center justify-center py-24 text-center">
              <Network className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No Assessment Results Yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Select a dataset, configure quasi-identifiers and sensitive attributes, then click <strong>Run Assessment</strong> to analyse privacy risks across all 10 attack types.
              </p>
            </Card>
            )
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
                {ATTACKS.filter((a) => selectedAttacks.includes(a.id)).map((a) => {
                  const r = results[a.id];
                  return (
                    <TabsTrigger key={a.id} value={a.id} className="flex items-center gap-1.5 text-xs px-3 py-1.5">
                      {a.icon}
                      {a.short}
                      {r && <span className="ml-1" style={{ color: RISK_COLORS[r.riskLevel] }}>●</span>}
                    </TabsTrigger>
                  );
                })}
                {results.composite && (
                  <TabsTrigger value="comparison" className="flex items-center gap-1.5 text-xs px-3 py-1.5">
                    <BarChart3 className="h-3 w-3" /> Comparison
                    <span className="ml-1 font-bold" style={{ color: RISK_COLORS[results.composite.riskLevel] }}>{results.composite.score}</span>
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Per-attack description banner */}
              {ATTACKS.filter((a) => selectedAttacks.includes(a.id)).map((a) => (
                <TabsContent key={a.id} value={a.id} className="space-y-4">
                  <Card className="bg-muted/40 border-0">
                    <CardContent className="flex items-start gap-3 py-3">
                      <div className="mt-0.5">{a.icon}</div>
                      <div>
                        <div className="font-semibold text-sm">{a.label}</div>
                        <div className="text-xs text-muted-foreground">{a.description}</div>
                      </div>
                      {results[a.id] && <div className="ml-auto">{riskBadge(results[a.id]!.riskLevel)}</div>}
                    </CardContent>
                  </Card>
                  {results[a.id] ? (
                    <>
                      {a.id === "prosecutor"          && <ProsecutorReport r={results.prosecutor!} kThreshold={kThreshold[0]} />}
                      {a.id === "journalist"          && <JournalistReport r={results.journalist!} kThreshold={kThreshold[0]} />}
                      {a.id === "marketer"            && <MarketerReport r={results.marketer!} />}
                      {a.id === "singlingOut"         && <SinglingOutReport r={results.singlingOut!} />}
                      {a.id === "inference"           && <InferenceReport r={results.inference!} />}
                      {a.id === "membership"          && <MembershipReport r={results.membership!} />}
                      {a.id === "recordLinkage"       && <RecordLinkageReport r={results.recordLinkage!} kThreshold={kThreshold[0]} />}
                      {a.id === "attributeDisclosure" && <AttributeDisclosureReport r={results.attributeDisclosure!} />}
                      {a.id === "differencing"        && <DifferencingReport r={results.differencing!} />}
                      {a.id === "modelInversion"      && <ModelInversionReport r={results.modelInversion!} kVal={kThreshold[0]} lVal={lThreshold[0]} tVal={tThreshold[0] / 100} />}
                    </>
                  ) : (
                    <Card className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Running {a.label}...
                    </Card>
                  )}
                </TabsContent>
              ))}

              <TabsContent value="comparison">
                <ComparisonDashboard results={results} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
