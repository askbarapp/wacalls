import pino from "pino";
import type {
  CreativeProvider,
  TextToImageParams,
  SmartEditParams,
  CreativeJobResponse,
  CreativeJobStatus,
} from "./creative-provider.js";

const log = pino({ name: "usevelix-provider" });

export interface UseVelixConfig {
  apiKey: string;
  baseUrl?: string;
  defaultType?: string;
  defaultAspect?: string;
  enhancePrompt?: boolean;
}

export class UseVelixProvider implements CreativeProvider {
  readonly name = "usevelix";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UseVelixConfig) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error("UseVelix API key is required");
    }
    this.apiKey = config.apiKey.trim();
    // Normalize base URL, removing trailing slash
    const base = config.baseUrl?.trim() || process.env.USEVELIX_BASE_URL || "https://usevelix.com";
    this.baseUrl = base.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "authorization": `Bearer ${this.apiKey}`,
      "x-api-key": this.apiKey,
      "user-agent": "WaCall-Creative-Studio/1.0",
    };
  }

  /**
   * Test API connectivity and authentication without consuming image generation credits.
   */
  async testConnection(): Promise<{
    ok: boolean;
    message: string;
    creditsRemaining?: number;
  }> {
    try {
      // First attempt: check account/credits profile if available
      const res = await fetch(`${this.baseUrl}/api/v1/account`, {
        method: "GET",
        headers: this.headers(),
      }).catch(() => null);

      if (res && res.status === 200) {
        const json = (await res.json().catch(() => ({}))) as any;
        return {
          ok: true,
          message: "UseVelix API connected and authenticated successfully",
          creditsRemaining: json?.creditsRemaining ?? json?.credits,
        };
      }

      if (res && (res.status === 401 || res.status === 403)) {
        return {
          ok: false,
          message: "Authentication failed: Invalid UseVelix API Key",
        };
      }

      // Second attempt: Probe jobs status endpoint with a test verification check
      const probe = await fetch(`${this.baseUrl}/api/v1/jobs/probe-auth-check`, {
        method: "GET",
        headers: this.headers(),
      });

      if (probe.status === 401 || probe.status === 403) {
        return {
          ok: false,
          message: "Authentication failed: Invalid UseVelix API Key",
        };
      }

      // If server returns 404 or 400 for a nonexistent job ID, the API Key and Base URL are valid and reachable!
      if (probe.status === 404 || probe.status === 400 || probe.status === 200) {
        return {
          ok: true,
          message: "UseVelix API endpoint is reachable and authenticated",
        };
      }

      return {
        ok: false,
        message: `UseVelix responded with unexpected status code ${probe.status}`,
      };
    } catch (err: any) {
      log.error({ err: err?.message }, "UseVelix test connection failed");
      return {
        ok: false,
        message: `Connection to UseVelix failed: ${err?.message || "Network error"}`,
      };
    }
  }

  /**
   * Trigger Text-to-Image Generation (POST /api/v1/generate/text-to-image)
   */
  async generateTextToImage(params: TextToImageParams): Promise<CreativeJobResponse> {
    const url = `${this.baseUrl}/api/v1/generate/text-to-image`;
    const payload = {
      prompt: params.prompt,
      type: params.type || "photorealistic",
      aspect: params.aspect || "1:1",
      enhancePrompt: params.enhancePrompt ?? 0,
      seed: params.seed ?? "",
    };

    log.info({ promptLength: payload.prompt.length, type: payload.type, aspect: payload.aspect }, "Calling UseVelix Text-to-Image");

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      const errMsg = data?.message || data?.error || `UseVelix API error ${res.status}`;
      log.error({ status: res.status, error: errMsg }, "UseVelix Text-to-Image failed");
      throw new Error(errMsg);
    }

    const jobId = data.jobId || data.id || data.job_id;
    if (!jobId) {
      throw new Error("UseVelix did not return a valid jobId");
    }

    return {
      success: true,
      jobId: String(jobId),
      status: data.status || "queued",
      creditsUsed: data.creditsUsed ?? data.credits_used,
      creditsRemaining: data.creditsRemaining ?? data.credits_remaining,
      message: data.message,
    };
  }

  /**
   * Trigger Smart-Edit on an existing image (POST /api/v1/generate/smart-edit)
   */
  async smartEdit(params: SmartEditParams): Promise<CreativeJobResponse> {
    const url = `${this.baseUrl}/api/v1/generate/smart-edit`;
    const payload = {
      imageUrl: params.imageUrl,
      imageUrl2: params.imageUrl2 || undefined,
      prompt: params.prompt,
      type: params.type || "photorealistic",
      aspect: params.aspect || "1:1",
    };

    log.info({ promptLength: payload.prompt.length, type: payload.type }, "Calling UseVelix Smart-Edit");

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      const errMsg = data?.message || data?.error || `UseVelix Smart-Edit API error ${res.status}`;
      log.error({ status: res.status, error: errMsg }, "UseVelix Smart-Edit failed");
      throw new Error(errMsg);
    }

    const jobId = data.jobId || data.id || data.job_id;
    if (!jobId) {
      throw new Error("UseVelix did not return a valid jobId for Smart-Edit");
    }

    return {
      success: true,
      jobId: String(jobId),
      status: data.status || "queued",
      creditsUsed: data.creditsUsed ?? data.credits_used,
      creditsRemaining: data.creditsRemaining ?? data.credits_remaining,
      message: data.message,
    };
  }

  /**
   * Check status of a generation or edit job (GET /api/v1/jobs/:jobId)
   */
  async getJobStatus(jobId: string): Promise<CreativeJobStatus> {
    const url = `${this.baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });

    const data = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      return {
        jobId,
        status: "failed",
        error: data?.message || data?.error || `Job check failed (${res.status})`,
        raw: data,
      };
    }

    // Normalize raw status
    const rawStatus = String(data?.status || data?.state || "").toLowerCase().trim();
    let status: CreativeJobStatus["status"] = "processing";

    if (["done", "completed", "succeeded", "success"].includes(rawStatus)) {
      status = "done";
    } else if (["queued", "pending", "waiting"].includes(rawStatus)) {
      status = "queued";
    } else if (["failed", "error", "rejected"].includes(rawStatus)) {
      status = "failed";
    } else {
      status = "processing";
    }

    // Extract output image URL defensively
    const imageUrl =
      data.resultUrl ||
      data.result?.imageUrl ||
      data.result?.outputUrl ||
      data.result?.url ||
      data.outputUrl ||
      data.imageUrl ||
      data.image ||
      (Array.isArray(data.result?.images) ? data.result.images[0] : undefined) ||
      (Array.isArray(data.output) ? data.output[0] : typeof data.output === "string" ? data.output : undefined);

    return {
      jobId,
      status,
      imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
      creditsUsed: data.creditsUsed ?? data.credits_used,
      error: data.error || data.message,
      raw: data,
    };
  }
}
