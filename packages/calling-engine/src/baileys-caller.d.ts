declare module "baileys-caller" {
  export class VoipClient {
    constructor(config: { authDir: string });
    connect(): Promise<void>;
    call(
      phoneNumber: string,
      opts?: { audioSource?: string; durationMs?: number },
    ): Promise<{
      callId: string;
      end: () => void;
      mute: (muted: boolean) => void;
      on: (event: string, cb: (...args: any[]) => void) => void;
    }>;
    disconnect(): void;
  }
}
