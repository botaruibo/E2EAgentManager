export type ExecutionMode = "dry_run" | "run_once" | "batch";

export type RunItemStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "requires_approval";

export interface ProductInput {
  rowId: string;
  productUrl?: string;
  productId?: string;
  title?: string;
  groupName?: string;
  remark?: string;
}

export interface WorkflowTarget {
  role?: string;
  label?: string;
  text?: string;
  css?: string;
  xpath?: string;
}

export type WorkflowStepType =
  | "browser.open"
  | "browser.click"
  | "browser.input"
  | "browser.verify"
  | "browser.press"
  | "browser.extract"
  | "browser.wait"
  | "flow.if"
  | "flow.loop"
  | "flow.map"
  | "flow.retry"
  | "flow.approval"
  | "strategy.decide"
  | "strategy.select"
  | "strategy.extract"
  | "strategy.recover";

export interface WorkflowExpectation {
  textExists?: string;
  anyTextExists?: string[];
}

export interface WorkflowExtractFieldSpec {
  selector?: string;
  attr?: string;
  text?: boolean;
}

export interface WorkflowExtractSpec {
  entity: string;
  selector?: string;
  limit?: number;
  fields?: Record<string, WorkflowExtractFieldSpec>;
}

export type WorkflowNodeLayer = "primitive" | "control" | "strategy";

export type WorkflowStrategyKind = "decide" | "select" | "extract" | "recover";

export type WorkflowStrategyAction =
  | "read"
  | "click"
  | "input"
  | "verify"
  | "extract"
  | "submit"
  | "delete"
  | "payment"
  | "send_message"
  | "record_failure"
  | "request_human";

export type WorkflowStrategyFailureBehavior =
  | "record_and_continue"
  | "retry"
  | "pause_for_human"
  | "fail_run";

export interface WorkflowStrategySpec {
  kind: WorkflowStrategyKind;
  goal: string;
  inputs?: string[];
  pageScope?: string;
  allowedActions: WorkflowStrategyAction[];
  deniedActions?: WorkflowStrategyAction[];
  successCriteria: string;
  failureBehavior: WorkflowStrategyFailureBehavior;
  evidenceRequired?: boolean;
}

export interface WorkflowFlowSpec {
  condition?: string;
  source?: string;
  retryLimit?: number;
  approvalKey?: string;
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name?: string;
  layer?: WorkflowNodeLayer;
  url?: string;
  target?: WorkflowTarget;
  value?: string;
  key?: string;
  extract?: WorkflowExtractSpec;
  expectation?: WorkflowExpectation;
  strategy?: WorkflowStrategySpec;
  flow?: WorkflowFlowSpec;
  approvalRequired?: boolean;
  skipWhen?: string;
  timeoutMs?: number;
}

export interface WorkflowPolicy {
  requireApprovalFor?: string[];
  maxBatchSize?: number;
  maxRetryPerItem?: number;
}

export interface WorkflowInputSpec {
  type: "string" | "enum";
  required?: boolean;
  values?: string[];
  default?: string;
}

export interface WorkflowDefinition {
  schemaVersion: 1;
  workflowId: string;
  name: string;
  inputs: Record<string, WorkflowInputSpec>;
  policy: WorkflowPolicy;
  steps: WorkflowStep[];
}

export interface RunContext {
  workflow: WorkflowDefinition;
  item: ProductInput;
  mode: ExecutionMode;
  itemIndex: number;
  batchSize: number;
  approvals: Set<string>;
}

export interface RuntimeEvent {
  type: string;
  timestamp: string;
  workflowId: string;
  itemId?: string;
  stepId?: string;
  message?: string;
  data?: unknown;
}

export interface TraceEntry {
  event: RuntimeEvent;
  snapshot?: Record<string, unknown>;
}

export interface StepResult {
  ok: boolean;
  skipped?: boolean;
  requiresApproval?: boolean;
  message?: string;
  data?: unknown;
}

export interface RunItemResult {
  item: ProductInput;
  status: RunItemStatus;
  events: RuntimeEvent[];
  error?: string;
  failedStepId?: string;
  checkpoint?: {
    lastStepId?: string;
    nextStepId?: string;
    retryCount: number;
  };
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  workflowVersionId?: string;
  employeeId?: string;
  employeeName?: string;
  mode: ExecutionMode;
  status: "running" | "completed" | "failed" | "requires_approval";
  totalItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  approvalCount: number;
  startedAt: string;
  completedAt?: string;
}

export interface StoredRun {
  summary: RunSummary;
  items: RunItemResult[];
  events: RuntimeEvent[];
  traces: TraceEntry[];
}

export interface WorkflowVersionSummary {
  versionId: string;
  workflowId: string;
  name: string;
  employeeId?: string;
  createdAt: string;
  note?: string;
}

export interface StoredWorkflowVersion {
  summary: WorkflowVersionSummary;
  workflow: WorkflowDefinition;
  employeeId?: string;
  employeeVersion?: number;
  status?: "draft" | "published";
  source?: "default" | "recorder" | "manual";
  actions?: unknown[];
  savedAt?: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(errors: string | string[]): Result<T> {
  return { ok: false, errors: Array.isArray(errors) ? errors : [errors] };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(prefix = "run"): string {
  const time = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${prefix}-${time}-${Math.random().toString(36).slice(2, 8)}`;
}

export function runtimeEvent(
  context: Pick<RunContext, "workflow" | "item">,
  type: string,
  fields: Omit<RuntimeEvent, "type" | "timestamp" | "workflowId" | "itemId"> = {}
): RuntimeEvent {
  return {
    type,
    timestamp: nowIso(),
    workflowId: context.workflow.workflowId,
    itemId: context.item.rowId,
    ...fields
  };
}
