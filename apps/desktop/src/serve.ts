import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { BrowserRuntime } from "../../../packages/browser/src/index.js";
import { FakeBrowserRuntime, inspectBrowserProfile, PlaywrightBrowserRuntime, requireBrowserProfileReady } from "../../../packages/browser/src/index.js";
import {
  applyWorkflowPatch,
  baiyingAddProductWorkflow,
  createRecorderSession,
  appendRecordedAction,
  recordedActionsToWorkflow
} from "../../../packages/runtime/src/index.js";
import { BaiyingMvpAppService, createRunPlan, filterProductsByRowIds, type RunConsoleView } from "../../../packages/app-service/src/index.js";
import { validateWorkflow } from "../../../packages/dsl/src/index.js";
import type { RecordedAction } from "../../../packages/recorder/src/index.js";
import { parseProductsInput, parseProductsXlsx, type ProductInputFormat } from "../../../packages/local-data/src/index.js";
import type { ProductInput, Result, WorkflowDefinition, WorkflowStep, WorkflowTarget } from "../../../packages/shared/src/index.js";
import {
  SqliteEmployeeStore,
  SqliteRunStore,
  SqliteWorkflowVersionStore,
  SqliteScheduledTriggerStore,
  type EmployeeDocument,
  type EmployeeStore,
  type RunStore,
  type ScheduledTriggerDocument,
  type ScheduledTriggerStore,
  type WorkflowVersionStore
} from "../../../packages/storage/src/index.js";
import { renderInteractiveConsole } from "./interactive-console.js";
import { renderTraceJsonViewer, renderTraceViewer } from "./render-trace-viewer.js";
import type { OpenLoginOutput } from "./open-login.js";
import { openLoginBrowser } from "./open-login.js";
import { runDoctor } from "./doctor.js";

const schedulerStarts = new WeakSet<ScheduledTriggerStore>();

export interface ServeOptions {
  host: string;
  port: number;
  storePath: string;
  workflowStorePath: string;
  databasePath: string;
  userDataDir: string;
  executablePath?: string;
  dev?: boolean;
}

