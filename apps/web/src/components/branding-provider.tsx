"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Phone } from "lucide-react";
import { apiOrigin, brandingAssetUrl } from "@/lib/api";

export type PublicBranding = {
  brandName: string;
  tagline: string;
  supportEmail: string;
  supportPhone: string;
  website: string;
  companyAddress: string;
  copyright: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  updatedAt: string | null;
};

const FALLBACK: PublicBranding = {
  brandName: "WaCalls",
  tagline: "WhatsApp calling, messaging, and sequential dialer",
  supportEmail: "",
  supportPhone: "",
  website: "",
  companyAddress: "",
  copyright: "",
  hasLogo: false,
  hasFavicon: false,
  updatedAt: null,
};

type BrandingCtx = {
  branding: PublicBranding;
  logoUrl: string | null;
  faviconUrl: string | null;
  reload: () => Promise<void>;
};

const Ctx = createContext<BrandingCtx>({
  branding: FALLBACK,
  logoUrl: null,
  faviconUrl: null,
  reload: async () => undefined,
});

export function useBranding() {
  return useContext(Ctx);
}

export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  const { branding, logoUrl } = useBranding();
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={branding.brandName}
        width={size}
        height={size}
        className={`rounded-xl object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-brand-500 text-ink-950 shadow-lg shadow-brand-500/20 ${className}`}
      style={{ width: size, height: size }}
    >
      <Phone style={{ width: size * 0.45, height: size * 0.45 }} />
    </div>
  );
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PublicBranding>(FALLBACK);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${apiOrigin()}/api/v1/public/branding`, { credentials: "include" });
      const json = (await res.json()) as { success?: boolean; data?: PublicBranding };
      if (res.ok && json.data) setBranding({ ...FALLBACK, ...json.data });
    } catch {
      /* keep fallback */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logoUrl = branding.hasLogo ? brandingAssetUrl("logo", branding.updatedAt) : null;
  const faviconUrl = branding.hasFavicon ? brandingAssetUrl("favicon", branding.updatedAt) : null;

  useEffect(() => {
    document.title = branding.tagline ? `${branding.brandName} — ${branding.tagline}` : branding.brandName;
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!faviconUrl) {
      if (link) link.remove();
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [branding.brandName, branding.tagline, faviconUrl]);

  const value = useMemo(
    () => ({ branding, logoUrl, faviconUrl, reload }),
    [branding, logoUrl, faviconUrl, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
