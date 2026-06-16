import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import HomePage from "@/pages/home-page";
import UploadPage from "@/pages/upload-page";
import RiskPage from "@/pages/risk-page";
import PrivacyPage from "@/pages/privacy-page";
import UtilityPage from "@/pages/utility-page";
import ReportsPage from "@/pages/reports-page";
import ConfigPage from "@/pages/config-page";
import ProfilePage from "@/pages/profile-page";
import HelpPage from "@/pages/help-page";
import PrivacyResultsPage from "@/pages/privacy-results-page";
import AdminPage from "@/pages/admin-page";
import ResearcherDashboard from "@/pages/researcher-dashboard";

function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect to="/auth" />;
  if (user.role === "researcher") return <Redirect to="/researcher" />;
  return <HomePage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <ProtectedRoute path="/upload"           component={UploadPage}          />
      <ProtectedRoute path="/risk"             component={RiskPage}            />
      <ProtectedRoute path="/privacy"          component={PrivacyPage}         />
      <ProtectedRoute path="/privacy-results"  component={PrivacyResultsPage}  />
      <ProtectedRoute path="/utility"          component={UtilityPage}         />
      <ProtectedRoute path="/reports"          component={ReportsPage}         />
      <ProtectedRoute path="/config"           component={ConfigPage}          />
      <ProtectedRoute path="/profile"          component={ProfilePage}         />
      <ProtectedRoute path="/help"             component={HelpPage}            />
      <ProtectedRoute path="/admin"            component={AdminPage}           roles={["master"]} />
      <ProtectedRoute path="/researcher"       component={ResearcherDashboard} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3.5rem",
} as React.CSSProperties;

function getInitialSidebarOpen(): boolean {
  const match = document.cookie.match(/sidebar_state=([^;]+)/);
  if (match) return match[1] === "true";
  return true;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <SidebarProvider defaultOpen={getInitialSidebarOpen()} style={sidebarStyle}>
              <Router />
              <Toaster />
            </SidebarProvider>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