export function createConsoleHandler(options: Pick<ServeOptions, "storePath" | "workflowStorePath" | "userDataDir" | "executablePath"> & {
  databasePath?: string;
  employeeStore?: EmployeeStore;
  runStore?: RunStore;
  triggerStore?: ScheduledTriggerStore;
  workflowVersionStore?: WorkflowVersionStore;
  loginOpener?: (input: { userDataDir: string; url: string; headless: boolean; executablePath?: string }) => Promise<{ ok: true; value: OpenLoginOutput } | { ok: false; errors: string[] }>;
}) {
  const databasePath = options.databasePath ?? "data/digital-employee.sqlite";
  const app = new BaiyingMvpAppService(options.runStore ?? new SqliteRunStore(databasePath));
  const workflowVersions = options.workflowVersionStore ?? new SqliteWorkflowVersionStore(databasePath);
  const employeeStore = options.employeeStore ?? new SqliteEmployeeStore(databasePath);
  const triggerStore = options.triggerStore ?? new SqliteScheduledTriggerStore(databasePath);
  startLocalTriggerScheduler(triggerStore, employeeStore, workflowVersions, app, {
    userDataDir: options.userDataDir,
    executablePath: options.executablePath
  });

  return async (request: Parameters<typeof createServer>[0] extends (request: infer Request, response: infer _Response) => void ? Request : never, response: Parameters<typeof createServer>[0] extends (request: infer _Request, response: infer Response) => void ? Response : never) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && request.url === "/") {
        send(response, 200, "text/html; charset=utf-8", renderInteractiveConsole());
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/favicon.ico") {
        send(response, 204, "image/x-icon", "");
        return;
      }

      if (request.method === "GET" && request.url === "/api/runs") {
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: await app.listRuns() }));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/workflows") {
        const employeeId = requestUrl.searchParams.get("employeeId");
        const versions = employeeId ? await workflowVersions.listByEmployee(employeeId) : await workflowVersions.list();
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: versions }));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/employees") {
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: await employeeStore.list() }));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/employees") {
        const bodyText = await readBody(request);
        const body = bodyText ? JSON.parse(bodyText) as { name?: string } : {};
        const employee = await employeeStore.createDraft({ name: body.name });
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: employee }));
        return;
      }

      const employeeUpdateMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)$/);
      if (request.method === "PATCH" && employeeUpdateMatch) {
        const body = JSON.parse(await readBody(request)) as { name?: string };
        const name = (body.name ?? "").trim();
        if (!name) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["员工名称不能为空。"] }));
          return;
        }
        const employee = await employeeStore.rename(decodeURIComponent(employeeUpdateMatch[1] ?? ""), name);
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: employee }));
        return;
      }

      const employeeDeleteMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)$/);
      if (request.method === "DELETE" && employeeDeleteMatch) {
        const employeeId = decodeURIComponent(employeeDeleteMatch[1] ?? "");
        const employee = await employeeStore.disable(employeeId);
        send(
          response,
          employee ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(employee ? { ok: true, value: employee } : { ok: false, errors: [`Employee ${employeeId} not found`] })
        );
        return;
      }

      const employeePublishMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/publish$/);
      if (request.method === "POST" && employeePublishMatch) {
        const employee = await employeeStore.publish(decodeURIComponent(employeePublishMatch[1] ?? ""));
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        if (employee.onlineVersionId) {
          const version = await workflowVersions.get(employee.onlineVersionId);
          if (version) {
            await workflowVersions.save({
              ...version,
              employeeId: employee.id,
              employeeVersion: employee.activeVersion ?? employee.version,
              status: "published"
            });
          }
        }
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: employee }));
        return;
      }

      const employeeEditMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/edit$/);
      if (request.method === "POST" && employeeEditMatch) {
        const employee = await employeeStore.edit(decodeURIComponent(employeeEditMatch[1] ?? ""));
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: employee }));
        return;
      }

      const employeeRunMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/run$/);
      if (request.method === "POST" && employeeRunMatch) {
        const bodyText = await readBody(request);
        const body = bodyText ? JSON.parse(bodyText) as EmployeeRunRequestBody : {};
        const employee = await employeeStore.get(decodeURIComponent(employeeRunMatch[1] ?? ""));
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        if (!isRunnableEmployee(employee)) {
          const log = await appendSkippedEmployeeRunLog(triggerStore, employee, "manual_employee", "草稿员工需要发布后才能运行。");
          send(response, 409, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: [log.result.message], value: log }));
          return;
        }
        const guard = await ensureBrowserCanRun(body, options.userDataDir);
        if (!guard.ok) {
          send(response, 409, "application/json; charset=utf-8", JSON.stringify(guard));
          return;
        }
        const run = await runEmployeeWorkflow({
          app,
          employee,
          workflowVersions,
          body,
          browser: createBrowser(body.browser ?? "fake", options.userDataDir, options.executablePath, body.runViewMode)
        });
        const log = await appendEmployeeRunLog(triggerStore, employee, "manual_employee", run);
        send(response, run.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(run.ok ? { ok: true, value: { employee, run: run.value, log } } : run));
        return;
      }

      const employeeTrialMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/trial$/);
      if (request.method === "POST" && employeeTrialMatch) {
        const bodyText = await readBody(request);
        const body = bodyText ? JSON.parse(bodyText) as EmployeeRunRequestBody : {};
        const employee = await employeeStore.get(decodeURIComponent(employeeTrialMatch[1] ?? ""));
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        const guard = await ensureBrowserCanRun(body, options.userDataDir);
        if (!guard.ok) {
          send(response, 409, "application/json; charset=utf-8", JSON.stringify(guard));
          return;
        }
        const run = await runEmployeeWorkflow({
          app,
          employee,
          workflowVersions,
          body,
          browser: createBrowser(body.browser ?? "fake", options.userDataDir, options.executablePath, body.runViewMode)
        });
        send(response, run.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(run.ok ? { ok: true, value: run.value } : run));
        return;
      }

      const employeeRunsMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/runs$/);
      if (employeeRunsMatch) {
        const employeeId = decodeURIComponent(employeeRunsMatch[1] ?? "");
        const employee = await employeeStore.get(employeeId);
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        if (request.method === "GET") {
          send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: await app.listRunsForEmployee(employee.id) }));
          return;
        }
        if (request.method === "DELETE") {
          const deleted = await app.clearEmployeeRuns(employee.id);
          send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: { employeeId: employee.id, deleted } }));
          return;
        }
      }

      const employeeRunAssetMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/runs\/([^/]+)\/(export\.csv|trace\.json|trace-json|trace)$/);
      if (request.method === "GET" && employeeRunAssetMatch) {
        const employeeId = decodeURIComponent(employeeRunAssetMatch[1] ?? "");
        const runId = decodeURIComponent(employeeRunAssetMatch[2] ?? "");
        const asset = employeeRunAssetMatch[3] ?? "";
        const employee = await employeeStore.get(employeeId);
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        if (asset === "export.csv") {
          const csv = await app.exportEmployeeRunCsv(employee.id, runId);
          send(
            response,
            csv ? 200 : 404,
            csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
            csv ?? JSON.stringify({ ok: false, errors: [`Run ${runId} not found for employee ${employee.id}`] })
          );
          return;
        }
        if (asset === "trace.json") {
          const trace = await app.exportEmployeeRunTraceJson(employee.id, runId);
          send(
            response,
            trace ? 200 : 404,
            "application/json; charset=utf-8",
            trace ?? JSON.stringify({ ok: false, errors: [`Run ${runId} not found for employee ${employee.id}`] })
          );
          return;
        }
        if (asset === "trace-json") {
          const trace = await app.getEmployeeRunTraceArtifact(employee.id, runId);
          send(
            response,
            trace ? 200 : 404,
            trace ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
            trace ? renderTraceJsonViewer(trace) : JSON.stringify({ ok: false, errors: [`Run ${runId} not found for employee ${employee.id}`] })
          );
          return;
        }
        const trace = await app.getEmployeeRunTraceArtifact(employee.id, runId);
        send(
          response,
          trace ? 200 : 404,
          trace ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
          trace ? renderTraceViewer(trace) : JSON.stringify({ ok: false, errors: [`Run ${runId} not found for employee ${employee.id}`] })
        );
        return;
      }

      const employeeRunHistoryMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/runs\/([^/]+)$/);
      if (employeeRunHistoryMatch) {
        const employeeId = decodeURIComponent(employeeRunHistoryMatch[1] ?? "");
        const runId = decodeURIComponent(employeeRunHistoryMatch[2] ?? "");
        const employee = await employeeStore.get(employeeId);
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        if (request.method === "GET") {
          const view = await app.getEmployeeRunConsole(employee.id, runId);
          send(
            response,
            view ? 200 : 404,
            "application/json; charset=utf-8",
            JSON.stringify(view ? { ok: true, value: view } : { ok: false, errors: [`Run ${runId} not found for employee ${employee.id}`] })
          );
          return;
        }
        if (request.method === "DELETE") {
          const deleted = await app.deleteEmployeeRun(employee.id, runId);
          send(
            response,
            deleted ? 200 : 404,
            "application/json; charset=utf-8",
            JSON.stringify(deleted ? { ok: true, value: { runId, employeeId: employee.id, deleted: true } } : { ok: false, errors: [`Run ${runId} not found for employee ${employee.id}`] })
          );
          return;
        }
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/triggers") {
        const employeeId = requestUrl.searchParams.get("employeeId");
        const sourceTriggers = employeeId ? await triggerStore.listByEmployee(employeeId) : await triggerStore.list();
        const triggers = await filterActiveEmployeeTriggers(sourceTriggers, employeeStore);
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: triggers.map(triggerView) }));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/triggers") {
        const body = JSON.parse(await readBody(request)) as TriggerRequestBody;
        const result = createScheduledTrigger(body, await employeeStore.list());
        if (!result.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(result));
          return;
        }
        await triggerStore.save(result.value);
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: triggerView(result.value) }));
        return;
      }

      const triggerUpdateMatch = requestUrl.pathname.match(/^\/api\/triggers\/([^/]+)$/);
      if (request.method === "PUT" && triggerUpdateMatch) {
        const triggerId = decodeURIComponent(triggerUpdateMatch[1] ?? "");
        const body = JSON.parse(await readBody(request)) as TriggerRequestBody;
        const existing = await triggerStore.get(triggerId);
        if (!existing) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: [`Trigger ${triggerId} not found`] }));
          return;
        }
        const result = updateScheduledTrigger(existing, body, await employeeStore.list());
        if (!result.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(result));
          return;
        }
        await triggerStore.save(result.value);
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: triggerView(result.value) }));
        return;
      }

      if (request.method === "GET" && (requestUrl.pathname === "/api/work-logs" || requestUrl.pathname === "/api/trigger-logs")) {
        const triggerId = requestUrl.searchParams.get("triggerId") ?? undefined;
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: await triggerStore.listLogs(triggerId) }));
        return;
      }

      const triggerEnabledMatch = requestUrl.pathname.match(/^\/api\/triggers\/([^/]+)\/enabled$/);
      if (request.method === "PATCH" && triggerEnabledMatch) {
        const body = JSON.parse(await readBody(request)) as { enabled?: boolean };
        const triggerId = decodeURIComponent(triggerEnabledMatch[1] ?? "");
        const trigger = await triggerStore.setEnabled(triggerId, Boolean(body.enabled));
        send(
          response,
          trigger ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(trigger ? { ok: true, value: triggerView(trigger) } : { ok: false, errors: [`Trigger ${triggerId} not found`] })
        );
        return;
      }

      const triggerRunMatch = requestUrl.pathname.match(/^\/api\/triggers\/([^/]+)\/run$/);
      if (request.method === "POST" && triggerRunMatch) {
        const bodyText = await readBody(request);
        const body = bodyText ? JSON.parse(bodyText) as EmployeeRunRequestBody : {};
        const triggerId = decodeURIComponent(triggerRunMatch[1] ?? "");
        const trigger = await triggerStore.get(triggerId);
        const employee = trigger ? await employeeStore.get(trigger.employee.id) : undefined;
        if (!trigger || !employee || !isRunnableEmployee(employee)) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: [`Trigger ${triggerId} not found`] }));
          return;
        }
        const runnableTrigger = bindTriggerEmployee(trigger, employee);
        if (!trigger.schedule.enabled) {
          const log = await appendSkippedTriggerRunLog(triggerStore, runnableTrigger, "任务已禁用，未执行。");
          send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: log }));
          return;
        }
        const guard = await ensureBrowserCanRun(body, options.userDataDir);
        if (!guard.ok) {
          send(response, 409, "application/json; charset=utf-8", JSON.stringify(guard));
          return;
        }
        const run = await runEmployeeWorkflow({
          app,
          employee,
          workflowVersions,
          body,
          browser: createBrowser(body.browser ?? "fake", options.userDataDir, options.executablePath, body.runViewMode)
        });
        const log = createTriggerRunLog(runnableTrigger, "manual_trigger", run);
        await triggerStore.appendLog(log);
        send(response, run.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(run.ok ? { ok: true, value: log } : run));
        return;
      }

      const triggerDeleteMatch = requestUrl.pathname.match(/^\/api\/triggers\/([^/]+)$/);
      if (request.method === "DELETE" && triggerDeleteMatch) {
        const triggerId = decodeURIComponent(triggerDeleteMatch[1] ?? "");
        const deleted = await triggerStore.delete(triggerId);
        send(
          response,
          deleted ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(deleted ? { ok: true, value: { triggerId, deleted: true } } : { ok: false, errors: [`Trigger ${triggerId} not found`] })
        );
        return;
      }

      if (request.method === "GET" && request.url === "/api/workflow/default") {
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: baiyingAddProductWorkflow }));
        return;
      }

      if (request.method === "GET" && request.url === "/api/workflow/default.json") {
        send(response, 200, "application/json; charset=utf-8", JSON.stringify(baiyingAddProductWorkflow, null, 2));
        return;
      }

      if (request.method === "POST" && request.url === "/api/workflow/validate") {
        const body = JSON.parse(await readBody(request)) as {
          workflow?: unknown;
        };
        const result = validateWorkflow(body.workflow);
        send(
          response,
          result.ok ? 200 : 400,
          "application/json; charset=utf-8",
          JSON.stringify(
            result.ok
              ? {
                  ok: true,
                  value: {
                    workflowId: result.value.workflowId,
                    name: result.value.name,
                    stepCount: result.value.steps.length
                  }
                }
              : result
          )
        );
        return;
      }

      if (request.method === "GET" && request.url === "/api/browser/profile") {
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: await inspectBrowserProfile(options.userDataDir) }));
        return;
      }

      if (request.method === "GET" && request.url === "/api/doctor") {
        const result = await runDoctor({
          userDataDir: options.userDataDir,
          storePath: options.storePath,
          workflowStorePath: options.workflowStorePath,
          samplePath: "examples/products.csv",
          executablePath: options.executablePath
        });
        send(response, result.ok ? 200 : 500, "application/json; charset=utf-8", JSON.stringify(result));
        return;
      }

      if (request.method === "POST" && request.url === "/api/browser/login") {
        const result = await (options.loginOpener ?? openLoginBrowser)({
          userDataDir: options.userDataDir,
          url: "https://buyin.jinritemai.com",
          headless: false,
          executablePath: options.executablePath
        });
        send(response, result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(result));
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/workflows/")) {
        const versionId = decodeURIComponent(request.url.slice("/api/workflows/".length));
        const version = await workflowVersions.get(versionId);
        send(
          response,
          version ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(version ? { ok: true, value: version } : { ok: false, errors: [`Workflow version ${versionId} not found`] })
        );
        return;
      }

      if (request.method === "DELETE" && request.url?.startsWith("/api/workflows/")) {
        const versionId = decodeURIComponent(request.url.slice("/api/workflows/".length));
        const deleted = await workflowVersions.delete(versionId);
        send(
          response,
          deleted ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(deleted ? { ok: true, value: { versionId, deleted: true } } : { ok: false, errors: [`Workflow version ${versionId} not found`] })
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/runs/") && request.url.endsWith("/export.csv")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length, -"/export.csv".length));
        const csv = await app.exportRunCsv(runId);
        send(
          response,
          csv ? 200 : 404,
          csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
          csv ?? JSON.stringify({ ok: false, errors: [`Run ${runId} not found`] })
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/runs/") && request.url.endsWith("/trace.json")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length, -"/trace.json".length));
        const trace = await app.exportRunTraceJson(runId);
        send(
          response,
          trace ? 200 : 404,
          "application/json; charset=utf-8",
          trace ?? JSON.stringify({ ok: false, errors: [`Run ${runId} not found`] })
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/runs/") && request.url.endsWith("/trace-json")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length, -"/trace-json".length));
        const trace = await app.getRunTraceArtifact(runId);
        send(
          response,
          trace ? 200 : 404,
          trace ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
          trace ? renderTraceJsonViewer(trace) : JSON.stringify({ ok: false, errors: [`Run ${runId} not found`] })
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/runs/") && request.url.endsWith("/recovery.json")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length, -"/recovery.json".length));
        const recovery = await app.getRunRecoveryPlan(runId);
        send(
          response,
          recovery ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(recovery ?? { ok: false, errors: [`Run ${runId} not found`] }, null, 2)
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/runs/") && request.url.endsWith("/trace")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length, -"/trace".length));
        const trace = await app.getRunTraceArtifact(runId);
        send(
          response,
          trace ? 200 : 404,
          trace ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
          trace ? renderTraceViewer(trace) : JSON.stringify({ ok: false, errors: [`Run ${runId} not found`] })
        );
        return;
      }

      if (request.method === "DELETE" && request.url?.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length));
        const deleted = await app.deleteRun(runId);
        send(
          response,
          deleted ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(deleted ? { ok: true, value: { runId, deleted: true } } : { ok: false, errors: [`Run ${runId} not found`] })
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(request.url.slice("/api/runs/".length));
        const view = await app.getRunConsole(runId);
        send(
          response,
          view ? 200 : 404,
          "application/json; charset=utf-8",
          JSON.stringify(view ? { ok: true, value: view } : { ok: false, errors: [`Run ${runId} not found`] })
        );
        return;
      }

      if (request.method === "POST" && request.url === "/api/input/preview") {
        const body = JSON.parse(await readBody(request)) as ProductInputRequestBody;
        const productsResult = parseProductInputBody(body);
        send(
          response,
          productsResult.ok ? 200 : 400,
          "application/json; charset=utf-8",
          JSON.stringify(productsResult.ok ? { ok: true, value: productInputPreview(productsResult.value) } : productsResult)
        );
        return;
      }

      if (request.method === "POST" && request.url === "/api/run/plan") {
        const body = JSON.parse(await readBody(request)) as ProductInputRequestBody & {
          mode?: "dry_run" | "run_once" | "batch";
          approvals?: string[];
          rowIds?: string[];
          workflowVersionId?: string;
        };
        const workflowResult = await resolveWorkflowForRequest(workflowVersions, body.workflowVersionId);
        if (!workflowResult.ok) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify(workflowResult));
          return;
        }
        const productsResult = parseProductInputBody(body);
        if (!productsResult.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(productsResult));
          return;
        }
        const filteredProducts = filterProductsByRowIds(productsResult.value, body.rowIds);
        if (!filteredProducts.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(filteredProducts));
          return;
        }
        const products = body.mode === "run_once" ? filteredProducts.value.slice(0, 1) : filteredProducts.value;
        const plan = createRunPlan({
          workflow: workflowResult.value.workflow,
          workflowVersionId: workflowResult.value.workflowVersionId,
          products,
          mode: body.mode ?? "dry_run",
          approvals: body.approvals ?? []
        });
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: plan }));
        return;
      }

      if (request.method === "POST" && request.url === "/api/run") {
        const body = JSON.parse(await readBody(request)) as ProductInputRequestBody & {
          mode?: "dry_run" | "run_once" | "batch";
          browser?: "fake" | "playwright";
          runViewMode?: "silent" | "visible";
          approvals?: string[];
          rowIds?: string[];
          workflowVersionId?: string;
          startStepId?: string;
        };
        const workflowResult = await resolveWorkflowForRequest(workflowVersions, body.workflowVersionId);
        if (!workflowResult.ok) {
          send(
            response,
            404,
            "application/json; charset=utf-8",
            JSON.stringify(workflowResult)
          );
          return;
        }
        if (body.browser === "playwright") {
          const profileReady = await requireBrowserProfileReady({
            userDataDir: options.userDataDir,
            mode: body.mode ?? "dry_run",
            approvals: body.approvals
          });
          if (!profileReady.ok) {
            send(response, 409, "application/json; charset=utf-8", JSON.stringify(profileReady));
            return;
          }
        }
        const productsResult = parseProductInputBody(body);
        if (!productsResult.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(productsResult));
          return;
        }
        const filteredProducts = filterProductsByRowIds(productsResult.value, body.rowIds);
        if (!filteredProducts.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(filteredProducts));
          return;
        }
        const planProducts = body.mode === "run_once" ? filteredProducts.value.slice(0, 1) : filteredProducts.value;
        const plan = createRunPlan({
          workflow: workflowResult.value.workflow,
          workflowVersionId: workflowResult.value.workflowVersionId,
          products: planProducts,
          mode: body.mode ?? "dry_run",
          approvals: body.approvals ?? []
        });
        if (!plan.canRun) {
          send(
            response,
            409,
            "application/json; charset=utf-8",
            JSON.stringify({
              ok: false,
              errors: ["Run plan requires attention before execution."],
              plan
            })
          );
          return;
        }
        const browser = createBrowser(body.browser ?? "fake", options.userDataDir, options.executablePath, body.runViewMode);
        const result = await app.runProducts({
          products: productsResult.value,
          rowIds: body.rowIds,
          mode: body.mode ?? "dry_run",
          approvals: body.approvals,
          workflow: workflowResult.value.workflow,
          workflowVersionId: workflowResult.value.workflowVersionId,
          startStepId: body.startStepId,
          browser
        });
        send(response, result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(result));
        return;
      }

      if (request.method === "POST" && request.url === "/api/workflow/patch") {
        const body = JSON.parse(await readBody(request)) as {
          stepId?: string;
          target?: WorkflowTarget;
          note?: string;
        };
        const result = applyWorkflowPatch(baiyingAddProductWorkflow, {
          stepId: body.stepId ?? "",
          target: body.target ?? {},
          note: body.note
        });
        if (result.ok) {
          const versionId = createWorkflowVersionId(result.value.workflow.workflowId);
          await workflowVersions.save({
            summary: {
              versionId,
              workflowId: result.value.workflow.workflowId,
              name: result.value.workflow.name,
              createdAt: new Date().toISOString(),
              note: result.value.note
            },
            workflow: result.value.workflow
          });
          send(
            response,
            200,
            "application/json; charset=utf-8",
            JSON.stringify({ ok: true, value: { ...result.value, versionId } })
          );
          return;
        }
        send(response, result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(result));
        return;
      }

      if (request.method === "POST" && request.url === "/api/workflow/version") {
        const body = JSON.parse(await readBody(request)) as {
          workflow?: unknown;
          note?: string;
        };
        const result = createWorkflowVersionFromDefinition(body.workflow, body.note);
        if (result.ok) {
          const versionId = createWorkflowVersionId(result.value.workflow.workflowId);
          await workflowVersions.save({
            summary: {
              versionId,
              workflowId: result.value.workflow.workflowId,
              name: result.value.workflow.name,
              createdAt: new Date().toISOString(),
              note: result.value.note
            },
            workflow: result.value.workflow
          });
          send(
            response,
            200,
            "application/json; charset=utf-8",
            JSON.stringify({ ok: true, value: { ...result.value, versionId } })
          );
          return;
        }
        send(response, result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(result));
        return;
      }

      if (request.method === "POST" && request.url === "/api/recorder/workflow") {
        const body = JSON.parse(await readBody(request)) as {
          sessionId?: string;
          name?: string;
          workflowId?: string;
          actions?: RecordedAction[];
          note?: string;
        };
        const result = createWorkflowFromRecordedActions({
          sessionId: body.sessionId,
          name: body.name,
          workflowId: body.workflowId,
          actions: body.actions,
          note: body.note
        });
        if (result.ok) {
          const versionId = createWorkflowVersionId(result.value.workflow.workflowId);
          await workflowVersions.save({
            summary: {
              versionId,
              workflowId: result.value.workflow.workflowId,
              name: result.value.workflow.name,
              createdAt: new Date().toISOString(),
              note: result.value.note
            },
            workflow: result.value.workflow
          });
          send(
            response,
            200,
            "application/json; charset=utf-8",
            JSON.stringify({ ok: true, value: { ...result.value, versionId } })
          );
          return;
        }
        send(response, result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify(result));
        return;
      }

      const employeeRecordingMatch = requestUrl.pathname.match(/^\/api\/employees\/([^/]+)\/recording$/);
      if (request.method === "POST" && employeeRecordingMatch) {
        const employeeId = decodeURIComponent(employeeRecordingMatch[1] ?? "");
        const body = JSON.parse(await readBody(request)) as {
          sessionId?: string;
          name?: string;
          workflowId?: string;
          actions?: RecordedAction[];
          note?: string;
        };
        const result = createWorkflowFromRecordedActions({
          sessionId: body.sessionId,
          name: body.name,
          workflowId: body.workflowId,
          actions: body.actions,
          note: body.note
        });
        if (!result.ok) {
          send(response, 400, "application/json; charset=utf-8", JSON.stringify(result));
          return;
        }
        const versionId = createWorkflowVersionId(result.value.workflow.workflowId);
        const savedAt = new Date().toISOString();
        const employee = await employeeStore.updateDraftScript(employeeId, {
          workflowId: result.value.workflow.workflowId,
          workflowName: result.value.workflow.name,
          workflowVersionId: versionId,
          source: "recorder",
          savedAt
        });
        if (!employee) {
          send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Employee not found"] }));
          return;
        }
        await workflowVersions.save({
          summary: {
            versionId,
            workflowId: result.value.workflow.workflowId,
            name: result.value.workflow.name,
            createdAt: savedAt,
            note: result.value.note
          },
          workflow: result.value.workflow,
          employeeId: employee.id,
          employeeVersion: employee.version,
          status: "draft",
          source: "recorder",
          actions: body.actions ?? [],
          savedAt
        });
        send(
          response,
          200,
          "application/json; charset=utf-8",
          JSON.stringify({ ok: true, value: { employee, workflow: result.value.workflow, versionId } })
        );
        return;
      }

      send(response, 404, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: ["Not found"] }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(response, 500, "application/json; charset=utf-8", JSON.stringify({ ok: false, errors: [message] }));
    }
  };
}

