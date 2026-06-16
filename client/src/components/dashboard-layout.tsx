import React, { ReactNode } from "react";
import { SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface DashboardLayoutProps {
  children: ReactNode;
  title: string;
  breadcrumbs?: { label: string; href?: string }[];
  fullHeight?: boolean;
}

export function DashboardLayout({ children, title, breadcrumbs = [], fullHeight = false }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar />
      <SidebarInset className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* ── Fixed header: title + breadcrumb — never scrolls ── */}
        <div className="px-8 pt-8 pb-0 shrink-0 flex items-start justify-between mb-8" style={{ fontFamily: "'Poppins', sans-serif" }}>
          <div>
            <h1
              className="text-3xl font-semibold text-slate-900 dark:text-white tracking-tight"
              data-testid={`heading-${title.toLowerCase().replace(/\s+/g, "-")}`}
              style={{ fontFamily: "'Poppins', sans-serif" }}
            >
              {title}
            </h1>
          </div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
              {breadcrumbs.length > 0 && <BreadcrumbSeparator />}
              {breadcrumbs.map((crumb, index) => [
                index > 0 ? <BreadcrumbSeparator key={`sep-${index}`} /> : null,
                <BreadcrumbItem key={`item-${index}`}>
                  {crumb.href
                    ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                    : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
                </BreadcrumbItem>,
              ]).flat()}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {/* ── Content area ── */}
        {fullHeight ? (
          /* fullHeight mode: content fills remaining space, NO outer scroll — children manage their own scroll */
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-8 pb-8 min-w-0" style={{ fontFamily: "'Poppins', sans-serif" }}>
            {children}
          </div>
        ) : (
          /* normal mode: content area scrolls vertically, horizontal overflow hidden */
          <main className="flex-1 overflow-y-auto overflow-x-hidden px-8 pb-8 min-w-0" style={{ fontFamily: "'Poppins', sans-serif" }}>
            {children}
          </main>
        )}

        <footer className="border-t bg-slate-50 dark:bg-slate-900 px-8 py-3 shrink-0">
          <div className="flex items-center justify-between text-xs text-slate-400" style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span>Government of India — Ministry of Electronics and Information Technology</span>
            <span>Developed by AIRAVATA Technologies</span>
          </div>
        </footer>
      </SidebarInset>
    </div>
  );
}
