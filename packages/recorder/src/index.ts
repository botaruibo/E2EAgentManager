import type {
  WorkflowDefinition,
  WorkflowExtractSpec,
  WorkflowExpectation,
  WorkflowStrategySpec,
  WorkflowStep,
  WorkflowTarget
} from "../../shared/src/index.js";

export type RecordedActionType = "open" | "click" | "input" | "press" | "verify" | "extract" | "wait" | "strategy";

export interface RecordedAction {
  id?: string;
  type: RecordedActionType;
  intent?: string;
  url?: string;
  target?: WorkflowTarget;
  value?: string;
  key?: string;
  extract?: WorkflowExtractSpec;
  expectation?: WorkflowExpectation;
  strategyType?: "strategy.decide" | "strategy.select" | "strategy.extract" | "strategy.recover";
  name?: string;
  strategy?: WorkflowStrategySpec;
  timeoutMs?: number;
  approvalRequired?: boolean;
  skipWhen?: string;
}

export interface RecorderSession {
  sessionId: string;
  name: string;
  actions: RecordedAction[];
}

export function createRecorderSession(sessionId: string, name: string): RecorderSession {
  return { sessionId, name, actions: [] };
}

export function appendRecordedAction(session: RecorderSession, action: RecordedAction): RecorderSession {
  const existingIds = session.actions.map((recorded) => recorded.id).filter(isString);
  return {
    ...session,
    actions: [...session.actions, normalizeRecordedAction(action, session.actions.length, existingIds)]
  };
}

export function recordedActionsToWorkflow(
  session: RecorderSession,
  workflowId: string,
  name = session.name
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId,
    name,
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
    steps: session.actions.map(recordedActionToStep)
  };
}

export function recordedActionToStep(action: RecordedAction): WorkflowStep {
  if (action.type === "open") {
    return {
      id: action.id ?? "open",
      type: "browser.open",
      url: required(action.url, `${action.id ?? "open"}.url`)
    };
  }

  if (action.type === "click") {
    return {
      id: action.id ?? "click",
      type: "browser.click",
      target: required(action.target, `${action.id ?? "click"}.target`),
      approvalRequired: action.approvalRequired,
      skipWhen: action.skipWhen
    };
  }

  if (action.type === "input") {
    return {
      id: action.id ?? "input",
      type: "browser.input",
      target: required(action.target, `${action.id ?? "input"}.target`),
      value: action.value ?? ""
    };
  }

  if (action.type === "press") {
    return {
      id: action.id ?? "press",
      type: "browser.press",
      target: action.target,
      key: action.key ?? "Enter"
    };
  }

  if (action.type === "verify") {
    return {
      id: action.id ?? "verify",
      type: "browser.verify",
      expectation: required(action.expectation, `${action.id ?? "verify"}.expectation`),
      skipWhen: action.skipWhen
    };
  }

  if (action.type === "extract") {
    return {
      id: action.id ?? "extract",
      type: "browser.extract",
      extract: required(action.extract, `${action.id ?? "extract"}.extract`)
    };
  }

  if (action.type === "strategy") {
    return {
      id: action.id ?? "strategy",
      type: action.strategyType ?? `strategy.${action.strategy?.kind ?? "select"}`,
      name: action.name,
      layer: "strategy",
      strategy: required(action.strategy, `${action.id ?? "strategy"}.strategy`)
    };
  }

  return {
    id: action.id ?? "wait",
    type: "browser.wait",
    timeoutMs: action.timeoutMs ?? 1000
  };
}

function normalizeRecordedAction(action: RecordedAction, index: number, existingIds: string[]): RecordedAction {
  const requestedId = action.id ?? normalizeActionId(action.intent) ?? `${action.type}_${index + 1}`;
  return {
    ...action,
    id: uniqueActionId(requestedId, existingIds)
  };
}

function uniqueActionId(requestedId: string, existingIds: string[]): string {
  if (!existingIds.includes(requestedId)) {
    return requestedId;
  }
  let suffix = 2;
  let candidate = `${requestedId}_${suffix}`;
  while (existingIds.includes(candidate)) {
    suffix += 1;
    candidate = `${requestedId}_${suffix}`;
  }
  return candidate;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Recorded action is missing ${name}.`);
  }
  return value;
}

function normalizeActionId(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || undefined;
}