export function createConsoleServer(options: ServeOptions) {
  return createServer(createConsoleHandler(options));
}

export async function createDevConsoleServer(options: ServeOptions) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    appType: "custom",
    plugins: [
      {
        name: "digital-employee-full-reload",
        transformIndexHtml() {
          return [
            {
              tag: "script",
              attrs: { type: "module", src: "/@vite/client" },
              injectTo: "head"
            }
          ];
        },
        handleHotUpdate(context) {
          if (isDesktopUiSource(context.file)) {
            context.server.moduleGraph.invalidateAll();
            context.server.ws.send({ type: "full-reload" });
          }
        }
      }
    ],
    server: {
      middlewareMode: true,
      hmr: {
        host: options.host,
        port: options.port + 1
      }
    }
  });
  const apiHandler = createConsoleHandler(options);
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", `http://${options.host}:${options.port}`);
    if (request.method === "GET" && requestUrl.pathname === "/") {
      try {
        const module = await vite.ssrLoadModule("/apps/desktop/src/interactive-console.ts") as { renderInteractiveConsole(): string };
        const html = await vite.transformIndexHtml(requestUrl.pathname, module.renderInteractiveConsole());
        send(response, 200, "text/html; charset=utf-8", html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        send(response, 500, "text/html; charset=utf-8", error instanceof Error ? error.stack ?? error.message : String(error));
      }
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/favicon.ico") {
      send(response, 204, "image/x-icon", "");
      return;
    }
    if (requestUrl.pathname.startsWith("/@vite") || requestUrl.pathname.startsWith("/@id") || requestUrl.pathname.startsWith("/node_modules")) {
      vite.middlewares(request, response, () => {
        send(response, 404, "text/plain; charset=utf-8", "Not found");
      });
      return;
    }
    await apiHandler(request, response);
  });
  (server as unknown as { on(eventName: "close", handler: () => void): void }).on("close", () => {
    void vite.close();
  });
  return server;
}

