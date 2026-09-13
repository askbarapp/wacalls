export interface TextToImageParams {
  prompt: string;
  type?: "human" | "cartoon" | "3d" | "photorealistic" | string;
  aspect?: "1:1" | "9:16" | "16:9" | string;
  enhancePrompt?: number;
  seed?: string;
}

export interface SmartEditParams {
  imageUrl: string;
  imageUrl2?: string;
  prompt: string;
  type?: "human" | "cartoon" | "3d" | "photorealistic" | string;
  aspect?: "1:1" | "9:16" | "16:9" | string;
}

export interface CreativeJobResponse {
  success: boolean;
  jobId: string;
  status: "queued" | "processing" | "done" | "failed" | string;
  creditsUsed?: number;
  creditsRemaining?: number;
  message?: string;
}

export interface CreativeJobStatus {
  jobId: string;
  status: "queued" | "processing" | "done" | "failed" | "timeout";
  imageUrl?: string;
  creditsUsed?: number;
  error?: string;
  raw?: any;
}

/**
 * Common abstraction interface for AI Creative Image & Edit Providers.
 * Ensures WaCall business logic is decoupled from UseVelix and ready for future providers.
 */
export interface CreativeProvider {
  readonly name: string;

  /**
   * Test API key and endpoint connectivity without consuming generation credits.
   */
  testConnection(): Promise<{
    ok: boolean;
    message: string;
    creditsRemaining?: number;
  }>;

  /**
   * Trigger asynchronous text-to-image generation.
   */
  generateTextToImage(params: TextToImageParams): Promise<CreativeJobResponse>;

  /**
   * Trigger asynchronous smart edit on an existing image.
   */
  smartEdit(params: SmartEditParams): Promise<CreativeJobResponse>;

  /**
   * Poll status of an ongoing generation/edit job.
   */
  getJobStatus(jobId: string): Promise<CreativeJobStatus>;
}
