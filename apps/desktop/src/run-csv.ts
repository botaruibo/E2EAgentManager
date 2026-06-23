import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionMode, ProductInput, Result, WorkflowDefinition } from "../../../packages/shared/src/index.js";
import { parseProductsInput, parseProductsXlsx, type ProductInputFormat } from "../../../packages/local-data/src/index.js";
import { baiyingAddProductWorkflow, validateWorkflow } from "../../../packages/dsl/src/index.js";
import { BaiyingMvpAppService, createRunPlan, filterProductsByRowIds, type RunPlan, type RunRecoveryPlan } from "../../../packages/app-service/src/index.js";
import { JsonFileRunStore } from "../../../packages/storage/src/index.js";
import { FakeBrowserRuntime, PlaywrightBrowserRuntime, requireBrowserProfileReady } from "../../../packages/browser/src/index.js";
import { renderRunConsole } from "./render-console.js";

export interface RunCsvFileOptions {
  csvPath: string;
  inputFormat: ProductInputFormat;
  mode: ExecutionMode;
  approvals?: string[];
  rowIds?: string[];
  browser: "fake" | "playwright";
  userDataDir: string;
  headless: boolean;
  executablePath?: string;
  startStepId?: string;
  workflowPath?: string;
  exportWorkflowPath?: string;
  planOnly: boolean;
  planOutPath?: string;
  recoveryFromRunId?: string;
  outHtmlPath: string;
  storePath: string;
}

export interface RunCsvFileOutput {
  runId: string;
  htmlPath: string;
  storePath: string;
  totalItems: number;
  status: string;
  workflowId: string;
  plan?: RunPlan;
  recovery?: RunRecoveryPlan;
  workflowExportPath?: string;
  planOutPath?: string;
}

