import React, { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

import mospiLogo from "@assets/mospi_logo.svg";
import moeLogo from "@assets/moe_logo.png";
import statathonLogo from "@assets/statathon_logo.png";
import innovationCellLogo from "@assets/innovation_cell_logo.png";

interface DashboardLayoutProps {
  children: ReactNode;
  title: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export function DashboardLayout({ children, title, breadcrumbs = [] }: DashboardLayoutProps) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1">
          <header className="sticky top-0 z-50 flex h-20 items-center gap-4 border-b bg-background px-6">
            <div className="flex items-center gap-4 flex-1">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <Separator orientation="vertical" className="h-8" />
              
              <div className="flex items-center gap-6 overflow-hidden">
                {/* Section 1: MoSPI */}
                <div className="flex items-center gap-3 border-r pr-6 shrink-0">
                  <img src={mospiLogo} alt="MoSPI Logo" className="h-10 w-auto" />
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold leading-tight uppercase text-muted-foreground">Ministry of Statistics and</span>
                    <span className="text-[11px] font-bold leading-tight uppercase text-muted-foreground">Programme Implementation</span>
                  </div>
                </div>

                {/* Section 2: MoE & Innovation Cell */}
                <div className="flex items-center gap-4 border-r pr-6 shrink-0">
                  <div className="flex items-center gap-3">
                    <img src={moeLogo} alt="MoE Logo" className="h-10 w-auto" />
                    <span className="text-[11px] font-bold leading-tight uppercase text-muted-foreground">Ministry of<br/>Education</span>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <img src={innovationCellLogo} alt="Innovation Cell" className="h-10 w-auto" />
                </div>

                {/* Section 3: Statathon */}
                <div className="flex items-center gap-2 shrink-0">
                  <img src={statathonLogo} alt="Statathon Logo" className="h-10 w-auto" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" data-testid="button-notifications">
                <Bell className="h-5 w-5" />
                <span className="sr-only">Notifications</span>
              </Button>
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6">
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-2xl font-bold" data-testid={`heading-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                {title}
              </h1>
              
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/">Home</BreadcrumbLink>
                  </BreadcrumbItem>
                  {breadcrumbs.length > 0 && <BreadcrumbSeparator />}
                  {breadcrumbs.map((crumb, index) => [
                    index > 0 ? <BreadcrumbSeparator key={`sep-${index}`} /> : null,
                    <BreadcrumbItem key={`item-${index}`}>
                      {crumb.href ? (
                        <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  ]).flat()}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            {children}
          </main>

          <footer className="border-t bg-muted/30 px-6 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Government of India - Ministry of Electronics and Information Technology</span>
              <span>Developed by AIRAVATA Technologies</span>
            </div>
          </footer>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