function isDesktopUiSource(filePath: string): boolean {
  return filePath.includes("apps/desktop/src/") &&
    (filePath.endsWith(".ts") || filePath.endsWith(".js") || filePath.endsWith(".css"));
}

export async function serve(options: ServeOptions): Promise<void> {
  await mkdir(".tmp", { recursive: true });
  const server = options.dev ? await createDevConsoleServer(options) : createConsoleServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`Douyin Baiying MVP console${options.dev ? " (Vite dev)" : ""}: http://${options.host}:${options.port}`);
  });
}

export function createBrowser(
  kind: "fake" | "playwright",
  userDataDir: string,
  executablePath?: string,
  runViewMode: "silent" | "visible" = "visible"
): BrowserRuntime {
  return kind === "playwright"
    ? new PlaywrightBrowserRuntime({
        userDataDir,
        headless: runViewMode === "silent",
        executablePath,
        actionDelayMs: runViewMode === "visible" ? 320 : 0
      })
    : new FakeBrowserRuntime();
}

function readBody(request: { on: Function }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: { statusCode: number; setHeader: Function; end: Function }, status: number, contentType: string, body: string): void {
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.end(body);
}

interface ProductInputRequestBody {
  csv?: string;
  inputBytes?: number[];
  inputFormat?: ProductInputFormat;
}

