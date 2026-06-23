import type { StoredRun, TraceEntry } from "../../../packages/shared/src/index.js";

export function renderTraceViewer(run: StoredRun): string {
  const rows = run.items.map((item) => {
    const traces = run.traces.filter((trace) => trace.event.itemId === item.item.rowId);
    const source = item.item.productUrl ?? item.item.productId ?? item.item.remark ?? "-";
    return `<section class="panel item">
      <div class="item-head">
        <div>
          <h2>${escapeHtml(item.item.title ?? item.item.rowId)}</h2>
          <span>${escapeHtml(item.item.rowId)}${source === "-" ? "" : ` · ${escapeHtml(source)}`}</span>
        </div>
        <strong class="badge ${statusClass(item.status)}">${escapeHtml(item.status)}</strong>
      </div>
      <div class="meta">
        <span>events ${item.events.length}</span>
        <span>retry ${item.checkpoint?.retryCount ?? 0}</span>
        <span>failed step ${escapeHtml(item.failedStepId ?? "-")}</span>
      </div>
      <ol>${traces.map(renderTraceEntry).join("\n")}</ol>
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trace Viewer · ${escapeHtml(run.summary.runId)}</title>
  <style>${styles()}</style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Trace Viewer</h1>
        <p>${escapeHtml(run.summary.employeeName ?? "员工运行")} ${escapeHtml(run.summary.employeeId ?? "-")} · ${escapeHtml(run.summary.runId)} · ${escapeHtml(run.summary.workflowId)} · ${escapeHtml(run.summary.mode)}</p>
      </div>
      <a href="${escapeHtml(traceJsonHref(run))}">Download trace.json</a>
    </header>
    <section class="summary">
      ${metric("Total", run.summary.totalItems)}
      ${metric("Success", run.summary.successCount)}
      ${metric("Failed", run.summary.failedCount)}
      ${metric("Approval", run.summary.approvalCount)}
      ${metric("Trace Entries", run.traces.length)}
    </section>
    ${rows || '<section class="panel"><h2>No run items</h2></section>'}
  </main>
</body>
</html>`;
}

export function renderTraceJsonViewer(run: StoredRun): string {
  const json = JSON.stringify(run, null, 2);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trace JSON · ${escapeHtml(run.summary.runId)}</title>
  <style>${styles()}</style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Trace JSON</h1>
        <p>${escapeHtml(run.summary.employeeName ?? "员工运行")} ${escapeHtml(run.summary.employeeId ?? "-")} · ${escapeHtml(run.summary.runId)} · ${escapeHtml(run.summary.workflowId)} · ${escapeHtml(run.summary.mode)}</p>
      </div>
      <nav class="actions">
        <button type="button" onclick="history.back()">返回试跑验证</button>
        <button type="button" onclick="window.close()">关闭页面</button>
        <a href="${escapeHtml(traceJsonHref(run))}">下载原始 JSON</a>
      </nav>
    </header>
    <section class="panel">
      <pre class="json">${escapeHtml(json)}</pre>
    </section>
  </main>
</body>
</html>`;
}

function traceJsonHref(run: StoredRun): string {
  return run.summary.employeeId
    ? `/api/employees/${encodeURIComponent(run.summary.employeeId)}/runs/${encodeURIComponent(run.summary.runId)}/trace.json`
    : `/api/runs/${encodeURIComponent(run.summary.runId)}/trace.json`;
}

function renderTraceEntry(trace: TraceEntry): string {
  const label = trace.event.stepId ? `${trace.event.type} / ${trace.event.stepId}` : trace.event.type;
  return `<li>
    <strong>${escapeHtml(label)}</strong>
    <span>${escapeHtml(trace.event.timestamp)}</span>
    <p>${escapeHtml(trace.event.message ?? "No message.")}</p>
    ${trace.event.data ? `<pre>${escapeHtml(JSON.stringify(trace.event.data, null, 2))}</pre>` : ""}
    ${trace.snapshot ? `<p class="snapshot">${escapeHtml(snapshotSummary(trace.snapshot))}</p>` : ""}
  </li>`;
}

function snapshotSummary(snapshot: Record<string, unknown>): string {
  const parts = [
    stringValue(snapshot.title),
    stringValue(snapshot.url),
    stringValue(snapshot.openedUrl),
    typeof snapshot.htmlLength === "number" ? `${snapshot.htmlLength} html chars` : undefined,
    typeof snapshot.domTextLength === "number" ? `${snapshot.domTextLength} visible text chars` : undefined,
    stringValue(snapshot.domTextSample),
    stringValue(snapshot.accessibilitySnapshot),
    typeof snapshot.accessibilitySnapshotError === "string" ? `accessibility error: ${snapshot.accessibilitySnapshotError}` : undefined,
    screenshotSummary(snapshot),
    typeof snapshot.screenshotError === "string" ? `screenshot error: ${snapshot.screenshotError}` : undefined
  ];
  return parts.filter(Boolean).join(" | ") || "snapshot captured";
}

function screenshotSummary(snapshot: Record<string, unknown>): string | undefined {
  const screenshot = snapshot.screenshot;
  if (typeof screenshot !== "object" || screenshot === null || Array.isArray(screenshot)) {
    return undefined;
  }
  const bytes = "bytes" in screenshot && typeof screenshot.bytes === "number" ? screenshot.bytes : undefined;
  const mimeType = "mimeType" in screenshot && typeof screenshot.mimeType === "string" ? screenshot.mimeType : "screenshot";
  return typeof bytes === "number" ? `${mimeType} ${bytes} bytes` : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function statusClass(status: string): string {
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  if (status === "requires_approval") return "approval";
  return "neutral";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styles(): string {
  return `
    :root { --bg:#f5f7fb; --panel:#fff; --line:#dbe2ee; --text:#111827; --muted:#667085; --blue:#2563eb; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); }
    main { max-width:1180px; margin:0 auto; padding:28px; }
    header { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:18px; }
    h1 { margin:0; font-size:24px; }
    h2 { margin:0; font-size:15px; }
    p { margin:6px 0 0; color:var(--muted); font-size:13px; }
    a { color:var(--blue); font-weight:700; text-decoration:none; }
    button { border:1px solid var(--line); border-radius:7px; background:#fff; color:#344054; padding:9px 12px; font:inherit; font-size:13px; font-weight:800; cursor:pointer; }
    .actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap; }
    .summary { display:grid; grid-template-columns:repeat(5, 1fr); gap:12px; margin-bottom:18px; }
    .metric, .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    .metric { padding:16px; }
    .metric span { display:block; color:var(--muted); font-size:12px; margin-bottom:8px; }
    .metric strong { font-size:24px; }
    .panel { padding:18px; margin-bottom:14px; }
    .item-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .item-head span, .meta span, li span { color:var(--muted); font-size:12px; }
    .meta { display:flex; gap:12px; margin:12px 0; }
    ol { margin:0; padding-left:22px; display:grid; gap:12px; }
    li strong { font-size:13px; }
    pre { white-space:pre-wrap; overflow:auto; background:#f8fafc; border:1px solid var(--line); border-radius:6px; padding:10px; font-size:12px; }
    pre.json { max-height:none; margin:0; line-height:1.55; }
    .snapshot { color:#344054; }
    .badge { border-radius:5px; padding:5px 8px; font-size:11px; text-transform:uppercase; }
    .badge.success { color:#067647; background:#dcfae6; } .badge.failed { color:#b42318; background:#fee4e2; } .badge.approval { color:#c2410c; background:#ffedd5; } .badge.neutral { color:#475467; background:#eef2f6; }
    @media (max-width: 760px) { main { padding:18px; } header { align-items:flex-start; flex-direction:column; } .summary { grid-template-columns:1fr 1fr; } }
  `;
}
