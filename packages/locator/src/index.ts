import type { WorkflowTarget } from "../../shared/src/index.js";

export interface LocatorCandidate {
  strategy: "role" | "label" | "text" | "css" | "xpath";
  value: string;
  score: number;
}

export interface LocatorSelection {
  selected?: LocatorCandidate;
  candidates: LocatorCandidate[];
  confidence: "auto" | "verify" | "manual";
}

export function buildLocatorCandidates(target: WorkflowTarget): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  if (target.role && target.text) {
    candidates.push({ strategy: "role", value: `${target.role}:${target.text}`, score: 0.94 });
  } else if (target.role) {
    candidates.push({ strategy: "role", value: target.role, score: 0.86 });
  }
  if (target.label) {
    candidates.push({ strategy: "label", value: target.label, score: 0.96 });
  }
  if (target.text) {
    candidates.push({ strategy: "text", value: target.text, score: 0.88 });
  }
  if (target.css) {
    candidates.push({ strategy: "css", value: target.css, score: 0.74 });
  }
  if (target.xpath) {
    candidates.push({ strategy: "xpath", value: target.xpath, score: 0.62 });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function selectLocator(target: WorkflowTarget): LocatorSelection {
  const candidates = buildLocatorCandidates(target);
  const selected = candidates[0];
  if (!selected || selected.score < 0.7) {
    return { selected, candidates, confidence: "manual" };
  }
  if (selected.score < 0.9) {
    return { selected, candidates, confidence: "verify" };
  }
  return { selected, candidates, confidence: "auto" };
}
