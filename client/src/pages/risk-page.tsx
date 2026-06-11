import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, Shield, Users, Fingerprint, BarChart3, Play, Loader2,
  CheckCircle, XCircle, Target, Eye, Brain, UserCheck, Network, Info,
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
import { computeCompositeScore, type CompositeResult } from "@/lib/attacks/compositeScore";
import { sampleData, type DataRow, RISK_COLORS, type RiskLevel } from "@/lib/attacks/utils";

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
  composite?: CompositeResult;
}

type AttackId = "prosecutor" | "journalist" | "marketer" | "singlingOut" | "inference" | "membership" | "recordLinkage" | "attributeDisclosure";

const ATTACKS: { id: AttackId; label: string; short: string; icon: React.ReactNode; description: string }[] = [
  { id: "prosecutor",           label: "Prosecutor Attack",          short: "Prosecutor",    icon: <Target className="h-4 w-4" />,      description: "Within-Dataset Re-ID — Attacker knows target is in dataset, uses QIs to isolate" },
  { id: "journalist",           label: "Journalist Attack",          short: "Journalist",    icon: <Eye className="h-4 w-4" />,         description: "Probabilistic Re-ID — Information-theoretic risk via Shannon entropy and EC analysis" },
  { id: "marketer",             label: "Marketer Attack",            short: "Marketer",      icon: <Users className="h-4 w-4" />,       description: "Group Targeting — L-Diversity & T-Closeness: attacker targets groups, not individuals" },
  { id: "singlingOut",          label: "Singling Out Attack",        short: "Singling Out",  icon: <Fingerprint className="h-4 w-4" />, description: "GDPR Article 4(1) — Minimal attribute combination sufficient to isolate one record" },
  { id: "inference",            label: "Inference Attack",           short: "Inference",     icon: <Brain className="h-4 w-4" />,       description: "ML Prediction — CART decision tree predicts sensitive attributes from quasi-identifiers" },
  { id: "membership",           label: "Membership Attack",          short: "Membership",    icon: <UserCheck className="h-4 w-4" />,   description: "Presence Detection — AUC-based test: can attacker tell if a record is in the dataset?" },
  { id: "recordLinkage",        label: "Record Linkage Attack",      short: "Rec. Linkage",  icon: <Network className="h-4 w-4" />,     description: "External Re-ID — Links anonymized records to an external dataset using quasi-identifiers" },
  { id: "attributeDisclosure",  label: "Attribute Disclosure Attack", short: "Attr. Disclose", icon: <Shield className="h-4 w-4" />,   description: "Sensitive Inference — Even without re-ID: attacker infers sensitive values from EC distributions" },
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

function ProsecutorReport({ r }: { r: ProsecutorResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Re-ID Risk", `${(r.riskScore * 100).toFixed(1)}%`, "Avg linkage score", <Target className="h-4 w-4" />, "text-red-600")}
        {kpiCard("Unique Records", r.uniqueRecordsCount, "Singleton ECs (k=1)", <Fingerprint className="h-4 w-4" />, "text-orange-600")}
        {kpiCard("Avg EC Size", r.avgEcSize.toFixed(1), "Mean equivalence class size", <Users className="h-4 w-4" />)}
        {kpiCard("Min-K", r.minK, "Smallest equivalence class", <AlertTriangle className="h-4 w-4" />, r.minK === 1 ? "text-red-600" : "text-green-600")}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Equivalence Class Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.histogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} name="Records" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Link Score Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.linkScoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" fill="#DC2626" radius={[4, 4, 0, 0]} name="Records" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Risk–Protection Donut</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={[
                  { name: "At Risk", value: parseFloat((r.riskScore * 100).toFixed(1)) },
                  { name: "Protected", value: parseFloat(((1 - r.riskScore) * 100).toFixed(1)) },
                ]} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  <Cell fill="#DC2626" />
                  <Cell fill="#16A34A" />
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Vulnerable Records</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">Link Score</th><th className="text-right pb-1">EC Size</th></tr></thead>
                <tbody>
                  {r.topVulnerable.map((row, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 pr-2 text-muted-foreground truncate max-w-[200px]">{row.qiCombo}</td>
                      <td className="py-1 text-right font-bold text-red-600">{row.linkScore}</td>
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

function JournalistReport({ r }: { r: JournalistResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Journalist Risk", `${(r.riskScore * 100).toFixed(1)}%`, "Mean 1/k across records", <Eye className="h-4 w-4" />, "text-red-600")}
        {kpiCard("K-Violations", r.violations, `Records below k-threshold`, <XCircle className="h-4 w-4" />, "text-orange-600")}
        {kpiCard("Entropy H_norm", r.hNorm.toFixed(3), "0 = uniform, 1 = diverse", <BarChart3 className="h-4 w-4" />)}
        {kpiCard("Risk Lift", `${r.riskLift}×`, "vs random guessing", <AlertTriangle className="h-4 w-4" />, r.riskLift > 10 ? "text-red-600" : "text-amber-600")}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">EC Distribution + Avg Risk</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.histogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar yAxisId="left" dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} name="Records" />
                <Line yAxisId="right" type="monotone" dataKey="avgRisk" stroke="#DC2626" strokeWidth={2} dot={false} name="Avg Risk %" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Information Gain by Quasi-Identifier</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.infoGain} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="qi" tick={{ fontSize: 10 }} width={90} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="gain" fill="#EA580C" radius={[0, 4, 4, 0]} name="Info Gain" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Risk–Protection Donut</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={[
                  { name: "At Risk", value: parseFloat((r.violationRate * 100).toFixed(1)) },
                  { name: "Protected", value: parseFloat(((1 - r.violationRate) * 100).toFixed(1)) },
                ]} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  <Cell fill="#DC2626" />
                  <Cell fill="#16A34A" />
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Entropy Gauge</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center justify-center h-[200px] gap-4">
            <div className="text-4xl font-bold">{r.hNorm.toFixed(3)}</div>
            <div className="text-sm text-muted-foreground">Normalized Shannon Entropy</div>
            <div className="w-full">
              <Progress value={r.hNorm * 100} className="h-4" />
              <div className="flex justify-between text-xs mt-1 text-muted-foreground"><span>0 (Uniform)</span><span>1 (Max Diverse)</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
      <RecommendationsCard recs={r.recommendations} />
    </div>
  );
}

function MarketerReport({ r }: { r: MarketerResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Marketer Risk", `${(r.riskScore * 100).toFixed(1)}%`, "Weighted group disclosure risk", <Users className="h-4 w-4" />, "text-red-600")}
        {kpiCard("L-Div Pass Rate", `${(r.lDiversityPassRate * 100).toFixed(0)}%`, `Groups with ≥ threshold distinct values`, <CheckCircle className="h-4 w-4" />, r.lDiversityPassRate > 0.8 ? "text-green-600" : "text-red-600")}
        {kpiCard("T-Close Pass Rate", `${(r.tClosenessPassRate * 100).toFixed(0)}%`, "Groups satisfying EMD ≤ threshold", <Shield className="h-4 w-4" />, r.tClosenessPassRate > 0.8 ? "text-green-600" : "text-orange-600")}
        {kpiCard("At-Risk Groups", r.atRiskGroups, `of ${r.totalGroups} total groups`, <AlertTriangle className="h-4 w-4" />, r.atRiskGroups > 0 ? "text-red-600" : "text-green-600")}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">L-Diversity Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.lDiversityHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" name="Groups">
                  {r.lDiversityHistogram.map((entry, i) => (
                    <Cell key={i} fill={i === 0 ? "#DC2626" : i === 1 ? "#EA580C" : "#16A34A"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">T-Closeness (EMD) Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.emdHistogram}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="count" fill="#7C3AED" radius={[4, 4, 0, 0]} name="Groups" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm">Most Dangerous Groups (Top 10)</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left pb-1">QI Combination</th><th className="text-right pb-1">Size</th><th className="text-right pb-1">Dom. Prob</th><th className="text-right pb-1">L-Div</th><th className="text-right pb-1">EMD</th><th className="text-right pb-1">L-OK</th><th className="text-right pb-1">T-OK</th></tr></thead>
                <tbody>
                  {r.groupRisks.slice(0, 10).map((g, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1 pr-2 text-muted-foreground truncate max-w-[180px]">{g.qiCombo.slice(0, 50)}</td>
                      <td className="py-1 text-right">{g.size}</td>
                      <td className="py-1 text-right font-bold" style={{ color: g.dominantProb > 0.5 ? "#DC2626" : "#16A34A" }}>{(g.dominantProb * 100).toFixed(0)}%</td>
                      <td className="py-1 text-right">{g.lDiversity}</td>
                      <td className="py-1 text-right">{g.emd.toFixed(2)}</td>
                      <td className="py-1 text-right">{g.isLDiverse ? "✅" : "❌"}</td>
                      <td className="py-1 text-right">{g.isTClose ? "✅" : "❌"}</td>
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

function InferenceReport({ r }: { r: InferenceResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCard("Attack Accuracy", `${r.attackAccuracy}%`, "5-fold CV accuracy", <Brain className="h-4 w-4" />, "text-red-600")}
        {kpiCard("Baseline Accuracy", `${r.baselineAccuracy}%`, "Best random guess", <BarChart3 className="h-4 w-4" />)}
        {kpiCard("Information Gain", `${r.infoGain}%`, "Attack above baseline", <AlertTriangle className="h-4 w-4" />, r.infoGain > 10 ? "text-red-600" : "text-green-600")}
        {kpiCard("Risk Level", r.riskLevel, "Based on information gain", <Shield className="h-4 w-4" />, r.riskLevel === "CRITICAL" || r.riskLevel === "HIGH" ? "text-red-600" : "text-green-600")}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Feature Importance (Gini)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.featureImportance} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="qi" tick={{ fontSize: 10 }} width={90} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="importance" fill="#2563EB" radius={[0, 4, 4, 0]} name="Importance" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Attack vs Baseline Accuracy</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={r.accuracyComparison}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Accuracy %">
                  <Cell fill="#DC2626" />
                  <Cell fill="#16A34A" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm">Per Sensitive Attribute Analysis</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left pb-2">Attribute</th><th className="text-right pb-2">Attack Acc.</th><th className="text-right pb-2">Baseline</th><th className="text-right pb-2">Info Gain</th><th className="text-right pb-2">Risk Level</th></tr></thead>
              <tbody>
                {r.perSA.map((sa, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-1.5 font-medium">{sa.sa}</td>
                    <td className="py-1.5 text-right">{sa.attackAccuracy}%</td>
                    <td className="py-1.5 text-right">{sa.baselineAccuracy}%</td>
                    <td className="py-1.5 text-right font-bold" style={{ color: sa.infoGain > 10 ? "#DC2626" : "#16A34A" }}>+{sa.infoGain}%</td>
                    <td className="py-1.5 text-right">{riskBadge(sa.riskLevel)}</td>
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

  const { data: datasets, isLoading: datasetsLoading } = useQuery<Dataset[]>({ queryKey: ["/api/datasets"] });

  const selectedDatasetObj = datasets?.find((d) => d.id.toString() === selectedDataset);

  // Fetch full dataset data for client-side computation
  const { data: datasetData } = useQuery<{ data: DataRow[] }>({
    queryKey: ["/api/data", selectedDataset],
    enabled: !!selectedDataset,
  });

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

    if (selectedAttacks.includes("prosecutor"))          steps.push({ id: "prosecutor",          label: "Prosecutor Attack (Within-Dataset Re-ID)...",         fn: () => { newResults.prosecutor          = runProsecutorAttack(rawData, quasiIdentifiers, kThreshold[0]); } });
    if (selectedAttacks.includes("journalist"))          steps.push({ id: "journalist",          label: "Journalist Attack (Probabilistic Re-ID)...",           fn: () => { newResults.journalist          = runJournalistAttack(rawData, quasiIdentifiers, kThreshold[0]); } });
    if (selectedAttacks.includes("marketer"))            steps.push({ id: "marketer",            label: "Marketer Attack (L-Diversity & T-Closeness)...",       fn: () => { newResults.marketer            = runMarketerAttack(rawData, quasiIdentifiers, sensitiveAttributes, lThreshold[0], tVal); } });
    if (selectedAttacks.includes("singlingOut"))         steps.push({ id: "singlingOut",         label: "Singling Out Attack (GDPR Singling-Out Standard)...",   fn: () => { newResults.singlingOut         = runSingleOutAttack(rawData, allCols, kThreshold[0]); } });
    if (selectedAttacks.includes("inference"))           steps.push({ id: "inference",           label: "Inference Attack (CART Decision Tree)...",              fn: () => { newResults.inference           = runInferenceAttack(rawData, quasiIdentifiers, sensitiveAttributes); } });
    if (selectedAttacks.includes("membership"))          steps.push({ id: "membership",          label: "Membership Attack (AUC Presence Detection)...",         fn: () => { newResults.membership          = runMembershipAttack(rawData, quasiIdentifiers); } });
    if (selectedAttacks.includes("recordLinkage"))       steps.push({ id: "recordLinkage",       label: "Record Linkage Attack (External Dataset Re-ID)...",     fn: () => { newResults.recordLinkage       = runRecordLinkageAttack(rawData, quasiIdentifiers); } });
    if (selectedAttacks.includes("attributeDisclosure")) steps.push({ id: "attributeDisclosure", label: "Attribute Disclosure Attack (Sensitive Inference)...",  fn: () => { newResults.attributeDisclosure = runAttributeDisclosureAttack(rawData, quasiIdentifiers, sensitiveAttributes); } });

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
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quasi-Identifiers</Label>
                    <ScrollArea className="h-[110px] rounded-md border p-2">
                      <div className="space-y-1.5">
                        {selectedDatasetObj.columns?.map((col) => (
                          <div key={col} className="flex items-center gap-2">
                            <Checkbox id={`qi-${col}`} checked={quasiIdentifiers.includes(col)} onCheckedChange={() => toggleColumn(col, "quasi")} />
                            <label htmlFor={`qi-${col}`} className="text-xs cursor-pointer">{col}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sensitive Attributes</Label>
                    <ScrollArea className="h-[110px] rounded-md border p-2">
                      <div className="space-y-1.5">
                        {selectedDatasetObj.columns?.map((col) => (
                          <div key={col} className="flex items-center gap-2">
                            <Checkbox id={`sa-${col}`} checked={sensitiveAttributes.includes(col)} onCheckedChange={() => toggleColumn(col, "sensitive")} />
                            <label htmlFor={`sa-${col}`} className="text-xs cursor-pointer">{col}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              )}

              {/* Sliders */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">K-Anonymity</Label>
                  <Badge variant="outline" className="text-xs">{kThreshold[0]}</Badge>
                </div>
                <Slider value={kThreshold} onValueChange={setKThreshold} min={2} max={20} step={1} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">L-Diversity Threshold</Label>
                  <Badge variant="outline" className="text-xs">{lThreshold[0]}</Badge>
                </div>
                <Slider value={lThreshold} onValueChange={setLThreshold} min={1} max={5} step={1} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">T-Closeness Threshold</Label>
                  <Badge variant="outline" className="text-xs">{tThreshold[0] / 100}</Badge>
                </div>
                <Slider value={tThreshold} onValueChange={setTThreshold} min={5} max={50} step={5} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sample Size</Label>
                  <Badge variant="outline" className="text-xs">{samplePct[0]}%</Badge>
                </div>
                <Slider value={samplePct} onValueChange={setSamplePct} min={10} max={100} step={10} />
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
            <Card className="flex flex-col items-center justify-center py-24 text-center">
              <Network className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No Assessment Results Yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Select a dataset, configure quasi-identifiers and sensitive attributes, then click <strong>Run Assessment</strong> to analyse privacy risks across all 8 attack types.
              </p>
            </Card>
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
                      {a.id === "prosecutor"          && <ProsecutorReport r={results.prosecutor!} />}
                      {a.id === "journalist"          && <JournalistReport r={results.journalist!} />}
                      {a.id === "marketer"            && <MarketerReport r={results.marketer!} />}
                      {a.id === "singlingOut"         && <SinglingOutReport r={results.singlingOut!} />}
                      {a.id === "inference"           && <InferenceReport r={results.inference!} />}
                      {a.id === "membership"          && <MembershipReport r={results.membership!} />}
                      {a.id === "recordLinkage"       && <RecordLinkageReport r={results.recordLinkage!} />}
                      {a.id === "attributeDisclosure" && <AttributeDisclosureReport r={results.attributeDisclosure!} />}
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
