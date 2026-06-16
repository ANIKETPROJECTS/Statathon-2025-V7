import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Users, UserPlus, Trash2, Share2, Shield, Edit, Crown,
  FlaskConical, UserCheck, FileOutput, Loader2, X
} from "lucide-react";

const PERMISSIONS = [
  { key: "data_upload", label: "Data Upload" },
  { key: "risk_assessment", label: "Risk Assessment" },
  { key: "privacy_enhancement", label: "Privacy Enhancement" },
  { key: "utility_measurement", label: "Utility Measurement" },
  { key: "report_generation", label: "Report Generation" },
];

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  master: { label: "Master", color: "bg-purple-100 text-purple-800 border-purple-200", icon: Crown },
  admin:  { label: "Master", color: "bg-purple-100 text-purple-800 border-purple-200", icon: Crown },
  assistant: { label: "Assistant", color: "bg-blue-100 text-blue-800 border-blue-200", icon: UserCheck },
  researcher: { label: "Researcher", color: "bg-green-100 text-green green-800 border-green-200", icon: FlaskConical },
  analyst: { label: "Analyst", color: "bg-amber-100 text-amber-800 border-amber-200", icon: Shield },
  officer: { label: "Officer", color: "bg-slate-100 text-slate-700 border-slate-200", icon: Shield },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] || { label: role, color: "bg-slate-100 text-slate-700 border-slate-200", icon: Shield };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({
    fullName: "", username: "", email: "", password: "",
    role: "researcher", department: "",
    permissions: ["data_upload", "risk_assessment", "privacy_enhancement", "utility_measurement", "report_generation"],
  });
  const [loading, setLoading] = useState(false);

  const togglePerm = (key: string) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/users", form);
      toast({ title: "User created", description: `${form.fullName} has been added.` });
      setOpen(false);
      setForm({ fullName: "", username: "", email: "", password: "", role: "researcher", department: "", permissions: ["data_upload", "risk_assessment", "privacy_enhancement", "utility_measurement", "report_generation"] });
      onCreated();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-user"><UserPlus className="h-4 w-4 mr-2" />Create User</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input placeholder="Full name" value={form.fullName} onChange={(e) => setForm(f => ({ ...f, fullName: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input placeholder="username" value={form.username} onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="email@gov.in" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master</SelectItem>
                  <SelectItem value="assistant">Assistant</SelectItem>
                  <SelectItem value="researcher">Researcher</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input placeholder="Department (optional)" value={form.department} onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))} />
            </div>
          </div>

          {form.role !== "researcher" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Section Permissions</Label>
              <div className="grid grid-cols-1 gap-2 p-3 bg-slate-50 rounded-lg border">
                {PERMISSIONS.map((p) => (
                  <div key={p.key} className="flex items-center gap-2">
                    <Checkbox id={p.key} checked={form.permissions.includes(p.key)} onCheckedChange={() => togglePerm(p.key)} />
                    <Label htmlFor={p.key} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Create User
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onUpdated }: { user: any; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({
    fullName: user.fullName || "",
    email: user.email || "",
    role: user.role || "researcher",
    department: user.department || "",
    permissions: user.permissions || [],
    password: "",
  });
  const [loading, setLoading] = useState(false);

  const togglePerm = (key: string) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((p: string) => p !== key) : [...f.permissions, key],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: any = { fullName: form.fullName, email: form.email, role: form.role, department: form.department, permissions: form.permissions };
      if (form.password) payload.password = form.password;
      await apiRequest("PUT", `/api/admin/users/${user.id}`, payload);
      toast({ title: "User updated", description: `${form.fullName} has been updated.` });
      setOpen(false);
      onUpdated();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-user-${user.id}`}><Edit className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit User — {user.username}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={form.fullName} onChange={(e) => setForm(f => ({ ...f, fullName: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master</SelectItem>
                  <SelectItem value="assistant">Assistant</SelectItem>
                  <SelectItem value="researcher">Researcher</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input value={form.department} onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>New Password (leave blank to keep current)</Label>
              <Input type="password" placeholder="New password..." value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
          </div>

          {form.role !== "researcher" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Section Permissions</Label>
              <div className="grid grid-cols-1 gap-2 p-3 bg-slate-50 rounded-lg border">
                {PERMISSIONS.map((p) => (
                  <div key={p.key} className="flex items-center gap-2">
                    <Checkbox id={`edit-${p.key}`} checked={form.permissions.includes(p.key)} onCheckedChange={() => togglePerm(p.key)} />
                    <Label htmlFor={`edit-${p.key}`} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareFileDialog({ onShared }: { onShared: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({ privacyOperationId: "", sharedWithUserId: "", note: "" });
  const [loading, setLoading] = useState(false);

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/admin/users"] });
  const { data: operations = [] } = useQuery<any[]>({ queryKey: ["/api/privacy/operations"] });

  const recipients = (users as any[]).filter((u: any) => u.role === "researcher" || u.role === "assistant");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.privacyOperationId || !form.sharedWithUserId) {
      toast({ title: "Please select both operation and recipient", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/share", form);
      toast({ title: "File shared", description: "Privacy-enhanced file has been shared successfully." });
      setOpen(false);
      setForm({ privacyOperationId: "", sharedWithUserId: "", note: "" });
      onShared();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-share-file"><Share2 className="h-4 w-4 mr-2" />Share File</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Share Privacy-Enhanced File</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Privacy Operation</Label>
            <Select value={form.privacyOperationId} onValueChange={(v) => setForm(f => ({ ...f, privacyOperationId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select operation..." /></SelectTrigger>
              <SelectContent>
                {(operations as any[]).map((op: any) => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.technique} — {new Date(op.createdAt).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Share With</Label>
            <Select value={form.sharedWithUserId} onValueChange={(v) => setForm(f => ({ ...f, sharedWithUserId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select user..." /></SelectTrigger>
              <SelectContent>
                {recipients.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName} ({u.username}) — {u.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recipients.length === 0 && <p className="text-xs text-slate-500">No researchers or assistants found. Create users first.</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea placeholder="Add a note for the recipient..." value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} rows={2} />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
            Share File
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: users = [], refetch: refetchUsers } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: shares = [], refetch: refetchShares } = useQuery<any[]>({
    queryKey: ["/api/admin/shares"],
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      toast({ title: "User deleted" });
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteShareMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/shares/${id}`),
    onSuccess: () => {
      toast({ title: "Share removed" });
      refetchShares();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/shares"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const roleCounts = (users as any[]).reduce((acc: any, u: any) => {
    const r = (u.role === "master" || u.role === "admin") ? "master" : u.role;
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  return (
    <DashboardLayout title="Admin Panel" breadcrumbs={[{ label: "Admin Panel" }]}>
      <div className="space-y-6">
        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-50"><Crown className="h-5 w-5 text-purple-600" /></div>
            <div><p className="text-sm text-slate-500">Masters</p><p className="text-2xl font-bold">{roleCounts.master || 0}</p></div>
          </CardContent></Card>
          <Card><CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50"><UserCheck className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-sm text-slate-500">Assistants</p><p className="text-2xl font-bold">{roleCounts.assistant || 0}</p></div>
          </CardContent></Card>
          <Card><CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50"><FlaskConical className="h-5 w-5 text-green-600" /></div>
            <div><p className="text-sm text-slate-500">Researchers</p><p className="text-2xl font-bold">{roleCounts.researcher || 0}</p></div>
          </CardContent></Card>
          <Card><CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-50"><FileOutput className="h-5 w-5 text-orange-600" /></div>
            <div><p className="text-sm text-slate-500">Shared Files</p><p className="text-2xl font-bold">{(shares as any[]).length}</p></div>
          </CardContent></Card>
        </div>

        <Tabs defaultValue="users">
          <TabsList className="bg-slate-100 p-1 rounded-lg">
            <TabsTrigger value="users" className="data-[state=active]:bg-white">
              <Users className="h-4 w-4 mr-2" />User Management
            </TabsTrigger>
            <TabsTrigger value="sharing" className="data-[state=active]:bg-white">
              <Share2 className="h-4 w-4 mr-2" />File Sharing
            </TabsTrigger>
          </TabsList>

          {/* ── Users tab ── */}
          <TabsContent value="users" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div>
                  <CardTitle>User Accounts</CardTitle>
                  <CardDescription>Create, edit, and manage all system users and their access levels</CardDescription>
                </div>
                <CreateUserDialog onCreated={() => { refetchUsers(); queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }); }} />
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">User</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Department</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Permissions</th>
                        <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(users as any[]).map((u: any) => (
                        <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors" data-testid={`row-user-${u.id}`}>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-slate-900">{u.fullName}</p>
                              <p className="text-xs text-slate-500">@{u.username} · {u.email}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                          <td className="px-4 py-3 text-slate-600">{u.department || "—"}</td>
                          <td className="px-4 py-3">
                            {u.role === "researcher" ? (
                              <span className="text-xs text-slate-400 italic">Shared files only</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {(u.permissions || []).map((p: string) => (
                                  <span key={p} className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{p.replace(/_/g, " ")}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <EditUserDialog user={u} onUpdated={() => { refetchUsers(); queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }); }} />
                              {u.id !== user?.id && (
                                <Button
                                  variant="ghost" size="icon"
                                  data-testid={`button-delete-user-${u.id}`}
                                  disabled={deleteUserMutation.isPending}
                                  onClick={() => { if (confirm(`Delete ${u.fullName}?`)) deleteUserMutation.mutate(u.id); }}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(users as any[]).length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Sharing tab ── */}
          <TabsContent value="sharing" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div>
                  <CardTitle>Shared Privacy-Enhanced Files</CardTitle>
                  <CardDescription>Share anonymized datasets with researchers and assistants</CardDescription>
                </div>
                <ShareFileDialog onShared={() => { refetchShares(); queryClient.invalidateQueries({ queryKey: ["/api/admin/shares"] }); }} />
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Dataset</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Technique</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Shared With</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Note</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Shared On</th>
                        <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(shares as any[]).map((s: any) => (
                        <tr key={s.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors" data-testid={`row-share-${s.id}`}>
                          <td className="px-4 py-3 font-medium text-slate-900">{s.datasetName || "—"}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                              {s.technique || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {s.sharedWithUser ? (
                              <div>
                                <p className="font-medium">{s.sharedWithUser.fullName}</p>
                                <p className="text-xs text-slate-500">@{s.sharedWithUser.username}</p>
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{s.note || <span className="text-slate-400 italic">—</span>}</td>
                          <td className="px-4 py-3 text-slate-500">{s.sharedAt ? new Date(s.sharedAt).toLocaleDateString() : "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost" size="icon"
                              data-testid={`button-unshare-${s.id}`}
                              disabled={deleteShareMutation.isPending}
                              onClick={() => { if (confirm("Remove this share?")) deleteShareMutation.mutate(s.id); }}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {(shares as any[]).length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No shared files yet. Use the Share File button above.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
