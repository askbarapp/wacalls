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
