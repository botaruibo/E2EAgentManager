import type { RunConsoleView } from "../../../packages/app-service/src/index.js";

export function renderRunConsole(view: RunConsoleView): string {
  const rows = view.rows.map(renderRow).join("\n");
  const firstProblem = view.rows.find((row) => row.error || row.status === "requires_approval");
  const selectedTraceRow = firstProblem ?? view.rows[0];
  const traceTitle = selectedTraceRow?.title ?? "No item selected";
  const traceStatus = selectedTraceRow?.status ?? "pending";
  const timeline = selectedTraceRow ? renderTimeline(selectedTraceRow.timeline) : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Douyin Baiying Automation MVP</title>
  <style>${styles()}</style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">抖</div>
        <div>
          <strong>Douyin Baiying</strong>
          <span>Automation MVP</span>
        </div>
      </div>
      <nav>
        <a class="active">Run</a>
        <a>Workflow</a>
        <a>Trace</a>
        <a>Settings</a>
      </nav>
    </aside>

    <main>
      <header class="topbar">
        <h1>Batch Add Products To Window</h1>
        <div class="env">Environment <strong>Local Fake Runtime</strong></div>
      </header>

      <section class="grid">
        <section class="panel config">
          <h2>Run Configuration</h2>
          <label>Input CSV / JSON</label>
          <div class="dropzone">
            <strong>examples/products.csv</strong>
            <span>CSV or JSON rows are normalized into productUrl, title, groupName, and remark.</span>
          </div>
          <label>Mode</label>
          <div class="segments">
            ${segment("dry_run", view.summary.mode === "dry_run")}
            ${segment("run_once", view.summary.mode === "run_once")}
            ${segment("batch", view.summary.mode === "batch")}
          </div>
          <div class="toggles">
            <span>Require approval for final submit</span>
            <strong>On</strong>
            <span>Batch safety gate</span>
            <strong>${view.summary.mode === "batch" ? "Required" : "Ready"}</strong>
          </div>
          <button>Run</button>
        </section>

        <section class="panel status">
          <div class="panel-title">
            <h2>Workflow Status</h2>
            <span>Run ID ${escapeHtml(view.summary.runId)} · ${escapeHtml(view.summary.workflowVersionId ?? "default workflow")}</span>
          </div>
          <div class="metrics">
            ${metric("Total", view.summary.totalItems, "blue")}
            ${metric("Success", view.summary.successCount, "green")}
            ${metric("Failed", view.summary.failedCount, "red")}
            ${metric("Approval Required", view.summary.approvalCount, "orange")}
          </div>
        </section>
      </section>

      <section class="workspace">
        <section class="panel results">
          <div class="panel-title">
            <h2>Run Results</h2>
            <span>${escapeHtml(view.summary.status)}</span>
          </div>
          <div class="table-tools">
            <input value="" placeholder="Search by product title or URL">
            <button class="secondary">Export CSV</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Product Title</th>
                <th>Product URL</th>
                <th>Status</th>
                <th>Events</th>
                <th>Retry</th>
                <th>Failed Step</th>
                <th>Resume Step</th>
                <th>Category</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>

        <aside class="panel trace">
          <div class="panel-title">
            <h2>Trace Preview</h2>
            <span>${escapeHtml(traceStatus)}</span>
          </div>
          <h3>${escapeHtml(traceTitle)}</h3>
          <ol>${timeline}</ol>
        </aside>
      </section>
    </main>
  </div>
</body>
</html>`;
}

function renderTimeline(timeline: RunConsoleView["rows"][number]["timeline"]): string {
  if (timeline.length === 0) {
    return `<li><strong>No trace entries</strong><span>This row has no runtime trace yet.</span></li>`;
  }

  return timeline
    .map((entry) => {
      const label = entry.stepId ? `${entry.type} / ${entry.stepId}` : entry.type;
      const locator = locatorSummary(entry.data);
      const snapshot = entry.snapshot ? ` Snapshot: ${snapshotSummary(entry.snapshot)}` : "";
      const message = `${entry.message ?? "No message."}${locator}${snapshot}`;
      return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(message)}</span></li>`;
    })
    .join("\n");
}

