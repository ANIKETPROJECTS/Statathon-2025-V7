import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

import dashboardIcon  from "@assets/dashboard.png";
import folderIcon     from "@assets/folder.png";
import cautionIcon    from "@assets/warning.png";
import securityIcon   from "@assets/security.png";
import graphIcon      from "@assets/graph.png";
import statisticsIcon from "@assets/statistics.png";
import settingIcon    from "@assets/setting.png";
import userIcon       from "@assets/user-icon.png";
import helpIcon       from "@assets/help.png";

const mainMenuItems = [
  { title: "Dashboard",           url: "/",        icon: dashboardIcon  },
  { title: "Data Upload",         url: "/upload",  icon: folderIcon     },
  { title: "Risk Assessment",     url: "/risk",    icon: cautionIcon    },
  { title: "Privacy Enhancement", url: "/privacy", icon: securityIcon   },
  { title: "Utility Measurement", url: "/utility", icon: graphIcon      },
  { title: "Reports",             url: "/reports", icon: statisticsIcon },
];

const settingsMenuItems = [
  { title: "Configuration", url: "/config",  icon: settingIcon },
  { title: "User Profile",  url: "/profile", icon: userIcon    },
  { title: "Help & Docs",   url: "/help",    icon: helpIcon    },
];

const researcherMenuItems = [
  { title: "Research Files", url: "/researcher", icon: securityIcon },
];

const poppins: React.CSSProperties = {
  fontFamily: "'Poppins', sans-serif",
};

const ROLE_LABELS: Record<string, string> = {
  master: "Master Admin",
  admin: "Master Admin",
  assistant: "Assistant",
  researcher: "Researcher",
  analyst: "Data Analyst",
  officer: "Privacy Officer",
};

function NavIcon({ src, alt, collapsed }: { src: string; alt: string; collapsed?: boolean }) {
  return (
    <img
      src={src}
      alt={alt}
      className={collapsed ? "h-9 w-9 object-contain shrink-0" : "h-[26px] w-[26px] object-contain shrink-0"}
      style={{ filter: "brightness(0)" }}
    />
  );
}

function NavItem({ item, active, collapsed }: { item: { title: string; url: string; icon: string }; active: boolean; collapsed: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
        className={[
          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
          active ? "bg-blue-50 text-blue-700" : "text-black hover:bg-slate-50",
        ].join(" ")}
        style={poppins}
      >
        <Link href={item.url}>
          <NavIcon src={item.icon} alt={item.title} collapsed={collapsed} />
          <span
            className={["text-[16px] leading-snug tracking-wide", active ? "font-semibold text-blue-700" : "font-medium text-black"].join(" ")}
            style={poppins}
          >
            {item.title}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const { open, toggleSidebar, state } = useSidebar();
  const collapsed = state === "collapsed";

  const role = user?.role || "analyst";
  const isMaster = role === "master" || role === "admin";
  const isResearcher = role === "researcher";

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  // Determine which nav items to show based on role
  const visibleMainItems = isResearcher
    ? researcherMenuItems
    : mainMenuItems.filter((item) => {
        if (isMaster) return true;
        const permMap: Record<string, string> = {
          "/upload":  "data_upload",
          "/risk":    "risk_assessment",
          "/privacy": "privacy_enhancement",
          "/utility": "utility_measurement",
          "/reports": "report_generation",
        };
        const perm = permMap[item.url];
        if (!perm) return true; // Dashboard always visible
        return (user?.permissions || []).includes(perm);
      });

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-200 shadow-sm">
      <div className="relative flex flex-col h-full overflow-visible">

        {/* ── Toggle ── */}
        <button
          onClick={toggleSidebar}
          data-testid="button-sidebar-collapse"
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-50
                     h-5 w-5 rounded-full bg-white border border-slate-200 shadow-md
                     flex items-center justify-center
                     hover:bg-slate-50 transition-colors"
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          {open
            ? <ChevronLeft  className="h-2.5 w-2.5 text-slate-700" />
            : <ChevronRight className="h-2.5 w-2.5 text-slate-700" />}
        </button>

        {/* ── Header ── */}
        <SidebarHeader className="relative border-b border-slate-100 overflow-visible"
          style={{ padding: collapsed ? "12px 8px" : "12px 16px" }}
        >
          <div className="flex items-center justify-center">
            <img
              src="/airavata-icon.png"
              alt="AIRAVATA"
              className="object-contain transition-all duration-200"
              style={{ height: collapsed ? "44px" : "72px", width: "auto", maxWidth: "100%" }}
            />
          </div>
        </SidebarHeader>

        {/* ── Navigation ── */}
        <SidebarContent style={poppins}>
          <SidebarGroup>
            <SidebarGroupLabel
              className="text-xs font-semibold tracking-widest uppercase text-slate-400 px-3 pt-3 pb-1"
              style={poppins}
            >
              {isResearcher ? "Research" : "Main Menu"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleMainItems.map((item) => (
                  <NavItem key={item.title} item={item} active={location === item.url} collapsed={collapsed} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Settings section — only for non-researcher or researcher with limited items */}
          <SidebarGroup>
            <SidebarGroupLabel
              className="text-xs font-semibold tracking-widest uppercase text-slate-400 px-3 pt-3 pb-1"
              style={poppins}
            >
              Settings
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Admin Panel — Masters only */}
                {isMaster && (
                  <NavItem
                    item={{ title: "Admin Panel", url: "/admin", icon: userIcon }}
                    active={location === "/admin"}
                    collapsed={collapsed}
                  />
                )}
                {settingsMenuItems
                  .filter((item) => {
                    // Researchers only see Profile and Help
                    if (isResearcher && item.url === "/config") return false;
                    return true;
                  })
                  .map((item) => (
                    <NavItem key={item.title} item={item} active={location === item.url} collapsed={collapsed} />
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* ── Footer ── */}
        <SidebarFooter className="border-t border-slate-100 p-4" style={poppins}>
          <div className="flex flex-col gap-4">
            {!collapsed && (
              <div className="flex justify-center">
                <img
                  src="/mospi-footer-logo.png"
                  alt="Ministry of Statistics"
                  className="w-full h-auto object-contain"
                />
              </div>
            )}
            <div className={collapsed ? "flex justify-center" : "flex items-center gap-3"}>
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-blue-50 text-blue-700 text-sm font-semibold" style={poppins}>
                  {user ? getInitials(user.fullName) : "U"}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-semibold text-black truncate" style={poppins}>
                      {user?.fullName || "User"}
                    </span>
                    <span className="text-xs text-slate-500 truncate" style={poppins}>
                      {ROLE_LABELS[role] || role}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    data-testid="button-logout"
                    className="shrink-0"
                  >
                    <LogOut className="h-4 w-4 text-slate-500" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </SidebarFooter>

      </div>
    </Sidebar>
  );
}
