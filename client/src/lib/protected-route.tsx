import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";

export function ProtectedRoute({
  path,
  component: Component,
  roles,
}: {
  path: string;
  component: () => React.JSX.Element;
  roles?: string[];
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">Loading SafeData Pipeline...</p>
          </div>
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  // Role check
  if (roles && roles.length > 0) {
    const userRole = user.role;
    const allowed = roles.some((r) => {
      if (r === "master") return userRole === "master" || userRole === "admin";
      return r === userRole;
    });
    if (!allowed) {
      return (
        <Route path={path}>
          <Redirect to={userRole === "researcher" ? "/researcher" : "/"} />
        </Route>
      );
    }
  }

  return <Route path={path} component={Component} />;
}
