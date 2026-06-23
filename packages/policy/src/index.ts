import type { RunContext, StepResult, WorkflowStep } from "../../shared/src/index.js";

const HIGH_RISK_ACTION_PATTERNS = [
  "删除",
  "移除",
  "下架",
  "改价",
  "修改价格",
  "付款",
  "支付",
  "投放",
  "充值",
  "退款",
  "delete",
  "remove",
  "price",
  "pay",
  "payment",
  "ads",
  "advertise"
];

export interface PolicyDecision {
  allow: boolean;
  requiresApproval?: boolean;
  reason?: string;
}

export function evaluateRunPolicy(context: RunContext): PolicyDecision {
  const maxBatchSize = context.workflow.policy.maxBatchSize ?? 100;
  if (context.batchSize > maxBatchSize) {
    return {
      allow: false,
      reason: `Batch size ${context.batchSize} exceeds maxBatchSize ${maxBatchSize}.`
    };
  }

  if (context.mode === "batch" && requiresApproval(context, "batch")) {
    return {
      allow: false,
      requiresApproval: true,
      reason: "Batch execution requires approval."
    };
  }

  return { allow: true };
}

export function evaluateStepPolicy(context: RunContext, step: WorkflowStep): PolicyDecision {
  const highRiskMatch = highRiskActionMatch(step);
  if (highRiskMatch) {
    return {
      allow: false,
      reason: `Policy blocked high-risk step ${step.id}: matched "${highRiskMatch}".`
    };
  }

  if (step.approvalRequired && requiresApproval(context, "final_submit")) {
    return {
      allow: false,
      requiresApproval: true,
      reason: `Step ${step.id} requires final_submit approval.`
    };
  }

  if (step.type === "flow.approval" && step.flow?.approvalKey && requiresApproval(context, step.flow.approvalKey)) {
    return {
      allow: false,
      requiresApproval: true,
      reason: `Step ${step.id} requires ${step.flow.approvalKey} approval.`
    };
  }

  return { allow: true };
}

export function policyDecisionToStepResult(decision: PolicyDecision): StepResult {
  return {
    ok: decision.allow,
    requiresApproval: decision.requiresApproval,
    message: decision.reason
  };
}

function requiresApproval(context: RunContext, approvalKey: string): boolean {
  const required = context.workflow.policy.requireApprovalFor ?? [];
  return required.includes(approvalKey) && !context.approvals.has(approvalKey);
}

function highRiskActionMatch(step: WorkflowStep): string | undefined {
  const haystack = [
    step.id,
    step.url,
    step.value,
    step.target?.role,
    step.target?.label,
    step.target?.text,
    step.target?.css,
    step.target?.xpath,
    step.strategy?.goal,
    step.strategy?.successCriteria,
    ...(step.strategy?.allowedActions ?? [])
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return HIGH_RISK_ACTION_PATTERNS.find((pattern) => haystack.includes(pattern.toLowerCase()));
}
