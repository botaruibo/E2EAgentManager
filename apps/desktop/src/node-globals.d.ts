declare const process: {
  argv: string[];
  exitCode?: number;
  version: string;
  cwd(): string;
};

declare const Buffer: {
  concat(chunks: Uint8Array[]): {
    toString(encoding: string): string;
  };
};

declare function setInterval(callback: () => void | Promise<void>, ms: number): { unref?(): void };

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function stat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  }

  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(data?: string): void;
  }

  export interface Server {
    listen(port: number, host: string, callback: () => void): void;
    close(callback?: () => void): void;
  }

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void
  ): Server;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...values: unknown[]): { changes?: number };
      get(...values: unknown[]): unknown;
      all(...values: unknown[]): unknown[];
    };
  }
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

declare module "node:zlib" {
  export function inflateRawSync(data: Uint8Array): Uint8Array;
}
