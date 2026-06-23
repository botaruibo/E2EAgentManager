import type { BrowserRuntime } from "../../browser/src/index.js";
import { selectLocator } from "../../locator/src/index.js";
import { evaluateStepPolicy, policyDecisionToStepResult } from "../../policy/src/index.js";
import type { RunContext, StepResult, WorkflowStep } from "../../shared/src/index.js";

export class ReplayEngine {
  constructor(private readonly browser: BrowserRuntime) {}

  async executeStep(context: RunContext, step: WorkflowStep): Promise<StepResult> {
    try {
      if (shouldSkipStep(context, step)) {
        return { ok: true, skipped: true, message: `Skipped ${step.id}` };
      }

      const decision = evaluateStepPolicy(context, step);
      if (!decision.allow) {
        return policyDecisionToStepResult(decision);
      }

      if (step.type === "browser.open") {
        return this.browser.open(bindVariables(step.url ?? "", context), step.timeoutMs);
      }
      if (step.type.startsWith("flow.")) {
        return executeFlowStep(context, step);
      }
      if (step.type.startsWith("strategy.")) {
        return executeStrategyStep(context, step);
      }
      if (step.type === "browser.verify") {
        return this.browser.verify(step.expectation ?? {}, step.timeoutMs);
      }
      if (step.type === "browser.wait") {
        return this.browser.wait(step.timeoutMs ?? 1000);
      }
      if (step.type === "browser.extract") {
        if (!this.browser.extract) {
          return { ok: false, message: "Browser runtime does not support extraction." };
        }
        return this.browser.extract(step.extract ?? { entity: "unknown" }, step.timeoutMs);
      }
      if (step.type === "browser.press" && !step.target) {
        if (!this.browser.press) {
          return { ok: false, message: "Browser runtime does not support keyboard press." };
        }
        return this.browser.press(bindVariables(step.key ?? "", context), undefined, undefined, step.timeoutMs);
      }

      if (!step.target) {
        return { ok: false, message: `Step ${step.id} requires target.` };
      }

      const selection = selectLocator(step.target);
      if (!selection.selected || selection.confidence === "manual") {
        return {
          ok: false,
          requiresApproval: true,
          message: `Step ${step.id} requires manual locator confirmation.`,
          data: selection
        };
      }

      if (step.type === "browser.click") {
        return withLocatorEvidence(
          await this.browser.click(selection.selected, step.target, step.timeoutMs),
          selection
        );
      }

      if (step.type === "browser.input") {
        return withLocatorEvidence(
          await this.browser.input(selection.selected, step.target, bindVariables(step.value ?? "", context), step.timeoutMs),
          selection
        );
      }

      if (step.type === "browser.press") {
        if (!this.browser.press) {
          return { ok: false, message: "Browser runtime does not support keyboard press." };
        }
        return withLocatorEvidence(
          await this.browser.press(bindVariables(step.key ?? "", context), selection.selected, step.target, step.timeoutMs),
          selection
        );
      }

      return { ok: false, message: `Unsupported step type ${step.type}.` };
    } catch (error) {
      return {
        ok: false,
        message: `Step ${step.id} failed: ${errorMessage(error)}`,
        data: {
          errorName: error instanceof Error ? error.name : undefined
        }
      };
    }
  }
}

function executeFlowStep(context: RunContext, step: WorkflowStep): StepResult {
  if (step.type === "flow.approval") {
    return {
      ok: true,
      message: `Approved control checkpoint ${step.flow?.approvalKey ?? step.id}.`,
      data: {
        layer: "control",
        flow: step.flow
      }
    };
  }
  return {
    ok: true,
    message: `Evaluated control node ${step.id}.`,
    data: {
      layer: "control",
      flow: bindFlowData(context, step)
    }
  };
}

function executeStrategyStep(context: RunContext, step: WorkflowStep): StepResult {
  const strategy = step.strategy;
  return {
    ok: true,
    message: `Evaluated strategy node ${step.id}${strategy?.kind ? ` (${strategy.kind})` : ""}.`,
    data: {
      layer: "strategy",
      strategy: strategy
        ? {
            ...strategy,
            resolvedInputs: resolveStrategyInputs(strategy.inputs ?? [], context),
            adapter: "deterministic-placeholder"
          }
        : undefined
    }
  };
}

export function bindVariables(template: string, context: RunContext): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const keys = rawKey
      .split("||")
      .map((key) => key.trim())
      .filter(Boolean);
    for (const key of keys) {
      const value = bindVariable(key, context);
      if (value) {
        return value;
      }
    }
    return "";
  });
}

function bindVariable(key: string, context: RunContext): string {
  if (key === "mode") {
    return context.mode;
  }
  const value = context.item[key as keyof typeof context.item];
  return typeof value === "string" ? value : "";
}

function shouldSkipStep(context: RunContext, step: WorkflowStep): boolean {
  return step.skipWhen === "{{mode == 'dry_run'}}" && context.mode === "dry_run";
}

function bindFlowData(context: RunContext, step: WorkflowStep): Record<string, unknown> | undefined {
  if (!step.flow) {
    return undefined;
  }
  return {
    ...step.flow,
    condition: step.flow.condition ? bindVariables(step.flow.condition, context) : undefined
  };
}

function resolveStrategyInputs(inputs: string[], context: RunContext): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of inputs) {
    values[input] = bindVariable(input, context);
  }
  return values;
}

function withLocatorEvidence(
  result: StepResult,
  selection: ReturnType<typeof selectLocator>
): StepResult {
  return {
    ...result,
    data: {
      ...(isObject(result.data) ? result.data : {}),
      locator: selection
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
