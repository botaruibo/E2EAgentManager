import type { BrowserRuntime } from "../../browser/src/index.js";
import { FakeBrowserRuntime } from "../../browser/src/index.js";
import { baiyingAddProductWorkflow, validateWorkflow } from "../../dsl/src/index.js";
import { parseProductsInput, type ProductInputFormat } from "../../local-data/src/index.js";
import { evaluateRunPolicy, evaluateStepPolicy } from "../../policy/src/index.js";
import type {
  ExecutionMode,
  Result,
  ProductInput,
  RunItemResult,
  RunSummary,
  StoredRun,
  TraceEntry,
  WorkflowDefinition,
  WorkflowNodeLayer
} from "../../shared/src/index.js";
import { createRunId, err, nowIso, ok } from "../../shared/src/index.js";
import type { RunStore } from "../../storage/src/index.js";
import { InMemoryRunStore } from "../../storage/src/index.js";
import { WorkflowEngine } from "../../workflow/src/index.js";

export interface RunProductsRequest {
  csv?: string;
  products?: ProductInput[];
  inputFormat?: ProductInputFormat;
  rowIds?: string[];
  mode: ExecutionMode;
  approvals?: string[];
  workflow?: WorkflowDefinition;
  workflowVersionId?: string;
  employeeId?: string;
  employeeName?: string;
  startStepId?: string;
  browser?: BrowserRuntime;
}

export interface RunConsoleView {
  summary: RunSummary;
  rows: Array<{
    rowId: string;
    title?: string;
    productUrl?: string;
    status: string;
    eventCount: number;
    error?: string;
    errorCategory?: FailureCategory;
    failedStepId?: string;
    resumeStepId?: string;
    checkpoint?: RunItemResult["checkpoint"];
    timeline: Array<{
      type: string;
      stepId?: string;
      message?: string;
      timestamp: string;
      data?: unknown;
      snapshot?: Record<string, unknown>;
    }>;
  }>;
}

export type FailureCategory =
  | "approval_required"
  | "locator"
  | "login"
  | "captcha"
  | "risk_control"
  | "policy"
  | "resume"
  | "browser"
  | "business_validation"
  | "unknown";

export interface RunPlan {
  workflowId: string;
  workflowVersionId?: string;
  mode: ExecutionMode;
  totalItems: number;
  canRun: boolean;
  missingApprovals: string[];
  blockers: string[];
  warnings: string[];
  steps: RunPlanStep[];
}

export interface RunPlanStep {
  stepId: string;
  type: string;
  layer: WorkflowNodeLayer;
  status: "ready" | "skipped" | "requires_approval" | "blocked";
  reason?: string;
}

export interface RunRecoveryPlan {
  runId: string;
  workflowId: string;
  workflowVersionId?: string;
  mode: ExecutionMode;
  totalRecoverableRows: number;
  rowIds: string[];
  groups: Array<{
    resumeStepId?: string;
    rowIds: string[];
    rowIdsArg: string;
    startStepArg?: string;
    count: number;
    errorCategories: FailureCategory[];
  }>;
  rows: Array<{
    rowId: string;
    title?: string;
    productUrl?: string;
    status: string;
    failedStepId?: string;
    resumeStepId?: string;
    errorCategory?: FailureCategory;
    error?: string;
  }>;
}

export class BaiyingMvpAppService {
  constructor(private readonly store: RunStore = new InMemoryRunStore()) {}

