import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../../../packages/shared/src/index.js";
import { err, ok } from "../../../packages/shared/src/index.js";
import { PlaywrightBrowserRuntime } from "../../../packages/browser/src/index.js";

export interface OpenLoginOptions {
  userDataDir: string;
  url: string;
  headless: boolean;
  executablePath?: string;
}

export interface OpenLoginOutput {
  userDataDir: string;
  url: string;
  title: string;
  message: string;
}

export async function openLoginBrowser(options: OpenLoginOptions): Promise<Result<OpenLoginOutput>> {
  try {
    const browser = new PlaywrightBrowserRuntime({
      userDataDir: options.userDataDir,
      headless: options.headless,
      executablePath: options.executablePath
    });
    const session = await browser.openLoginSession(options.url);
    return ok(session);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export function parseOpenLoginArgs(argv: string[]): OpenLoginOptions {
  const args = argv.slice(2);
  return {
    userDataDir: readFlag(args, "--user-data-dir", "browser-profiles/baiying"),
    url: readFlag(args, "--url", "https://buyin.jinritemai.com"),
    headless: readFlag(args, "--headless", "false") === "true",
    executablePath: readOptionalFlag(args, "--executable-path")
  };
}

function readFlag(args: string[], name: string, fallback: string): string {
  return readOptionalFlag(args, name) ?? fallback;
}

function readOptionalFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

const isCli = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
if (isCli) {
  const result = await openLoginBrowser(parseOpenLoginArgs(process.argv));
  if (!result.ok) {
    process.exitCode = 1;
    console.error(result.errors.join("\n"));
  } else {
    console.log(JSON.stringify(result.value, null, 2));
    console.log("Keep the browser open until login is complete. Stop this command when finished.");
  }
}
