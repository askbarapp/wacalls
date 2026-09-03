"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, KeyRound, UserRound } from "lucide-react";
import { api, apiOrigin, apiUpload, getAccessToken } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type Tab = "profile" | "password" | "workspace";

type Account = {
  user: {
    email: string;
    name?: string;
    phone?: string;
    hasAvatar?: boolean;
    role: string;
    superAdmin?: boolean;
  };
  organization: {
    name: string;
    slug: string;
    status: string;
    billingEmail?: string | null;
    plan?: {
      name: string;
      maxChannels: number;
      maxAgents: number;
      maxKnowledgeBases?: number;
      maxAiAgents?: number;
      maxMessagesPerDay: number;
      maxCallsPerDay: number;
      allowCloudApi: boolean;
      allowSdk: boolean;
    } | null;
    _count?: { users: number; channels: number; calls: number; messages: number };
  } | null;
};

const TABS: Array<{ id: Tab; label: string; icon: typeof UserRound }> = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "password", label: "Password", icon: KeyRound },
  { id: "workspace", label: "Workspace", icon: Building2 },
];

export default function SettingsPage() {
  const avatarInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [account, setAccount] = useState<Account | null>(null);
  const [orgName, setOrgName] = useState("");
  const [profile, setProfile] = useState({ name: "", phone: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadAccount() {
    const r = await api<{ success: true; data: Account }>("/api/v1/account");
    setAccount(r.data);
    setOrgName(r.data.organization?.name ?? "");
    setProfile({ name: r.data.user.name ?? "", phone: r.data.user.phone ?? "" });
    return r.data;
  }

  useEffect(() => {
    void loadAccount().catch((err) => setError(err instanceof Error ? err.message : "Could not load account"));
  }, []);

  useEffect(() => {
    if (!account?.user.hasAvatar) {
      setAvatarUrl(null);
      return;
    }
    const token = getAccessToken();
    let objectUrl = "";
    fetch(`${apiOrigin()}/api/v1/account/avatar`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: "include",
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [account?.user.hasAvatar, account?.user.email]);

  function flash(ok: string) {
    setError("");
    setMsg(ok);
  }

  async function saveProfile() {
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/account/profile", {
        method: "PATCH",
        body: JSON.stringify(profile),
      });
      await loadAccount();
      flash("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      await apiUpload("/api/v1/account/avatar", data);
      await loadAccount();
      flash("Profile photo updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    setError("");
    if (next.length < 10) {
      setError("New password must be at least 10 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current, next }),
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      flash("Password updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  const plan = account?.organization?.plan;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Profile" subtitle="Your name, password, and workspace details. Plan and branding are managed by the super admin." />
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setMsg("");
                setError("");
              }}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition ${
                tab === t.id
                  ? "bg-brand-500 text-ink-950 shadow-glow"
                  : "bg-white/10 text-slate-200 hover:bg-white/15"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="mb-4 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
          {msg}
        </div>
      ) : null}

      {tab === "profile" ? (
        <section className="surface p-5">
          <div className="mb-5 flex items-center gap-3">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-lg font-medium text-white">
                {(profile.name || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <input
                ref={avatarInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadAvatar(file);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => avatarInput.current?.click()}
                  className="min-h-10 rounded-lg bg-brand-500 px-3 text-sm font-medium text-ink-950"
                >
                  Upload photo
                </button>
                {account?.user.hasAvatar ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/v1/account/avatar", { method: "DELETE" });
                        await loadAccount();
                        flash("Photo removed.");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not remove photo");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="min-h-10 rounded-lg bg-white/10 px-3 text-sm"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <label className="mb-3 block text-sm text-slate-300">
            Full name
            <input
              className="mt-1 min-h-11"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </label>
          <label className="mb-3 block text-sm text-slate-300">
            Email
            <input className="mt-1 min-h-11" value={account?.user.email ?? ""} disabled />
          </label>
          <label className="mb-4 block text-sm text-slate-300">
            Phone
            <input
              className="mt-1 min-h-11"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveProfile()}
            className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950"
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
        </section>
      ) : null}

      {tab === "password" ? (
        <section className="surface p-5">
          <label className="mb-3 block text-sm text-slate-300">
            Current password
            <input
              className="mt-1 min-h-11"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="mb-3 block text-sm text-slate-300">
            New password
            <input
              className="mt-1 min-h-11"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={10}
              placeholder="At least 10 characters"
            />
          </label>
          <label className="mb-4 block text-sm text-slate-300">
            Confirm new password
            <input
              className="mt-1 min-h-11"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void savePassword()}
            className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950"
          >
            {busy ? "Updating…" : "Update password"}
          </button>
        </section>
      ) : null}

      {tab === "workspace" ? (
        <div className="space-y-4">
          <section className="surface p-5">
            <h2 className="mb-4 font-medium">Workspace</h2>
            <input className="mb-4 min-h-11" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Workspace name" />
            <button
              type="button"
              className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/api/v1/account/organization", {
                    method: "PATCH",
                    body: JSON.stringify({ name: orgName }),
                  });
                  await loadAccount();
                  flash("Workspace updated.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not update workspace");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save workspace
            </button>
            {account?.organization ? (
              <p className="mt-3 text-xs text-slate-500">
                Status {account.organization.status} · slug {account.organization.slug}
              </p>
            ) : null}
          </section>
          <section className="surface p-5 text-sm text-slate-300">
            <h2 className="mb-2 font-medium text-white">Plan</h2>
            <p className="mb-2 text-xs text-slate-500">Assigned by the super admin. You can use the limits below.</p>
            {plan ? (
              <ul className="space-y-1 text-slate-400">
                <li className="text-white">{plan.name}</li>
                <li>{plan.maxChannels} WhatsApp channels</li>
                <li>{plan.maxAgents} team members</li>
                <li>{plan.maxKnowledgeBases ?? 1} knowledge bases</li>
                <li>{plan.maxAiAgents ?? 1} AI calling agents</li>
                <li>{plan.maxCallsPerDay} calls / day</li>
                <li>{plan.maxMessagesPerDay} messages / day</li>
                <li>Cloud API: {plan.allowCloudApi ? "yes" : "no"}</li>
                <li>Calling SDK: {plan.allowSdk ? "yes" : "no"}</li>
              </ul>
            ) : (
              <p className="text-slate-500">No plan assigned yet. Ask the super admin to attach one.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
