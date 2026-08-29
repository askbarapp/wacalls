# WaCalls Implementation Plan

Build order matches the product brief. Each phase is testable before the next.

## Phase 1 — Architecture + repository

- Monorepo (pnpm workspaces)
- Shared types, ESLint, Prettier, strict TypeScript
- Prisma schema + indexes
- Docker Compose skeletons
- This documentation set

## Phase 2 — Self-hosted WhatsApp connection POC

- Baileys multi-file auth on volume
- QR over WebSocket/REST
- CONNECTED / DISCONNECTED / RECONNECTING
- Restart without re-scan

## Phase 3 — Voice call initiation POC

- Load `SelfHostedWhatsAppEngine`
- Dynamic import of optional `baileys-caller`
- `initiateCall(channelId, e164)`
- Honest `UnsupportedCapabilityError` if WASM stack missing

## Phase 4 — Call event detection

- Map engine `ringing` / `connected` / `ended`
- Persist `calls` + `call_attempts`
- Never infer ANSWERED from a timeout

## Phase 5 — Web dialer

- Channel presence, number pad, mute, hangup, timer
- Live status from WebSocket
- Mic PCM streaming when capabilities allow

## Phase 6 — Queue + Redis lock

- `lock:whatsapp-channel:{id}`
- BullMQ call jobs, delay on lock miss
- Four-agent / one-channel test (see `packages/queue` tests)

## Phase 7 — Users + agents

- Auth, roles, invitations, agent presence (ready/busy/offline)

## Phase 8 — Contacts + CSV

- E.164, duplicates, preview/confirm import, error CSV

## Phase 9 — Campaigns

- MANUAL / SEQUENTIAL / RECORDED / AI_VOICE
- Start / pause / resume / stop / skip / retry
- DNC respected

## Phase 10 — History + analytics

- Filters, dashboard cards, charts API

## Phase 11 — Recording / audio engine

- Upload, ffmpeg convert, capability-gated playback

## Phase 12 — Widget

- `widget.js`, public token, queue position, no session leakage

## Phase 13 — REST API + webhooks

- Versioned `/api/v1`, HMAC webhooks, delivery retries

## Phase 14 — AI voice architecture

- STT / LLM / TTS providers, scripts, summaries, callback fallback

## Phase 15 — Production hardening

- Rate limits, backups, metrics, audit logs, encryption

## Phase 16 — `setup.sh`

- Ubuntu 22.04/24.04, Docker, SSL, firewall, first admin, CLI

## Exit criteria (MVP)

Documented in README. Core loop: VPS install → login → QR → dialer → real call events → sequential campaign → single-channel lock.
