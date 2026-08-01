"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";

const NO_SHELL_ROUTES = ["/login"];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (NO_SHELL_ROUTES.includes(pathname)) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
