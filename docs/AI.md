# AI voice

Interfaces (`packages/audio-engine`):

```text
SpeechToText  →  LLM  →  TextToSpeech
```

`AIProvider`: `transcribe`, `generateResponse`, `synthesize`.

Configure via env, not hard-coded vendors:

```env
AI_PROVIDER=openai
AI_API_KEY=
AI_MODEL=
AI_STT_PROVIDER=
AI_TTS_PROVIDER=
AI_BASE_URL=
```

Admin scripts live in `ai_configs` (system prompt, greeting, objective, questions, disallowed claims, language, voice).

After a call, persist outcome, summary, and lead score when a provider is configured. If live RTP transfer is unavailable, create a **callback task** instead of pretending a warm transfer happened.

This path is experimental: latency, barge-in, and WASM audio clocks are not carrier-grade.