function locatorSummary(data: unknown): string {
  if (!isObject(data) || !isObject(data.locator)) {
    return "";
  }
  const locator = data.locator;
  const selected = isObject(locator.selected) ? locator.selected : undefined;
  const confidence = typeof locator.confidence === "string" ? locator.confidence : undefined;
  const strategy = selected && typeof selected.strategy === "string" ? selected.strategy : undefined;
  const value = selected && typeof selected.value === "string" ? selected.value : undefined;
  const score = selected && typeof selected.score === "number" ? selected.score.toFixed(2) : undefined;
  return strategy && value ? ` Locator: ${strategy}=${value} score=${score ?? "-"} confidence=${confidence ?? "-"}.` : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotSummary(snapshot: Record<string, unknown>): string {
  const url = typeof snapshot.url === "string" ? snapshot.url : undefined;
  const openedUrl = typeof snapshot.openedUrl === "string" ? snapshot.openedUrl : undefined;
  const title = typeof snapshot.title === "string" ? snapshot.title : undefined;
  const htmlLength = typeof snapshot.htmlLength === "number" ? `${snapshot.htmlLength} html chars` : undefined;
  const screenshot = isObject(snapshot.screenshot) && typeof snapshot.screenshot.bytes === "number"
    ? `${snapshot.screenshot.bytes} screenshot bytes`
    : undefined;
  const screenshotError = typeof snapshot.screenshotError === "string" ? `screenshot error: ${snapshot.screenshotError}` : undefined;
  return [title, url, openedUrl, htmlLength, screenshot, screenshotError].filter(Boolean).join(" | ") || "captured";
}

function renderRow(row: RunConsoleView["rows"][number], index: number): string {
  return `<tr>
    <td>${index + 1}</td>
    <td>${escapeHtml(row.title ?? "-")}</td>
    <td><a href="${escapeHtml(row.productUrl ?? "#")}">${escapeHtml(row.productUrl ?? "-")}</a></td>
    <td><span class="badge ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
    <td>${row.eventCount}</td>
    <td>${row.checkpoint?.retryCount ?? 0}</td>
    <td>${escapeHtml(row.failedStepId ?? "-")}</td>
    <td>${escapeHtml(row.resumeStepId ?? "-")}</td>
    <td>${escapeHtml(row.errorCategory ?? "-")}</td>
    <td>${escapeHtml(row.error ?? "-")}</td>
  </tr>`;
}

function segment(label: string, active: boolean): string {
  return `<span class="${active ? "selected" : ""}">${label}</span>`;
}

function metric(label: string, value: number, color: string): string {
  return `<div class="metric ${color}"><span>${label}</span><strong>${value}</strong></div>`;
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
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --line: #dbe2ee;
      --text: #111827;
      --muted: #667085;
      --blue: #2563eb;
      --green: #16a34a;
      --red: #dc2626;
      --orange: #ea580c;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .app-shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { background: #fff; border-right: 1px solid var(--line); padding: 22px 18px; display: flex; flex-direction: column; gap: 28px; }
    .brand { display: flex; gap: 12px; align-items: center; }
    .brand-mark { width: 36px; height: 36px; border-radius: 8px; background: #050505; color: #fff; display: grid; place-items: center; font-weight: 800; }
    .brand strong, .brand span { display: block; }
    .brand span { color: var(--muted); font-size: 12px; margin-top: 2px; }
    nav { display: grid; gap: 8px; }
    nav a { padding: 12px 14px; border-radius: 8px; color: #344054; text-decoration: none; font-size: 14px; }
    nav a.active { background: #eaf1ff; color: var(--blue); font-weight: 700; }
    main { min-width: 0; padding: 22px 28px 28px; overflow-x: hidden; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    h1 { font-size: 22px; margin: 0; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0 0 18px; }
    h3 { font-size: 14px; margin: 10px 0 16px; }
    .env { color: var(--muted); font-size: 13px; }
    .env strong { margin-left: 8px; color: var(--text); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
    .panel { min-width: 0; max-width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; box-shadow: 0 1px 2px rgba(16, 24, 40, .04); overflow: hidden; }
    label { display: block; font-size: 13px; font-weight: 700; margin: 14px 0 8px; }
    .dropzone { border: 1px dashed #b8c4d8; border-radius: 8px; padding: 22px; display: grid; gap: 6px; color: var(--muted); }
    .dropzone strong { color: var(--text); }
    .segments { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
    .segments span { text-align: center; padding: 10px; font-size: 13px; border-right: 1px solid var(--line); }
    .segments span:last-child { border-right: 0; }
    .segments .selected { color: var(--blue); background: #eff5ff; box-shadow: inset 0 0 0 1px var(--blue); font-weight: 700; }
    .toggles { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin: 16px 0; font-size: 13px; color: #344054; }
    .toggles strong { color: var(--blue); }
    button { border: 0; border-radius: 7px; background: var(--blue); color: #fff; padding: 10px 20px; font-weight: 700; float: right; }
    button.secondary { float: none; background: #fff; color: #344054; border: 1px solid var(--line); }
    .panel-title { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
    .panel-title span { color: var(--muted); font-size: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-height: 112px; }
    .metric span { display: block; color: var(--muted); font-size: 13px; margin-bottom: 14px; }
    .metric strong { font-size: 30px; line-height: 1; }
    .metric.blue strong { color: var(--blue); }
    .metric.green strong { color: var(--green); }
    .metric.red strong { color: var(--red); }
    .metric.orange strong { color: var(--orange); }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: 18px; margin-top: 18px; align-items: start; }
    .table-tools { display: flex; justify-content: space-between; margin-bottom: 12px; }
    input { width: min(320px, 100%); min-width: 0; max-width: 100%; border: 1px solid var(--line); border-radius: 7px; padding: 10px 12px; font: inherit; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid var(--line); padding: 12px 10px; text-align: left; vertical-align: middle; }
    th { color: #475467; font-size: 12px; background: #f8fafc; }
    td a { color: var(--blue); text-decoration: none; }
    .badge { display: inline-flex; border-radius: 5px; padding: 4px 7px; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .badge.success { color: #067647; background: #dcfae6; }
    .badge.failed { color: #b42318; background: #fee4e2; }
    .badge.approval { color: #c2410c; background: #ffedd5; }
    .badge.neutral { color: #475467; background: #eef2f6; }
    .trace ol { margin: 0; padding-left: 20px; display: grid; gap: 16px; }
    .trace li strong, .trace li span { display: block; }
    .trace li strong { font-size: 13px; }
    .trace li span { color: var(--muted); font-size: 12px; margin-top: 4px; }

    @media (max-width: 980px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar { display: none; }
      .grid, .workspace { grid-template-columns: 1fr; }
      main { padding: 18px; }
      .topbar { align-items: flex-start; flex-direction: column; gap: 8px; }
      input { width: 100%; }
    }
  `;
}
