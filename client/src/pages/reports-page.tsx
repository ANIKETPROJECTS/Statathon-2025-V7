import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Download,
  Eye,
  Loader2,
  FileDown,
  Clock,
  CheckCircle,
  Trash2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Dataset, RiskAssessment, UtilityMeasurement, Report } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

const reportTypes = [
  { id: "executive", name: "Executive Summary", description: "Brief overview for stakeholders" },
  { id: "technical", name: "Technical Report", description: "Detailed metrics and analysis" },
  { id: "comprehensive", name: "Comprehensive Report", description: "Full analysis with all details" },
];

export default function ReportsPage() {
  const { toast } = useToast();
  const [reportTitle, setReportTitle] = useState("");
  const [reportType, setReportType] = useState("executive");
  const [reportFormat, setReportFormat] = useState("pdf");
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [selectedAssessment, setSelectedAssessment] = useState<string>("");
  const [selectedUtility, setSelectedUtility] = useState<string>("");

  const { data: datasets } = useQuery<Dataset[]>({
    queryKey: ["/api/datasets"],
  });

  const { data: assessments } = useQuery<RiskAssessment[]>({
    queryKey: ["/api/risk/assessments"],
  });

  const { data: utilities } = useQuery<UtilityMeasurement[]>({
    queryKey: ["/api/utility/measurements"],
  });

  const { data: reports, isLoading: reportsLoading } = useQuery<Report[]>({
    queryKey: ["/api/reports"],
  });

  const generateMutation = useMutation({
    mutationFn: async (params: any) => {
      const res = await apiRequest("POST", "/api/reports/generate", params);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({
        title: "Report generated",
        description: `${reportTypes.find(t => t.id === reportType)?.name} has been created.`,
      });
      setReportTitle("");
    },
    onError: (error: Error) => {
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({
        title: "Report deleted",
        description: "The report has been removed.",
      });
    },
  });

  const handleGenerate = () => {
    if (!reportTitle) {
      toast({
        title: "Title required",
        description: "Please provide a report title.",
        variant: "destructive",
      });
      return;
    }

    generateMutation.mutate({
      title: reportTitle,
      type: reportType,
      format: reportFormat,
      datasetId: selectedDataset && selectedDataset !== "none" ? selectedDataset : null,
      riskAssessmentId: selectedAssessment && selectedAssessment !== "none" ? selectedAssessment : null,
      utilityMeasurementId: selectedUtility && selectedUtility !== "none" ? selectedUtility : null,
    });
  };

  const handleDownload = async (report: Report) => {
    try {
      const response = await fetch(`/api/reports/${report.id}/download`, {
        credentials: "include",
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${report.title.replace(/\s+/g, "_")}.${report.format}`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Could not download the report.",
        variant: "destructive",
      });
    }
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTypeLabel = (type: string) => {
    return reportTypes.find(t => t.id === type)?.name || type;
  };

  return (
    <DashboardLayout title="Reports" breadcrumbs={[{ label: "Reports" }]}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Generate Report
              </CardTitle>
              <CardDescription>
                Create privacy and utility analysis reports
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Report Title</Label>
                <Input
                  id="title"
                  placeholder="Enter report title"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  data-testid="input-report-title"
                />
              </div>

              <div className="space-y-3">
                <Label>Report Type</Label>
                <RadioGroup value={reportType} onValueChange={setReportType}>
                  {reportTypes.map((type) => (
                    <div key={type.id} className="flex items-start space-x-3">
                      <RadioGroupItem value={type.id} id={type.id} className="mt-1" />
                      <div>
                        <Label htmlFor={type.id} className="font-medium cursor-pointer">
                          {type.name}
                        </Label>
                        <p className="text-xs text-muted-foreground">{type.description}</p>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-3">
                <Label>Format</Label>
                <RadioGroup value={reportFormat} onValueChange={setReportFormat} className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="pdf" id="pdf" />
                    <Label htmlFor="pdf" className="font-normal">PDF</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="html" id="html" />
                    <Label htmlFor="html" className="font-normal">HTML</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label>Include Dataset (Optional)</Label>
                <Select value={selectedDataset} onValueChange={setSelectedDataset}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {datasets?.map((d) => (
                      <SelectItem key={d.id} value={d.id.toString()}>
                        {d.originalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Include Risk Assessment (Optional)</Label>
                <Select value={selectedAssessment} onValueChange={setSelectedAssessment}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select assessment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {assessments?.map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        Assessment #{a.id} - {a.riskLevel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Include Utility Measurement (Optional)</Label>
                <Select value={selectedUtility} onValueChange={setSelectedUtility}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select measurement" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {utilities?.map((u) => (
                      <SelectItem key={u.id} value={u.id.toString()}>
                        Measurement #{u.id} - {u.utilityLevel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={generateMutation.isPending || !reportTitle}
                data-testid="button-generate-report"
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-2 h-4 w-4" />
                    Generate Report
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Generated Reports</CardTitle>
              <CardDescription>
                View and download previously generated reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !reports?.length ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No reports generated yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Generate your first report using the form
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Format</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports.map((report) => (
                        <TableRow key={report.id} data-testid={`row-report-${report.id}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate max-w-[200px]">{report.title}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{getTypeLabel(report.type)}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{report.format.toUpperCase()}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(report.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDownload(report)}
                                data-testid={`button-download-report-${report.id}`}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteMutation.mutate(report.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-report-${report.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
