"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AutoReplyForm, TRIGGERS, type TriggerId } from "@/components/auto-reply-form";
import { PageHeader } from "@/components/page-header";

export default function NewAutoReplyPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <NewAutoReplyInner />
    </Suspense>
  );
}

function NewAutoReplyInner() {
  const search = useSearchParams();
  const raw = search.get("trigger");
  const trigger = TRIGGERS.some((t) => t.id === raw) ? (raw as TriggerId) : "ANSWERED";
  return (
    <div>
      <Link href="/auto-reply" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Auto Reply
      </Link>
      <PageHeader title="New call follow-up" subtitle="When a WhatsApp call is received, rejected, or unanswered, send a designed template automatically." />
      <AutoReplyForm defaultTrigger={trigger} />
    </div>
  );
}
