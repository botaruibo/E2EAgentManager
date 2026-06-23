import type { Result, WorkflowDefinition, WorkflowNodeLayer, WorkflowStep, WorkflowStrategyAction, WorkflowStrategyFailureBehavior, WorkflowStrategyKind, WorkflowStepType } from "../../shared/src/index.js";
import { err, ok } from "../../shared/src/index.js";

const INPUT_TYPES = new Set(["string", "enum"]);
const PRIMITIVE_STEP_TYPES = new Set<WorkflowStepType>([
  "browser.open",
  "browser.click",
  "browser.input",
  "browser.verify",
  "browser.press",
  "browser.extract",
  "browser.wait"
]);
const CONTROL_STEP_TYPES = new Set<WorkflowStepType>([
  "flow.if",
  "flow.loop",
  "flow.map",
  "flow.retry",
  "flow.approval"
]);
const STRATEGY_STEP_TYPES = new Set<WorkflowStepType>([
  "strategy.decide",
  "strategy.select",
  "strategy.extract",
  "strategy.recover"
]);
const STEP_TYPES = new Set<WorkflowStepType>([
  ...PRIMITIVE_STEP_TYPES,
  ...CONTROL_STEP_TYPES,
  ...STRATEGY_STEP_TYPES
]);
const NODE_LAYERS = new Set<WorkflowNodeLayer>(["primitive", "control", "strategy"]);
const STRATEGY_KINDS = new Set<WorkflowStrategyKind>(["decide", "select", "extract", "recover"]);
const STRATEGY_ACTIONS = new Set<WorkflowStrategyAction>([
  "read",
  "click",
  "input",
  "verify",
  "extract",
  "submit",
  "delete",
  "payment",
  "send_message",
  "record_failure",
  "request_human"
]);
const STRATEGY_FAILURE_BEHAVIORS = new Set<WorkflowStrategyFailureBehavior>([
  "record_and_continue",
  "retry",
  "pause_for_human",
  "fail_run"
]);

export const workflowNodeTaxonomy = {
  primitive: [...PRIMITIVE_STEP_TYPES],
  control: [...CONTROL_STEP_TYPES],
  strategy: [...STRATEGY_STEP_TYPES],
  strategyKinds: [...STRATEGY_KINDS]
} as const;

export function validateWorkflow(input: unknown): Result<WorkflowDefinition> {
  const errors: string[] = [];
  const workflow = input as Partial<WorkflowDefinition>;

  if (!workflow || typeof workflow !== "object") {
    return err("Workflow must be an object.");
  }

  if (workflow.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.");
  }
  if (!workflow.workflowId) {
    errors.push("workflowId is required.");
  }
  if (!workflow.name) {
    errors.push("name is required.");
  }
  if (!workflow.inputs || typeof workflow.inputs !== "object") {
    errors.push("inputs must be an object.");
  } else {
    validateInputs(workflow.inputs, errors);
  }
  if (!workflow.policy || typeof workflow.policy !== "object") {
    errors.push("policy must be an object.");
  } else {
    validatePolicy(workflow.policy, errors);
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push("steps must contain at least one step.");
  } else {
    workflow.steps.forEach((step, index) => validateStep(step, index, errors));
    validateUniqueStepIds(workflow.steps, errors);
  }

  return errors.length > 0 ? err(errors) : ok(workflow as WorkflowDefinition);
}

