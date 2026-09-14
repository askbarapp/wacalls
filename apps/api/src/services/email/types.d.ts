declare module "imapflow" {
  export class ImapFlow {
    constructor(options: any);
    connect(): Promise<void>;
    logout(): Promise<void>;
    list(): Promise<any>;
    getMailboxLock(path: string): Promise<{ release: () => void }>;
    search(criteria: any, options?: any): Promise<number[]>;
    fetch(seq: any, query: any): AsyncIterable<any>;
  }
}

declare module "mailparser" {
  export function simpleParser(source: any, options?: any): Promise<any>;
}
