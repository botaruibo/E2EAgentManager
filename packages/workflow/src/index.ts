import type { BrowserRuntime } from "../../browser/src/index.js";
import { evaluateRunPolicy, evaluateStepPolicy } from "../../policy/src/index.js";
import { ReplayEngine } from "../../replay/src/index.js";
import type {
  ExecutionMode,
  ProductInput,
  RunContext,
  RunItemResult,
  RuntimeEvent,
  WorkflowDefinition
} from "../../shared/src/index.js";
import { runtimeEvent } from "../../shared/src/index.js";
import { TraceCollector } from "../../trace/src/index.js";

export interface RunOptions {
  mode: ExecutionMode;
  approvals?: string[];
  startStepId?: string;
}

export interface BatchRunResult {
  results: RunItemResult[];
  trace: TraceCollector;
}

export class WorkflowEngine {
  private readonly replay: ReplayEngine;

  constructor(
    private readonly browser: BrowserRuntime,
    private readonly trace = new TraceCollector()
  ) {
    this.replay = new ReplayEngine(browser);
  }

  async runBatch(
    workflow: WorkflowDefinition,
    items: ProductInput[],
    options: RunOptions
  ): Promise<BatchRunResult> {
    const results: RunItemResult[] = [];
    try {
      for (let index = 0; index < items.length; index += 1) {
        results.push(await this.runItem(workflow, items[index], index, items.length, options));
      }
      return { results, trace: this.trace };
    } finally {
      await this.closeBrowser();
    }
  }

  private async runItem(
    workflow: WorkflowDefinition,
    item: ProductInput,
    itemIndex: number,
    batchSize: number,
    options: RunOptions
  ): Promise<RunItemResult> {
    const context: RunContext = {
      workflow,
      item,
      mode: options.mode,
      itemIndex,
      batchSize,
      approvals: new Set(options.approvals ?? [])
    };
    const events: RuntimeEvent[] = [];
    const emit = async (type: string, stepId?: string, message?: string, data?: unknown): Promise<void> => {
      const event = runtimeEvent(context, type, { stepId, message, data });
      events.push(event);
      this.trace.record(event);
    };

    await emit("item.started", undefined, `Started item ${item.rowId}`);
    const runDecision = evaluateRunPolicy(context);
    if (!runDecision.allow) {
      await emit(
        runDecision.requiresApproval ? "approval.required" : "policy.blocked",
        undefined,
        runDecision.reason
      );
      return {
        item,
        status: runDecision.requiresApproval ? "requires_approval" : "failed",
        events,
        error: runDecision.reason,
        checkpoint: {
          nextStepId: workflow.steps[0]?.id,
          retryCount: 0
        }
      };
    }

    const startStepIndex = resolveStartStepIndex(workflow, options.startStepId);
    if (!startStepIndex.ok) {
      await emit("resume.invalid", options.startStepId, startStepIndex.error);
      return {
        item,
        status: "failed",
        events,
        error: startStepIndex.error,
        checkpoint: {
          nextStepId: workflow.steps[0]?.id,
          retryCount: 0
        }
      };
    }
    if (options.startStepId) {
      await emit("item.resumed", options.startStepId, `Resumed item ${item.rowId} from step ${options.startStepId}`, {
        startStepId: options.startStepId
      });
    }

    const stepPolicy = preflightStepPolicy(context, workflow, startStepIndex.value);
    if (!stepPolicy.allow) {
      await emit(
        stepPolicy.requiresApproval ? "approval.required" : "policy.blocked",
        stepPolicy.stepId,
        stepPolicy.reason
      );
      return {
        item,
        status: stepPolicy.requiresApproval ? "requires_approval" : "failed",
        events,
        error: stepPolicy.reason,
        failedStepId: stepPolicy.requiresApproval ? undefined : stepPolicy.stepId,
        checkpoint: {
          nextStepId: stepPolicy.stepId,
          retryCount: 0
        }
      };
    }

    let lastStepId: string | undefined;
    let retryCount = 0;
    for (let stepIndex = startStepIndex.value; stepIndex < workflow.steps.length; stepIndex += 1) {
      const step = workflow.steps[stepIndex];
      const maxRetry = workflow.policy.maxRetryPerItem ?? 0;
      let attempt = 0;

      while (attempt <= maxRetry) {
        await emit("step.started", step.id, undefined, { attempt: attempt + 1, maxRetry });
        const result = await this.replay.executeStep(context, step);
        const stepEvent = runtimeEvent(context, result.skipped ? "step.skipped" : result.ok ? "step.succeeded" : "step.failed", {
          stepId: step.id,
          message: result.message,
          data: {
            ...(isObject(result.data) ? result.data : {}),
            attempt: attempt + 1,
            maxRetry
          }
        });
        events.push(stepEvent);
        const snapshot = await this.safeSnapshot();
        this.trace.record(stepEvent, snapshot);

        if (result.ok) {
          lastStepId = step.id;
          break;
        }

        const intervention = detectHumanInterventionSignal(result.message, snapshot);
        if (intervention) {
          const interventionEvent = runtimeEvent(context, "human_intervention.required", {
            stepId: step.id,
            message: intervention.reason,
            data: {
              category: intervention.category,
              matchedText: intervention.matchedText
            }
          });
          events.push(interventionEvent);
          this.trace.record(interventionEvent, snapshot);
          return {
            item,
            status: "requires_approval",
            events,
            error: intervention.reason,
            failedStepId: step.id,
            checkpoint: {
              lastStepId,
              nextStepId: step.id,
              retryCount
            }
          };
        }

        const canRetry = !result.requiresApproval && attempt < maxRetry;
        if (!canRetry) {
          const snapshotEvent = runtimeEvent(context, "trace.captured", {
            stepId: step.id,
            message: `Captured trace for failed step ${step.id}`
          });
          events.push(snapshotEvent);
          this.trace.record(snapshotEvent);
          return {
            item,
            status: result.requiresApproval ? "requires_approval" : "failed",
            events,
            error: result.message,
            failedStepId: step.id,
            checkpoint: {
              lastStepId,
              nextStepId: step.id,
              retryCount
            }
          };
        }

        retryCount += 1;
        await emit("step.retrying", step.id, `Retrying step ${step.id}`, {
          nextAttempt: attempt + 2,
          maxRetry
        });
        attempt += 1;
      }
    }

    await emit("item.completed", undefined, `Completed item ${item.rowId}`);
    return {
      item,
      status: "success",
      events,
      checkpoint: {
        lastStepId,
        retryCount
      }
    };
  }

