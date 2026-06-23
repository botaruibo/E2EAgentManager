import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBrowserProfile } from "../../../packages/browser/src/index.js";
import { validateWorkflow, baiyingAddProductWorkflow } from "../../../packages/dsl/src/index.js";
import { parseProductsInput } from "../../../packages/local-data/src/index.js";
import { JsonFileRunStore, JsonFileWorkflowVersionStore } from "../../../packages/storage/src/index.js";
import type { Result } from "../../../packages/shared/src/index.js";
import { ok } from "../../../packages/shared/src/index.js";

export interface DoctorOptions {
  userDataDir: string;
  storePath: string;
  workflowStorePath: string;
  samplePath: string;
  executablePath?: string;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
}

export interface DoctorReport {
  status: "ok" | "warning" | "error";
  checks: DoctorCheck[];
}

export async function runDoctor(options: DoctorOptions): Promise<Result<DoctorReport>> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion(process.version));
  checks.push(checkWorkflow());
  checks.push(await checkSampleInput(options.samplePath));
  checks.push(await checkRunStore(options.storePath));
  checks.push(await checkWorkflowStore(options.workflowStorePath));
  checks.push(await checkElectronPackage());
  checks.push(await checkPlaywrightPackage());
  checks.push(await checkExecutablePath(options.executablePath));
  checks.push(await checkBrowserProfile(options.userDataDir));

  return ok({
    status: overallStatus(checks),
    checks
  });
}

export function parseDoctorArgs(argv: string[]): DoctorOptions {
  const args = argv.slice(2);
  return {
    userDataDir: readFlag(args, "--user-data-dir", "browser-profiles/baiying"),
    storePath: readFlag(args, "--store", ".tmp/runs.json"),
    workflowStorePath: readFlag(args, "--workflow-store", ".tmp/workflow-versions.json"),
    samplePath: readFlag(args, "--sample", "examples/products.csv"),
    executablePath: readOptionalFlag(args, "--executable-path")
  };
}

function checkNodeVersion(version: string): DoctorCheck {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  return major >= 22
    ? { name: "node", status: "ok", message: `${version} satisfies >=22.` }
    : { name: "node", status: "error", message: `${version} does not satisfy >=22.` };
}

function checkWorkflow(): DoctorCheck {
  const result = validateWorkflow(baiyingAddProductWorkflow);
  return result.ok
    ? { name: "workflow", status: "ok", message: `${result.value.workflowId} validates.` }
    : { name: "workflow", status: "error", message: result.errors.join(" ") };
}

async function checkSampleInput(samplePath: string): Promise<DoctorCheck> {
  try {
    const content = await readFile(resolve(samplePath), "utf8");
    const result = parseProductsInput(content, "auto");
    return result.ok
      ? { name: "sample_input", status: "ok", message: `${result.value.length} product row(s) parsed from ${samplePath}.` }
      : { name: "sample_input", status: "error", message: result.errors.join(" ") };
  } catch (error) {
    return { name: "sample_input", status: "error", message: errorMessage(error) };
  }
}

async function checkRunStore(storePath: string): Promise<DoctorCheck> {
  try {
    const runs = await new JsonFileRunStore(storePath).list();
    return { name: "run_store", status: "ok", message: `${runs.length} saved run(s) readable from ${storePath}.` };
  } catch (error) {
    return { name: "run_store", status: "error", message: errorMessage(error) };
  }
}

async function checkWorkflowStore(workflowStorePath: string): Promise<DoctorCheck> {
  try {
    const versions = await new JsonFileWorkflowVersionStore(workflowStorePath).list();
    return { name: "workflow_store", status: "ok", message: `${versions.length} workflow version(s) readable from ${workflowStorePath}.` };
  } catch (error) {
    return { name: "workflow_store", status: "error", message: errorMessage(error) };
  }
}

async function checkPlaywrightPackage(): Promise<DoctorCheck> {
  try {
    await import("playwright");
    return { name: "playwright_package", status: "ok", message: "playwright package is resolvable." };
  } catch (error) {
    return {
      name: "playwright_package",
      status: "warning",
      message: `playwright package is not resolvable. Install project dependencies before real browser runs. ${errorMessage(error)}`
    };
  }
}

async function checkElectronPackage(): Promise<DoctorCheck> {
  try {
    await import("electron");
    return { name: "electron_package", status: "ok", message: "electron package is resolvable." };
  } catch (error) {
    return {
      name: "electron_package",
      status: "warning",
      message: `electron package is not resolvable. Install project dependencies before desktop runs. ${errorMessage(error)}`
    };
  }
}

async function checkBrowserProfile(userDataDir: string): Promise<DoctorCheck> {
  try {
    const profile = await inspectBrowserProfile(userDataDir);
    return profile.warnings.length === 0
      ? { name: "browser_profile", status: "ok", message: `Profile ready at ${profile.absolutePath}.` }
      : { name: "browser_profile", status: "warning", message: profile.warnings.join(" ") };
  } catch (error) {
    return { name: "browser_profile", status: "error", message: errorMessage(error) };
  }
}

async function checkExecutablePath(executablePath?: string): Promise<DoctorCheck> {
  if (!executablePath) {
    return {
      name: "browser_executable",
      status: "warning",
      message: "No executablePath configured. Playwright will use its bundled browser or default resolution."
    };
  }
  try {
    const info = await stat(resolve(executablePath));
    return info.isFile()
      ? { name: "browser_executable", status: "ok", message: `Executable found at ${executablePath}.` }
      : { name: "browser_executable", status: "error", message: `Path is not a file: ${executablePath}.` };
  } catch (error) {
    return { name: "browser_executable", status: "error", message: errorMessage(error) };
  }
}

function overallStatus(checks: DoctorCheck[]): DoctorReport["status"] {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  return "ok";
}

function readFlag(args: string[], name: string, fallback: string): string {
  return readOptionalFlag(args, name) ?? fallback;
}

function readOptionalFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isCli = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
if (isCli) {
  const result = await runDoctor(parseDoctorArgs(process.argv));
  if (!result.ok) {
    process.exitCode = 1;
    console.error(result.errors.join("\n"));
  } else {
    console.log(JSON.stringify(result.value, null, 2));
    process.exitCode = result.value.status === "error" ? 1 : 0;
  }
}
