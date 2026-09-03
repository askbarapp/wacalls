import { spawn } from "node:child_process";
import { UnsupportedCapabilityError, type CallingEngine } from "@wacalls/calling-engine";

export type SupportedFormat = {
  mime: string;
  extension: string;
  sampleRateHz: number;
  channels: number;
};

export interface AudioEngine {
  playFile(callId: string, filePath: string): Promise<void>;
  stop(callId: string): Promise<void>;
  convert(inputPath: string, outputPath: string): Promise<void>;
  getSupportedFormats(): SupportedFormat[];
}

export class FfmpegAudioEngine implements AudioEngine {
  constructor(private readonly calling: CallingEngine) {}

  getSupportedFormats(): SupportedFormat[] {
    return [
      { mime: "audio/wav", extension: ".wav", sampleRateHz: 16000, channels: 1 },
      { mime: "audio/mpeg", extension: ".mp3", sampleRateHz: 16000, channels: 1 },
    ];
  }

  async convert(inputPath: string, outputPath: string): Promise<void> {
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ]);
  }

  async playFile(callId: string, filePath: string): Promise<void> {
    if (!this.calling.capabilities.recordedPlayback) {
      throw new UnsupportedCapabilityError("recordedPlayback", this.calling.name);
    }
    // Playback is initiated at call start via InitiateCallOptions.audioFilePath.
    // Mid-call file switch is not exported by baileys-caller.
    void callId;
    void filePath;
    throw new UnsupportedCapabilityError(
      "mid-call playFile (pass audioFilePath when initiating the call)",
      this.calling.name,
    );
  }

  async stop(callId: string): Promise<void> {
    await this.calling.hangup(callId);
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

export type AIContext = {
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  language?: string;
  temperature?: number;
  maxTokens?: number;
};

export interface AIProvider {
  transcribe(audio: Buffer): Promise<string>;
  generateResponse(text: string, context: AIContext): Promise<string>;
  synthesize(text: string): Promise<Buffer>;
}

export class UnconfiguredAIProvider implements AIProvider {
  async transcribe(): Promise<string> {
    throw new Error("No STT provider configured. Set AI_STT_PROVIDER and AI_API_KEY.");
  }
  async generateResponse(): Promise<string> {
    throw new Error("No LLM provider configured. Set AI_PROVIDER and AI_API_KEY.");
  }
  async synthesize(): Promise<Buffer> {
    throw new Error("No TTS provider configured. Set AI_TTS_PROVIDER and AI_API_KEY.");
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly model = "gpt-4o-mini",
  ) {}

  async transcribe(audio: Buffer): Promise<string> {
    const form = new FormData();
    form.set("file", new Blob([audio]), "audio.wav");
    form.set("model", "whisper-1");
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`STT failed: ${res.status}`);
    const json = (await res.json()) as { text?: string };
    return json.text ?? "";
  }

  async generateResponse(text: string, context: AIContext): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: context.temperature ?? 0.4,
        max_tokens: context.maxTokens ?? 400,
        messages: [
          { role: "system", content: context.systemPrompt },
          ...context.history,
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM failed: ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
  }

  async synthesize(text: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
        format: "wav",
      }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function createAIProvider(): AIProvider {
  const key = process.env.AI_API_KEY;
  const provider = process.env.AI_PROVIDER;
  if (!key || !provider) return new UnconfiguredAIProvider();
  return new OpenAICompatibleProvider(key, process.env.AI_BASE_URL, process.env.AI_MODEL);
}

export * from "./sarvam.js";
export * from "./wav.js";
export * from "./voice-agent-prompt.js";