  private async safeSnapshot(): Promise<Record<string, unknown>> {
    try {
      return await this.browser.snapshot();
    } catch (error) {
      return {
        snapshotError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async closeBrowser(): Promise<void> {
    try {
      await this.browser.close?.();
    } catch {
      // Closing is best-effort because a cleanup failure should not hide the run result.
    }
  }
}

function preflightStepPolicy(
  context: RunContext,
  workflow: WorkflowDefinition,
  startStepIndex: number
): { allow: true } | { allow: false; requiresApproval?: boolean; reason?: string; stepId: string } {
  for (let stepIndex = startStepIndex; stepIndex < workflow.steps.length; stepIndex += 1) {
    const step = workflow.steps[stepIndex];
    if (step.skipWhen === "{{mode == 'dry_run'}}" && context.mode === "dry_run") {
      continue;
    }
    const decision = evaluateStepPolicy(context, step);
    if (!decision.allow) {
      return {
        allow: false,
        requiresApproval: decision.requiresApproval,
        reason: decision.reason,
        stepId: step.id
      };
    }
  }
  return { allow: true };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectHumanInterventionSignal(
  message: string | undefined,
  snapshot: Record<string, unknown>
): { category: "login" | "captcha" | "risk_control"; matchedText: string; reason: string } | undefined {
  const text = [
    message,
    snapshot.title,
    snapshot.url,
    snapshot.domTextSample,
    snapshot.openedUrl,
    snapshot.pageText
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();

  const signals: Array<{ category: "login" | "captcha" | "risk_control"; keywords: string[]; reason: string }> = [
    {
      category: "captcha",
      keywords: ["验证码", "captcha", "滑块", "拖动滑块", "安全验证", "人机验证"],
      reason: "Human intervention required: captcha or verification challenge detected."
    },
    {
      category: "risk_control",
      keywords: ["风控", "风险", "risk control", "risk-control", "异常访问", "操作频繁", "安全拦截"],
      reason: "Human intervention required: risk-control or security block detected."
    },
    {
      category: "login",
      keywords: ["登录", "登陆", "login", "sign in", "重新登录", "请先登录", "未登录"],
      reason: "Human intervention required: login state appears invalid."
    }
  ];

  for (const signal of signals) {
    const matchedText = signal.keywords.find((keyword) => text.includes(keyword.toLowerCase()));
    if (matchedText) {
      return {
        category: signal.category,
        matchedText,
        reason: signal.reason
      };
    }
  }
  return undefined;
}

function resolveStartStepIndex(
  workflow: WorkflowDefinition,
  startStepId: string | undefined
): { ok: true; value: number } | { ok: false; error: string } {
  if (!startStepId) {
    return { ok: true, value: 0 };
  }
  const index = workflow.steps.findIndex((step) => step.id === startStepId);
  return index === -1
    ? { ok: false, error: `Cannot resume workflow ${workflow.workflowId}: step ${startStepId} was not found.` }
    : { ok: true, value: index };
}
