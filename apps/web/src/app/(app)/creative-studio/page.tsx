"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Palette,
  Image as ImageIcon,
  Lock,
  Send,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sliders,
  History,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

interface BusinessProfile {
  id?: string;
  businessName: string;
  businessCategory?: string | null;
  brandColors?: string | null;
  brandStyle?: string | null;
  tagline?: string | null;
  products: string[];
  services: string[];
  defaultOffer?: string | null;
  phone?: string | null;
  language?: string;
}

interface CreativeVersion {
  id: string;
  version: number;
  prompt: string;
  imageUrl?: string | null;
  status: string;
  creditsUsed: number;
  createdAt: string;
}

interface CreativeAsset {
  id: string;
  title: string;
  concept?: string | null;
  status: string;
  locked: boolean;
  createdAt: string;
  versions: CreativeVersion[];
}

interface CreditBalance {
  balance: number;
  used: number;
  monthlyLimit: number;
}

export default function CreativeStudioPage() {
  const [activeTab, setActiveTab] = useState<"gallery" | "profile">("gallery");

  // Data states
  const [creatives, setCreatives] = useState<CreativeAsset[]>([]);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [profile, setProfile] = useState<BusinessProfile>({
    businessName: "",
    businessCategory: "",
    brandColors: "",
    brandStyle: "modern, premium, clean",
    tagline: "",
    products: [],
    services: [],
    defaultOffer: "",
    language: "Hindi + English",
  });

  // Modal / Form states
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    userInstruction: "",
    festivalName: "",
    creativeType: "poster" as "poster" | "banner" | "status",
    aspect: "1:1" as "1:1" | "9:16" | "16:9",
  });
  const [selectedAsset, setSelectedAsset] = useState<CreativeAsset | null>(null);
  const [editInstruction, setEditInstruction] = useState("");

  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const [creativesRes, profileRes, creditsRes] = await Promise.all([
        api<{ success: true; data: CreativeAsset[] }>("/api/v1/creative"),
        api<{ success: true; data: BusinessProfile | null }>("/api/v1/creative/profile"),
        api<{ success: true; data: CreditBalance }>("/api/v1/creative/credits"),
      ]);

      setCreatives(creativesRes.data || []);
      if (profileRes.data) {
        setProfile({
          ...profileRes.data,
          products: profileRes.data.products || [],
          services: profileRes.data.services || [],
        });
      }
      setCredits(creditsRes.data);
    } catch (err: any) {
      setError(err?.message || "Failed to load creative studio data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleSaveProfile() {
    setActionBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await api<{ success: true; data: BusinessProfile }>("/api/v1/creative/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      setProfile(res.data);
      setMsg("Business Profile saved successfully! Future posters will use these brand guidelines.");
    } catch (err: any) {
      setError(err?.message || "Failed to save profile");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleGenerateCreative() {
    if (!generateForm.userInstruction.trim()) return;
    setActionBusy(true);
    setError("");
    setMsg("");
    try {
      await api("/api/v1/creative/generate", {
        method: "POST",
        body: JSON.stringify(generateForm),
      });
      setIsGenerateOpen(false);
      setGenerateForm({
        userInstruction: "",
        festivalName: "",
        creativeType: "poster",
        aspect: "1:1",
      });
      setMsg("Poster generation started! It takes ~1 minute to render.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Generation request failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSmartEdit(assetId: string) {
    if (!editInstruction.trim()) return;
    setActionBusy(true);
    setError("");
    try {
      await api("/api/v1/creative/edit", {
        method: "POST",
        body: JSON.stringify({ assetId, editInstruction }),
      });
      setEditInstruction("");
      setMsg("Revision request submitted! Generating updated version...");
      await loadData();
      // Update selected asset view
      const updated = creatives.find((c) => c.id === assetId);
      if (updated) setSelectedAsset(updated);
    } catch (err: any) {
      setError(err?.message || "Edit request failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleFinalize(assetId: string) {
    setActionBusy(true);
    setError("");
    try {
      await api(`/api/v1/creative/${assetId}/finalize`, { method: "POST" });
      setMsg("Creative finalized and locked! Ready for campaign distribution.");
      await loadData();
      if (selectedAsset?.id === assetId) {
        setSelectedAsset((prev) => (prev ? { ...prev, status: "FINAL", locked: true } : null));
      }
    } catch (err: any) {
      setError(err?.message || "Finalize failed");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <PageHeader
          title="AI Creative Studio"
          subtitle="Generate high-converting business posters, festival creatives, and smart revisions directly on WhatsApp or Web."
        />

        <div className="flex items-center gap-3">
          {credits && (
            <div className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3.5 py-1.5 text-xs text-violet-300">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <span>Credits: <strong>{credits.balance}</strong> left</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsGenerateOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" />
            Create Poster
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {msg}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex border-b border-white/10 text-sm">
        <button
          type="button"
          onClick={() => setActiveTab("gallery")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 font-medium transition-colors ${
            activeTab === "gallery"
              ? "border-violet-500 text-violet-300"
              : "border-transparent text-white/60 hover:text-white"
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          Creatives & Posters ({creatives.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 font-medium transition-colors ${
            activeTab === "profile"
              ? "border-violet-500 text-violet-300"
              : "border-transparent text-white/60 hover:text-white"
          }`}
        >
          <Palette className="h-4 w-4" />
          Business Brand Profile
        </button>
      </div>

      {/* Tab 1: Gallery */}
      {activeTab === "gallery" && (
        <div>
          {loading ? (
            <div className="flex h-64 items-center justify-center text-white/50">
              <RefreshCw className="h-6 w-6 animate-spin" />
            </div>
          ) : creatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <Sparkles className="mb-3 h-10 w-10 text-violet-400/60" />
              <h3 className="text-base font-semibold text-white">No creatives generated yet</h3>
              <p className="mt-1 max-w-sm text-xs text-white/50">
                Type &quot;Diwali ka poster bana do&quot; on WhatsApp, or click &quot;Create Poster&quot; above to generate your first AI business creative!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {creatives.map((asset) => {
                const latestVersion = asset.versions[0];
                return (
                  <div
                    key={asset.id}
                    onClick={() => setSelectedAsset(asset)}
                    className="group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg transition-all hover:border-violet-500/50 hover:bg-white/[0.07]"
                  >
                    <div className="relative aspect-square w-full overflow-hidden bg-black/40">
                      {latestVersion?.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={latestVersion.imageUrl}
                          alt={asset.title}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center text-white/40">
                          <RefreshCw className="h-8 w-8 animate-spin text-violet-400" />
                          <span className="mt-2 text-xs">Rendering in 3D...</span>
                        </div>
                      )}

                      {/* Status Badges */}
                      <div className="absolute left-3 top-3 flex items-center gap-1.5">
                        {asset.locked ? (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/90 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                            <Lock className="h-3 w-3" /> Final
                          </span>
                        ) : asset.status === "GENERATING" ? (
                          <span className="flex items-center gap-1 rounded-full bg-amber-500/90 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                            <Clock className="h-3 w-3 animate-pulse" /> Generating
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded-full bg-blue-500/90 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                            <Sliders className="h-3 w-3" /> v{latestVersion?.version || 1}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-4">
                      <h4 className="line-clamp-1 text-sm font-semibold text-white group-hover:text-violet-300">
                        {asset.title}
                      </h4>
                      {asset.concept && (
                        <p className="mt-1 line-clamp-2 text-xs text-white/60">
                          {asset.concept}
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-between text-[11px] text-white/40">
                        <span>{new Date(asset.createdAt).toLocaleDateString("en-IN")}</span>
                        <span>{asset.versions.length} versions</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Brand Profile */}
      {activeTab === "profile" && (
        <section className="surface rounded-2xl border border-white/10 p-6 shadow-xl space-y-5">
          <div className="border-b border-white/10 pb-4">
            <h3 className="text-base font-semibold text-white">Business Brand Profile</h3>
            <p className="text-xs text-white/60">
              The AI creative engine strictly references these products and details. It will never invent fictional offers or discounts.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Business Name</label>
              <input
                type="text"
                value={profile.businessName}
                onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
                placeholder="e.g. Royal Sweets & Bakers"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Category / Industry</label>
              <input
                type="text"
                value={profile.businessCategory || ""}
                onChange={(e) => setProfile({ ...profile, businessCategory: e.target.value })}
                placeholder="e.g. Bakery & Sweets, Real Estate, Jewellery"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Brand Colors</label>
              <input
                type="text"
                value={profile.brandColors || ""}
                onChange={(e) => setProfile({ ...profile, brandColors: e.target.value })}
                placeholder="e.g. Royal Gold and Crimson Red, #D4AF37"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Tagline / Slogan</label>
              <input
                type="text"
                value={profile.tagline || ""}
                onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
                placeholder="e.g. Pure Taste, Pure Tradition"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-white/80">
              Key Products / Offerings (comma separated)
            </label>
            <input
              type="text"
              value={profile.products.join(", ")}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  products: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              placeholder="e.g. Kaju Katli, Motichoor Ladoo, Dry Fruit Hampers, Rasgulla"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-white/80">
              Permanent Offer or Notice (Optional)
            </label>
            <input
              type="text"
              value={profile.defaultOffer || ""}
              onChange={(e) => setProfile({ ...profile, defaultOffer: e.target.value })}
              placeholder="e.g. Free Delivery across City | Pre-order now for festival gift packs"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end pt-3">
            <button
              type="button"
              disabled={actionBusy}
              onClick={handleSaveProfile}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {actionBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              Save Brand Profile
            </button>
          </div>
        </section>
      )}

      {/* Generate Modal */}
      {isGenerateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-400" />
                <h3 className="text-base font-semibold text-white">Create New Business Creative</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsGenerateOpen(false)}
                className="text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/80">
                  Festival / Occasion (Optional)
                </label>
                <select
                  value={generateForm.festivalName}
                  onChange={(e) => setGenerateForm({ ...generateForm, festivalName: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                >
                  <option value="">None / General Marketing</option>
                  <option value="Diwali">Diwali / Deepavali</option>
                  <option value="Holi">Holi Festival of Colors</option>
                  <option value="Eid">Eid Mubarak</option>
                  <option value="Navratri">Navratri / Durga Puja</option>
                  <option value="New Year">Happy New Year</option>
                  <option value="Independence Day">Independence Day</option>
                  <option value="Raksha Bandhan">Raksha Bandhan</option>
                  <option value="Christmas">Christmas</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-white/80">
                  Poster Concept / Instructions
                </label>
                <textarea
                  rows={3}
                  value={generateForm.userInstruction}
                  onChange={(e) => setGenerateForm({ ...generateForm, userInstruction: e.target.value })}
                  placeholder="e.g. Diwali festive poster with glowing diya lamps, showcasing premium gift hampers and elegant packaging..."
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-white/80">Format</label>
                  <select
                    value={generateForm.creativeType}
                    onChange={(e) =>
                      setGenerateForm({
                        ...generateForm,
                        creativeType: e.target.value as any,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="poster">Poster</option>
                    <option value="banner">Banner</option>
                    <option value="status">Status Story</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-white/80">Aspect Ratio</label>
                  <select
                    value={generateForm.aspect}
                    onChange={(e) =>
                      setGenerateForm({
                        ...generateForm,
                        aspect: e.target.value as any,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="1:1">1:1 Square (WhatsApp Feed)</option>
                    <option value="9:16">9:16 Vertical (Status/Story)</option>
                    <option value="16:9">16:9 Banner (Horizontal)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsGenerateOpen(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionBusy || !generateForm.userInstruction.trim()}
                  onClick={handleGenerateCreative}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {actionBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  Generate (5 Credits)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View / Smart Edit Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-semibold text-white">{selectedAsset.title}</h3>
                <p className="text-xs text-white/60">{selectedAsset.concept}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAsset(null)}
                className="text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Image Preview */}
              <div className="flex flex-col items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/50 p-2">
                {selectedAsset.versions[0]?.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={selectedAsset.versions[0].imageUrl}
                    alt={selectedAsset.title}
                    className="max-h-[380px] w-auto rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center text-white/40">
                    <RefreshCw className="h-8 w-8 animate-spin text-violet-400" />
                    <span className="mt-2 text-xs">Generating image...</span>
                  </div>
                )}
              </div>

              {/* Controls & Smart Edit */}
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <div className="text-xs text-white/50">Status</div>
                    <div className="flex items-center gap-1.5 font-semibold text-white">
                      {selectedAsset.locked ? (
                        <>
                          <Lock className="h-4 w-4 text-emerald-400" />
                          <span className="text-emerald-400">Final (Locked)</span>
                        </>
                      ) : (
                        <>
                          <Sliders className="h-4 w-4 text-amber-400" />
                          <span>Draft / Editable (v{selectedAsset.versions[0]?.version || 1})</span>
                        </>
                      )}
                    </div>
                  </div>

                  {!selectedAsset.locked && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleFinalize(selectedAsset.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Finalize & Lock
                    </button>
                  )}
                </div>

                {/* Smart Edit Input */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Sliders className="h-4 w-4 text-violet-400" />
                    <span>Smart Edit Revision</span>
                  </div>
                  <p className="text-xs text-white/60">
                    Ask for modifications naturally (e.g. &quot;Logo छोटा करो&quot;, &quot;Background blue करो&quot;, &quot;एक और विकल्प बनाओ&quot;):
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editInstruction}
                      onChange={(e) => setEditInstruction(e.target.value)}
                      placeholder="e.g. Background change to royal gold..."
                      className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={actionBusy || !editInstruction.trim()}
                      onClick={() => handleSmartEdit(selectedAsset.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Apply
                    </button>
                  </div>
                </div>

                {/* Version History */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-white/70">
                    <History className="h-3.5 w-3.5 text-white/50" />
                    <span>Version History ({selectedAsset.versions.length})</span>
                  </div>
                  <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                    {selectedAsset.versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 p-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">
                            v{ver.version}
                          </span>
                          <span className="line-clamp-1 text-white/70">{ver.prompt}</span>
                        </div>
                        <span className="shrink-0 text-[10px] text-white/40">
                          {new Date(ver.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
