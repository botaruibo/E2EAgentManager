import { mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExecutionMode, Result } from "../../shared/src/index.js";
import { err, ok } from "../../shared/src/index.js";

export interface BrowserProfileStatus {
  userDataDir: string;
  absolutePath: string;
  exists: boolean;
  isDirectory: boolean;
  fileCount: number;
  markers: string[];
  likelyHasLoginState: boolean;
  warnings: string[];
}

const PROFILE_MARKERS = [
  "Default/Cookies",
  "Default/Network/Cookies",
  "Cookies",
  "Local State"
];

export async function ensureBrowserProfileDir(userDataDir: string): Promise<BrowserProfileStatus> {
  await mkdir(userDataDir, { recursive: true });
  return inspectBrowserProfile(userDataDir);
}

export async function inspectBrowserProfile(userDataDir: string): Promise<BrowserProfileStatus> {
  const absolutePath = resolve(userDataDir);
  const status = await readDirectoryStatus(absolutePath);
  const markers = await findProfileMarkers(absolutePath);
  const warnings: string[] = [];

  if (!status.exists) {
    warnings.push("Profile directory does not exist yet. It will be created before launching Playwright.");
  } else if (!status.isDirectory) {
    warnings.push("Profile path exists but is not a directory.");
  } else if (status.fileCount === 0) {
    warnings.push("Profile directory is empty. Open Playwright once and log in to Douyin Baiying before batch mode.");
  } else if (!markers.some((marker) => marker.endsWith("Cookies"))) {
    warnings.push("No Chromium cookie database marker found. Login state may be missing.");
  }

  return {
    userDataDir,
    absolutePath,
    exists: status.exists,
    isDirectory: status.isDirectory,
    fileCount: status.fileCount,
    markers,
    likelyHasLoginState: markers.some((marker) => marker.endsWith("Cookies")),
    warnings
  };
}

export async function requireBrowserProfileReady(input: {
  userDataDir: string;
  mode: ExecutionMode;
  approvals?: string[];
}): Promise<Result<BrowserProfileStatus>> {
  const status = await inspectBrowserProfile(input.userDataDir);
  if (!needsLoginState(input.mode, input.approvals ?? [])) {
    return ok(status);
  }

  if (status.likelyHasLoginState) {
    return ok(status);
  }

  return err([
    "Playwright execution with run_once, batch, or final_submit approval requires a prepared Douyin Baiying browser profile.",
    `Profile: ${status.absolutePath}`,
    ...status.warnings,
    "Open Login Browser or run `npm run login:browser -- --user-data-dir browser-profiles/baiying`, complete login, then retry dry_run before approved execution."
  ]);
}

function needsLoginState(mode: ExecutionMode, approvals: string[]): boolean {
  return mode !== "dry_run" || approvals.includes("final_submit") || approvals.includes("batch");
}

async function readDirectoryStatus(absolutePath: string): Promise<{ exists: boolean; isDirectory: boolean; fileCount: number }> {
  try {
    const info = await stat(absolutePath);
    if (!info.isDirectory()) {
      return { exists: true, isDirectory: false, fileCount: 0 };
    }
    const entries = await readdir(absolutePath);
    return { exists: true, isDirectory: true, fileCount: entries.length };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { exists: false, isDirectory: false, fileCount: 0 };
    }
    throw error;
  }
}

async function findProfileMarkers(absolutePath: string): Promise<string[]> {
  const found: string[] = [];
  for (const marker of PROFILE_MARKERS) {
    try {
      const info = await stat(resolve(absolutePath, marker));
      if (info.isFile() || info.isDirectory()) {
        found.push(marker);
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
  return found;
}
