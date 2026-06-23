import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import { createConsoleServer, createDevConsoleServer, type ServeOptions } from "./serve.js";

export interface DesktopOptions extends ServeOptions {
  width: number;
  height: number;
}

export interface ElectronAppLike {
  whenReady(): Promise<void>;
  on(eventName: string, handler: () => void): void;
  quit(): void;
  focus?(): void;
}

export interface ElectronWindowLike {
  loadURL(url: string): Promise<unknown>;
  show?(): void;
  focus?(): void;
  on?(eventName: string, handler: () => void): void;
}

export interface ElectronLike {
  app: ElectronAppLike;
  BrowserWindow: new (options: Record<string, unknown>) => ElectronWindowLike;
}

export interface DesktopDependencies {
  loadElectron(): Promise<ElectronLike>;
  createServer(options: ServeOptions): Pick<Server, "listen" | "close"> | Promise<Pick<Server, "listen" | "close">>;
}

const defaultDependencies: DesktopDependencies = {
  loadElectron,
  async createServer(options) {
    return options.dev ? createDevConsoleServer(options) : createConsoleServer(options);
  }
};
const activeWindows = new Set<ElectronWindowLike>();

export async function startDesktop(
  options: DesktopOptions,
  dependencies: DesktopDependencies = defaultDependencies
): Promise<{ url: string; close(): Promise<void> }> {
  await mkdir(".tmp", { recursive: true });
  const server = await dependencies.createServer(options);
  await listen(server, options.port, options.host);
  const url = `http://${options.host}:${options.port}`;
  console.log(`Desktop server listening: ${url}`);
  const electron = await dependencies.loadElectron();
  console.log("Electron module loaded.");
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await closeServer(server);
  };

  console.log("Waiting for Electron app readiness...");
  await electron.app.whenReady();
  console.log("Electron app ready. Creating window...");
  const window = new electron.BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: 960,
    minHeight: 680,
    show: true,
    backgroundColor: "#f5f7fb",
    title: "数字员工调度中心",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });
  activeWindows.add(window);
  window.on?.("closed", () => {
    activeWindows.delete(window);
  });
  window.show?.();
  window.focus?.();
  electron.app.focus?.();
  console.log("Electron window shown. Loading local console...");
  void window.loadURL(url).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
  });

  electron.app.on("before-quit", () => {
    void close();
  });
  electron.app.on("window-all-closed", () => {
    electron.app.quit();
  });

  return { url, close };
}

export function parseDesktopArgs(argv: string[]): DesktopOptions {
  const args = argv.slice(2);
  return {
    host: readFlag(args, "--host", "127.0.0.1"),
    port: Number(readFlag(args, "--port", "4173")),
    storePath: readFlag(args, "--store", ".tmp/server-runs.json"),
    workflowStorePath: readFlag(args, "--workflow-store", ".tmp/workflow-versions.json"),
    databasePath: readFlag(args, "--database", "data/digital-employee.sqlite"),
    userDataDir: readFlag(args, "--user-data-dir", "browser-profiles/baiying"),
    executablePath: readOptionalFlag(args, "--executable-path"),
    dev: args.includes("--dev"),
    width: Number(readFlag(args, "--width", "1440")),
    height: Number(readFlag(args, "--height", "960"))
  };
}

async function loadElectron(): Promise<ElectronLike> {
  const module = await import("electron");
  const electron = "default" in module && module.default ? module.default : module;
  return electron as unknown as ElectronLike;
}

function listen(server: Pick<Server, "listen">, port: number, host: string): Promise<void> {
  return new Promise((resolve) => server.listen(port, host, resolve));
}

function closeServer(server: Pick<Server, "close">): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

function readFlag(args: string[], name: string, fallback: string): string {
  return readOptionalFlag(args, name) ?? fallback;
}

function readOptionalFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const isCli = process.argv[1]?.endsWith("/electron-main.js") ?? false;
if (isCli) {
  void startDesktop(parseDesktopArgs(process.argv)).then((desktop) => {
    console.log(`Douyin Baiying MVP desktop: ${desktop.url}`);
  }).catch((error: unknown) => {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  });
}