interface EmployeeRunRequestBody extends ProductInputRequestBody {
  products?: ProductInput[];
  mode?: "dry_run" | "run_once" | "batch";
  browser?: "fake" | "playwright";
  runViewMode?: "silent" | "visible";
  approvals?: string[];
  rowIds?: string[];
  startStepId?: string;
}

function parseProductInputBody(body: ProductInputRequestBody): Result<ProductInput[]> {
  return body.inputFormat === "xlsx"
    ? parseProductsXlsx(Uint8Array.from(body.inputBytes ?? []))
    : parseProductsInput(body.csv ?? "", body.inputFormat ?? "auto");
}

async function ensureBrowserCanRun(
  body: EmployeeRunRequestBody,
  userDataDir: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  if (body.browser !== "playwright") {
    return { ok: true };
  }
  return requireBrowserProfileReady({
    userDataDir,
    mode: body.mode ?? "run_once",
    approvals: body.approvals
  });
}

async function runEmployeeWorkflow(input: {
  app: BaiyingMvpAppService;
  employee: EmployeeDocument;
  workflowVersions: WorkflowVersionStore;
  body: EmployeeRunRequestBody;
  browser: BrowserRuntime;
}): Promise<Result<RunConsoleView>> {
  const products = input.body.products ?? (input.body.csv || input.body.inputBytes
    ? undefined
    : [defaultEmployeeRunItem(input.employee)]);
  const workflowResult = await workflowForEmployee(input.employee, input.workflowVersions);
  if (!workflowResult.ok) {
    return workflowResult;
  }
  return input.app.runProducts({
    csv: input.body.csv,
    products,
    inputFormat: input.body.inputFormat,
    rowIds: input.body.rowIds,
    mode: input.body.mode ?? "run_once",
    approvals: employeeRunApprovals(input.body.mode ?? "run_once", input.body.approvals),
    workflow: workflowResult.value.workflow,
    workflowVersionId: workflowResult.value.workflowVersionId,
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    startStepId: input.body.startStepId,
    browser: input.browser
  });
}