  async runProducts(request: RunProductsRequest): Promise<Result<RunConsoleView>> {
    const workflow = request.workflow ?? baiyingAddProductWorkflow;
    const workflowResult = validateWorkflow(workflow);
    if (!workflowResult.ok) {
      return err(workflowResult.errors);
    }

    const productsResult = request.products
      ? ok(request.products)
      : parseProductsInput(request.csv ?? "", request.inputFormat ?? "auto");
    if (!productsResult.ok) {
      return err(productsResult.errors);
    }

    const filteredProducts = filterProductsByRowIds(productsResult.value, request.rowIds);
    if (!filteredProducts.ok) {
      return err(filteredProducts.errors);
    }
    const runnableProducts = request.mode === "run_once" ? filteredProducts.value.slice(0, 1) : filteredProducts.value;
    const startedAt = nowIso();
    const runId = createRunId(request.employeeId ?? "run");
    const engine = new WorkflowEngine(request.browser ?? new FakeBrowserRuntime());
    const run = await engine.runBatch(workflowResult.value, runnableProducts, {
      mode: request.mode,
      approvals: request.approvals,
      startStepId: request.startStepId
    });
    const completedAt = nowIso();
    const summary = summarizeRun({
      runId,
      workflowId: workflowResult.value.workflowId,
      workflowVersionId: request.workflowVersionId,
      employeeId: request.employeeId,
      employeeName: request.employeeName,
      mode: request.mode,
      startedAt,
      completedAt,
      items: run.results
    });

    const storedRun: StoredRun = {
      summary,
      items: run.results,
      events: run.results.flatMap((result) => result.events),
      traces: run.trace.all()
    };
    await this.store.save(storedRun);

    return ok(toConsoleView(storedRun));
  }

  async listRuns(): Promise<RunSummary[]> {
    return this.store.list();
  }

  async deleteRun(runId: string): Promise<boolean> {
    return this.store.delete(runId);
  }

  async listRunsForEmployee(employeeId: string): Promise<RunSummary[]> {
    return this.store.listByEmployee(employeeId);
  }

  async getEmployeeRunConsole(employeeId: string, runId: string): Promise<RunConsoleView | undefined> {
    const run = await this.store.getForEmployee(employeeId, runId);
    return run ? toConsoleView(run) : undefined;
  }

  async getEmployeeRunTraceArtifact(employeeId: string, runId: string): Promise<StoredRun | undefined> {
    return this.store.getForEmployee(employeeId, runId);
  }

  async exportEmployeeRunCsv(employeeId: string, runId: string): Promise<string | undefined> {
    const run = await this.store.getForEmployee(employeeId, runId);
    return run ? runToCsv(run) : undefined;
  }

  async exportEmployeeRunTraceJson(employeeId: string, runId: string): Promise<string | undefined> {
    const run = await this.store.getForEmployee(employeeId, runId);
    return run ? JSON.stringify(run, null, 2) : undefined;
  }

  async deleteEmployeeRun(employeeId: string, runId: string): Promise<boolean> {
    return this.store.deleteForEmployee(employeeId, runId);
  }

  async clearEmployeeRuns(employeeId: string): Promise<number> {
    return this.store.clearForEmployee(employeeId);
  }

  async getRunConsole(runId: string): Promise<RunConsoleView | undefined> {
    const run = await this.store.get(runId);
    return run ? toConsoleView(run) : undefined;
  }

  async getRunTraceArtifact(runId: string): Promise<StoredRun | undefined> {
    return this.store.get(runId);
  }

  async exportRunCsv(runId: string): Promise<string | undefined> {
    const run = await this.store.get(runId);
    return run ? runToCsv(run) : undefined;
  }

  async exportRunTraceJson(runId: string): Promise<string | undefined> {
    const run = await this.store.get(runId);
    return run ? JSON.stringify(run, null, 2) : undefined;
  }

  async getRunRecoveryPlan(runId: string): Promise<RunRecoveryPlan | undefined> {
    const run = await this.store.get(runId);
    return run ? toRecoveryPlan(run) : undefined;
  }
}

