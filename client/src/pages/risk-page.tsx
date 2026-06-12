import { useState, useCallback, useEffect, useRef } from "react";
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
  PolarAngleAxis, PolarRadiusAxis, Legend,
} from "recharts";

import { runProsecutorAttack, type ProsecutorResult } from "@/lib/attacks/prosecutorAttack";
import { runJournalistAttack, type JournalistResult } from "@/lib/attacks/journalistAttack";
import { runMarketerAttack, type MarketerResult } from "@/lib/attacks/marketerAttack";
import { runSingleOutAttack, type SingleOutResult } from "@/lib/attacks/singleOutAttack";
import { runInferenceAttack, type InferenceResult } from "@/lib/attacks/inferenceAttack";
import { runMembershipAttack, type MembershipResult } from "@/lib/attacks/membershipAttack";
import { runRecordLinkageAttack, type RecordLinkageResult } from "@/lib/attacks/recordLinkageAttack";
import { runAttributeDisclosureAttack, type AttributeDisclosureResult } from "@/lib/attacks/attributeDisclosureAttack";
import { runDifferencingAttack, type DifferencingResult } from "@/lib/attacks/differencingAttack";
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
            {r.lDiversityResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Min distinct values in any EC: <strong>{res.minL}</strong></div>
                  <div>ECs violating l-diversity: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong> ({res.totalEcs > 0 ? ((res.violatingEcs/res.totalEcs)*100).toFixed(0) : 0}%)</div>
                  {res.status === "FAIL" && <div className="italic mt-1">In some groups, all records share the same {res.sa} value. An attacker who identifies the group learns {res.sa} with certainty.</div>}
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
            {r.tClosenessResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Maximum EC deviation from global distribution: <strong className={res.maxDistance > 0.3 ? "text-red-600" : "text-green-600"}>{res.maxDistance}</strong></div>
                  <div>ECs violating t-closeness: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong></div>
                  {res.status === "FAIL" && <div className="italic mt-1">The distribution of {res.sa} inside individual groups is very different from the overall dataset. This reveals information even without direct re-identification.</div>}
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
            {r.lDiversityResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Min distinct values in any EC: <strong>{res.minL}</strong></div>
                  <div>ECs violating l-diversity: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong> ({res.totalEcs > 0 ? ((res.violatingEcs/res.totalEcs)*100).toFixed(0) : 0}%)</div>
                  {res.status === "FAIL" && <div className="italic mt-1">In some groups, all records share the same {res.sa} value — an attacker who links to the group learns {res.sa} with certainty, regardless of journalist/prosecutor model.</div>}
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
            {r.tClosenessResults.map((res, i) => (
              <div key={i} className={`p-3 rounded-lg border ${res.status === "FAIL" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">Sensitive Attribute: <code>{res.sa}</code></span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{res.status === "FAIL" ? "🔴 FAIL" : "🟢 PASS"}</span>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>Maximum EC deviation from global distribution: <strong className={res.maxDistance > 0.3 ? "text-red-600" : "text-green-600"}>{res.maxDistance}</strong></div>
                  <div>ECs violating t-closeness: <strong className={res.violatingEcs > 0 ? "text-red-600" : "text-green-600"}>{res.violatingEcs} out of {res.totalEcs}</strong></div>
                  {res.status === "FAIL" && <div className="italic mt-1">The distribution of {res.sa} inside some groups differs significantly from the overall dataset distribution.</div>}
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
                      {ld.status === "FAIL" && (
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
                      {tc.status === "FAIL" && (
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
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Singling Out Rate", `${(r.singlingOutRate * 100).toFixed(1)}%`, `${r.singulableCount} of ${r.totalRecords} records`, <Fingerprint className="h-4 w-4" />, r.singlingOutRate > 0.3 ? "text-red-600" : "text-green-600")}
        {kpiCard("Avg Footprint", r.avgFootprint.toFixed(1), "Attributes needed on avg", <BarChart3 className="h-4 w-4" />)}
        {kpiCard("GDPR Status", r.gdprStatus, r.gdprStatus === "FAIL" ? "Singling-out standard violated" : "Meets singling-out standard", <Shield className="h-4 w-4" />, r.gdprStatus === "FAIL" ? "text-red-600" : "text-green-600")}
        {kpiCard("Safe Records", r.totalRecords - r.singulableCount, "Cannot be uniquely singled out", <CheckCircle className="h-4 w-4" />, "text-green-600")}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Privacy Footprint Histogram</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.footprintHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" fill="#7C3AED" radius={[4, 4, 0, 0]} name="Records" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Attack Effort Curve</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={r.effortCurve}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="k" tick={{ fontSize: 11 }} label={{ value: "# Attributes Known", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="pct" stroke="#DC2626" strokeWidth={2} dot name="% Singulable" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm">Per-Attribute Singulability Score</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={r.attrSingulability} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <YAxis type="category" dataKey="attr" tick={{ fontSize: 10 }} width={100} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Bar dataKey="score" fill="#EA580C" radius={[0, 4, 4, 0]} name="Singulability" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
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
              <div className="flex items-center gap-4 mb-3">
                <div>
                  <div className="text-xs text-muted-foreground">Dataset-wide avg confidence</div>
                  <div className="text-2xl font-bold" style={{ color: inferenceFormAColor(sa.formA.datasetRisk) }}>
                    {(sa.formA.datasetRisk * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Records in high-risk groups (≥70%)</div>
                  <div className="text-xl font-bold text-red-600">{sa.formA.highRiskRecordPct.toFixed(1)}%</div>
                </div>
              </div>
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
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("AUC Score", r.aucScore.toFixed(3), "0.5 = random, 1.0 = full leakage", <UserCheck className="h-4 w-4" />, r.aucScore > 0.75 ? "text-red-600" : "text-green-600")}
        {kpiCard("Membership Risk", `${r.membershipRiskPct}%`, "2×(AUC−0.5) normalized", <AlertTriangle className="h-4 w-4" />, r.membershipRiskPct > 30 ? "text-red-600" : "text-green-600")}
        {kpiCard("Isolation Rate", `${(r.isolationRate * 100).toFixed(1)}%`, "Records easily detectable as members", <Fingerprint className="h-4 w-4" />, r.isolationRate > 0.2 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Memorization", r.memorization.toFixed(3), "Avg NN similarity within dataset", <Brain className="h-4 w-4" />)}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">ROC Curve (AUC = {r.aucScore.toFixed(3)})</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={r.rocCurve}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="fpr" tick={{ fontSize: 11 }} label={{ value: "FPR", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: "TPR", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="tpr" stroke="#DC2626" strokeWidth={2} dot={false} name="TPR" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Similarity Distribution (Members vs Non-members)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.similarityDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="members" fill="#DC2626" name="Members" />
                <Bar dataKey="nonMembers" fill="#16A34A" name="Non-members" />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm">Threshold Sensitivity Table</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-2">Threshold</th><th className="text-right pb-2">TPR (Recall)</th><th className="text-right pb-2">FPR</th><th className="text-right pb-2">Precision</th></tr></thead>
              <tbody>
                {r.thresholdTable.map((row, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1.5">{row.threshold}</td>
                    <td className="py-1.5 text-right">{row.tpr}%</td>
                    <td className="py-1.5 text-right">{row.fpr}%</td>
                    <td className="py-1.5 text-right">{row.precision}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function RecordLinkageReport({ r }: { r: RecordLinkageResult }) {
  const linkedPct = r.totalRecords > 0 ? ((r.linkedRecords / r.totalRecords) * 100).toFixed(1) : "0.0";
  const perfectPct = r.totalRecords > 0 ? ((r.perfectLinks / r.totalRecords) * 100).toFixed(1) : "0.0";
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Linkage Risk", `${(r.riskScore * 100).toFixed(1)}%`, "Σ(1/matches) / N", <Network className="h-4 w-4" />, "text-red-600")}
        {kpiCard("Perfect Links", r.perfectLinks, `${perfectPct}% uniquely linked`, <Fingerprint className="h-4 w-4" />, r.perfectLinks > 0 ? "text-red-600" : "text-green-600")}
        {kpiCard("Records Linked", `${linkedPct}%`, `${r.linkedRecords} of ${r.totalRecords} linkable`, <Users className="h-4 w-4" />, r.linkedRecords / Math.max(r.totalRecords, 1) > 0.5 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Avg Match Size", r.avgMatchSize.toFixed(1), "External matches per record", <BarChart3 className="h-4 w-4" />)}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Link Risk Score Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.linkRiskHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {r.linkRiskHistogram.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? "#16A34A" : i < 3 ? "#D97706" : i === 4 ? "#EA580C" : "#DC2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">External Match Count Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.externalMatchDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="matches" tick={{ fontSize: 11 }} label={{ value: "# External Matches", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {r.externalMatchDistribution.map((d, i) => (
                    <Cell key={i} fill={d.risk === "SAFE" ? "#16A34A" : d.risk === "CRITICAL" ? "#DC2626" : d.risk === "HIGH" ? "#EA580C" : "#D97706"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Linkage Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={r.riskDonut} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  <Cell fill="#DC2626" />
                  <Cell fill="#EA580C" />
                  <Cell fill="#16A34A" />
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Vulnerable Records (Highest Link Score)</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">Matches</th><th className="text-right pb-1">Link Score</th></tr></thead>
                <tbody>
                  {r.topVulnerable.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 pr-2 text-muted-foreground truncate max-w-[200px]">{row.qiCombo}</td>
                      <td className="py-1 text-right">{row.matchCount}</td>
                      <td className="py-1 text-right font-bold text-red-600">{row.linkScore}%</td>
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

function AttributeDisclosureReport({ r }: { r: AttributeDisclosureResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Disclosure Risk", `${(r.riskScore * 100).toFixed(1)}%`, "Weighted Pmax across ECs", <Shield className="h-4 w-4" />, "text-red-600")}
        {kpiCard("Worst-Case Pmax", `${(r.worstCaseProb * 100).toFixed(0)}%`, "Max single-group confidence", <AlertTriangle className="h-4 w-4" />, r.worstCaseProb > 0.8 ? "text-red-600" : r.worstCaseProb > 0.6 ? "text-orange-600" : "text-green-600")}
        {kpiCard("High-Risk Groups", r.highRiskGroups, `of ${r.totalGroups} total groups (Pmax > 60%)`, <XCircle className="h-4 w-4" />, r.highRiskGroups > 0 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Entropy Risk", `${(r.entropyRisk * 100).toFixed(0)}%`, "1 − H_observed/H_max (avg)", <BarChart3 className="h-4 w-4" />, r.entropyRisk > 0.5 ? "text-red-600" : "text-green-600")}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Dominant Probability Distribution (Pmax per Group)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.dominantProbHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Groups" radius={[4, 4, 0, 0]}>
                  {r.dominantProbHistogram.map((_, i) => (
                    <Cell key={i} fill={["#16A34A", "#D97706", "#EA580C", "#DC2626"][i] || "#DC2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Sensitive Values (Global Frequency)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.topSensitiveValues} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="value" tick={{ fontSize: 10 }} width={100} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="groupPct" fill="#7C3AED" radius={[0, 4, 4, 0]} name="% of Records" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        {r.perSAResults.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Per Sensitive Attribute Risk</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-2">Attribute</th><th className="text-right pb-2">Avg Pmax</th><th className="text-right pb-2">Worst Pmax</th><th className="text-right pb-2">Entropy Risk</th><th className="text-right pb-2">High-Risk Groups</th><th className="text-right pb-2">Risk Level</th></tr></thead>
                <tbody>
                  {r.perSAResults.map((sa, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-medium">{sa.sa}</td>
                      <td className="py-1.5 text-right">{(sa.avgDominantProb * 100).toFixed(0)}%</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: sa.worstCaseProb > 0.6 ? "#DC2626" : "#16A34A" }}>{(sa.worstCaseProb * 100).toFixed(0)}%</td>
                      <td className="py-1.5 text-right">{(sa.entropyRisk * 100).toFixed(0)}%</td>
                      <td className="py-1.5 text-right">{sa.highRiskGroups}</td>
                      <td className="py-1.5 text-right">{riskBadge(sa.riskLevel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-sm">Top High-Risk Groups (Sorted by Pmax)</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">Size</th><th className="text-right pb-1">Dominant Value</th><th className="text-right pb-1">Pmax</th><th className="text-right pb-1">H Risk</th><th className="text-right pb-1">Level</th></tr></thead>
                <tbody>
                  {r.perGroupRisks.slice(0, 12).map((g, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 pr-2 text-muted-foreground truncate max-w-[160px]">{g.qiCombo.slice(0, 40)}</td>
                      <td className="py-1 text-right">{g.size}</td>
                      <td className="py-1 text-right text-muted-foreground">{g.dominantValue.slice(0, 15)}</td>
                      <td className="py-1 text-right font-bold" style={{ color: g.dominantProb > 0.6 ? "#DC2626" : "#16A34A" }}>{(g.dominantProb * 100).toFixed(0)}%</td>
                      <td className="py-1 text-right">{(g.entropyRisk * 100).toFixed(0)}%</td>
                      <td className="py-1 text-right">{riskBadge(g.riskLevel)}</td>
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

function DifferencingReport({ r }: { r: DifferencingResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Differencing Risk", `${r.leakyPct}%`, "Leaky query pairs / total", <BarChart3 className="h-4 w-4" />, "text-red-600")}
        {kpiCard("Leaky Queries", r.leakyPairs, `of ${r.totalPairs} total pairs`, <AlertTriangle className="h-4 w-4" />, r.leakyPairs > 0 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Max Leakage", `${r.maxLeakage}%`, `Column: ${r.maxLeakageColumn || "—"}`, <XCircle className="h-4 w-4" />, r.maxLeakage > 40 ? "text-red-600" : r.maxLeakage > 20 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Avg Leakage", `${r.avgLeakage}%`, "Mean |Q1-Q2|/Q1 across all pairs", <Eye className="h-4 w-4" />)}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Leakage Distribution Histogram</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.leakageHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Query Pairs" radius={[4, 4, 0, 0]}>
                  {r.leakageHistogram.map((_, i) => (
                    <Cell key={i} fill={["#16A34A", "#D97706", "#EA580C", "#DC2626", "#7C0000"][i] || "#DC2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Per-Column Leakage Risk</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.perColumnRisks.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="column" tick={{ fontSize: 10 }} width={90} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="maxLeakage" fill="#DC2626" radius={[0, 4, 4, 0]} name="Max Leakage %" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        {r.perColumnRisks.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Column-Level Differencing Risk Table</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[220px]">
                <table className="w-full text-xs">
                  <thead><tr className="border-b"><th className="text-left pb-1">Column</th><th className="text-right pb-1">Global Avg</th><th className="text-right pb-1">Max Leakage</th><th className="text-right pb-1">Avg Leakage</th><th className="text-right pb-1">Leaky Records</th><th className="text-right pb-1">Risk</th></tr></thead>
                  <tbody>
                    {r.perColumnRisks.map((col, i) => (
                      <tr key={i} className="border-b border-muted">
                        <td className="py-1 font-medium">{col.column}</td>
                        <td className="py-1 text-right text-muted-foreground">{col.globalValue}</td>
                        <td className="py-1 text-right font-bold" style={{ color: col.maxLeakage > 40 ? "#DC2626" : "#16A34A" }}>{col.maxLeakage}%</td>
                        <td className="py-1 text-right">{col.avgLeakage}%</td>
                        <td className="py-1 text-right">{col.leakyRecords} ({col.leakyPct}%)</td>
                        <td className="py-1 text-right">{riskBadge(col.riskLevel)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Leaky Records (Highest |Q1−Q2| / Q1)</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-1">Record #</th><th className="text-right pb-1">Column</th><th className="text-right pb-1">Global Avg</th><th className="text-right pb-1">Avg w/o Record</th><th className="text-right pb-1">Leakage</th></tr></thead>
                <tbody>
                  {r.topLeakyRecords.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1"># {row.index + 1}</td>
                      <td className="py-1 text-right text-muted-foreground">{row.column}</td>
                      <td className="py-1 text-right">{row.globalVal}</td>
                      <td className="py-1 text-right">{row.withoutVal}</td>
                      <td className="py-1 text-right font-bold text-red-600">{row.leakage}%</td>
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

function ModelInversionReport({ r }: { r: ModelInversionResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Inversion Risk", `${r.inversionRate}%`, "Records reconstructed > 80% conf.", <AlertTriangle className="h-4 w-4" />, "text-red-600")}
        {kpiCard("Max Confidence", `${r.maxConfidence}%`, "Highest Naïve Bayes confidence", <Brain className="h-4 w-4" />, r.maxConfidence > 75 ? "text-red-600" : "text-green-600")}
        {kpiCard("Reconstruction Acc.", `${r.reconstructionAccuracy}%`, "Correct attribute predictions", <Target className="h-4 w-4" />, r.reconstructionAccuracy > 60 ? "text-orange-600" : "text-green-600")}
        {kpiCard("Avg Confidence", `${r.avgConfidence}%`, "Mean prediction probability", <BarChart3 className="h-4 w-4" />)}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Prediction Confidence Histogram</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.confidenceHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {r.confidenceHistogram.map((_, i) => (
                    <Cell key={i} fill={["#16A34A", "#D97706", "#EA580C", "#DC2626", "#7C0000"][i] || "#DC2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Inversion Rate at Different Confidence Thresholds</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={r.inversionCurve}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="threshold" tick={{ fontSize: 11 }} label={{ value: "Confidence Threshold", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="rate" stroke="#DC2626" strokeWidth={2} dot name="Inversion Rate %" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        {r.perSAResults.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Per Sensitive Attribute Inversion Analysis</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-2">Attribute</th><th className="text-right pb-2">Avg Confidence</th><th className="text-right pb-2">Max Confidence</th><th className="text-right pb-2">Inversion Rate</th><th className="text-right pb-2">Top Reconstructed Value</th><th className="text-right pb-2">Risk</th></tr></thead>
                <tbody>
                  {r.perSAResults.map((sa, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 font-medium">{sa.sa}</td>
                      <td className="py-1.5 text-right">{sa.avgConfidence}%</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: sa.maxConfidence > 75 ? "#DC2626" : "#16A34A" }}>{sa.maxConfidence}%</td>
                      <td className="py-1.5 text-right">{sa.inversionRate}%</td>
                      <td className="py-1.5 text-right text-muted-foreground">{sa.reconstructedValue.slice(0, 20)}</td>
                      <td className="py-1.5 text-right">{riskBadge(sa.riskLevel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        {r.topReconstructedRecords.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Top Reconstructed Records (Highest Confidence)</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[220px]">
                <table className="w-full text-xs">
                  <thead><tr className="border-b"><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">Sensitive Attr.</th><th className="text-right pb-1">Reconstructed Value</th><th className="text-right pb-1">Confidence</th></tr></thead>
                  <tbody>
                    {r.topReconstructedRecords.map((row, i) => (
                      <tr key={i} className="border-b border-muted">
                        <td className="py-1 pr-2 text-muted-foreground truncate max-w-[180px]">{row.qiCombo}</td>
                        <td className="py-1 text-right">{row.targetSA}</td>
                        <td className="py-1 text-right font-medium">{row.reconstructedValue}</td>
                        <td className="py-1 text-right font-bold text-red-600">{row.confidence}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
      <RecommendationsCard recs={r.recommendations} />
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
    risk: parseFloat((b.risk * 100).toFixed(1)),
    safe: Math.max(0, 30 - b.risk * 100),
  }));

  const barData = [...c.breakdown].sort((a, b) => b.risk - a.risk).map((b) => ({
    name: b.attack,
    risk: parseFloat((b.risk * 100).toFixed(1)),
    color: RISK_COLORS[b.risk >= 0.7 ? "CRITICAL" : b.risk >= 0.5 ? "HIGH" : b.risk >= 0.3 ? "MEDIUM" : "LOW"],
  }));

  const tableRows = [
    { attack: "Prosecutor",           result: results.prosecutor,           key: "prosecutor" as AttackId,           threat: "Within-dataset re-ID",       metric: results.prosecutor ? `${results.prosecutor.uniqueRecordsCount} unique records` : "—" },
    { attack: "Journalist",           result: results.journalist,           key: "journalist" as AttackId,           threat: "QI violations",               metric: results.journalist ? `${results.journalist.violations} violations` : "—" },
    { attack: "Marketer",             result: results.marketer,             key: "marketer" as AttackId,             threat: "Group attribute disclosure",   metric: results.marketer ? `${(results.marketer.lDiversityPassRate * 100).toFixed(0)}% L-div pass` : "—" },
    { attack: "Singling Out",         result: results.singlingOut,          key: "singlingOut" as AttackId,          threat: "GDPR/DPDP singling-out",      metric: results.singlingOut ? `${results.singlingOut.singulableCount} singulable` : "—" },
    { attack: "Inference",            result: results.inference,            key: "inference" as AttackId,            threat: "ML attribute prediction",     metric: results.inference ? `${results.inference.infoGain}% info gain` : "—" },
    { attack: "Membership",           result: results.membership,           key: "membership" as AttackId,           threat: "Presence detection",          metric: results.membership ? `AUC ${results.membership.aucScore.toFixed(2)}` : "—" },
    { attack: "Record Linkage",       result: results.recordLinkage,        key: "recordLinkage" as AttackId,        threat: "External dataset re-ID",      metric: results.recordLinkage ? `${results.recordLinkage.perfectLinks} perfect links` : "—" },
    { attack: "Attr. Disclosure",     result: results.attributeDisclosure,  key: "attributeDisclosure" as AttackId,  threat: "Sensitive value inference",   metric: results.attributeDisclosure ? `Pmax ${(results.attributeDisclosure.worstCaseProb * 100).toFixed(0)}%` : "—" },
    { attack: "Differencing",         result: results.differencing,         key: "differencing" as AttackId,         threat: "Aggregate query leakage",     metric: results.differencing ? `${results.differencing.leakyPct}% leaky queries` : "—" },
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
                  <span className="text-xs w-20 text-muted-foreground">{b.attack}</span>
                  <Progress value={b.risk * 100} className="flex-1 h-2" />
                  <span className="text-xs font-bold w-10 text-right" style={{ color: RISK_COLORS[b.risk >= 0.7 ? "CRITICAL" : b.risk >= 0.5 ? "HIGH" : b.risk >= 0.3 ? "MEDIUM" : "LOW"] }}>
                    {(b.risk * 100).toFixed(0)}%
                  </span>
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
    if (selectedAttacks.includes("singlingOut"))         steps.push({ id: "singlingOut",         label: "Singling Out Attack (GDPR Singling-Out Standard)...",   fn: () => { newResults.singlingOut         = runSingleOutAttack(rawData, allCols, kThreshold[0]); } });
    if (selectedAttacks.includes("inference"))           steps.push({ id: "inference",           label: "Inference Attack (Form A+B: EC Homogeneity & Predictive)...", fn: () => { newResults.inference           = runInferenceAttack(rawData, quasiIdentifiers, sensitiveAttributes, lThreshold[0]); } });
    if (selectedAttacks.includes("membership"))          steps.push({ id: "membership",          label: "Membership Attack (AUC Presence Detection)...",         fn: () => { newResults.membership          = runMembershipAttack(rawData, quasiIdentifiers); } });
    if (selectedAttacks.includes("recordLinkage"))       steps.push({ id: "recordLinkage",       label: "Record Linkage Attack (External Dataset Re-ID)...",          fn: () => { newResults.recordLinkage       = runRecordLinkageAttack(rawData, quasiIdentifiers); } });
    if (selectedAttacks.includes("attributeDisclosure")) steps.push({ id: "attributeDisclosure", label: "Attribute Disclosure Attack (Sensitive Inference)...",        fn: () => { newResults.attributeDisclosure = runAttributeDisclosureAttack(rawData, quasiIdentifiers, sensitiveAttributes); } });
    if (selectedAttacks.includes("differencing"))        steps.push({ id: "differencing",        label: "Differencing Attack (Aggregate Query Leakage)...",            fn: () => { newResults.differencing        = runDifferencingAttack(rawData, quasiIdentifiers); } });
    if (selectedAttacks.includes("modelInversion"))      steps.push({ id: "modelInversion",      label: "Model Inversion Attack (Naïve Bayes Reconstruction)...",      fn: () => { newResults.modelInversion      = runModelInversionAttack(rawData, quasiIdentifiers, sensitiveAttributes); } });

    for (let i = 0; i < steps.length; i++) {
      setProgress({ step: `${i + 1}/${steps.length}: Running ${steps[i].label}`, pct: Math.round((i / steps.length) * 100) });
      await new Promise((r) => setTimeout(r, 50)); // yield to UI
      steps[i].fn();
      setResults({ ...newResults });
      await new Promise((r) => setTimeout(r, 20));
    }

    // Composite score
    newResults.composite = computeCompositeScore({
      prosecutor:          newResults.prosecutor?.riskScore          ?? 0,
      journalist:          newResults.journalist?.riskScore          ?? 0,
      marketer:            newResults.marketer?.riskScore            ?? 0,
      singlingOut:         newResults.singlingOut?.riskScore         ?? 0,
      inference:           newResults.inference?.riskScore           ?? 0,
      membership:          newResults.membership?.riskScore          ?? 0,
      recordLinkage:       newResults.recordLinkage?.riskScore       ?? 0,
      attributeDisclosure: newResults.attributeDisclosure?.riskScore ?? 0,
      differencing:        newResults.differencing?.riskScore        ?? 0,
      modelInversion:      newResults.modelInversion?.riskScore      ?? 0,
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

                  {/* QI columns */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quasi-Identifiers</Label>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{quasiIdentifiers.length} sel.</Badge>
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
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{sensitiveAttributes.length} sel.</Badge>
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
                      {a.id === "recordLinkage"       && <RecordLinkageReport r={results.recordLinkage!} />}
                      {a.id === "attributeDisclosure" && <AttributeDisclosureReport r={results.attributeDisclosure!} />}
                      {a.id === "differencing"        && <DifferencingReport r={results.differencing!} />}
                      {a.id === "modelInversion"      && <ModelInversionReport r={results.modelInversion!} />}
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
