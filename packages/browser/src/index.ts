import type { StepResult, WorkflowExpectation, WorkflowExtractSpec, WorkflowTarget } from "../../shared/src/index.js";
import type { LocatorCandidate } from "../../locator/src/index.js";

export interface BrowserRuntime {
  open(url: string, timeoutMs?: number): Promise<StepResult>;
  click(candidate: LocatorCandidate, target: WorkflowTarget, timeoutMs?: number): Promise<StepResult>;
  input(candidate: LocatorCandidate, target: WorkflowTarget, value: string, timeoutMs?: number): Promise<StepResult>;
  press?(key: string, candidate?: LocatorCandidate, target?: WorkflowTarget, timeoutMs?: number): Promise<StepResult>;
  extract?(spec: WorkflowExtractSpec, timeoutMs?: number): Promise<StepResult>;
  verify(expectation: WorkflowExpectation, timeoutMs?: number): Promise<StepResult>;
  wait(timeoutMs: number): Promise<StepResult>;
  snapshot(): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

export class FakeBrowserRuntime implements BrowserRuntime {
  private pageText = "百应 橱窗 商品";
  private openedUrl?: string;
  private values = new Map<string, string>();

  async open(url: string, timeoutMs?: number): Promise<StepResult> {
    this.openedUrl = url;
    return { ok: true, message: `Opened ${url}`, data: timeoutMs ? { timeoutMs } : undefined };
  }

  async click(candidate: LocatorCandidate, target: WorkflowTarget, timeoutMs?: number): Promise<StepResult> {
    const label = target.text ?? target.label ?? candidate.value;
    if (label.includes("确认添加")) {
      this.pageText += " 添加成功";
    }
    return { ok: true, message: `Clicked ${candidate.strategy}:${candidate.value}`, data: timeoutMs ? { timeoutMs } : undefined };
  }

  async input(candidate: LocatorCandidate, target: WorkflowTarget, value: string, timeoutMs?: number): Promise<StepResult> {
    const key = target.label ?? target.text ?? candidate.value;
    this.values.set(key, value);
    return { ok: true, message: `Filled ${key}`, data: { value, ...(timeoutMs ? { timeoutMs } : {}) } };
  }

  async press(key: string, candidate?: LocatorCandidate, target?: WorkflowTarget, timeoutMs?: number): Promise<StepResult> {
    return {
      ok: true,
      message: `Pressed ${key}${candidate ? ` on ${candidate.strategy}:${candidate.value}` : ""}`,
      data: {
        key,
        target,
        ...(timeoutMs ? { timeoutMs } : {})
      }
    };
  }

  async extract(spec: WorkflowExtractSpec, timeoutMs?: number): Promise<StepResult> {
    const rows = [
      {
        id: `${spec.entity}-1`,
        url: this.openedUrl,
        title: "示例标题",
        text: this.pageText
      }
    ].slice(0, spec.limit ?? 1);
    return {
      ok: true,
      message: `Extracted ${rows.length} ${spec.entity} row(s)`,
      data: {
        entity: spec.entity,
        rows,
        ...(timeoutMs ? { timeoutMs } : {})
      }
    };
  }

  async verify(expectation: WorkflowExpectation, timeoutMs?: number): Promise<StepResult> {
    if (expectation.textExists) {
      return this.pageText.includes(expectation.textExists)
        ? { ok: true, message: `Verified text ${expectation.textExists}`, data: timeoutMs ? { timeoutMs } : undefined }
        : { ok: false, message: `Missing text ${expectation.textExists}`, data: timeoutMs ? { timeoutMs } : undefined };
    }

    if (expectation.anyTextExists) {
      const matched = expectation.anyTextExists.find((text) => this.pageText.includes(text));
      return matched
        ? { ok: true, message: `Verified text ${matched}`, data: timeoutMs ? { timeoutMs } : undefined }
        : { ok: false, message: `Missing any expected text: ${expectation.anyTextExists.join(", ")}`, data: timeoutMs ? { timeoutMs } : undefined };
    }

    return { ok: true, message: "No expectation defined", data: timeoutMs ? { timeoutMs } : undefined };
  }

  async wait(timeoutMs: number): Promise<StepResult> {
    return { ok: true, message: `Waited ${timeoutMs}ms` };
  }

  async snapshot(): Promise<Record<string, unknown>> {
    return {
      openedUrl: this.openedUrl,
      pageText: this.pageText,
      values: Object.fromEntries(this.values)
    };
  }

  async close(): Promise<void> {}
}

export type { PlaywrightBrowserRuntimeConfig } from "./playwright.js";
export { PlaywrightBrowserRuntime } from "./playwright.js";
export type { BrowserProfileStatus } from "./profile.js";
export { ensureBrowserProfileDir, inspectBrowserProfile, requireBrowserProfileReady } from "./profile.js";
