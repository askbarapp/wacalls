import { useEffect, useState } from "react";
import { Webhook, Plus, Trash2, ExternalLink, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { listWebhooks, createWebhook, deleteWebhook, type WebhookConfig } from "@/services/webhooks";
import { useI18n } from "@/lib/i18n";

export const WebhooksPage = ({ sid }: { sid: string }) => {
  const t = useI18n((s) => s.t);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("*");
  const [creating, setCreating] = useState(false);

  const load = () => {
    listWebhooks(sid)
      .then(setWebhooks)
      .catch(() => setWebhooks([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [sid]);

  const onCreate = async () => {
    if (!url) return;
    setCreating(true);
    try {
      await createWebhook(sid, url, events);
      setUrl("");
      setEvents("*");
      load();
      toast.success("Webhook created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (wid: string) => {
    try {
      await deleteWebhook(sid, wid);
      load();
      toast.success("Webhook deleted");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copySecret = (secret: string) => {
    navigator.clipboard.writeText(secret);
    toast.success("Secret copied");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Webhook className="h-5 w-5" />
        <h2 className="text-lg font-semibold">{t("webhooks")}</h2>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            placeholder="Events (*, call.started, call.ended)"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            className="w-64"
          />
          <Button onClick={onCreate} disabled={creating || !url}>
            <Plus className="h-4 w-4 mr-1" />
            {t("add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Events: call.incoming, call.started, call.ended, recording.ready
        </p>
      </Card>

      {webhooks.length === 0 ? (
        <Card className="p-8 text-center">
          <Webhook className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("no_webhooks")}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <Card key={wh.id} className="flex items-center gap-4 p-4">
              <ExternalLink className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{wh.url}</p>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{wh.events}</span>
                  <span className={wh.active ? "text-green-500" : "text-red-500"}>
                    {wh.active ? "active" : "inactive"}
                  </span>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => copySecret(wh.secret)}>
                <Copy className="h-4 w-4 mr-1" />
                Secret
              </Button>
              <Button variant="outline" size="sm" onClick={() => onDelete(wh.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