function employeeRunApprovals(mode: EmployeeRunRequestBody["mode"], approvals: string[] | undefined): string[] {
  const next = new Set(approvals ?? []);
  if (mode !== "dry_run") {
    next.add("final_submit");
  }
  if (mode === "batch") {
    next.add("batch");
  }
  return [...next];
}

async function workflowForEmployee(
  employee: EmployeeDocument,
  workflowVersions: WorkflowVersionStore
): Promise<Result<{ workflow: WorkflowDefinition; workflowVersionId?: string }>> {
  const workflowVersionId = employee.status === "draft"
    ? employee.draftScript?.workflowVersionId ?? employee.latestVersionId ?? employee.script.workflowVersionId
    : employee.onlineVersionId ?? employee.script.workflowVersionId;
  if (!workflowVersionId) {
    return { ok: true, value: { workflow: baiyingAddProductWorkflow } };
  }
  const version = await workflowVersions.get(workflowVersionId);
  return version
    ? { ok: true, value: { workflow: normalizeWorkflowStepOrder(version.workflow), workflowVersionId: version.summary.versionId } }
    : { ok: false, errors: [`Employee ${employee.id} references missing workflow version ${workflowVersionId}`] };
}

function normalizeWorkflowStepOrder(workflow: WorkflowDefinition): WorkflowDefinition {
  const steps = workflow.steps.slice();
  let changed = false;
  for (let index = 0; index < steps.length - 1; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    if (isInputAfterTrailingPress(current, next)) {
      steps[index] = next;
      steps[index + 1] = current;
      changed = true;
      index += 1;
    }
  }
  return changed ? { ...workflow, steps } : workflow;
}

function isInputAfterTrailingPress(current: WorkflowStep, next: WorkflowStep): boolean {
  return current.type === "browser.press"
    && next.type === "browser.input"
    && ["Enter", "Tab"].includes(current.key ?? "")
    && sameWorkflowTarget(current.target, next.target);
}

function sameWorkflowTarget(left?: WorkflowTarget, right?: WorkflowTarget): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function defaultEmployeeRunItem(employee: EmployeeDocument): ProductInput {
  return {
    rowId: `employee-${employee.id}`,
    title: employee.name,
    remark: "manual employee run"
  };
}

function productInputPreview(products: ProductInput[]): {
  totalItems: number;
  rows: Array<Pick<ProductInput, "rowId" | "productUrl" | "productId" | "title" | "groupName">>;
} {
  return {
    totalItems: products.length,
    rows: products.slice(0, 5).map((product) => ({
      rowId: product.rowId,
      productUrl: product.productUrl,
      productId: product.productId,
      title: product.title,
      groupName: product.groupName
    }))
  };
}

async function resolveWorkflowForRequest(
  workflowVersions: WorkflowVersionStore,
  workflowVersionId?: string
): Promise<Result<{ workflow: WorkflowDefinition; workflowVersionId?: string }>> {
  if (!workflowVersionId) {
    return { ok: true, value: { workflow: baiyingAddProductWorkflow } };
  }
  const version = await workflowVersions.get(workflowVersionId);
  return version
    ? { ok: true, value: { workflow: version.workflow, workflowVersionId: version.summary.versionId } }
    : { ok: false, errors: [`Workflow version ${workflowVersionId} not found`] };
}

function createWorkflowFromRecordedActions(input: {
  sessionId?: string;
  name?: string;
  workflowId?: string;
  actions?: RecordedAction[];
  note?: string;
}): { ok: true; value: { workflow: WorkflowDefinition; note?: string } } | { ok: false; errors: string[] } {
  try {
    if (!Array.isArray(input.actions) || input.actions.length === 0) {
      return { ok: false, errors: ["actions must contain at least one recorded action"] };
    }

    const session = input.actions.reduce(
      (current, action) => appendRecordedAction(current, action),
      createRecorderSession(input.sessionId ?? createWorkflowVersionId("recorder-session"), input.name ?? "Recorded Employee Workflow")
    );
    const workflow = recordedActionsToWorkflow(
      session,
      normalizeWorkflowId(input.workflowId ?? input.name ?? session.sessionId),
      input.name ?? session.name
    );
    const validation = validateWorkflow(workflow);
    if (!validation.ok) {
      return validation;
    }
    return {
      ok: true,
      value: {
        workflow: validation.value,
        note: input.note ?? "Generated from recorded semantic actions"
      }
    };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function createWorkflowVersionFromDefinition(
  workflowInput: unknown,
  note?: string
): { ok: true; value: { workflow: WorkflowDefinition; note?: string } } | { ok: false; errors: string[] } {
  const validation = validateWorkflow(workflowInput);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    value: {
      workflow: validation.value,
      note: note ?? "Saved from workflow JSON editor"
    }
  };
}

function normalizeWorkflowId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "recorded-employee-workflow";
}

