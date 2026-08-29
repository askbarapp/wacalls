# WaCalls Feasibility Report

**Date:** 2026-08-29  
**Scope:** Self-hosted WhatsApp Web calling (QR-linked device) for a multi-agent office dialer.  
**Method:** Source/API review of Baileys, WhatsApp Web VoIP WASM research, and community call engines. No fabricated call success.

This document answers the ten required technical questions before product code. It is the source of truth for what WaCalls may claim.

---

## Executive verdict

| Layer | Verdict | Production posture |
| --- | --- | --- |
| QR / session persistence | **Feasible and proven** | Production-capable with Baileys multi-file auth |
| Outbound WhatsApp voice media | **Experimental, technically demonstrated by community engines** | Optional self-hosted adapter; never faked |
| Ringing / answered / ended events | **Feasible when the WASM media stack is used** | Mapped through `CallingEngine` events |
| Audio inject / capture / recording playback | **Feasible on the experimental WASM path** | Behind `AudioEngine`; capability-flagged |
| Real-time STT/TTS AI voice | **Architecturally feasible, operationally experimental** | Provider-agnostic adapters; high latency/risk |
| Official WhatsApp Business Calling API | **Not this product** | Do not claim Meta official compliance |

**WaCalls never reports RINGING, ANSWERED, or ENDED unless the selected calling engine emits those events.** Development uses `MockEngine` only when `APP_ENV=development` and `CALLING_ENGINE=mock`.

---

## 1. Can QR WhatsApp session connection be self-hosted?

**Yes.**

WhatsApp multi-device linking (QR or pairing code) is implemented by `@whiskeysockets/baileys` using the WhatsApp Web protocol.

Flow:

1. Create a socket with `useMultiFileAuthState(sessionDir)`.
2. Emit QR (`connection.update.qr`) to the dashboard.
3. User scans via **WhatsApp → Linked Devices**.
4. Persist `creds.json` + key files on a Docker volume (`whatsapp_sessions`).
5. Restart reuses the same auth state. QR is not required after a healthy restart.

**Limitations**

- Unofficial protocol. Not the Cloud API.
- Sessions can be invalidated by WhatsApp (logout, security, device limit).
- Concurrent sockets for the same account are unsafe. One process owns one channel.

**Required component:** `@whiskeysockets/baileys`, encrypted-at-rest session volume.

---

## 2. Can voice calls be initiated?

**Not with stock Baileys messaging APIs. Yes, experimentally, by running WhatsApp Web’s own VoIP WASM stack next to Baileys.**

Baileys is a messaging/session library. Maintainers and public PRs treat **call signaling** and **call media** as separate problems:

| Layer | Stock Baileys | What a real call needs |
| --- | --- | --- |
| QR / auth | Yes | Yes |
| Incoming call *notification* | Yes (`call` events) | Insufficient alone |
| Outgoing `call/offer` signaling | Partial / PRs only | Required |
| Opus / SRTP / TURN relay media | **No** | Required |

A real outbound voice call requires the **WhatsApp Web VoIP WASM binary** (compiled C++ / pjlib / Opus) plus:

- raw call stanzas (not Baileys’ simplified `call` event)
- relay / ICE / transport I/O
- audio capture/playback drivers
- pthread / worker-thread shims so the WASM can run in Node.js

Community engines that wrap this stack (not Wavoip, not a WaCalls hard dependency):

