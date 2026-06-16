import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import {
  FlaskConical, Download, Shield, FileDown, Calendar,
  User, FileText, FolderOpen, Info
} from "lucide-react";

const TECHNIQUE_COLORS: Record<string, string> = {
  "k-anonymity":           "bg-blue-100 text-blue-800 border-blue-200",
  "l-diversity":           "bg-purple-100 text-purple-800 border-purple-200",
  "t-closeness":           "bg-indigo-100 text-indigo-800 border-indigo-200",
  "differential-privacy":  "bg-green-100 text-green-800 border-green-200",
  "synthetic-data":        "bg-orange-100 text-orange-800 border-orange-200",
};

function TechniqueBadge({ technique }: { technique: string }) {
  const cls = TECHNIQUE_COLORS[technique] || "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      <Shield className="h-3 w-3" />
      {technique}
    </span>
  );
}

export default function ResearcherDashboard() {
  const { user } = useAuth();

  const { data: sharedFiles = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/researcher/files"],
  });

  const handleDownload = (operationId: string, technique: string) => {
    window.open(`/api/privacy/${operationId}/download`, "_blank");
  };

  return (
    <DashboardLayout title="My Research Files" breadcrumbs={[{ label: "Research Dashboard" }]}>
      <div className="space-y-6">
        {/* Welcome banner */}
        <Card className="border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-600 shadow-sm">
                <FlaskConical className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Welcome, {user?.fullName}</h2>
                <p className="text-sm text-slate-600">
                  Your research portal — privacy-enhanced datasets shared with you are listed below.
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-3xl font-bold text-blue-700">{(sharedFiles as any[]).length}</p>
                <p className="text-xs text-slate-500">Files available</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50"><FolderOpen className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Total Shared Files</p>
                <p className="text-2xl font-bold">{(sharedFiles as any[]).length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-50"><Shield className="h-5 w-5 text-purple-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Unique Techniques</p>
                <p className="text-2xl font-bold">
                  {new Set((sharedFiles as any[]).map((f: any) => f.technique).filter(Boolean)).size}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-50"><FileText className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-slate-500">Datasets</p>
                <p className="text-2xl font-bold">
                  {new Set((sharedFiles as any[]).map((f: any) => f.datasetName).filter(Boolean)).size}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Shared files grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900">Privacy-Enhanced Files</h3>
            <p className="text-sm text-slate-500">Files shared with you by the Master admin</p>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}><CardContent className="pt-5"><Skeleton className="h-32 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : (sharedFiles as any[]).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-16 flex flex-col items-center text-center gap-3">
                <div className="p-4 rounded-full bg-slate-100">
                  <FolderOpen className="h-8 w-8 text-slate-400" />
                </div>
                <div>
                  <p className="font-medium text-slate-600">No files shared yet</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Privacy-enhanced files shared with you by the Master admin will appear here.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(sharedFiles as any[]).map((file: any) => (
                <Card key={file.id} className="hover:shadow-md transition-shadow" data-testid={`card-shared-file-${file.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="p-2 rounded-lg bg-blue-50 shrink-0">
                        <FileDown className="h-5 w-5 text-blue-600" />
                      </div>
                      {file.technique && <TechniqueBadge technique={file.technique} />}
                    </div>
                    <CardTitle className="text-base mt-3 leading-snug">
                      {file.datasetName || "Privacy-Enhanced Dataset"}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {/* Shared by */}
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <User className="h-3.5 w-3.5 text-slate-400" />
                      <span>Shared by <span className="font-medium">{file.sharedByUser?.fullName || "Admin"}</span></span>
                    </div>

                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                      <span>{file.sharedAt ? new Date(file.sharedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
                    </div>

                    {/* Note */}
                    {file.note && (
                      <div className="flex items-start gap-2 text-sm text-slate-600 bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                        <Info className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <span className="leading-snug">{file.note}</span>
                      </div>
                    )}

                    {/* Download button */}
                    <Button
                      className="w-full mt-2"
                      size="sm"
                      onClick={() => handleDownload(file.privacyOperationId, file.technique)}
                      data-testid={`button-download-${file.id}`}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download CSV
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
