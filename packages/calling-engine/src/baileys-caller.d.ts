declare module "baileys-caller" {
  import { EventEmitter } from "node:events";

  export class ActiveCall extends EventEmitter {
    readonly callId: string;
    _audioSource: string;
    end: () => void;
    mute: (muted: boolean) => void;
    on: (event: string, cb: (...args: any[]) => void) => this;
  }

  export class VoipClient {
    constructor(config: { authDir: string });
    connect(): Promise<void>;
    call(
      phoneNumber: string,
      opts?: { audioSource?: string; durationMs?: number },
    ): Promise<ActiveCall>;
    disconnect(): void;
  }
}