export function createRunPlan(input: {
  workflow: WorkflowDefinition;
  workflowVersionId?: string;
  products: ProductInput[];
  mode: ExecutionMode;
  approvals?: string[];
}): RunPlan {
  const missingApprovals = new Set<string>();
  const blockers: string[] = [];
  const steps: RunPlanStep[] = [];
  const context = {
    workflow: input.workflow,
    item: input.products[0] ?? { rowId: "preview" },
    mode: input.mode,
    itemIndex: 0,
    batchSize: input.products.length,
    approvals: new Set(input.approvals ?? [])
  };
  const runDecision = evaluateRunPolicy(context);
  if (!runDecision.allow) {
    if (runDecision.requiresApproval) {
      missingApprovals.add("batch");
    } else if (runDecision.reason) {
      blockers.push(runDecision.reason);
    }
  }
  for (const step of input.workflow.steps) {
    if (step.skipWhen === "{{mode == 'dry_run'}}" && input.mode === "dry_run") {
      steps.push({
        stepId: step.id,
        type: step.type,
        layer: step.layer ?? stepLayerForType(step.type),
        status: "skipped",
        reason: "Skipped in dry_run mode."
      });
      continue;
    }
    const stepDecision = evaluateStepPolicy(context, step);
    if (!stepDecision.allow) {
      if (stepDecision.requiresApproval) {
        missingApprovals.add("final_submit");
        steps.push({
          stepId: step.id,
          type: step.type,
          layer: step.layer ?? stepLayerForType(step.type),
          status: "requires_approval",
          reason: stepDecision.reason
        });
      } else if (stepDecision.reason) {
        blockers.push(stepDecision.reason);
        steps.push({
          stepId: step.id,
          type: step.type,
          layer: step.layer ?? stepLayerForType(step.type),
          status: "blocked",
          reason: stepDecision.reason
        });
      }
      continue;
    }
    steps.push({
      stepId: step.id,
      type: step.type,
      layer: step.layer ?? stepLayerForType(step.type),
      status: "ready"
    });
  }
  return {
    workflowId: input.workflow.workflowId,
    workflowVersionId: input.workflowVersionId,
    mode: input.mode,
    totalItems: input.products.length,
    canRun: blockers.length === 0 && missingApprovals.size === 0,
    missingApprovals: [...missingApprovals],
    blockers,
    warnings: input.mode === "dry_run" ? ["dry_run skips final submit and post-submit verification steps."] : [],
    steps
  };
}

function stepLayerForType(type: string): WorkflowNodeLayer {
  if (type.startsWith("flow.")) {
    return "control";
  }
  if (type.startsWith("strategy.")) {
    return "strategy";
  }
  return "primitive";
}

export function filterProductsByRowIds(products: ProductInput[], rowIds?: string[]): Result<ProductInput[]> {
  const requested = (rowIds ?? []).map((rowId) => rowId.trim()).filter(Boolean);
  if (requested.length === 0) {
    return ok(products);
  }
  const requestedSet = new Set(requested);
  const filtered = products.filter((product) => requestedSet.has(product.rowId));
  const found = new Set(filtered.map((product) => product.rowId));
  const missing = requested.filter((rowId) => !found.has(rowId));
  return missing.length > 0
    ? err(`Requested rowIds not found: ${missing.join(", ")}.`)
    : ok(filtered);
}

function summarizeRun(input: {
  runId: string;
  workflowId: string;
  workflowVersionId?: string;
  employeeId?: string;
  employeeName?: string;
  mode: ExecutionMode;
  startedAt: string;
  completedAt: string;
  items: RunItemResult[];
}): RunSummary {
  const successCount = input.items.filter((item) => item.status === "success").length;
  const failedCount = input.items.filter((item) => item.status === "failed").length;
  const skippedCount = input.items.filter((item) => item.status === "skipped").length;
  const approvalCount = input.items.filter((item) => item.status === "requires_approval").length;

  return {
    runId: input.runId,
    workflowId: input.workflowId,
    workflowVersionId: input.workflowVersionId,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    mode: input.mode,
    status: approvalCount > 0 ? "requires_approval" : failedCount > 0 ? "failed" : "completed",
    totalItems: input.items.length,
    successCount,
    failedCount,
    skippedCount,
    approvalCount,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  };
}

function toConsoleView(run: StoredRun): RunConsoleView {
  return {
    summary: run.summary,
    rows: run.items.map((item) => ({
      rowId: item.item.rowId,
      title: item.item.title,
      productUrl: item.item.productUrl,
      status: item.status,
      eventCount: item.events.length,
      error: item.error,
      errorCategory: classifyFailure(item),
      failedStepId: item.failedStepId,
      resumeStepId: resumeStepIdForItem(item),
      checkpoint: item.checkpoint,
      timeline: timelineForItem(run.traces, item.item.rowId)
    }))
  };
}

function timelineForItem(traces: TraceEntry[], rowId: string): RunConsoleView["rows"][number]["timeline"] {
  return traces
    .filter((trace) => trace.event.itemId === rowId)
    .map((trace) => ({
      type: trace.event.type,
      stepId: trace.event.stepId,
      message: trace.event.message,
      timestamp: trace.event.timestamp,
      data: trace.event.data,
      snapshot: trace.snapshot
    }));
}