- [SheIITear/baileys-caller](https://github.com/SheIITear/baileys-caller) — outbound 1:1 voice, file/PCM audio, ringing/connected/ended events. MIT. Git dependency. Not on npm as of this writing.
- [natsu-dev01/call-llamada-natsu](https://github.com/natsu-dev01/call-llamada-natsu) — similar WASM wrapper, also claims video.

WaCalls binds these behind `SelfHostedWhatsAppEngine`. The dashboard, queue, and API never import them.

**If the WASM adapter fails to load, `initiateCall` throws `UnsupportedCapabilityError`. Status stays FAILED. Nothing is faked.**

---

## 3. Can ringing / answered / ended events be detected?

**Yes, on the WASM path. Partially, on Baileys-only.**

| Event | Baileys-only | baileys-caller / WASM |
| --- | --- | --- |
| Connecting / offer sent | Possible if signaling PR present | Yes |
| Ringing | Incoming `call` events; outbound unreliable | `ringing` event |
| Answered / media flowing | Not from messaging APIs | `connected` event |
| Ended / rejected / timeout | Incoming terminate; outbound incomplete | `ended` with reason (`hangup`, `timeout`, `rejected`) |

WaCalls maps engine events to:

`CONNECTING → RINGING → ANSWERED → ENDED | FAILED | BUSY | NO_ANSWER | REJECTED`

---

## 4. Can call audio be injected?

**Yes, experimentally, via the WASM audio driver.**

baileys-caller accepts:

- MP3 / WAV file path
- `"silence"`
- PCM `Float32Array` (16 kHz mono)

Browser microphone audio is **not** a native WhatsApp API. WaCalls streams agent mic PCM over the authenticated WebSocket into `AudioEngine` / `CallingEngine.sendAudio()`.

This is experimental: clock drift, WASM heap, and WhatsApp binary changes can break it.

---

## 5. Can remote call audio be captured?

**Yes, experimentally.**

baileys-caller emits `audio` with 16 kHz mono `Float32Array` frames. WaCalls can:

- stream frames to the agent browser for live listen
- buffer them for STT in the AI adapter
- **not** claim legally compliant call recording without organization consent/config

Inbound *calls* (answering a customer who dials the WhatsApp number) are **not** supported by baileys-caller today.

---

## 6. Can prerecorded audio be played?

**Yes, experimentally, on the WASM path.** Prefer WAV/MP3; convert with ffmpeg to 16 kHz mono PCM before inject.

**Not claimed** unless `engine.capabilities.recordedPlayback === true`.

After playback, campaign config may:

- hang up
- wait for response (capture remote audio)
- transfer to agent (or create a callback task if transfer is unsupported)

---

## 7. Can real-time STT / TTS work?

**Architecturally yes. Operationally experimental.**

Pipeline:

```text
Remote PCM → SpeechToText → LLM → TextToSpeech → PCM inject
```

Providers are interfaces, not hard-coded vendors (`openai`, `groq`, `deepgram`, `elevenlabs`, etc.).

Risks: round-trip latency, barge-in, WASM audio clock, cost, and ToS of both WhatsApp and the AI vendor.

Human takeover: if the engine cannot transfer the live RTP session, WaCalls creates a **callback task** for an available agent.

---

## 8. What open-source components are required?

| Component | Role |
| --- | --- |
| Node.js 20+ | Runtime |
| `@whiskeysockets/baileys` | QR, session, WhatsApp socket |
| PostgreSQL 16 | System of record |
| Redis 7 | Locks, queues, pub/sub |
| BullMQ | Call / campaign / webhook jobs |
| ffmpeg | Audio decode / resample |
| Nginx + Certbot | TLS reverse proxy |
| Docker Compose | Process isolation |
| **Optional:** `baileys-caller` (git) | WASM VoIP media |
| **Optional:** `@roamhq/wrtc` | Native WebRTC bits used by some WASM loaders |

WaCalls does **not** require Wavoip.

---

## 9. What components are experimental?

- WhatsApp Web VoIP WASM running in Node
- Outbound call media and event fidelity
- Browser mic → WhatsApp inject
- Remote audio capture quality
- Recorded-campaign playback into a live call
- Real-time AI voice
- WASM binary freshness (`fetch-wasm` when WhatsApp ships a new stack)
- Account bans / session drops caused by calling from a linked web device

---

## 10. What components are production-risk?

- **ToS / policy:** Linked-device automation is not the official WhatsApp Business Calling API. Meta may ban numbers.
- **Protocol churn:** WASM and stanza formats change without notice.
- **Single-call physical limit:** One WhatsApp account ≈ one live call. This is a product constraint, not a bug.
- **Native deps:** `wrtc` / ffmpeg must match the host (Docker images pin this).
- **Legal:** recording, AI, and outbound calling laws (consent, DNC, spam).
- **Security:** session files are credentials. Volume encryption + no frontend exposure.

---

## 11. What limitations exist without Wavoip?

Wavoip is a paid third-party calling bridge. Without it (default WaCalls):

- You rely on Baileys + optional WASM adapter.
- Stability, codec, and “official-looking” web-calling UX are not guaranteed.
- Group/video/inbound answering are out of scope for the default engine.
- You must operate your own VPS, sessions, and risk.

The `WavoipAdapter` exists so a future paid bridge can be swapped **without** rewriting tenants, queues, or UI.

---

## 12. What would require a paid external service?

| Need | Typical paid option |
| --- | --- |
| Official Meta calling / compliance | WhatsApp Business Platform (Cloud API) if/when calling is offered for that product |
| Higher-stability unofficial calling | Wavoip or similar commercial bridge (`WavoipAdapter`) |
| Production STT/TTS/LLM | OpenAI, Deepgram, ElevenLabs, Groq, etc. |
| Transactional email | SMTP provider (Postmark, SES, …) |
| Managed TLS/DNS | Optional Cloudflare (installer still works with manual A records) |

---

## Capability matrix (honest)

| Capability | Self-hosted engine | Mock engine | Wavoip adapter |
| --- | --- | --- | --- |
| QR connect + persist | Yes (Baileys) | Simulated | Adapter-defined |
| Outbound voice | Experimental WASM | Simulated | Future |
| Ringing / answered / ended | Experimental WASM | Simulated | Future |
| Audio inject | Experimental | Simulated | Future |
| Audio capture | Experimental | Simulated | Future |
| Recorded playback | Experimental | Simulated | Future |
| Real-time AI | Experimental + paid STT/TTS | Simulated | Future |
| Inbound answer | **No** (baileys-caller) | Simulated | Unknown |
| Group / video | **No** | No | Unknown |
| Official Meta API | **No** | No | No unless documented later |

---

## POC success criteria (not faked)

A Phase 3/4 POC is only “green” when a **real** linked device:

1. Shows QR and reaches `CONNECTED`
2. Places an outbound WhatsApp voice call that rings a real phone
3. Receives `ringing` then `connected` from the engine
4. Ends with an engine `ended` reason
5. Persists those states in PostgreSQL

If step 2–4 fail, the UI shows **FAILED** and `CALLING_ENGINE.md` is updated with the error. The rest of the SaaS (tenancy, queue, CSV, campaigns) still ships, because it talks only to `CallingEngine`.
