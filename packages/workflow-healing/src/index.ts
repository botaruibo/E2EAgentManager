import { validateWorkflow } from "../../dsl/src/index.js";
import type { Result, WorkflowDefinition, WorkflowTarget } from "../../shared/src/index.js";
import { err, ok } from "../../shared/src/index.js";

export interface WorkflowPatch {
  stepId: string;
  target: WorkflowTarget;
  note?: string;
}

export interface WorkflowPatchResult {
  workflow: WorkflowDefinition;
  changedStepId: string;
  note?: string;
}

export function applyWorkflowPatch(
  workflow: WorkflowDefinition,
  patch: WorkflowPatch
): Result<WorkflowPatchResult> {
  const stepIndex = workflow.steps.findIndex((step) => step.id === patch.stepId);
  if (stepIndex === -1) {
    return err(`Step ${patch.stepId} was not found.`);
  }

  const step = workflow.steps[stepIndex];
  if (step.type !== "browser.click" && step.type !== "browser.input") {
    return err(`Step ${patch.stepId} does not support target patching.`);
  }

  if (!hasTargetSignal(patch.target)) {
    return err("Patch target must include at least one locator signal.");
  }

  const patched: WorkflowDefinition = {
    ...workflow,
    steps: workflow.steps.map((candidate, index) =>
      index === stepIndex
        ? {
            ...candidate,
            target: patch.target
          }
        : candidate
    )
  };

  const validation = validateWorkflow(patched);
  if (!validation.ok) {
    return err(validation.errors);
  }

  return ok({
    workflow: patched,
    changedStepId: patch.stepId,
    note: patch.note
  });
}

export function suggestTargetFromLocatorEvidence(data: unknown): WorkflowTarget | undefined {
  if (!isObject(data)) {
    return undefined;
  }

  const locator = isObject(data.locator) ? data.locator : data;
  const selected = isObject(locator.selected) ? locator.selected : undefined;
  if (!selected) {
    return undefined;
  }

  const strategy = typeof selected.strategy === "string" ? selected.strategy : undefined;
  const value = typeof selected.value === "string" ? selected.value : undefined;
  if (!strategy || !value) {
    return undefined;
  }

  if (strategy === "label") {
    return { label: value };
  }
  if (strategy === "text") {
    return { text: value };
  }
  if (strategy === "css") {
    return { css: value };
  }
  if (strategy === "xpath") {
    return { xpath: value };
  }
  if (strategy === "role") {
    const [role, ...nameParts] = value.split(":");
    const text = nameParts.join(":");
    return text ? { role, text } : { role };
  }

  return undefined;
}

function hasTargetSignal(target: WorkflowTarget): boolean {
  return Boolean(target.role || target.label || target.text || target.css || target.xpath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
