import type { RuntimeEvent, TraceEntry } from "../../shared/src/index.js";

export type { TraceEntry } from "../../shared/src/index.js";

export class TraceCollector {
  private entries: TraceEntry[] = [];

  record(event: RuntimeEvent, snapshot?: Record<string, unknown>): void {
    this.entries.push({ event, snapshot });
  }

  all(): TraceEntry[] {
    return [...this.entries];
  }
}
