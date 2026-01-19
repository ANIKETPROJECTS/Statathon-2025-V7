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

import moeLogo from "@assets/moe_logo.png";
import statathonLogo from "@assets/Screenshot_2026-01-19_at_9.37.15_AM_1768795639830.png";
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
          <header className="sticky top-0 z-50 flex h-24 items-center gap-4 border-b bg-white dark:bg-slate-900 px-6">
            <div className="flex items-center gap-4 flex-1 h-full py-2 overflow-visible">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <Separator orientation="vertical" className="h-10" />
              
              <div className="flex items-center gap-8 h-full overflow-visible">
                <div className="flex items-center gap-3 border-r border-slate-200 dark:border-slate-800 pr-8 h-full overflow-visible">
                  <img src="/attached_assets/Government_of_India_logo.svg" alt="Government of India" className="h-14 w-auto object-contain" />
                </div>

                <div className="flex items-center gap-6 border-r border-slate-200 dark:border-slate-800 pr-8 h-full overflow-visible">
                  <div className="flex items-center gap-3">
                    <img src="/attached_assets/Ministry_of_Education_India.svg" alt="Ministry of Education" className="h-14 w-auto object-contain" />
                  </div>
                  <div className="h-10 w-px bg-slate-200 dark:bg-slate-800" />
                  <img src={innovationCellLogo} alt="Innovation Cell" className="h-14 w-auto object-contain min-w-[100px]" />
                </div>

                <div className="flex items-center gap-2 h-full overflow-visible">
                  <img src={statathonLogo} alt="Statathon Logo" className="h-14 w-auto object-contain min-w-[120px]" />
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
              <h1 className="text-2xl font-bold" data-testid={`heading-${title.toLowerCase().replace(/\s+/g, "-")}`}>{title}</h1>
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
                  {breadcrumbs.length > 0 && <BreadcrumbSeparator />}
                  {breadcrumbs.map((crumb, index) => [
                    index > 0 ? <BreadcrumbSeparator key={`sep-${index}`} /> : null,
                    <BreadcrumbItem key={`item-${index}`}>
                      {crumb.href ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
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
