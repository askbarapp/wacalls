# REST API

Base path: `/api/v1`

Auth: `Authorization: Bearer <access>` or httpOnly cookies, or `X-API-Key: wc_live_…`

All tenant queries are scoped by `organization_id` from the token.

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | `{ email, password, remember }` |
| POST | `/api/v1/auth/refresh` | Refresh cookie |
| POST | `/api/v1/auth/logout` | |
| GET | `/api/v1/auth/me` | |
| POST | `/api/v1/auth/change-password` | |
| POST | `/api/v1/auth/forgot-password` | |
| POST | `/api/v1/auth/reset-password` | |

## Calls

```http
POST /api/v1/calls
Content-Type: application/json

{
  "channel_id": "uuid",
  "phone": "919876543210",
  "contact_name": "Rahul",
  "campaign_id": "uuid"
}
```

```json
{
  "success": true,
  "call_id": "uuid",
  "status": "QUEUED",
  "queue_position": 1
}
```

| Method | Path |
| --- | --- |
| GET | `/api/v1/calls` |
| GET | `/api/v1/calls/:id` |
| POST | `/api/v1/calls/:id/hangup` |
| POST | `/api/v1/calls/:id/mute` |
| POST | `/api/v1/calls/:id/result` |

## Messages (WhatsApp text)

Send WhatsApp **text** through a **CONNECTED** WhatsApp Web line (or a Cloud API channel if your plan allows it). This is WaCalls’ own send API, not Meta’s product name. Daily plan limits apply.

Auth: `Authorization: Bearer <jwt>` or `X-API-Key: wc_live_…` / `wc_pub_…` with scope `messages:write`.

```http
POST /api/v1/messages
Content-Type: application/json
X-API-Key: wc_live_...

{
  "channel_id": "CHANNEL_UUID",
  "phone": "+9198xxxxxxxx",
  "text": "Hello from our website form"
}
```

Optional body fields: `template_id`, `contact_id`. `text` can be omitted when `template_id` is set.

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "SENT",
    "phone": "+9198xxxxxxxx",
    "body": "Hello from our website form"
  }
}
```

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/messages` | Paginated send log |
| POST | `/api/v1/messages` | Send text (channel must be CONNECTED for Web) |

Errors: `409` if the line is disconnected, Cloud credentials are missing, or the daily message cap is reached. `400` if `text` and `template_id` are both empty.

### curl

```bash
curl -sS -X POST "$ORIGIN/api/v1/messages" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $WACALLS_API_KEY" \
  -d "{\"channel_id\":\"$CHANNEL_ID\",\"phone\":\"+9198xxxxxxxx\",\"text\":\"Hello from our form\"}"
```

### Node

```js
const res = await fetch(`${origin}/api/v1/messages`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": process.env.WACALLS_API_KEY,
  },
  body: JSON.stringify({
    channel_id: process.env.WACALLS_CHANNEL_ID,
    phone: "+9198xxxxxxxx",
    text: "Hello from Node",
  }),
});
const json = await res.json();
if (!json.success) throw new Error(json.error?.message || "send failed");
```

### HTML form (browser SDK)

Use a **publishable** key (`wc_pub_…`) and `/sdk/wacalls.js`:

```html
<script src="https://YOUR_DOMAIN/sdk/wacalls.js"></script>
<form id="lead">
  <input name="phone" placeholder="+9198xxxxxxxx" required />
  <textarea name="text">Thanks for contacting us.</textarea>
  <button type="submit">Send WhatsApp</button>
</form>
<script>
  const client = WaCalls.init({
    token: "wc_pub_...",
    channelId: "CHANNEL_UUID",
  });
  document.getElementById("lead").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await client.sendMessage({ phone: fd.get("phone"), text: fd.get("text") });
  });
</script>
```

## Other resources

| Method | Path |
| --- | --- |
| GET/POST | `/api/v1/contacts` |
| POST | `/api/v1/contacts/import/preview` |
| POST | `/api/v1/contacts/import/confirm` |
| GET/POST | `/api/v1/campaigns` |
| POST | `/api/v1/campaigns/:id/start` |
| POST | `/api/v1/campaigns/:id/pause` |
| POST | `/api/v1/campaigns/:id/stop` |
| GET/POST | `/api/v1/channels` |
| POST | `/api/v1/channels/:id/connect` |
| GET | `/api/v1/channels/:id/qr` |
| GET | `/api/v1/dashboard` |
| GET | `/api/v1/analytics` |
| GET/POST | `/api/v1/webhooks` |
| GET/POST | `/api/v1/api-keys` |

## Widget (public, rate limited)

`POST /widget/call` `{ channelId, phone, name }`

## Health

`GET /health` `GET /ready` `GET /metrics`

## Webhooks

HMAC-SHA256 of the raw body in `x-wacalls-signature`. Events: `call.started`, `call.ringing`, `call.answered`, `call.ended`, `call.failed`, `campaign.started`, `campaign.completed`, `contact.completed`.

Payload includes `event`, `timestamp`, `organization_id`, `call_id`, `contact_id`, `channel_id`, `status`, `duration`.