function readArg(name: string, fallback: string): string {
  return readOptionalArg(name) ?? fallback;
}

function readOptionalArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const isCli = process.argv[1]?.endsWith("/serve.js") ?? false;
if (isCli) {
  await serve({
    host: readArg("--host", "127.0.0.1"),
    port: Number(readArg("--port", "4173")),
    storePath: readArg("--store", ".tmp/server-runs.json"),
    workflowStorePath: readArg("--workflow-store", ".tmp/workflow-versions.json"),
    databasePath: readArg("--database", "data/digital-employee.sqlite"),
    userDataDir: readArg("--user-data-dir", "browser-profiles/baiying"),
    executablePath: readOptionalArg("--executable-path"),
    dev: process.argv.includes("--dev")
  });
}

function createWorkflowVersionId(workflowId: string): string {
  const time = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${workflowId}-${time}-${Math.random().toString(36).slice(2, 8)}`;
}

interface TriggerRequestBody {
  name?: string;
  employeeId?: string;
  frequency?: ScheduledTriggerDocument["schedule"]["frequency"];
  time?: string;
  timezone?: string;
  enabled?: boolean;
  endEnabled?: boolean;
  calendarEnabled?: boolean;
  queueEnabled?: boolean;
  timeoutMinutes?: number;
}

function createScheduledTrigger(
  body: TriggerRequestBody,
  employees: EmployeeDocument[]
): { ok: true; value: ScheduledTriggerDocument } | { ok: false; errors: string[] } {
  const result = buildScheduledTriggerDocument(body, employees);
  if (!result.ok) {
    return result;
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      ...result.value,
      id: createId("trigger"),
      createdAt: now,
      updatedAt: now
    }
  };
}

function updateScheduledTrigger(
  existing: ScheduledTriggerDocument,
  body: TriggerRequestBody,
  employees: EmployeeDocument[]
): { ok: true; value: ScheduledTriggerDocument } | { ok: false; errors: string[] } {
  const result = buildScheduledTriggerDocument(body, employees);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    value: {
      ...result.value,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    }
  };
}

function buildScheduledTriggerDocument(
  body: TriggerRequestBody,
  employees: EmployeeDocument[]
): { ok: true; value: ScheduledTriggerDocument } | { ok: false; errors: string[] } {
  const name = (body.name ?? "").trim();
  const time = (body.time ?? "09:00").trim();
  const frequency = body.frequency ?? "day";
  const employee = employees.find((item) => item.id === body.employeeId && item.status !== "disabled");
  const errors: string[] = [];
  if (!name) {
    errors.push("任务名称不能为空。");
  }
  if (!employee) {
    errors.push("员工名称必须从可选员工中选择。");
  }
  if (!["minute", "hour", "day", "week", "month", "advanced"].includes(frequency)) {
    errors.push("触发频率不支持。");
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    errors.push("触发时间格式应为 HH:mm。");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      id: "",
      name,
      type: "scheduled",
      employee: {
        id: body.employeeId ?? "baiying-window-agent",
        name: employee?.name ?? "",
        script: employee ? employee.draftScript ?? employee.script : undefined
      },
      schedule: {
        frequency,
        time,
        timezone: body.timezone ?? "Asia/Shanghai",
        enabled: body.enabled ?? true,
        endEnabled: body.endEnabled ?? false,
        calendarEnabled: body.calendarEnabled ?? false,
        queueEnabled: body.queueEnabled ?? false,
        timeoutMinutes: Number(body.timeoutMinutes ?? 0)
      },
      createdAt: "",
      updatedAt: ""
    }
  };
}

function triggerView(trigger: ScheduledTriggerDocument): ScheduledTriggerDocument & { conditionText: string; nextRuns: string[] } {
  return {
    ...trigger,
    conditionText: scheduleText(trigger),
    nextRuns: nextRunTimes(trigger)
  };
}

function scheduleText(trigger: ScheduledTriggerDocument): string {
  const [hour = "09", minute = "00"] = trigger.schedule.time.split(":");
  const frequencyLabels: Record<ScheduledTriggerDocument["schedule"]["frequency"], string> = {
    minute: "每分钟执行",
    hour: "每小时执行",
    day: `每天的 ${hour} 时 ${minute} 分执行`,
    week: `每周的 ${hour} 时 ${minute} 分执行`,
    month: `每月的 ${hour} 时 ${minute} 分执行`,
    advanced: `按高级规则在 ${trigger.schedule.time} 执行`
  };
  return frequencyLabels[trigger.schedule.frequency];
}

function nextRunTimes(trigger: ScheduledTriggerDocument): string[] {
  const [hourText = "09", minuteText = "00"] = trigger.schedule.time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const start = new Date();
  const runs: string[] = [];
  for (let index = 1; runs.length < 5 && index < 40; index += 1) {
    const candidate = new Date(start);
    if (trigger.schedule.frequency === "minute") {
      candidate.setMinutes(start.getMinutes() + index, 0, 0);
    } else if (trigger.schedule.frequency === "hour") {
      candidate.setHours(start.getHours() + index, minute, 0, 0);
    } else if (trigger.schedule.frequency === "week") {
      candidate.setDate(start.getDate() + index * 7);
      candidate.setHours(hour, minute, 0, 0);
    } else if (trigger.schedule.frequency === "month") {
      candidate.setMonth(start.getMonth() + index);
      candidate.setHours(hour, minute, 0, 0);
    } else {
      candidate.setDate(start.getDate() + index);
      candidate.setHours(hour, minute, 0, 0);
    }
    if (candidate.getTime() > start.getTime()) {
      runs.push(formatLocalDateTime(candidate));
    }
  }
  return runs;
}

function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function appendEmployeeRunLog(
  triggerStore: ScheduledTriggerStore,
  employee: EmployeeDocument,
  execution: string,
  run: Result<RunConsoleView>
) {
  const log = createEmployeeRunLog(employee, execution, run);
  await triggerStore.appendLog(log);
  return log;
}

async function appendSkippedEmployeeRunLog(
  triggerStore: ScheduledTriggerStore,
  employee: EmployeeDocument,
  execution: string,
  message: string
) {
  const now = new Date().toISOString();
  const log = {
    id: createId("work-log"),
    triggerId: `manual-${employee.id}`,
    triggerName: `手动运行 ${employee.name}`,
    startedAt: now,
    finishedAt: now,
    params: {
      employee: employeeRunSummary(employee),
      employeeScript: employee.script,
      execution
    },
    result: {
      ok: false,
      message
    }
  };
  await triggerStore.appendLog(log);
  return log;
}

async function appendSkippedTriggerRunLog(
  triggerStore: ScheduledTriggerStore,
  trigger: ScheduledTriggerDocument,
  message: string
) {
  const now = new Date().toISOString();
  const log = {
    id: createId("trigger-log"),
    triggerId: trigger.id,
    triggerName: trigger.name,
    startedAt: now,
    finishedAt: now,
    params: {
      trigger: triggerView(trigger),
      employeeScript: trigger.employee.script,
      execution: "manual_trigger"
    },
    result: {
      ok: false,
      message
    }
  };
  await triggerStore.appendLog(log);
  return log;
}

function createEmployeeRunLog(employee: EmployeeDocument, execution: string, run: Result<RunConsoleView>) {
  const now = new Date().toISOString();
  const summary = run.ok ? run.value.summary : undefined;
  const okResult = Boolean(summary && summary.status === "completed" && summary.failedCount === 0);
  return {
    id: createId("work-log"),
    triggerId: `manual-${employee.id}`,
    triggerName: `手动运行 ${employee.name}`,
    startedAt: summary?.startedAt ?? now,
    finishedAt: summary?.completedAt ?? now,
    params: {
      employee: employeeRunSummary(employee),
      employeeScript: employee.script,
      execution,
      runId: summary?.runId,
      runSummary: summary
    },
    result: {
      ok: okResult,
      message: run.ok
        ? `已运行员工脚本：${employee.name}，结果 ${summary?.status ?? "unknown"}。`
        : `员工脚本运行失败：${run.errors.join("；")}`
    }
  };
}

function createTriggerRunLog(
  trigger: ScheduledTriggerDocument,
  execution: string,
  run: Result<RunConsoleView>
) {
  const now = new Date().toISOString();
  const summary = run.ok ? run.value.summary : undefined;
  const okResult = Boolean(summary && summary.status === "completed" && summary.failedCount === 0);
  return {
    id: createId("trigger-log"),
    triggerId: trigger.id,
    triggerName: trigger.name,
    startedAt: summary?.startedAt ?? now,
    finishedAt: summary?.completedAt ?? now,
    params: {
      trigger: triggerView(trigger),
      employeeScript: trigger.employee.script,
      execution,
      runId: summary?.runId,
      runSummary: summary
    },
    result: {
      ok: okResult,
      message: run.ok
        ? `已运行计划任务：${trigger.name}，结果 ${summary?.status ?? "unknown"}。`
        : `计划任务运行失败：${run.errors.join("；")}`
    }
  };
}

function employeeRunSummary(employee: EmployeeDocument): Record<string, unknown> {
  return {
    id: employee.id,
    name: employee.name,
    status: employee.status,
    version: employee.version,
    activeVersion: employee.activeVersion
  };
}

function isRunnableEmployee(employee: EmployeeDocument): boolean {
  return employee.status !== "disabled" && typeof employee.activeVersion === "number" && employee.versions.some((version) => version.version === employee.activeVersion && version.status === "published");
}

async function filterActiveEmployeeTriggers(triggers: ScheduledTriggerDocument[], employeeStore: EmployeeStore): Promise<ScheduledTriggerDocument[]> {
  const next: ScheduledTriggerDocument[] = [];
  for (const trigger of triggers) {
    const employee = await employeeStore.get(trigger.employee.id);
    if (employee && employee.status !== "disabled") {
      next.push(bindTriggerEmployee(trigger, employee));
    }
  }
  return next;
}

function bindTriggerEmployee(trigger: ScheduledTriggerDocument, employee: EmployeeDocument): ScheduledTriggerDocument {
  return {
    ...trigger,
    employee: {
      ...trigger.employee,
      id: employee.id,
      name: employee.name,
      script: employee.draftScript ?? employee.script
    }
  };
}

function startLocalTriggerScheduler(
  triggerStore: ScheduledTriggerStore,
  employeeStore: EmployeeStore,
  workflowVersions: WorkflowVersionStore,
  app: BaiyingMvpAppService,
  runtime: { userDataDir: string; executablePath?: string }
): void {
  if (schedulerStarts.has(triggerStore)) {
    return;
  }
  schedulerStarts.add(triggerStore);
  const executedKeys = new Set<string>();
  const interval = setInterval(async () => {
    const now = new Date();
    const minuteKey = formatSchedulerMinute(now);
    try {
      const triggers = await triggerStore.list();
      for (const trigger of triggers) {
        const employee = await employeeStore.get(trigger.employee.id);
        if (!employee || !isRunnableEmployee(employee) || !trigger.schedule.enabled || !isTriggerDue(trigger, now)) {
          continue;
        }
        const runnableTrigger = bindTriggerEmployee(trigger, employee);
        const executionKey = `${trigger.id}:${minuteKey}`;
        if (executedKeys.has(executionKey)) {
          continue;
        }
        executedKeys.add(executionKey);
        const run = await runEmployeeWorkflow({
          app,
          employee,
          workflowVersions,
          body: {
            mode: "run_once",
            browser: "playwright",
            runViewMode: "silent",
            approvals: ["final_submit"]
          },
          browser: createBrowser("playwright", runtime.userDataDir, runtime.executablePath, "silent")
        });
        await triggerStore.appendLog(createTriggerRunLog(runnableTrigger, "scheduled", run));
      }
    } catch {
      // Scheduler errors are surfaced by the next explicit API read/write.
    }
  }, 30_000);
  interval.unref?.();
}

function isTriggerDue(trigger: ScheduledTriggerDocument, now: Date): boolean {
  const [hourText = "0", minuteText = "0"] = trigger.schedule.time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (trigger.schedule.frequency === "minute") {
    return true;
  }
  if (trigger.schedule.frequency === "hour") {
    return now.getMinutes() === minute;
  }
  if (trigger.schedule.frequency === "day" || trigger.schedule.frequency === "advanced") {
    return now.getHours() === hour && now.getMinutes() === minute;
  }
  if (trigger.schedule.frequency === "week") {
    return now.getDay() === 1 && now.getHours() === hour && now.getMinutes() === minute;
  }
  if (trigger.schedule.frequency === "month") {
    return now.getDate() === 1 && now.getHours() === hour && now.getMinutes() === minute;
  }
  return false;
}

function formatSchedulerMinute(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
