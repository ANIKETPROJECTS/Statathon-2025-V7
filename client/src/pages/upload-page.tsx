import { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload, FileSpreadsheet, CheckCircle, Loader2,
  CheckCircle2, ArrowLeft, Table2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Dataset } from "@shared/schema";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import iconDatabase from "@assets/database_1781619133257.png";
import iconDiagnosis from "@assets/diagnosis_1781619253434.png";
import iconTargetAudience from "@assets/target-audience_1781619256636.png";
import iconShield from "@assets/shield_1781619281871.png";
import iconFolder from "@assets/open-folder_(1)_1781619380487.png";
import iconView from "@assets/view_1781619449946.png";
import iconTools from "@assets/tools_1781619494445.png";
import iconBin from "@assets/bin_1781619508970.png";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

const poppins: React.CSSProperties = { fontFamily: "'Poppins', sans-serif" };

const GUIDELINES = [
  {
    img: iconDatabase, title: "File Requirements",
    items: ["CSV, XLSX, XLS, JSON accepted", "No file size limit", "Min 10 rows recommended", "Headers required"],
  },
  {
    img: iconDiagnosis, title: "Quasi-Identifiers",
    items: ["Age, Gender, Postal Code", "State, Occupation", "Education Level, Salary", "Can re-identify when combined"],
  },
  {
    img: iconTargetAudience, title: "Direct Identifiers",
    items: ["Remove: Name, ID, Email", "Remove: Phone, Address", "Keep: Anonymised ID only", "Already removed by NSO"],
  },
  {
    img: iconShield, title: "Data Quality",
    items: ["Minimise missing values", "Check for outliers", "Consistent formatting", "Valid data types"],
  },
];

