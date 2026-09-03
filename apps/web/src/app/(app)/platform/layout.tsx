"use client";

import { SuperAdminGuard } from "@/components/super-admin-guard";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminGuard>{children}</SuperAdminGuard>;
}
