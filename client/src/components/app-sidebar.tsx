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

const poppins: React.CSSProperties = {
  fontFamily: "'Poppins', sans-serif",
};

function NavIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="h-[22px] w-[22px] object-contain shrink-0"
      style={{ filter: "brightness(0)" }}
    />
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const { open, toggleSidebar } = useSidebar();

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-200 shadow-sm">
      <div className="relative flex flex-col h-full overflow-visible">

        {/* ── Collapse toggle circle – vertically centred on the right edge ── */}
        <button
          onClick={toggleSidebar}
          data-testid="button-sidebar-collapse"
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-50
                     h-7 w-7 rounded-full bg-white border border-slate-200 shadow-md
                     flex items-center justify-center
                     hover:bg-slate-50 transition-colors"
          style={poppins}
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          {open
            ? <ChevronLeft  className="h-3.5 w-3.5 text-slate-700" />
            : <ChevronRight className="h-3.5 w-3.5 text-slate-700" />}
        </button>

        {/* ── Header ── */}
        <SidebarHeader className="border-b border-slate-100 p-4">
          <div className="flex items-center justify-center">
            <img
              src="/airavata-icon.png"
              alt="AIRAVATA"
              className="h-20 w-auto object-contain"
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
              Main Menu
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {mainMenuItems.map((item) => {
                  const active = location === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                        className={[
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                          active
                            ? "bg-blue-50 text-blue-700"
                            : "text-black hover:bg-slate-50",
                        ].join(" ")}
                        style={poppins}
                      >
                        <Link href={item.url}>
                          <NavIcon src={item.icon} alt={item.title} />
                          <span
                            className={[
                              "text-[15px] leading-snug tracking-wide",
                              active ? "font-semibold text-blue-700" : "font-medium text-black",
                            ].join(" ")}
                            style={poppins}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel
              className="text-xs font-semibold tracking-widest uppercase text-slate-400 px-3 pt-3 pb-1"
              style={poppins}
            >
              Settings
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {settingsMenuItems.map((item) => {
                  const active = location === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                        className={[
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                          active
                            ? "bg-blue-50 text-blue-700"
                            : "text-black hover:bg-slate-50",
                        ].join(" ")}
                        style={poppins}
                      >
                        <Link href={item.url}>
                          <NavIcon src={item.icon} alt={item.title} />
                          <span
                            className={[
                              "text-[15px] leading-snug tracking-wide",
                              active ? "font-semibold text-blue-700" : "font-medium text-black",
                            ].join(" ")}
                            style={poppins}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* ── Footer ── */}
        <SidebarFooter className="border-t border-slate-100 p-4" style={poppins}>
          <div className="flex flex-col gap-4">
            <div className="flex justify-center">
              <img
                src="/mospi-footer-logo.png"
                alt="Ministry of Statistics"
                className="w-full h-auto object-contain"
              />
            </div>
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-blue-50 text-blue-700 text-sm font-semibold" style={poppins}>
                  {user ? getInitials(user.fullName) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-semibold text-black truncate" style={poppins}>
                  {user?.fullName || "User"}
                </span>
                <span className="text-xs text-slate-500 truncate" style={poppins}>
                  Admin
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
            </div>
          </div>
        </SidebarFooter>

      </div>
    </Sidebar>
  );
}