function runToCsv(run: StoredRun): string {
  const header = [
    "runId",
    "employeeId",
    "employeeName",
    "runObjectId",
    "runObjectName",
    "runObjectSource",
    "status",
    "eventCount",
    "failedStepId",
    "resumeStepId",
    "retryCount",
    "errorCategory",
    "error"
  ];
  const rows = run.items.map((item) => [
    run.summary.runId,
    run.summary.employeeId ?? "",
    run.summary.employeeName ?? "",
    item.item.rowId,
    item.item.title ?? "",
    item.item.productUrl ?? item.item.productId ?? "",
    item.status,
    String(item.events.length),
    item.failedStepId ?? "",
    resumeStepIdForItem(item) ?? "",
    String(item.checkpoint?.retryCount ?? 0),
    classifyFailure(item) ?? "",
    item.error ?? ""
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function toRecoveryPlan(run: StoredRun): RunRecoveryPlan {
  const rows = run.items
    .filter((item) => item.status === "failed" || item.status === "requires_approval")
    .map((item) => ({
      rowId: item.item.rowId,
      title: item.item.title,
      productUrl: item.item.productUrl,
      status: item.status,
      failedStepId: item.failedStepId,
      resumeStepId: resumeStepIdForItem(item),
      errorCategory: classifyFailure(item),
      error: item.error
    }));
  return {
    runId: run.summary.runId,
    workflowId: run.summary.workflowId,
    workflowVersionId: run.summary.workflowVersionId,
    mode: run.summary.mode,
    totalRecoverableRows: rows.length,
    rowIds: rows.map((row) => row.rowId),
    groups: recoveryGroups(rows),
    rows
  };
}

function recoveryGroups(rows: RunRecoveryPlan["rows"]): RunRecoveryPlan["groups"] {
  const groups = new Map<string, {
    resumeStepId?: string;
    rowIds: string[];
    errorCategories: Set<FailureCategory>;
  }>();
  for (const row of rows) {
    const key = row.resumeStepId ?? "";
    const group = groups.get(key) ?? {
      resumeStepId: row.resumeStepId,
      rowIds: [],
      errorCategories: new Set<FailureCategory>()
    };
    group.rowIds.push(row.rowId);
    if (row.errorCategory) {
      group.errorCategories.add(row.errorCategory);
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    resumeStepId: group.resumeStepId,
    rowIds: group.rowIds,
    rowIdsArg: group.rowIds.join(","),
    startStepArg: group.resumeStepId,
    count: group.rowIds.length,
    errorCategories: [...group.errorCategories]
  }));
}

export function classifyFailure(item: RunItemResult): FailureCategory | undefined {
  if (item.status === "success" || item.status === "skipped") {
    return undefined;
  }
  const message = [
    item.error,
    item.failedStepId,
    ...item.events.map((event) => `${event.type} ${event.message ?? ""}`)
  ].join("\n").toLowerCase();
  if (message.includes("captcha") || message.includes("验证码") || message.includes("滑块") || message.includes("人机验证")) {
    return "captcha";
  }
  if (message.includes("risk-control") || message.includes("risk control") || message.includes("风控") || message.includes("安全拦截")) {
    return "risk_control";
  }
  if (message.includes("login") || message.includes("cookie") || message.includes("profile")) {
    return "login";
  }
  if (item.status === "requires_approval") {
    return "approval_required";
  }
  if (message.includes("manual locator") || message.includes("locator") || message.includes("target") || message.includes("xpath")) {
    return "locator";
  }
  if (message.includes("batch size") || message.includes("maxbatchsize") || message.includes("policy")) {
    return "policy";
  }
  if (message.includes("cannot resume") || message.includes("resume")) {
    return "resume";
  }
  if (message.includes("verify") || message.includes("添加成功") || message.includes("已添加")) {
    return "business_validation";
  }
  if (message.includes("browser") || message.includes("click") || message.includes("input") || message.includes("open")) {
    return "browser";
  }
  return "unknown";
}

function resumeStepIdForItem(item: RunItemResult): string | undefined {
  if (item.status === "success" || item.status === "skipped") {
    return undefined;
  }
  return item.checkpoint?.nextStepId ?? item.failedStepId;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