function QualityBar({ score }: { score: number | null }) {
  if (!score) return <span className="text-slate-400 text-sm">—</span>;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? "bg-emerald-500" : score >= 0.6 ? "bg-amber-500" : "bg-rose-500";
  const text = score >= 0.8 ? "text-emerald-600" : score >= 0.6 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-semibold ${text}`} style={poppins}>{pct}%</span>
    </div>
  );
}

type UploadPhase = "idle" | "uploading" | "processing" | "done" | "error";

function formatBytes(b: number) {
  if (!b) return "0 B";
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + " " + ["B", "KB", "MB", "GB", "TB"][i];
}

function formatCount(n: number) {
  return n.toLocaleString("en-IN");
}

/** Quickly count rows in a CSV by counting newlines (no full parse needed) */
function estimateCsvRows(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return Math.max(0, count - 1); // subtract header row
}

export default function UploadPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Progress state
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadPct, setUploadPct] = useState(0);        // 0-100 file transfer %
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [estimatedRows, setEstimatedRows] = useState<number | null>(null);
  const [finalRows, setFinalRows] = useState<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [datasetPreviews, setDatasetPreviews] = useState<Record<string, { columns: string[]; rows: any[] }>>({});
  const [viewDataset, setViewDataset] = useState<Dataset | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [fixResults, setFixResults] = useState<Record<string, string[]>>({});
  const [isFixing, setIsFixing] = useState<Record<string, boolean>>({});
  const [perfectOpen, setPerfectOpen] = useState(false);

  const { data: datasets, isLoading } = useQuery<Dataset[]>({
    queryKey: ["/api/datasets"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/datasets/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datasets"] });
      toast({ title: "Dataset deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const uploadFile = useCallback((file: File) => {
    setPhase("uploading");
    setUploadPct(0);
    setUploadedBytes(0);
    setTotalBytes(file.size);
    setEstimatedRows(null);
    setFinalRows(null);

    // For CSV: read a sample to estimate rows
    if (file.name.toLowerCase().endsWith(".csv")) {
      const SAMPLE = 512 * 1024; // 512 KB sample
      const blob = file.slice(0, SAMPLE);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string ?? "";
        const newlines = (text.match(/\n/g) || []).length;
        const bytesPerRow = newlines > 0 ? SAMPLE / newlines : 200;
        const estimated = Math.round(file.size / bytesPerRow);
        setEstimatedRows(estimated);
      };
      reader.readAsText(blob);
    }

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploadPct(pct);
        setUploadedBytes(e.loaded);
      }
    };

    xhr.upload.onload = () => {
      setUploadPct(100);
      setPhase("processing");
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          setFinalRows(result.rowCount ?? null);
          setPhase("done");
          qc.invalidateQueries({ queryKey: ["/api/datasets"] });
          toast({ title: "Upload successful", description: `${formatCount(result.rowCount ?? 0)} records imported.` });
          setTimeout(() => setPhase("idle"), 4000);
        } catch {
          setPhase("error");
          toast({ title: "Upload failed", description: "Invalid server response.", variant: "destructive" });
        }
      } else {
        setPhase("error");
        toast({ title: "Upload failed", description: xhr.responseText || `HTTP ${xhr.status}`, variant: "destructive" });
        setTimeout(() => setPhase("idle"), 3000);
      }
    };

    xhr.onerror = () => {
      setPhase("error");
      toast({ title: "Upload failed", description: "Network error.", variant: "destructive" });
      setTimeout(() => setPhase("idle"), 3000);
    };

    xhr.open("POST", "/api/data/upload");
    xhr.send(formData);
  }, [qc, toast]);

  const onDrop = useCallback((files: File[]) => {
    if (files[0] && phase === "idle") uploadFile(files[0]);
  }, [uploadFile, phase]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "application/json": [".json"],
    },
    maxFiles: 1,
    disabled: phase !== "idle",
  });

  const openFullView = async (dataset: Dataset) => {
    if (datasetPreviews[dataset.id]) { setViewDataset(dataset); return; }
    setLoadingPreview(true);
    setViewDataset(dataset);
    try {
      const res = await fetch(`/api/data/${dataset.id}/preview`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDatasetPreviews(p => ({ ...p, [dataset.id]: data }));
      }
    } catch {
      toast({ title: "Failed to load data", variant: "destructive" });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleAutoFix = async (dataset: Dataset) => {
    if (dataset.qualityScore && dataset.qualityScore >= 0.95) { setPerfectOpen(true); return; }
    setIsFixing(p => ({ ...p, [dataset.id]: true }));
    try {
      const res = await fetch(`/api/data/${dataset.id}/autofix`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const result = await res.json();
        setFixResults(p => ({ ...p, [dataset.id]: result.fixes || ["Data cleaning completed"] }));
        setDatasetPreviews(p => { const u = { ...p }; delete u[dataset.id]; return u; });
        qc.invalidateQueries({ queryKey: ["/api/datasets"] });
        toast({ title: "Auto Fix completed" });
      }
    } catch {
      toast({ title: "Auto Fix failed", variant: "destructive" });
    } finally {
      setIsFixing(p => ({ ...p, [dataset.id]: false }));
    }
  };

  const formatDate = (d: string | Date | null) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const previewData = viewDataset ? datasetPreviews[viewDataset.id] : null;
  const isPending = phase === "uploading" || phase === "processing";

  /* ── Progress overlay content ── */
  function ProgressContent() {
    if (phase === "idle") return null;

    if (phase === "uploading") {
      return (
        <div className="flex flex-col items-center gap-4 px-6 w-full max-w-xs">
          <div className="h-14 w-14 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Upload className="h-7 w-7 text-blue-500 animate-pulse" />
          </div>
          <div className="w-full">
            <div className="flex justify-between mb-1.5">
              <span className="text-sm font-semibold text-slate-700" style={poppins}>Uploading file…</span>
              <span className="text-sm font-semibold text-blue-600" style={poppins}>{uploadPct}%</span>
            </div>
            {/* Track */}
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-slate-400 font-medium" style={poppins}>{formatBytes(uploadedBytes)}</span>
              <span className="text-xs text-slate-400 font-medium" style={poppins}>{formatBytes(totalBytes)}</span>
            </div>
          </div>
          {estimatedRows !== null && (
            <p className="text-xs text-slate-400 font-medium" style={poppins}>
              ~{formatCount(estimatedRows)} records estimated
            </p>
          )}
        </div>
      );
    }

    if (phase === "processing") {
      return (
        <div className="flex flex-col items-center gap-4 px-6 w-full max-w-xs">
          <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
          <div className="text-center">
            <p className="text-base font-semibold text-slate-800" style={poppins}>Analysing records…</p>
            {estimatedRows !== null && (
              <p className="text-sm text-slate-500 mt-1 font-medium" style={poppins}>
                Processing {formatCount(estimatedRows)} records
              </p>
            )}
            <p className="text-xs text-slate-400 mt-1 font-medium" style={poppins}>
              Calculating quality scores & risk indicators
            </p>
          </div>
          {/* Indeterminate bar */}
          <div className="h-1.5 w-48 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-blue-400 rounded-full animate-[shimmer_1.4s_ease-in-out_infinite]" />
          </div>
        </div>
      );
    }

    if (phase === "done") {
      return (
        <div className="flex flex-col items-center gap-3 px-6">
          <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-emerald-700" style={poppins}>Import complete!</p>
            {finalRows !== null && (
              <p className="text-2xl font-bold text-slate-800 mt-1" style={poppins}>
                {formatCount(finalRows)}
                <span className="text-sm font-semibold text-slate-400 ml-1.5">records imported</span>
              </p>
            )}
          </div>
        </div>
      );
    }

    if (phase === "error") {
      return (
        <div className="flex flex-col items-center gap-3 px-6">
          <div className="h-12 w-12 rounded-full bg-rose-50 flex items-center justify-center">
            <span className="text-rose-500 text-2xl font-bold">!</span>
          </div>
          <p className="text-sm font-semibold text-rose-600" style={poppins}>Upload failed</p>
        </div>
      );
    }

    return null;
  }

  /* ── FULL DATA VIEW ── */
  if (viewDataset) {
    return (
      <DashboardLayout title="Data Upload" breadcrumbs={[{ label: "Data Upload" }]} fullHeight>
        <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden" style={poppins}>
          <div className="flex items-center justify-between mb-5 shrink-0">
            <button
              onClick={() => setViewDataset(null)}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
              style={poppins}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to datasets
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-400 font-medium" style={poppins}>
              <Table2 className="h-4 w-4" />
              {viewDataset.originalName}
            </div>
          </div>

          <div className="grid grid-cols-4 divide-x divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden bg-white shrink-0 mb-5">
            {[
              { label: "Quality Score", value: viewDataset.qualityScore ? `${Math.round(viewDataset.qualityScore * 100)}%` : "—" },
              { label: "Completeness", value: viewDataset.completenessScore ? `${Math.round(viewDataset.completenessScore * 100)}%` : "—" },
              { label: "Total Rows", value: viewDataset.rowCount.toLocaleString("en-IN") },
              { label: "Columns", value: String(viewDataset.columns?.length ?? "—") },
            ].map(({ label, value }) => (
              <div key={label} className="px-7 py-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider" style={poppins}>{label}</p>
                <p className="text-2xl font-semibold text-slate-800 mt-1" style={poppins}>{value}</p>
              </div>
            ))}
          </div>

          <div className="border border-slate-100 rounded-2xl bg-white flex flex-col flex-1 min-h-0 overflow-hidden">
            {loadingPreview || !previewData ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="text-sm" style={{ ...poppins, minWidth: "100%" }}>
                    <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-12 border-r border-slate-100 bg-slate-50" style={poppins}>#</th>
                        {previewData.columns.map(col => (
                          <th key={col} className="px-4 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider min-w-[130px] whitespace-nowrap bg-slate-50" style={poppins}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {previewData.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-2.5 text-xs text-slate-300 font-medium border-r border-slate-100 w-12 text-right" style={poppins}>{idx + 1}</td>
                          {previewData.columns.map(col => (
                            <td key={col} className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis" style={{ fontFamily: "'JetBrains Mono','Fira Mono',monospace" }}>
                              {String(row[col] ?? "—")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
                  <p className="text-xs text-slate-400 font-medium" style={poppins}>
                    Showing {previewData.rows.length} of {viewDataset.rowCount.toLocaleString("en-IN")} rows
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <Dialog open={perfectOpen} onOpenChange={setPerfectOpen}>
          <DialogContent className="max-w-sm rounded-2xl" style={poppins}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-semibold" style={poppins}>
                <CheckCircle className="h-6 w-6 text-emerald-500" />Dataset is Perfect!
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 pt-2 font-medium" style={poppins}>
                Quality score ≥ 95% — no fixes needed. Ready for risk assessment.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setPerfectOpen(false)} style={poppins}>Got it</Button>
            </div>
          </DialogContent>
        </Dialog>
      </DashboardLayout>
    );
  }

  /* ── MAIN UPLOAD VIEW ── */
  return (
    <DashboardLayout title="Data Upload" breadcrumbs={[{ label: "Data Upload" }]}>
      <div className="space-y-10" style={poppins}>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">

          {/* LEFT — upload zone */}
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-800 mb-1.5" style={poppins}>Upload Microdata File</h2>
              <p className="text-[15px] text-slate-500 font-medium leading-relaxed" style={poppins}>
                Upload your NSO microdata file. It will be automatically analysed for quasi-identifiers and re-identification risk.
              </p>
            </div>

            <div
              {...getRootProps()}
              data-testid="dropzone-upload"
              className={[
                "relative border-2 border-dashed rounded-2xl transition-all duration-200 select-none",
                "flex flex-col items-center justify-center gap-5 py-16 px-8 min-h-[280px]",
                isPending || phase === "done"
                  ? "pointer-events-none border-blue-200 bg-blue-50/30"
                  : isDragActive
                    ? "border-blue-500 bg-blue-50/60 cursor-copy"
                    : "border-slate-200 hover:border-blue-400 hover:bg-slate-50/40 cursor-pointer",
              ].join(" ")}
            >
              <input {...getInputProps()} data-testid="input-file-upload" />

              {phase !== "idle" ? (
                <ProgressContent />
              ) : (
                <>
                  <div className={`h-[72px] w-[72px] rounded-2xl flex items-center justify-center ${isDragActive ? "bg-blue-100" : "bg-slate-100"}`}>
                    <Upload className={`h-8 w-8 ${isDragActive ? "text-blue-600" : "text-slate-500"}`} />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-semibold text-slate-800" style={poppins}>
                      {isDragActive ? "Drop file here" : "Drop your file here"}
                    </p>
                    {!isDragActive && (
                      <p className="text-[15px] text-slate-400 mt-1 font-medium" style={poppins}>
                        or <span className="text-blue-600 underline underline-offset-2">click to browse</span>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {["CSV", "XLSX", "XLS", "JSON"].map(f => (
                      <span key={f} className="px-3 py-1 rounded-md bg-slate-100 text-slate-600 text-sm font-semibold tracking-wide" style={poppins}>{f}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* RIGHT — guidelines */}
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-slate-800" style={poppins}>Upload Guidelines</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-8">
              {GUIDELINES.map(({ img, title, items }) => (
                <div key={title}>
                  <div className="flex items-center gap-3 mb-3">
                    <img src={img} alt={title} className="h-7 w-7 shrink-0 object-contain" />
                    <span className="text-[15px] font-semibold text-slate-800" style={poppins}>{title}</span>
                  </div>
                  <ul className="space-y-1">
                    {items.map(item => (
                      <li key={item} className="text-[13px] text-slate-900 font-medium flex items-start gap-1.5 leading-snug" style={poppins}>
                        <span className="shrink-0 text-slate-900 mt-0.5">·</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Uploaded Datasets ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-800" style={poppins}>Your Uploaded Datasets</h2>
            {datasets && datasets.length > 0 && (
              <span className="text-sm text-slate-400 font-medium" style={poppins}>
                {datasets.length} file{datasets.length !== 1 ? "s" : ""} uploaded
              </span>
            )}
          </div>

          <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : !datasets?.length ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
                  <FileSpreadsheet className="h-8 w-8 text-slate-400" />
                </div>
                <p className="text-lg font-semibold text-slate-700" style={poppins}>No datasets yet</p>
                <p className="text-sm text-slate-400 mt-2 font-medium max-w-xs" style={poppins}>
                  Upload your first NSO microdata file above to begin privacy assessment.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={poppins}>
                  <thead>
                    <tr className="border-b border-slate-100">
                      {["File Name", "Format", "Size", "Rows", "Cols", "Quality", "Uploaded", "Actions"].map(h => (
                        <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap" style={poppins}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {datasets.map(ds => (
                      <tr key={ds.id} data-testid={`row-dataset-${ds.id}`} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-4">
                          <button
                            onClick={() => openFullView(ds)}
                            className="flex items-center gap-2.5 text-left group"
                          >
                            <img src={iconFolder} alt="file" className="h-5 w-5 shrink-0 object-contain" />
                            <span className="text-[14px] font-semibold text-slate-900 group-hover:text-blue-600 transition-colors truncate max-w-[180px]" style={poppins}>
                              {ds.originalName}
                            </span>
                          </button>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-xs font-semibold text-slate-900 tracking-wide" style={poppins}>
                            {ds.format.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-900 font-medium whitespace-nowrap" style={poppins}>{formatBytes(ds.size)}</td>
                        <td className="px-5 py-4 text-sm font-semibold text-slate-900" style={poppins}>{ds.rowCount.toLocaleString("en-IN")}</td>
                        <td className="px-5 py-4 text-sm font-semibold text-slate-900" style={poppins}>{ds.columns?.length || 0}</td>
                        <td className="px-5 py-4"><QualityBar score={ds.qualityScore} /></td>
                        <td className="px-5 py-4 text-sm text-slate-900 font-medium whitespace-nowrap" style={poppins}>{formatDate((ds as any).uploadedAt)}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openFullView(ds)}
                              title="View full data"
                              className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-blue-50 transition-colors"
                            >
                              <img src={iconView} alt="view" className="h-4 w-4 object-contain" />
                            </button>
                            <button
                              onClick={() => handleAutoFix(ds)}
                              disabled={!!(isFixing[ds.id] || fixResults[ds.id])}
                              title="Auto-fix issues"
                              className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-amber-50 transition-colors disabled:opacity-40"
                            >
                              {isFixing[ds.id] ? <Loader2 className="h-4 w-4 animate-spin text-amber-500" /> : <img src={iconTools} alt="fix" className="h-4 w-4 object-contain" />}
                            </button>
                            <button
                              onClick={() => deleteMutation.mutate(ds.id)}
                              disabled={deleteMutation.isPending}
                              title="Delete dataset"
                              data-testid={`button-delete-${ds.id}`}
                              className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-rose-50 transition-colors disabled:opacity-40"
                            >
                              <img src={iconBin} alt="delete" className="h-4 w-4 object-contain" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {Object.entries(fixResults).map(([id, fixes]) => (
            <div key={id} className="mt-3 flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-700" style={poppins}>Auto Fix Completed</p>
                <ul className="mt-1 space-y-0.5">
                  {fixes.map((f, i) => (
                    <li key={i} className="text-sm text-emerald-600 font-medium" style={poppins}>· {f}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </section>
      </div>

      <Dialog open={perfectOpen} onOpenChange={setPerfectOpen}>
        <DialogContent className="max-w-sm rounded-2xl" style={poppins}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold" style={poppins}>
              <CheckCircle className="h-6 w-6 text-emerald-500" />Dataset is Perfect!
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 pt-2 font-medium" style={poppins}>
              Quality score ≥ 95% — no fixes needed. Ready for risk assessment.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setPerfectOpen(false)} style={poppins}>Got it</Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