function validateInputs(inputs: WorkflowDefinition["inputs"], errors: string[]): void {
  for (const [name, spec] of Object.entries(inputs)) {
    const prefix = `inputs.${name}`;
    if (!spec || typeof spec !== "object") {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (!INPUT_TYPES.has(spec.type)) {
      errors.push(`${prefix}.type must be string or enum.`);
    }
    if (spec.required !== undefined && typeof spec.required !== "boolean") {
      errors.push(`${prefix}.required must be a boolean.`);
    }
    if (spec.default !== undefined && typeof spec.default !== "string") {
      errors.push(`${prefix}.default must be a string.`);
    }
    if (spec.type === "enum") {
      if (!Array.isArray(spec.values) || spec.values.length === 0 || spec.values.some((value) => typeof value !== "string")) {
        errors.push(`${prefix}.values must be a non-empty array of strings for enum inputs.`);
      } else if (spec.default !== undefined && !spec.values.includes(spec.default)) {
        errors.push(`${prefix}.default must be one of ${spec.values.join(", ")}.`);
      }
    }
    if (spec.type === "string" && spec.values !== undefined) {
      errors.push(`${prefix}.values is only supported for enum inputs.`);
    }
  }
}

function validatePolicy(policy: WorkflowDefinition["policy"], errors: string[]): void {
  if (policy.requireApprovalFor !== undefined) {
    if (!Array.isArray(policy.requireApprovalFor) || policy.requireApprovalFor.some((value) => typeof value !== "string")) {
      errors.push("policy.requireApprovalFor must be an array of strings.");
    }
  }
  if (policy.maxBatchSize !== undefined && (!Number.isFinite(policy.maxBatchSize) || policy.maxBatchSize <= 0)) {
    errors.push("policy.maxBatchSize must be a positive number.");
  }
  if (policy.maxRetryPerItem !== undefined && (!Number.isFinite(policy.maxRetryPerItem) || policy.maxRetryPerItem < 0)) {
    errors.push("policy.maxRetryPerItem must be a non-negative number.");
  }
}

function validateUniqueStepIds(steps: WorkflowStep[], errors: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of steps) {
    if (!step.id) {
      continue;
    }
    if (seen.has(step.id)) {
      duplicates.add(step.id);
    }
    seen.add(step.id);
  }
  if (duplicates.size > 0) {
    errors.push(`steps.id values must be unique. Duplicates: ${[...duplicates].join(", ")}.`);
  }
}

function validateStep(step: WorkflowStep, index: number, errors: string[]): void {
  const prefix = `steps[${index}]`;
  if (!step.id) {
    errors.push(`${prefix}.id is required.`);
  }
  if (!STEP_TYPES.has(step.type)) {
    errors.push(`${prefix}.type is invalid.`);
  }
  validateStepLayer(step, prefix, errors);
  if (step.type === "browser.open" && !step.url) {
    errors.push(`${prefix}.url is required for browser.open.`);
  }
  if ((step.type === "browser.click" || step.type === "browser.input") && !step.target) {
    errors.push(`${prefix}.target is required for ${step.type}.`);
  }
  if (step.type === "browser.input" && step.value === undefined) {
    errors.push(`${prefix}.value is required for browser.input.`);
  }
  if (step.type === "browser.press" && !step.key) {
    errors.push(`${prefix}.key is required for browser.press.`);
  }
  if (step.type === "browser.extract") {
    if (!step.extract || typeof step.extract !== "object") {
      errors.push(`${prefix}.extract is required for browser.extract.`);
    } else {
      if (!step.extract.entity) {
        errors.push(`${prefix}.extract.entity is required for browser.extract.`);
      }
      if (step.extract.limit !== undefined && (!Number.isFinite(step.extract.limit) || step.extract.limit <= 0)) {
        errors.push(`${prefix}.extract.limit must be a positive number.`);
      }
    }
  }
  if (step.type === "browser.verify" && !step.expectation) {
    errors.push(`${prefix}.expectation is required for browser.verify.`);
  }
  if (CONTROL_STEP_TYPES.has(step.type)) {
    validateControlStep(step, prefix, errors);
  }
  if (STRATEGY_STEP_TYPES.has(step.type)) {
    validateStrategyStep(step, prefix, errors);
  }
  if (step.timeoutMs !== undefined && (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0)) {
    errors.push(`${prefix}.timeoutMs must be a positive number.`);
  }
}

function validateStepLayer(step: WorkflowStep, prefix: string, errors: string[]): void {
  if (step.layer !== undefined && !NODE_LAYERS.has(step.layer)) {
    errors.push(`${prefix}.layer must be primitive, control, or strategy.`);
    return;
  }
  const expectedLayer = stepLayerForType(step.type);
  if (step.layer !== undefined && expectedLayer && step.layer !== expectedLayer) {
    errors.push(`${prefix}.layer must be ${expectedLayer} for ${step.type}.`);
  }
}

function validateControlStep(step: WorkflowStep, prefix: string, errors: string[]): void {
  if (!step.flow || typeof step.flow !== "object") {
    errors.push(`${prefix}.flow is required for ${step.type}.`);
    return;
  }
  if (step.type === "flow.if" && !step.flow.condition) {
    errors.push(`${prefix}.flow.condition is required for flow.if.`);
  }
  if ((step.type === "flow.loop" || step.type === "flow.map") && !step.flow.source) {
    errors.push(`${prefix}.flow.source is required for ${step.type}.`);
  }
  if (step.type === "flow.retry" && (step.flow.retryLimit === undefined || !Number.isFinite(step.flow.retryLimit) || step.flow.retryLimit < 0)) {
    errors.push(`${prefix}.flow.retryLimit must be a non-negative number for flow.retry.`);
  }
  if (step.type === "flow.approval" && !step.flow.approvalKey) {
    errors.push(`${prefix}.flow.approvalKey is required for flow.approval.`);
  }
}

