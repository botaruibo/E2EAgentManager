import type { BrowserRuntime } from "../../browser/src/index.js";
import { FakeBrowserRuntime } from "../../browser/src/index.js";
import { baiyingAddProductWorkflow, validateWorkflow } from "../../dsl/src/index.js";
import { parseProductsInput, type ProductInputFormat } from "../../local-data/src/index.js";
import type { ExecutionMode, Result, RunItemResult, WorkflowDefinition } from "../../shared/src/index.js";
import { err, ok } from "../../shared/src/index.js";
import { WorkflowEngine } from "../../workflow/src/index.js";

export interface RuntimeRunInput {
  workflow?: WorkflowDefinition;
  csv: string;
  inputFormat?: ProductInputFormat;
  mode: ExecutionMode;
  approvals?: string[];
  browser?: BrowserRuntime;
}

export interface RuntimeRunOutput {
  results: RunItemResult[];
  traceCount: number;
}

export async function runCommerceRuntime(input: RuntimeRunInput): Promise<Result<RuntimeRunOutput>> {
  const workflow = input.workflow ?? baiyingAddProductWorkflow;
  const workflowResult = validateWorkflow(workflow);
  if (!workflowResult.ok) {
    return err(workflowResult.errors);
  }

  const productsResult = parseProductsInput(input.csv, input.inputFormat ?? "auto");
  if (!productsResult.ok) {
    return err(productsResult.errors);
  }

  const engine = new WorkflowEngine(input.browser ?? new FakeBrowserRuntime());
  const run = await engine.runBatch(workflowResult.value, productsResult.value, {
    mode: input.mode,
    approvals: input.approvals
  });

  return ok({
    results: run.results,
    traceCount: run.trace.all().length
  });
}

export { baiyingAddProductWorkflow } from "../../dsl/src/index.js";
export { FakeBrowserRuntime } from "../../browser/src/index.js";
export { BaiyingMvpAppService } from "../../app-service/src/index.js";
export {
  appendRecordedAction,
  createRecorderSession,
  recordedActionsToWorkflow,
  recordedActionToStep
} from "../../recorder/src/index.js";
export {
  applyWorkflowPatch,
  suggestTargetFromLocatorEvidence
} from "../../workflow-healing/src/index.js";
