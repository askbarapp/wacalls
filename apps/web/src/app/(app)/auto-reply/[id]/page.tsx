"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AutoReplyForm } from "@/components/auto-reply-form";
import { PageHeader } from "@/components/page-header";

export default function EditAutoReplyPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <Link href="/auto-reply" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Auto Reply
      </Link>
      <PageHeader title="Edit call follow-up" subtitle="When a WhatsApp call is received, rejected, or unanswered, send a designed template automatically." />
      <AutoReplyForm ruleId={id} />
    </div>
  );
}