export async function runCsvFile(options: RunCsvFileOptions): Promise<Result<RunCsvFileOutput>> {
  const outHtmlPath = resolve(options.outHtmlPath);
  const storePath = resolve(options.storePath);
  if (options.recoveryFromRunId) {
    const app = new BaiyingMvpAppService(new JsonFileRunStore(storePath));
    const recovery = await app.getRunRecoveryPlan(options.recoveryFromRunId);
    return recovery
      ? {
          ok: true,
          value: {
            runId: recovery.runId,
            htmlPath: "",
            storePath,
            totalItems: recovery.totalRecoverableRows,
            status: recovery.totalRecoverableRows > 0 ? "needs_recovery" : "ready",
            workflowId: recovery.workflowId,
            recovery
          }
        }
      : { ok: false, errors: [`Run ${options.recoveryFromRunId} not found in ${storePath}.`] };
  }
  const csvPath = resolve(options.csvPath);
  const workflowResult = await readWorkflowFile(options.workflowPath);
  if (!workflowResult.ok) {
    return workflowResult;
  }
  const workflow = workflowResult.value;
  if (options.exportWorkflowPath) {
    const workflowExportPath = resolve(options.exportWorkflowPath);
    await mkdir(dirname(workflowExportPath), { recursive: true });
    await writeFile(workflowExportPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    return {
      ok: true,
      value: {
        runId: "",
        htmlPath: "",
        storePath,
        totalItems: 0,
        status: "workflow_exported",
        workflowId: workflow.workflowId,
        workflowExportPath
      }
    };
  }
  const inputFormat = resolveInputFormat(options.csvPath, options.inputFormat);
  let input: { csv?: string; inputFormat?: ProductInputFormat; products?: ProductInput[] };
  if (inputFormat === "xlsx") {
    const productsResult = parseProductsXlsx(await readFile(csvPath));
    if (!productsResult.ok) {
      return productsResult;
    }
    input = { products: productsResult.value };
  } else {
    input = { csv: await readFile(csvPath, "utf8"), inputFormat };
  }
  const productsResult = input.products
    ? { ok: true as const, value: input.products }
    : parseProductsInput(input.csv ?? "", input.inputFormat ?? "auto");
  if (!productsResult.ok) {
    return productsResult;
  }
  const filteredProducts = filterProductsByRowIds(productsResult.value, options.rowIds);
  if (!filteredProducts.ok) {
    return filteredProducts;
  }
  const runnableProducts = options.mode === "run_once" ? filteredProducts.value.slice(0, 1) : filteredProducts.value;
  const plan = createRunPlan({
    workflow,
    products: runnableProducts,
    mode: options.mode,
    approvals: options.approvals
  });
  if (options.planOnly) {
    const planOutPath = options.planOutPath ? resolve(options.planOutPath) : undefined;
    if (planOutPath) {
      await mkdir(dirname(planOutPath), { recursive: true });
      await writeFile(planOutPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    }
    return {
      ok: true,
      value: {
        runId: "",
        htmlPath: "",
        storePath,
        totalItems: plan.totalItems,
        status: plan.canRun ? "ready" : "needs_attention",
        workflowId: plan.workflowId,
        plan,
        planOutPath
      }
    };
  }
  if (!plan.canRun) {
    return {
      ok: true,
      value: {
        runId: "",
        htmlPath: "",
        storePath,
        totalItems: plan.totalItems,
        status: "needs_attention",
        workflowId: plan.workflowId,
        plan
      }
    };
  }
  if (options.browser === "playwright") {
    const profileReady = await requireBrowserProfileReady({
      userDataDir: options.userDataDir,
      mode: options.mode,
      approvals: options.approvals
    });
    if (!profileReady.ok) {
      return profileReady;
    }
  }
  const app = new BaiyingMvpAppService(new JsonFileRunStore(storePath));
  const result = await app.runProducts({
    ...input,
    rowIds: options.rowIds,
    mode: options.mode,
    approvals: options.approvals,
    workflow,
    startStepId: options.startStepId,
    browser:
      options.browser === "playwright"
        ? new PlaywrightBrowserRuntime({
            userDataDir: options.userDataDir,
            headless: options.headless,
            executablePath: options.executablePath
          })
        : new FakeBrowserRuntime()
  });

  if (!result.ok) {
    return result;
  }

  await mkdir(dirname(outHtmlPath), { recursive: true });
  await writeFile(outHtmlPath, renderRunConsole(result.value), "utf8");

  return {
    ok: true,
    value: {
      runId: result.value.summary.runId,
      htmlPath: outHtmlPath,
      storePath,
      totalItems: result.value.summary.totalItems,
      status: result.value.summary.status,
      workflowId: result.value.summary.workflowId
    }
  };
}

async function readWorkflowFile(workflowPath?: string): Promise<Result<WorkflowDefinition>> {
  if (!workflowPath) {
    return { ok: true, value: baiyingAddProductWorkflow };
  }
  try {
    const workflow = JSON.parse(await readFile(resolve(workflowPath), "utf8"));
    return validateWorkflow(workflow);
  } catch (error) {
    return { ok: false, errors: [`Invalid workflow file ${workflowPath}: ${error instanceof Error ? error.message : String(error)}.`] };
  }
}

function resolveInputFormat(path: string, format: ProductInputFormat): ProductInputFormat {
  if (format !== "auto") {
    return format;
  }
  return extname(path).toLowerCase() === ".xlsx" ? "xlsx" : "auto";
}

export function parseRunCsvArgs(argv: string[]): RunCsvFileOptions {
  const args = argv.slice(2);
  const csvPath = args[0] ?? "examples/products.csv";
  return {
    csvPath,
    inputFormat: readFlag(args, "--input-format", "auto") as ProductInputFormat,
    mode: readFlag(args, "--mode", "dry_run") as ExecutionMode,
    approvals: readFlag(args, "--approvals", "")
      .split(",")
      .map((approval) => approval.trim())
      .filter(Boolean),
    rowIds: readFlag(args, "--row-ids", "")
      .split(",")
      .map((rowId) => rowId.trim())
      .filter(Boolean),
    browser: readFlag(args, "--browser", "fake") as "fake" | "playwright",
    userDataDir: readFlag(args, "--user-data-dir", "browser-profiles/baiying"),
    headless: readFlag(args, "--headless", "false") === "true",
    executablePath: readOptionalFlag(args, "--executable-path"),
    startStepId: readOptionalFlag(args, "--start-step"),
    workflowPath: readOptionalFlag(args, "--workflow-file"),
    exportWorkflowPath: readOptionalFlag(args, "--export-workflow"),
    planOnly: readFlag(args, "--plan-only", "false") === "true",
    planOutPath: readOptionalFlag(args, "--plan-out"),
    recoveryFromRunId: readOptionalFlag(args, "--recovery-from-run"),
    outHtmlPath: readFlag(args, "--out", ".tmp/console.html"),
    storePath: readFlag(args, "--store", ".tmp/runs.json")
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
  const result = await runCsvFile(parseRunCsvArgs(process.argv));
  if (!result.ok) {
    process.exitCode = 1;
    console.error(result.errors.join("\n"));
  } else {
    console.log(JSON.stringify(result.value, null, 2));
  }
}
