"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";

export function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api<{ success: true; data: Me }>("/api/v1/auth/me")
      .then((r) => {
        if (!r.data.superAdmin) {
          router.replace("/");
          return;
        }
        setOk(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!ok) {
    return <p className="text-sm text-slate-500">Checking super admin access…</p>;
  }
  return <>{children}</>;
}
