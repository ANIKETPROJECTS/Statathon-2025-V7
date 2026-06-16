import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Database, ChevronDown, ChevronRight, Download, Trash2,
  Shield, Calendar, BarChart3, FileText, FolderOpen,
  CheckCircle, AlertTriangle, Layers
} from "lucide-react";

const TECHNIQUE_COLORS: Record<string, string> = {
  "k-anonymity":          "bg-blue-100 text-blue-800 border-blue-200",
  "l-diversity":          "bg-purple-100 text-purple-800 border-purple-200",
  "t-closeness":          "bg-indigo-100 text-indigo-800 border-indigo-200",
  "differential-privacy": "bg-green-100 text-green-800 border-green-200",
  "synthetic-data":       "bg-orange-100 text-orange-800 border-orange-200",
  "sdg":                  "bg-amber-100 text-amber-800 border-amber-200",
  "federated-learning":   "bg-rose-100 text-rose-800 border-rose-200",
  "crypto-pets":          "bg-cyan-100 text-cyan-800 border-cyan-200",
};

function TechniqueBadge({ technique }: { technique: string }) {
  const cls = TECHNIQUE_COLORS[technique?.toLowerCase()] || "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      <Shield className="h-3 w-3" />
      {technique}
    </span>
  );
}

function InfoLossBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const cls = pct < 30 ? "bg-green-500" : pct < 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${pct < 30 ? "text-green-600" : pct < 60 ? "text-amber-600" : "text-red-600"}`}>
        {pct}%
      </span>
    </div>
  );
}

function OperationRow({ op, onDelete }: { op: any; onDelete: (id: string) => void }) {
  const { toast } = useToast();

  const handleDownload = () => {
    window.open(`/api/privacy/${op.id}/download`, "_blank");
  };

  const statusOk = op.status === "completed";

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-slate-50/80 transition-colors"
      data-testid={`row-operation-${op.id}`}
    >
      {/* Status icon */}
      <div className="shrink-0">
        {statusOk
          ? <CheckCircle className="h-4 w-4 text-green-500" />
          : <AlertTriangle className="h-4 w-4 text-amber-500" />}
      </div>

      {/* Technique */}
      <div className="w-48 shrink-0">
        <TechniqueBadge technique={op.technique} />
      </div>

      {/* Info loss */}
      <div className="flex-1 min-w-[120px]">
        <p className="text-xs text-slate-400 mb-1">Information Loss</p>
        {op.informationLoss != null
          ? <InfoLossBar value={op.informationLoss} />
          : <span className="text-xs text-slate-400">—</span>}
      </div>

      {/* Records retained */}
      <div className="w-28 shrink-0">
        <p className="text-xs text-slate-400 mb-0.5">Records Retained</p>
        <p className="text-sm font-semibold text-slate-700">
          {op.recordsRetained != null ? `${op.recordsRetained}` : "—"}
        </p>
      </div>

      {/* Date */}
      <div className="w-28 shrink-0">
        <p className="text-xs text-slate-400 mb-0.5">Processed</p>
        <p className="text-sm text-slate-600">
          {op.createdAt
            ? new Date(op.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : "—"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={handleDownload}
          data-testid={`button-download-op-${op.id}`}
        >
          <Download className="h-3 w-3" />
          Download
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
          onClick={() => {
            if (confirm(`Delete this ${op.technique} operation?`)) onDelete(op.id);
          }}
          data-testid={`button-delete-op-${op.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function DatasetCard({ dataset, operations, onDeleteOp }: {
  dataset: any;
  operations: any[];
  onDeleteOp: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const techniques = [...new Set(operations.map((o: any) => o.technique).filter(Boolean))];
  const minInfoLoss = operations.length > 0
    ? Math.min(...operations.map((o: any) => o.informationLoss ?? 100))
    : null;

  return (
    <Card className="overflow-hidden" data-testid={`card-dataset-${dataset.id}`}>
      {/* Dataset header */}
      <div
        className="flex items-center gap-4 px-5 py-4 bg-slate-50 border-b cursor-pointer hover:bg-slate-100 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="p-2 rounded-lg bg-blue-100 shrink-0">
          <Database className="h-5 w-5 text-blue-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-900 text-base truncate">{dataset.originalName}</h3>
            <span className="text-xs text-slate-400 shrink-0">{dataset.rowCount} rows · {dataset.columnCount} cols</span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {techniques.map((t: any) => (
              <TechniqueBadge key={t} technique={t} />
            ))}
            {operations.length === 0 && (
              <span className="text-xs text-slate-400 italic">No privacy operations yet</span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-center">
            <p className="text-xl font-bold text-slate-900">{operations.length}</p>
            <p className="text-xs text-slate-400">Operations</p>
          </div>
          {minInfoLoss != null && (
            <div className="text-center">
              <p className={`text-xl font-bold ${minInfoLoss < 30 ? "text-green-600" : minInfoLoss < 60 ? "text-amber-600" : "text-red-600"}`}>
                {Math.round(minInfoLoss)}%
              </p>
              <p className="text-xs text-slate-400">Best Loss</p>
            </div>
          )}
        </div>

        <div className="shrink-0 ml-2">
          {expanded
            ? <ChevronDown className="h-5 w-5 text-slate-400" />
            : <ChevronRight className="h-5 w-5 text-slate-400" />}
        </div>
      </div>

      {/* Operations table */}
      {expanded && (
        <div>
          {operations.length === 0 ? (
            <div className="py-10 flex flex-col items-center gap-2 text-slate-400">
              <Shield className="h-7 w-7" />
              <p className="text-sm">No privacy operations for this dataset yet.</p>
              <p className="text-xs">Go to Privacy Enhancement to process this dataset.</p>
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div className="flex items-center gap-4 px-4 py-2 bg-slate-50/50 border-b text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <div className="w-5 shrink-0" />
                <div className="w-48 shrink-0">Technique</div>
                <div className="flex-1 min-w-[120px]">Information Loss</div>
                <div className="w-28 shrink-0">Records Retained</div>
                <div className="w-28 shrink-0">Date</div>
                <div className="w-32 shrink-0">Actions</div>
              </div>
              {operations.map((op: any) => (
                <OperationRow key={op.id} op={op} onDelete={onDeleteOp} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function DatasetHandlingPage() {
  const { toast } = useToast();

  const { data: datasets = [], isLoading: datasetsLoading } = useQuery<any[]>({
    queryKey: ["/api/datasets"],
  });

  const { data: allOperations = [], isLoading: opsLoading } = useQuery<any[]>({
    queryKey: ["/api/privacy/operations"],
  });

  const deleteOpMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/privacy/${id}`),
    onSuccess: () => {
      toast({ title: "Operation deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/privacy/operations"] });
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const isLoading = datasetsLoading || opsLoading;

  // Group operations by datasetId
  const opsByDataset = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const op of allOperations as any[]) {
      const key = String(op.datasetId);
      if (!map[key]) map[key] = [];
      map[key].push(op);
    }
    return map;
  }, [allOperations]);

  // Summary stats
  const totalOps = (allOperations as any[]).length;
  const totalDatasets = (datasets as any[]).length;
  const datasetsWithOps = Object.keys(opsByDataset).length;
  const avgInfoLoss = totalOps > 0
    ? Math.round((allOperations as any[]).reduce((s: number, o: any) => s + (o.informationLoss ?? 0), 0) / totalOps)
    : 0;

  return (
    <DashboardLayout title="Dataset Handling" breadcrumbs={[{ label: "Dataset Handling" }]}>
      <div className="space-y-6">
        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50"><Database className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Total Datasets</p>
                <p className="text-2xl font-bold">{totalDatasets}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-50"><Layers className="h-5 w-5 text-purple-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Privacy Operations</p>
                <p className="text-2xl font-bold">{totalOps}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-50"><FolderOpen className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Processed Datasets</p>
                <p className="text-2xl font-bold">{datasetsWithOps}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50"><BarChart3 className="h-5 w-5 text-amber-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Avg Information Loss</p>
                <p className="text-2xl font-bold">{avgInfoLoss}%</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dataset cards */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <Card key={i}><CardContent className="pt-5"><Skeleton className="h-24 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : (datasets as any[]).length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
              <div className="p-4 rounded-full bg-slate-100"><Database className="h-8 w-8 text-slate-400" /></div>
              <div>
                <p className="font-medium text-slate-600">No datasets uploaded yet</p>
                <p className="text-sm text-slate-400 mt-1">Upload a dataset from the Data Upload page to get started.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {(datasets as any[]).map((dataset: any) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                operations={opsByDataset[String(dataset.id)] || []}
                onDeleteOp={(id) => deleteOpMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
