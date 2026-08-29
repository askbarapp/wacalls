# Calling engine

Product code talks only to `CallingEngine`.

```text
CallingEngine
├── SelfHostedWhatsAppEngine   default
├── WavoipAdapter              stub / future
└── MockEngine                 APP_ENV=development AND CALLING_ENGINE=mock
```

## Self-hosted

1. **Baileys** owns QR and multi-file auth. Sessions survive restarts via `whatsapp_sessions`.
2. After `creds.json` exists, the engine tries to hand off to **baileys-caller** `VoipClient` (same `authDir`) so the WhatsApp Web WASM stack can place a real outbound 1:1 voice call.
3. Events `ringing` / `connected` / `ended` are forwarded unchanged. WaCalls does not invent ANSWERED.

If `baileys-caller` is missing or WASM init fails, `initiateCall` throws `UnsupportedCapabilityError`. The call row is **FAILED**.

Optional install inside the WhatsApp container (experimental, native `wrtc`, ffmpeg required):

```bash
docker compose exec whatsapp sh -c 'pnpm add baileys-caller@github:SheIITear/baileys-caller'
```

Then reconnect the channel.

## Mock

Used only in `docker-compose.dev.yml`. Production boot with `CALLING_ENGINE=mock` throws `EngineMisconfiguredError`.

## Wavoip

`WavoipAdapter` is a placeholder. Do not spread Wavoip types through Prisma or React. When you have credentials, implement the adapter in `packages/calling-engine/src/wavoip-adapter.ts` only.

## Channel lock

`lock:whatsapp-channel:{channelId}` in Redis. MAX_ACTIVE_CALLS = 1. Four agents: first ACTIVE, others QUEUED. See `packages/queue/src/lock.test.ts`.

## Audio

`AudioEngine` converts with ffmpeg to 16 kHz mono WAV. `playFile` during an already-live call is **not** exported by baileys-caller; pass `audioFilePath` at initiate time for recorded campaigns. Live mic PCM inject is documented as unsupported until VoipClient exposes a feeder hook.