function validateStrategyStep(step: WorkflowStep, prefix: string, errors: string[]): void {
  if (!step.strategy || typeof step.strategy !== "object") {
    errors.push(`${prefix}.strategy is required for ${step.type}.`);
    return;
  }
  const expectedKind = step.type.replace("strategy.", "");
  if (!STRATEGY_KINDS.has(step.strategy.kind)) {
    errors.push(`${prefix}.strategy.kind must be decide, select, extract, or recover.`);
  } else if (step.strategy.kind !== expectedKind) {
    errors.push(`${prefix}.strategy.kind must be ${expectedKind} for ${step.type}.`);
  }
  if (!step.strategy.goal) {
    errors.push(`${prefix}.strategy.goal is required for ${step.type}.`);
  }
  if (!Array.isArray(step.strategy.allowedActions) || step.strategy.allowedActions.length === 0) {
    errors.push(`${prefix}.strategy.allowedActions must be a non-empty array.`);
  } else if (step.strategy.allowedActions.some((action) => !STRATEGY_ACTIONS.has(action))) {
    errors.push(`${prefix}.strategy.allowedActions contains an unsupported action.`);
  }
  if (step.strategy.deniedActions !== undefined) {
    if (!Array.isArray(step.strategy.deniedActions) || step.strategy.deniedActions.some((action) => !STRATEGY_ACTIONS.has(action))) {
      errors.push(`${prefix}.strategy.deniedActions must contain supported actions.`);
    }
  }
  if (!step.strategy.successCriteria) {
    errors.push(`${prefix}.strategy.successCriteria is required for ${step.type}.`);
  }
  if (!STRATEGY_FAILURE_BEHAVIORS.has(step.strategy.failureBehavior)) {
    errors.push(`${prefix}.strategy.failureBehavior must be record_and_continue, retry, pause_for_human, or fail_run.`);
  }
  if (step.strategy.evidenceRequired !== undefined && typeof step.strategy.evidenceRequired !== "boolean") {
    errors.push(`${prefix}.strategy.evidenceRequired must be a boolean.`);
  }
}

function stepLayerForType(type: WorkflowStep["type"]): WorkflowNodeLayer | undefined {
  if (PRIMITIVE_STEP_TYPES.has(type)) {
    return "primitive";
  }
  if (CONTROL_STEP_TYPES.has(type)) {
    return "control";
  }
  if (STRATEGY_STEP_TYPES.has(type)) {
    return "strategy";
  }
  return undefined;
}

export const baiyingAddProductWorkflow: WorkflowDefinition = {
  schemaVersion: 1,
  workflowId: "douyin-baiying-add-product-to-window",
  name: "Add Product To Douyin Baiying Window",
  inputs: {
    productUrl: { type: "string", required: false },
    productId: { type: "string", required: false },
    groupName: { type: "string", required: false },
    mode: { type: "enum", values: ["dry_run", "run_once", "batch"], default: "dry_run" }
  },
  policy: {
    requireApprovalFor: ["batch", "final_submit"],
    maxBatchSize: 100,
    maxRetryPerItem: 2
  },
  steps: [
    {
      id: "open_baiying",
      type: "browser.open",
      url: "https://buyin.jinritemai.com"
    },
    {
      id: "ensure_login",
      type: "browser.verify",
      expectation: {
        anyTextExists: ["百应", "橱窗", "商品"]
      }
    },
    {
      id: "open_product_window",
      type: "browser.click",
      target: {
        role: "menuitem",
        text: "橱窗"
      }
    },
    {
      id: "click_add_product",
      type: "browser.click",
      target: {
        role: "button",
        text: "添加商品"
      }
    },
    {
      id: "input_product",
      type: "browser.input",
      target: {
        role: "textbox",
        label: "商品链接"
      },
      value: "{{productUrl || productId}}"
    },
    {
      id: "confirm_add",
      type: "browser.click",
      target: {
        role: "button",
        text: "确认添加"
      },
      approvalRequired: true,
      skipWhen: "{{mode == 'dry_run'}}"
    },
    {
      id: "verify_added",
      type: "browser.verify",
      skipWhen: "{{mode == 'dry_run'}}",
      expectation: {
        anyTextExists: ["添加成功", "已添加", "商品已在橱窗"]
      }
    }
  ]
};
