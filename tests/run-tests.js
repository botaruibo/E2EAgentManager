import { runCommerceRuntime } from "../dist/packages/runtime/src/index.js";
import { validateWorkflow, baiyingAddProductWorkflow, workflowNodeTaxonomy } from "../dist/packages/dsl/src/index.js";
import { parseProductsCsv, parseProductsInput, parseProductsJson, parseProductsXlsx } from "../dist/packages/local-data/src/index.js";
import { BaiyingMvpAppService, createRunPlan } from "../dist/packages/app-service/src/index.js";
import { PlaywrightBrowserRuntime } from "../dist/packages/browser/src/playwright.js";
import { ensureBrowserProfileDir, inspectBrowserProfile, requireBrowserProfileReady } from "../dist/packages/browser/src/index.js";
import { JsonFileRunStore, JsonFileWorkflowVersionStore, SqliteRunStore } from "../dist/packages/storage/src/index.js";
import { renderRunConsole } from "../dist/apps/desktop/src/render-console.js";
import { renderTraceViewer } from "../dist/apps/desktop/src/render-trace-viewer.js";
import {
  appendRecordedAction,
  createRecorderSession,
  recordedActionsToWorkflow
} from "../dist/packages/recorder/src/index.js";
import {
  applyWorkflowPatch,
  suggestTargetFromLocatorEvidence
} from "../dist/packages/workflow-healing/src/index.js";
import { runCsvFile } from "../dist/apps/desktop/src/run-csv.js";
import { parseRunCsvArgs } from "../dist/apps/desktop/src/run-csv.js";
import { parseOpenLoginArgs } from "../dist/apps/desktop/src/open-login.js";
import { parseDoctorArgs, runDoctor } from "../dist/apps/desktop/src/doctor.js";
import { parseDesktopArgs, startDesktop } from "../dist/apps/desktop/src/electron-main.js";
import { createBrowser, createConsoleHandler, createDevConsoleServer } from "../dist/apps/desktop/src/serve.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(fn, expectedMessage, message) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expectedMessage), message);
    return;
  }
  throw new Error(message);
}

async function testWorkflowValidation() {
  const result = validateWorkflow(baiyingAddProductWorkflow);
  assert(result.ok, "default Baiying workflow should validate");

  const invalidTimeout = validateWorkflow({
    ...baiyingAddProductWorkflow,
    steps: [
      {
        ...baiyingAddProductWorkflow.steps[0],
        timeoutMs: 0
      }
    ]
  });
  assert(!invalidTimeout.ok, "workflow validation should reject non-positive step timeout");
  assert(invalidTimeout.errors.some((error) => error.includes("timeoutMs")), "timeout validation should explain the invalid field");

  const duplicateStep = validateWorkflow({
    ...baiyingAddProductWorkflow,
    steps: [
      baiyingAddProductWorkflow.steps[0],
      {
        ...baiyingAddProductWorkflow.steps[1],
        id: baiyingAddProductWorkflow.steps[0].id
      }
    ]
  });
  assert(!duplicateStep.ok, "workflow validation should reject duplicate step ids");
  assert(duplicateStep.errors.some((error) => error.includes("Duplicates")), "duplicate step validation should name duplicate ids");

  const invalidPolicy = validateWorkflow({
    ...baiyingAddProductWorkflow,
    policy: {
      requireApprovalFor: ["batch", 123],
      maxBatchSize: 0,
      maxRetryPerItem: -1
    }
  });
  assert(!invalidPolicy.ok, "workflow validation should reject invalid policy fields");
  assert(invalidPolicy.errors.some((error) => error.includes("requireApprovalFor")), "policy validation should report invalid approvals");
  assert(invalidPolicy.errors.some((error) => error.includes("maxBatchSize")), "policy validation should report invalid batch size");
  assert(invalidPolicy.errors.some((error) => error.includes("maxRetryPerItem")), "policy validation should report invalid retry count");

  const invalidInputs = validateWorkflow({
    ...baiyingAddProductWorkflow,
    inputs: {
      productUrl: { type: "string", values: ["unexpected"] },
      mode: { type: "enum", values: ["dry_run"], default: "batch" },
      productId: { type: "string", required: "yes" }
    }
  });
  assert(!invalidInputs.ok, "workflow validation should reject invalid input specs");
  assert(invalidInputs.errors.some((error) => error.includes("values is only supported")), "input validation should reject string values");
  assert(invalidInputs.errors.some((error) => error.includes("default must be one of")), "input validation should reject invalid enum default");
  assert(invalidInputs.errors.some((error) => error.includes("required must be a boolean")), "input validation should reject invalid required flag");
}

async function testWorkflowNodeTaxonomyAndStrategyNodes() {
  assert(workflowNodeTaxonomy.primitive.includes("browser.click"), "taxonomy should include primitive browser nodes");
  assert(workflowNodeTaxonomy.control.includes("flow.approval"), "taxonomy should include control flow nodes");
  assert(workflowNodeTaxonomy.strategy.join(",") === "strategy.decide,strategy.select,strategy.extract,strategy.recover", "taxonomy should expose the four strategy node types");

  const strategyWorkflow = {
    ...baiyingAddProductWorkflow,
    workflowId: "strategy-node-workflow",
    name: "Strategy Node Workflow",
    policy: {
      requireApprovalFor: ["human_review"],
      maxBatchSize: 10,
      maxRetryPerItem: 0
    },
    steps: [
      {
        id: "open_admin",
        type: "browser.open",
        layer: "primitive",
        url: "https://example.com/admin"
      },
      {
        id: "map_input",
        type: "flow.map",
        layer: "control",
        flow: {
          source: "products"
        }
      },
      {
        id: "decide_page_state",
        type: "strategy.decide",
        layer: "strategy",
        strategy: {
          kind: "decide",
          goal: "判断当前页面是成功、失败、需登录还是验证码状态",
          inputs: ["title"],
          pageScope: "current_page",
          allowedActions: ["read", "record_failure"],
          deniedActions: ["submit"],
          successCriteria: "必须输出一个明确页面状态和判断证据",
          failureBehavior: "pause_for_human",
          evidenceRequired: true
        }
      },
      {
        id: "select_best_result",
        type: "strategy.select",
        layer: "strategy",
        strategy: {
          kind: "select",
          goal: "从搜索结果里选择标题最匹配的商品",
          inputs: ["title"],
          pageScope: "search_results",
          allowedActions: ["read", "click"],
          deniedActions: ["submit", "delete", "payment"],
          successCriteria: "被点击的结果标题应包含输入商品标题",
          failureBehavior: "record_and_continue",
          evidenceRequired: true
        }
      },
      {
        id: "extract_business_error",
        type: "strategy.extract",
        layer: "strategy",
        strategy: {
          kind: "extract",
          goal: "抽取页面上的业务错误原因",
          inputs: ["title"],
          pageScope: "result_dialog",
          allowedActions: ["read", "extract"],
          successCriteria: "输出错误分类和原始页面文本证据",
          failureBehavior: "record_and_continue",
          evidenceRequired: true
        }
      },
      {
        id: "recover_locator",
        type: "strategy.recover",
        layer: "strategy",
        strategy: {
          kind: "recover",
          goal: "当普通 locator 失效时寻找替代按钮并给出修复建议",
          inputs: ["title"],
          pageScope: "current_page",
          allowedActions: ["read", "verify"],
          successCriteria: "返回可人工确认的替代 locator 候选项",
          failureBehavior: "pause_for_human",
          evidenceRequired: true
        }
      },
      {
        id: "human_review",
        type: "flow.approval",
        layer: "control",
        flow: {
          approvalKey: "human_review"
        }
      }
    ]
  };

  const valid = validateWorkflow(strategyWorkflow);
  assert(valid.ok, "workflow validation should accept control and strategy nodes");

  const plan = createRunPlan({
    workflow: strategyWorkflow,
    products: [{ rowId: "row-1", title: "示例商品A", productUrl: "https://example.com/a" }],
    mode: "run_once",
    approvals: ["human_review"]
  });
  assert(plan.canRun, "approved strategy workflow should be runnable");
  assert(plan.steps.some((step) => step.layer === "primitive" && step.type === "browser.open"), "run plan should classify primitive nodes");
  assert(plan.steps.some((step) => step.layer === "control" && step.type === "flow.map"), "run plan should classify control nodes");
  assert(plan.steps.some((step) => step.layer === "strategy" && step.type === "strategy.select"), "run plan should classify strategy nodes");

  const app = new BaiyingMvpAppService();
  const run = await app.runProducts({
    products: [{ rowId: "row-1", title: "示例商品A", productUrl: "https://example.com/a" }],
    mode: "run_once",
    workflow: strategyWorkflow,
    approvals: ["human_review"]
  });
  assert(run.ok, "strategy workflow should run through the deterministic placeholder");
  assert(run.value.rows[0].status === "success", "strategy placeholder nodes should not fail the workflow");
  assert(
    run.value.rows[0].timeline.some((entry) => entry.stepId === "select_best_result" && entry.data?.strategy?.adapter === "deterministic-placeholder"),
    "strategy timeline should preserve placeholder adapter evidence"
  );

  const invalidStrategy = validateWorkflow({
    ...strategyWorkflow,
    steps: [
      {
        id: "bad_strategy",
        type: "strategy.select",
        layer: "strategy",
        strategy: {
          kind: "decide",
          goal: "",
          allowedActions: [],
          successCriteria: "",
          failureBehavior: "unknown"
        }
      }
    ]
  });
  assert(!invalidStrategy.ok, "workflow validation should reject invalid strategy specs");
  assert(invalidStrategy.errors.some((error) => error.includes("strategy.kind")), "invalid strategy validation should report kind mismatch");
  assert(invalidStrategy.errors.some((error) => error.includes("allowedActions")), "invalid strategy validation should require allowed actions");
}

async function testCsvParsing() {
  const result = parseProductsCsv("rowId,productUrl,title\nrow-1,https://example.com/a,商品A");
  assert(result.ok, "CSV parser should accept productUrl rows");
  assert(result.value.length === 1, "CSV parser should return one product");
  assert(result.value[0].rowId === "row-1", "CSV parser should preserve rowId");

  const normalizedHeaderResult = parseProductsCsv("\uFEFFRowID,ProductURL,Title\nrow-bom,https://example.com/bom,带BOM商品");
  assert(normalizedHeaderResult.ok, "CSV parser should normalize BOM and case-insensitive headers");
  assert(normalizedHeaderResult.value[0].rowId === "row-bom", "CSV parser should preserve row data after header normalization");

  const duplicateRows = parseProductsCsv("rowId,productUrl,title\nrow-dup,https://example.com/a,商品A\nrow-dup,https://example.com/b,商品B");
  assert(!duplicateRows.ok, "CSV parser should reject duplicate rowId values");
  assert(duplicateRows.errors.some((error) => error.includes("row-dup")), "duplicate rowId error should name duplicates");

  const jsonResult = parseProductsJson([{ rowId: "row-json", productUrl: "https://example.com/json", title: "商品JSON" }]);
  assert(jsonResult.ok, "JSON parser should accept productUrl rows");
  assert(jsonResult.value[0].rowId === "row-json", "JSON parser should preserve rowId");

  const numericJsonResult = parseProductsJson([{ rowId: 1001, productId: 123456789, title: "数字商品ID" }]);
  assert(numericJsonResult.ok, "JSON parser should accept numeric productId values");
  assert(numericJsonResult.value[0].rowId === "1001", "JSON parser should stringify numeric rowId");
  assert(numericJsonResult.value[0].productId === "123456789", "JSON parser should stringify numeric productId");

  const autoResult = parseProductsInput('[{"rowId":"row-auto","productId":"123","title":"商品Auto"}]');
  assert(autoResult.ok, "auto parser should detect JSON arrays");
  assert(autoResult.value[0].productId === "123", "auto parser should preserve productId");

  const xlsxResult = parseProductsXlsx(createXlsxWorkbook([
    ["rowId", "productUrl", "title", "groupName", "remark"],
    ["row-xlsx", "https://example.com/xlsx", "商品XLSX", "默认分组", "xlsx sample"]
  ]));
  assert(xlsxResult.ok, "XLSX parser should accept productUrl rows");
  assert(xlsxResult.value[0].rowId === "row-xlsx", "XLSX parser should preserve rowId");
  assert(xlsxResult.value[0].title === "商品XLSX", "XLSX parser should preserve title");

  const normalizedXlsxResult = parseProductsXlsx(createXlsxWorkbook([
    ["RowID", "ProductID", "Title"],
    ["row-xlsx-id", "987654321", "大小写表头商品"]
  ]));
  assert(normalizedXlsxResult.ok, "XLSX parser should normalize case-insensitive headers");
  assert(normalizedXlsxResult.value[0].productId === "987654321", "XLSX parser should preserve values after header normalization");
}

async function testPackageDeclaresOptionalPlaywright() {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert(
    manifest.optionalDependencies?.playwright,
    "package manifest should declare Playwright as an optional dependency for real browser runs"
  );
  assert(
    manifest.optionalDependencies?.electron,
    "package manifest should declare Electron as an optional dependency for desktop runs"
  );
}

async function testElectronDesktopShellUsesLocalConsole() {
  const options = parseDesktopArgs([
    "electron",
    "electron-main.js",
    "--host",
    "127.0.0.1",
    "--port",
    "4517",
    "--width",
    "1280",
    "--height",
    "800",
    "--executable-path",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ]);
  assert(options.port === 4517, "desktop args should parse port");
  assert(options.width === 1280 && options.height === 800, "desktop args should parse window size");
  assert(options.executablePath?.includes("Google Chrome"), "desktop args should parse browser executable path");

  let loadedUrl = "";
  let closeCount = 0;
  let showCount = 0;
  let focusCount = 0;
  const appHandlers = {};
  class FakeBrowserWindow {
    constructor(windowOptions) {
      assert(windowOptions.title === "数字员工调度中心", "desktop window should use product title");
      assert(windowOptions.show === true, "desktop window should show immediately while the local URL loads");
      assert(windowOptions.webPreferences.contextIsolation === true, "desktop window should isolate renderer context");
      assert(windowOptions.webPreferences.nodeIntegration === false, "desktop window should disable renderer Node integration");
      assert(windowOptions.webPreferences.webviewTag === true, "desktop window should enable webview for embedded recorder browser");
    }
    async loadURL(url) {
      loadedUrl = url;
    }
    show() {
      showCount += 1;
    }
    focus() {
      focusCount += 1;
    }
  }
  const desktop = await startDesktop(options, {
    async loadElectron() {
      return {
        app: {
          async whenReady() {},
          on(eventName, handler) {
            appHandlers[eventName] = handler;
          },
          quit() {}
        },
        BrowserWindow: FakeBrowserWindow
      };
    },
    createServer() {
      return {
        listen(port, host, callback) {
          assert(port === 4517 && host === "127.0.0.1", "desktop should start local console server with parsed address");
          callback();
        },
        close(callback) {
          closeCount += 1;
          callback?.();
        }
      };
    }
  });
  await Promise.resolve();
  assert(loadedUrl === "http://127.0.0.1:4517", "desktop window should load the local console URL");
  assert(showCount === 1 && focusCount === 1, "desktop window should be shown and focused before loading");
  assert(typeof appHandlers["before-quit"] === "function", "desktop should register server cleanup on quit");
  await desktop.close();
  await desktop.close();
  assert(closeCount === 1, "desktop server cleanup should be idempotent");
}

async function testDryRunSkipsFinalSubmit() {
  const result = await runCommerceRuntime({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run"
  });
  assert(result.ok, "dry-run runtime should succeed");
  assert(result.value.results[0].status === "success", "dry-run item should succeed");
  assert(result.value.traceCount > 0, "dry-run should record trace events");
}

async function testBatchRequiresApproval() {
  const result = await runCommerceRuntime({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "batch"
  });
  assert(result.ok, "batch runtime call should return structured result");
  assert(result.value.results[0].status === "requires_approval", "batch should require approval");
}

async function testRunRecoveryPlan() {
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "batch"
  });
  assert(result.ok, "approval-paused run should return console view");
  const recovery = await app.getRunRecoveryPlan(result.value.summary.runId);
  assert(recovery.totalRecoverableRows === 1, "recovery plan should include approval-paused row");
  assert(recovery.rowIds[0] === "row-1", "recovery plan should include row id");
  assert(recovery.rows[0].resumeStepId === "open_baiying", "recovery plan should include resume step");
  assert(recovery.rows[0].errorCategory === "approval_required", "recovery plan should include failure category");
  assert(recovery.groups.length === 1, "recovery plan should group rows by resume step");
  assert(recovery.groups[0].resumeStepId === "open_baiying", "recovery group should include resume step");
  assert(recovery.groups[0].rowIds[0] === "row-1", "recovery group should include row ids");
  assert(recovery.groups[0].rowIdsArg === "row-1", "recovery group should include CLI row ids arg");
  assert(recovery.groups[0].startStepArg === "open_baiying", "recovery group should include CLI start step arg");
}

async function testRunOnceLimitsToFirstProduct() {
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
    mode: "run_once",
    approvals: ["final_submit"]
  });
  assert(result.ok, "run_once app service run should succeed");
  assert(result.value.summary.totalItems === 1, "run_once should execute only one product");
  assert(result.value.rows[0].rowId === "row-1", "run_once should execute the first product");
}

async function testWorkflowExtractStepPersistsRows() {
  const workflow = {
    ...baiyingAddProductWorkflow,
    workflowId: "browser-extract-test",
    name: "Browser Extract Test",
    steps: [
      {
        id: "open_news",
        type: "browser.open",
        url: "https://news.baidu.com/"
      },
      {
        id: "extract_articles",
        type: "browser.extract",
        extract: {
          entity: "articles",
          selector: ".result",
          limit: 5
        }
      }
    ]
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    products: [{ rowId: "keyword-1", title: "人工智能" }],
    mode: "run_once",
    workflow
  });
  assert(result.ok, "workflow with extract step should run");
  const extractEvent = result.value.rows[0].timeline.find((entry) => entry.stepId === "extract_articles" && entry.type === "step.succeeded");
  assert(extractEvent?.data?.entity === "articles", "extract step should persist entity name in timeline data");
  assert(Array.isArray(extractEvent.data.rows), "extract step should persist extracted rows in timeline data");
}

async function testRowIdsFilterProducts() {
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
    mode: "batch",
    approvals: ["batch", "final_submit"],
    rowIds: ["row-2"]
  });
  assert(result.ok, "rowIds filtered app service run should succeed");
  assert(result.value.summary.totalItems === 1, "rowIds filter should run one product");
  assert(result.value.rows[0].rowId === "row-2", "rowIds filter should keep requested row");

  const missing = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    rowIds: ["missing-row"]
  });
  assert(!missing.ok, "rowIds filter should reject missing rows");
  assert(missing.errors.join("\n").includes("missing-row"), "rowIds filter should name missing row ids");
}

async function testProductIdOnlyRowsBindToProductInput() {
  let inputValue = "";
  const browser = {
    async open(url) {
      return { ok: true, message: `Opened ${url}` };
    },
    async click(candidate) {
      return { ok: true, message: `Clicked ${candidate.value}` };
    },
    async input(candidate, target, value) {
      inputValue = value;
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      return { ok: true, message: "Verified" };
    },
    async wait(timeoutMs) {
      return { ok: true, message: `Waited ${timeoutMs}ms` };
    },
    async snapshot() {
      return { ready: true };
    }
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productId,title\nrow-1,123456789,商品ID行",
    mode: "dry_run",
    browser
  });
  assert(result.ok, "productId-only rows should run through the default workflow");
  assert(inputValue === "123456789", "default workflow should bind productId when productUrl is missing");
}

async function testBatchWithApprovalsCanRun() {
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
    mode: "batch",
    approvals: ["batch", "final_submit"]
  });
  assert(result.ok, "approved batch app service run should succeed");
  assert(result.value.summary.status === "completed", "approved batch should complete");
  assert(result.value.summary.totalItems === 2, "approved batch should process all rows");
  assert(result.value.summary.successCount === 2, "approved batch should succeed in fake runtime");
}

async function testHighRiskWorkflowStepsAreBlocked() {
  const riskyWorkflow = {
    ...baiyingAddProductWorkflow,
    steps: [
      {
        id: "open_baiying",
        type: "browser.open",
        url: "https://buyin.jinritemai.com"
      },
      {
        id: "delete_product",
        type: "browser.click",
        target: {
          role: "button",
          text: "删除商品"
        }
      }
    ]
  };
  const plan = createRunPlan({
    workflow: riskyWorkflow,
    products: [{ rowId: "row-1", productUrl: "https://example.com/a" }],
    mode: "run_once",
    approvals: ["final_submit"]
  });
  assert(!plan.canRun, "run plan should block high-risk workflow steps");
  assert(plan.blockers.some((blocker) => blocker.includes("high-risk step delete_product")), "run plan should explain high-risk blocker");
  assert(plan.steps.some((step) => step.stepId === "delete_product" && step.status === "blocked"), "run plan should expose blocked high-risk step");

  const app = new BaiyingMvpAppService();
  const browserCalls = [];
  const recordingBrowser = {
    async open(url) {
      browserCalls.push(["open", url]);
      return { ok: true, message: `Opened ${url}` };
    },
    async click(candidate) {
      browserCalls.push(["click", candidate.value]);
      return { ok: true, message: "Clicked" };
    },
    async input() {
      browserCalls.push(["input"]);
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      browserCalls.push(["verify"]);
      return { ok: true, message: "Verified" };
    },
    async wait() {
      browserCalls.push(["wait"]);
      return { ok: true, message: "Waited" };
    },
    async snapshot() {
      return { ready: true };
    }
  };
  const result = await app.runProducts({
    products: [{ rowId: "row-1", productUrl: "https://example.com/a", title: "商品A" }],
    mode: "run_once",
    approvals: ["final_submit"],
    workflow: riskyWorkflow,
    browser: recordingBrowser
  });
  assert(result.ok, "high-risk execution should return a structured console view");
  assert(result.value.summary.status === "failed", "high-risk step should fail the run");
  assert(result.value.rows[0].failedStepId === "delete_product", "high-risk step should be the failed step");
  assert(result.value.rows[0].errorCategory === "policy", "high-risk step should classify as policy failure");
  assert(browserCalls.length === 0, "high-risk preflight should block before browser actions");
}

async function testBrowserProfileInspection() {
  const profilePath = ".tmp/test-browser-profile";
  await rm(profilePath, { recursive: true, force: true });
  const missing = await inspectBrowserProfile(profilePath);
  assert(!missing.exists, "missing profile should report exists=false");
  assert(missing.warnings.some((warning) => warning.includes("does not exist")), "missing profile should include setup warning");

  const created = await ensureBrowserProfileDir(profilePath);
  assert(created.exists, "ensureBrowserProfileDir should create profile directory");
  assert(created.isDirectory, "created profile should be a directory");

  await mkdir(`${profilePath}/Default/Network`, { recursive: true });
  await writeFile(`${profilePath}/Default/Network/Cookies`, "", "utf8");
  const withCookies = await inspectBrowserProfile(profilePath);
  assert(withCookies.likelyHasLoginState, "profile with Chromium cookie marker should likely have login state");
  assert(withCookies.markers.includes("Default/Network/Cookies"), "profile should report cookie marker");

  const dryRunGuard = await requireBrowserProfileReady({
    userDataDir: ".tmp/missing-profile-for-dry-run",
    mode: "dry_run"
  });
  assert(dryRunGuard.ok, "dry_run should not require existing browser login state");

  const batchGuard = await requireBrowserProfileReady({
    userDataDir: ".tmp/missing-profile-for-batch",
    mode: "batch",
    approvals: ["batch", "final_submit"]
  });
  assert(!batchGuard.ok, "approved Playwright batch should require prepared browser login state");
  assert(batchGuard.errors.join("\n").includes("login:browser"), "profile guard should explain how to initialize login");
}

async function testWorkflowPausesForCaptchaSignal() {
  const app = new BaiyingMvpAppService();
  const browser = {
    async open(url) {
      return { ok: true, message: `Opened ${url}` };
    },
    async click() {
      return { ok: true, message: "Clicked" };
    },
    async input() {
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      return { ok: false, message: "Missing expected text because captcha is visible" };
    },
    async wait(timeoutMs) {
      return { ok: true, message: `Waited ${timeoutMs}ms` };
    },
    async snapshot() {
      return {
        title: "安全验证",
        url: "https://buyin.jinritemai.com/login",
        domTextSample: "请先登录并完成验证码",
        domTextLength: 10
      };
    }
  };

  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    browser
  });
  assert(result.ok, "captcha signal should return a structured console view");
  assert(result.value.summary.status === "requires_approval", "captcha signal should pause the run summary");
  assert(result.value.rows[0].status === "requires_approval", "captcha signal should pause the row");
  assert(result.value.rows[0].failedStepId === "ensure_login", "captcha signal should keep failed step id");
  assert(result.value.rows[0].errorCategory === "captcha", "captcha signal should classify failure category");
  assert(
    result.value.rows[0].timeline.some((entry) => entry.type === "human_intervention.required"),
    "captcha signal should emit human intervention event"
  );

  const recovery = await app.getRunRecoveryPlan(result.value.summary.runId);
  assert(recovery.totalRecoverableRows === 1, "captcha-paused run should produce a recovery plan");
  assert(recovery.groups[0].errorCategories.includes("captcha"), "recovery plan should preserve captcha category");
}

async function testAppServicePersistsConsoleRun() {
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run"
  });
  assert(result.ok, "app service run should succeed");
  assert(result.value.summary.totalItems === 1, "console summary should include total item count");
  assert(result.value.rows[0].eventCount > 0, "console row should include event count");
  assert(result.value.rows[0].timeline.length > 0, "console row should include trace timeline");
  assert(
    result.value.rows[0].timeline.some((entry) => entry.data?.locator?.selected),
    "console timeline should include locator evidence"
  );

  const runs = await app.listRuns();
  assert(runs.length === 1, "app service should persist run summary");

  const consoleView = await app.getRunConsole(runs[0].runId);
  assert(consoleView?.rows[0].rowId === "row-1", "app service should retrieve saved console view");

  const exported = await app.exportRunCsv(runs[0].runId);
  assert(exported.includes("runId,employeeId,employeeName,runObjectId,runObjectName,runObjectSource,status,eventCount,failedStepId,resumeStepId,retryCount,errorCategory,error"), "app service should export run CSV header");
  assert(exported.includes("row-1"), "app service should export run row");

  const traceJson = await app.exportRunTraceJson(runs[0].runId);
  const tracePayload = JSON.parse(traceJson);
  assert(tracePayload.summary.runId === runs[0].runId, "app service should export trace JSON summary");
  assert(tracePayload.traces.length > 0, "app service should export trace JSON entries");

  const jsonRun = await app.runProducts({
    csv: '[{"rowId":"row-json","productUrl":"https://example.com/json","title":"商品JSON"}]',
    inputFormat: "json",
    mode: "dry_run"
  });
  assert(jsonRun.ok, "app service should run JSON product input");
  assert(jsonRun.value.rows[0].rowId === "row-json", "app service should preserve JSON rowId");
}

async function testWorkflowRetriesFailedSteps() {
  let clickAttempts = 0;
  const flakyBrowser = {
    async open(url) {
      return { ok: true, message: `Opened ${url}` };
    },
    async click(candidate) {
      clickAttempts += 1;
      if (candidate.value === "menuitem:橱窗" && clickAttempts === 1) {
        return { ok: false, message: "Transient click failure" };
      }
      return { ok: true, message: `Clicked ${candidate.value}` };
    },
    async input() {
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      return { ok: true, message: "Verified" };
    },
    async wait(timeoutMs) {
      return { ok: true, message: `Waited ${timeoutMs}ms` };
    },
    async snapshot() {
      return { ready: true };
    }
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    browser: flakyBrowser
  });
  assert(result.ok, "workflow should succeed after retrying transient step failure");
  assert(result.value.rows[0].status === "success", "retried item should succeed");
  assert(result.value.rows[0].checkpoint.retryCount === 1, "checkpoint should record retry count");
  assert(result.value.rows[0].timeline.some((entry) => entry.type === "step.retrying"), "timeline should include retry event");
}

async function testBrowserExceptionsBecomeRecoverableFailures() {
  const app = new BaiyingMvpAppService();
  const throwingBrowser = {
    async open(url) {
      return { ok: true, message: `Opened ${url}` };
    },
    async click() {
      throw new Error("Browser click timeout");
    },
    async input() {
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      return { ok: true, message: "Verified" };
    },
    async wait(timeoutMs) {
      return { ok: true, message: `Waited ${timeoutMs}ms` };
    },
    async snapshot() {
      throw new Error("Snapshot unavailable");
    }
  };

  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    browser: throwingBrowser
  });
  assert(result.ok, "browser exceptions should return a structured console view");
  assert(result.value.summary.status === "failed", "browser exception should fail the run summary");
  assert(result.value.rows[0].status === "failed", "browser exception should fail the row");
  assert(result.value.rows[0].failedStepId === "open_product_window", "browser exception should keep failed step id");
  assert(result.value.rows[0].resumeStepId === "open_product_window", "browser exception should suggest failed step for recovery");
  assert(result.value.rows[0].error.includes("Browser click timeout"), "browser exception should preserve error message");
  assert(result.value.rows[0].errorCategory === "browser", "browser exception should classify as browser failure");
  assert(
    result.value.rows[0].timeline.some((entry) => entry.snapshot?.snapshotError === "Snapshot unavailable"),
    "snapshot exceptions should be captured in trace evidence"
  );

  const recovery = await app.getRunRecoveryPlan(result.value.summary.runId);
  assert(recovery.totalRecoverableRows === 1, "browser exception should produce a recovery plan");
  assert(recovery.groups[0].startStepArg === "open_product_window", "recovery plan should resume from failed browser step");
}

async function testWorkflowClosesBrowserRuntime() {
  let closeCount = 0;
  const browser = {
    async open(url) {
      return { ok: true, message: `Opened ${url}` };
    },
    async click(candidate) {
      return { ok: true, message: `Clicked ${candidate.value}` };
    },
    async input() {
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      return { ok: true, message: "Verified" };
    },
    async wait(timeoutMs) {
      return { ok: true, message: `Waited ${timeoutMs}ms` };
    },
    async snapshot() {
      return { ready: true };
    },
    async close() {
      closeCount += 1;
    }
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    browser
  });
  assert(result.ok, "workflow should still return a structured result");
  assert(closeCount === 1, "workflow should close the browser runtime after a batch");

  const closeFailingBrowser = {
    ...browser,
    async close() {
      closeCount += 1;
      throw new Error("close failed");
    }
  };
  const closeFailingResult = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-2,https://example.com/b,商品B",
    mode: "dry_run",
    browser: closeFailingBrowser
  });
  assert(closeFailingResult.ok, "browser close failures should not hide run results");
  assert(closeFailingResult.value.rows[0].status === "success", "close failure should not change row status");
}

async function testWorkflowResumeFromStartStep() {
  const calls = [];
  const recordingBrowser = {
    async open(url) {
      calls.push(["open", url]);
      return { ok: true, message: `Opened ${url}` };
    },
    async click(candidate) {
      calls.push(["click", candidate.value]);
      return { ok: true, message: `Clicked ${candidate.value}` };
    },
    async input(candidate, target, value) {
      calls.push(["input", value]);
      return { ok: true, message: "Filled input" };
    },
    async verify() {
      calls.push(["verify"]);
      return { ok: true, message: "Verified" };
    },
    async wait(timeoutMs) {
      calls.push(["wait", timeoutMs]);
      return { ok: true, message: `Waited ${timeoutMs}ms` };
    },
    async snapshot() {
      return { ready: true };
    }
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    startStepId: "click_add_product",
    browser: recordingBrowser
  });
  assert(result.ok, "resume run should succeed from a valid step");
  assert(result.value.rows[0].timeline.some((entry) => entry.type === "item.resumed"), "resume run should emit item.resumed");
  assert(!calls.some((call) => call[0] === "open"), "resume run should skip steps before startStepId");
  assert(calls.some((call) => call[0] === "click" && call[1] === "button:添加商品"), "resume run should execute requested start step");

  const invalid = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    startStepId: "missing_step",
    browser: recordingBrowser
  });
  assert(invalid.ok, "invalid resume should still return structured console view");
  assert(invalid.value.rows[0].status === "failed", "invalid resume should fail the item");
  assert(invalid.value.rows[0].error.includes("missing_step"), "invalid resume should explain missing step");
  assert(invalid.value.rows[0].errorCategory === "resume", "invalid resume should classify failure category");
  assert(invalid.value.rows[0].resumeStepId === "open_baiying", "invalid resume should suggest first workflow step");
  assert(invalid.value.rows[0].timeline.some((entry) => entry.type === "resume.invalid"), "invalid resume should emit resume.invalid");
}

async function testStepTimeoutsReachBrowserRuntime() {
  const calls = [];
  const browser = {
    async open(url, timeoutMs) {
      calls.push(["open", url, timeoutMs]);
      return { ok: true, message: "Opened" };
    },
    async click(candidate, target, timeoutMs) {
      calls.push(["click", candidate.value, timeoutMs]);
      return { ok: true, message: "Clicked" };
    },
    async input(candidate, target, value, timeoutMs) {
      calls.push(["input", value, timeoutMs]);
      return { ok: true, message: "Filled" };
    },
    async verify(expectation, timeoutMs) {
      calls.push(["verify", expectation.textExists ?? expectation.anyTextExists?.[0], timeoutMs]);
      return { ok: true, message: "Verified" };
    },
    async wait(timeoutMs) {
      calls.push(["wait", timeoutMs]);
      return { ok: true, message: "Waited" };
    },
    async snapshot() {
      return { ready: true };
    }
  };
  const workflow = {
    ...baiyingAddProductWorkflow,
    steps: [
      { id: "open", type: "browser.open", url: "https://example.com", timeoutMs: 111 },
      { id: "verify", type: "browser.verify", expectation: { textExists: "Ready" }, timeoutMs: 222 },
      { id: "click", type: "browser.click", target: { role: "button", text: "添加商品" }, timeoutMs: 333 },
      { id: "input", type: "browser.input", target: { label: "商品链接" }, value: "{{productUrl}}", timeoutMs: 444 },
      { id: "wait", type: "browser.wait", timeoutMs: 555 }
    ]
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    workflow,
    browser
  });
  assert(result.ok, "step timeout workflow should run");
  assert(calls.some((call) => call[0] === "open" && call[2] === 111), "open should receive step timeout");
  assert(calls.some((call) => call[0] === "verify" && call[2] === 222), "verify should receive step timeout");
  assert(calls.some((call) => call[0] === "click" && call[2] === 333), "click should receive step timeout");
  assert(calls.some((call) => call[0] === "input" && call[2] === 444), "input should receive step timeout");
  assert(calls.some((call) => call[0] === "wait" && call[1] === 555), "wait should use step timeout as duration");
}

async function testPlaywrightAdapterUsesInjectedDriver() {
  const calls = [];
  const handlers = {};
  const emit = (eventName, ...args) => {
    for (const handler of handlers[eventName] ?? []) {
      handler(...args);
    }
  };
  const request = (url, method = "GET", resourceType = "document") => ({
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    failure: () => ({ errorText: "net::ERR_FAILED" })
  });
  const locator = {
    async click() {
      calls.push(["click"]);
    },
    async fill(value) {
      calls.push(["fill", value]);
    },
    async innerText() {
      calls.push(["innerText"]);
      return "百应 橱窗 添加成功 商品链接";
    },
    async ariaSnapshot() {
      calls.push(["ariaSnapshot"]);
      return "- main:\n  - button \"添加商品\"\n  - textbox \"商品链接\"";
    }
  };
  const page = {
    on(eventName, handler) {
      handlers[eventName] = [...(handlers[eventName] ?? []), handler];
    },
    async goto(url) {
      calls.push(["goto", url]);
      emit("console", { type: () => "error", text: () => "Baiying console error" });
      emit("response", { url: () => url, status: () => 200, request: () => request(url) });
      emit("response", { url: () => `${url}/api`, status: () => 500, request: () => request(`${url}/api`, "POST", "xhr") });
      emit("requestfailed", request(`${url}/blocked`, "GET", "script"));
    },
    getByRole(role, options) {
      calls.push(["getByRole", role, options?.name]);
      return locator;
    },
    getByLabel(label) {
      calls.push(["getByLabel", label]);
      return locator;
    },
    getByText(text) {
      calls.push(["getByText", text]);
      return locator;
    },
    locator(selector) {
      calls.push(["locator", selector]);
      return locator;
    },
    async waitForTimeout(timeoutMs) {
      calls.push(["waitForTimeout", timeoutMs]);
    },
    async content() {
      return "<html><body>百应 橱窗 添加成功</body></html>";
    },
    async title() {
      return "百应";
    },
    url() {
      return "https://buyin.jinritemai.com";
    },
    async screenshot() {
      return new Uint8Array([1, 2, 3]);
    }
  };
  const context = {
    pages() {
      return [page];
    },
    async newPage() {
      return page;
    },
    async close() {
      calls.push(["close"]);
    }
  };
  const fakePlaywright = {
    chromium: {
      async launchPersistentContext(userDataDir, options) {
        calls.push(["launchPersistentContext", userDataDir, options.headless]);
        return context;
      }
    }
  };
  const browser = new PlaywrightBrowserRuntime(
    { userDataDir: ".tmp/test-playwright-profile", headless: true, actionDelayMs: 15 },
    async () => fakePlaywright
  );
  const result = await browser.open("https://buyin.jinritemai.com");
  assert(result.ok, "playwright adapter should open with injected driver");
  await browser.click({ strategy: "role", value: "button:添加商品", score: 0.94 }, { role: "button", text: "添加商品" });
  await browser.input({ strategy: "label", value: "商品链接", score: 0.96 }, { label: "商品链接" }, "https://example.com/a");
  const loginSession = await browser.openLoginSession("https://buyin.jinritemai.com/dashboard");
  const verify = await browser.verify({ anyTextExists: ["添加成功"] });
  const snapshot = await browser.snapshot();
  await browser.close();

  assert(loginSession.userDataDir === ".tmp/test-playwright-profile", "playwright login session should return profile path");
  assert(loginSession.url === "https://buyin.jinritemai.com", "playwright login session should open requested login page");
  assert(verify.ok, "playwright adapter should verify page content");
  assert(snapshot.ready === true, "playwright adapter snapshot should report ready page");
  assert(snapshot.domTextLength > 0, "playwright snapshot should include DOM text length");
  assert(snapshot.domTextSample.includes("商品链接"), "playwright snapshot should include visible DOM text sample");
  assert(snapshot.accessibilitySnapshot.includes("button"), "playwright snapshot should include accessibility evidence when available");
  assert(snapshot.screenshot.bytes === 3, "playwright adapter snapshot should include screenshot byte count");
  assert(snapshot.screenshot.base64 === "AQID", "playwright adapter snapshot should include screenshot base64");
  assert(snapshot.consoleLogs.some((log) => log.text === "Baiying console error"), "playwright snapshot should include console logs");
  assert(snapshot.networkSummary.total === 6, "playwright snapshot should include network event count");
  assert(snapshot.networkSummary.failed === 2, "playwright snapshot should summarize failed requests");
  assert(snapshot.networkSummary.status5xx === 2, "playwright snapshot should summarize 5xx responses");
  assert(snapshot.networkEvents.some((event) => event.errorText === "net::ERR_FAILED"), "playwright snapshot should include failed request details");
  assert(calls.some((call) => call[0] === "launchPersistentContext"), "playwright adapter should launch persistent context");
  assert(calls.some((call) => call[0] === "getByRole"), "playwright adapter should use role locator");
  assert(calls.some((call) => call[0] === "getByLabel"), "playwright adapter should use label locator");
  assert(calls.filter((call) => call[0] === "waitForTimeout" && call[1] === 15).length >= 3, "visible debug runs should pause after browser actions");
}

async function testPlaywrightClickFallsBackFromRecordedTitlePrefix() {
  const calls = [];
  const prefixedLocator = {
    async click() {
      calls.push(["click", "prefixed"]);
      throw new Error("Timeout waiting for prefixed accessible name");
    },
    async fill() {}
  };
  const cleanLocator = {
    async click() {
      calls.push(["click", "clean"]);
    },
    async fill() {}
  };
  const page = {
    async goto() {},
    getByRole(role, options) {
      calls.push(["getByRole", role, options?.name, options?.exact]);
      return options?.name === "标题：豆包App入局即时出行赛道" ? prefixedLocator : cleanLocator;
    },
    getByLabel() {
      return cleanLocator;
    },
    getByText(text) {
      calls.push(["getByText", text]);
      return text === "标题：豆包App入局即时出行赛道" ? prefixedLocator : cleanLocator;
    },
    locator() {
      return cleanLocator;
    },
    async waitForTimeout() {},
    async content() {
      return "<html><body><a>豆包App入局即时出行赛道</a></body></html>";
    },
    async title() {
      return "测试页";
    },
    url() {
      return "https://example.com";
    },
    async screenshot() {
      return new Uint8Array();
    }
  };
  const context = {
    pages() {
      return [page];
    },
    async newPage() {
      return page;
    },
    async close() {}
  };
  const fakePlaywright = {
    chromium: {
      async launchPersistentContext() {
        return context;
      }
    }
  };
  const browser = new PlaywrightBrowserRuntime(
    { userDataDir: ".tmp/test-playwright-prefix-profile", headless: true },
    async () => fakePlaywright
  );
  const result = await browser.click(
    { strategy: "role", value: "link:标题：豆包App入局即时出行赛道", score: 0.94 },
    { role: "link", text: "标题：豆包App入局即时出行赛道" }
  );
  await browser.close();

  assert(result.ok, "playwright click should succeed after trying cleaned recorded text");
  assert(calls.some((call) => call[0] === "getByRole" && call[2] === "豆包App入局即时出行赛道"), "playwright click should try the cleaned link name");
  assert(calls.some((call) => call[0] === "click" && call[1] === "clean"), "playwright click should use the successful fallback locator");
}

async function testPlaywrightLabelFallsBackToCssForRecordedInputs() {
  const calls = [];
  const labelLocator = {
    async fill() {
      calls.push(["fill", "label"]);
      throw new Error("Timeout waiting for label word");
    },
    async press() {
      calls.push(["press", "label"]);
      throw new Error("Timeout waiting for label word");
    }
  };
  const cssLocator = {
    async fill(value) {
      calls.push(["fill", "css", value]);
    },
    async press(key) {
      calls.push(["press", "css", key]);
    }
  };
  const page = {
    async goto() {},
    getByRole() { return cssLocator; },
    getByLabel(label) {
      calls.push(["getByLabel", label]);
      return labelLocator;
    },
    getByText() { return cssLocator; },
    locator(selector) {
      calls.push(["locator", selector]);
      return cssLocator;
    },
    async waitForTimeout() {},
    async content() { return "<html><body><input id=\"ww\" name=\"word\"></body></html>"; },
    async title() { return "百度新闻"; },
    url() { return "https://news.baidu.com"; },
    async screenshot() { return new Uint8Array(); }
  };
  const context = {
    pages() { return [page]; },
    async newPage() { return page; },
    async close() {}
  };
  const browser = new PlaywrightBrowserRuntime(
    { userDataDir: ".tmp/test-playwright-label-css-profile", headless: true },
    async () => ({ chromium: { async launchPersistentContext() { return context; } } })
  );

  const inputResult = await browser.input(
    { strategy: "label", value: "word", score: 0.96 },
    { role: "textbox", label: "word", css: "#ww" },
    "豆包"
  );
  const pressResult = await browser.press(
    "Enter",
    { strategy: "label", value: "word", score: 0.96 },
    { role: "textbox", label: "word", css: "#ww" }
  );
  await browser.close();

  assert(inputResult.ok, "playwright input should succeed through css fallback after label timeout");
  assert(pressResult.ok, "playwright press should succeed through css fallback after label timeout");
  assert(calls.some((call) => call[0] === "locator" && call[1] === "#ww"), "playwright should try recorded css selector as fallback");
  assert(calls.some((call) => call[0] === "fill" && call[1] === "css" && call[2] === "豆包"), "playwright input should use css fallback locator");
  assert(calls.some((call) => call[0] === "press" && call[1] === "css" && call[2] === "Enter"), "playwright press should use css fallback locator");
}

async function testPlaywrightClickTracksPopupPage() {
  const handlers = {};
  const calls = [];
  const popupPage = {
    on() {},
    async goto() {},
    getByRole() { return locator; },
    getByLabel() { return locator; },
    getByText() { return locator; },
    locator() { return locator; },
    async waitForTimeout(timeoutMs) { calls.push(["popupWait", timeoutMs]); },
    async content() { return "<html><body>豆包新闻详情</body></html>"; },
    async title() { return "豆包新闻详情"; },
    url() { return "https://baijiahao.baidu.com/s?id=1"; },
    async screenshot() { return new Uint8Array(); }
  };
  const locator = {
    async click() {
      calls.push(["click"]);
      for (const handler of handlers.popup ?? []) {
        handler(popupPage);
      }
    },
    async fill() {},
    async innerText() {
      return "搜索页";
    }
  };
  const page = {
    on(eventName, handler) {
      handlers[eventName] = [...(handlers[eventName] ?? []), handler];
    },
    async goto(url) {
      calls.push(["goto", url]);
    },
    getByRole() { return locator; },
    getByLabel() { return locator; },
    getByText() { return locator; },
    locator() { return locator; },
    async waitForTimeout(timeoutMs) { calls.push(["pageWait", timeoutMs]); },
    async content() { return "<html><body>搜索页</body></html>"; },
    async title() { return "搜索页"; },
    url() { return "https://www.baidu.com/s?word=doubao"; },
    async screenshot() { return new Uint8Array(); }
  };
  const context = {
    pages() { return [page]; },
    async newPage() { return page; },
    async close() {}
  };
  const browser = new PlaywrightBrowserRuntime(
    { userDataDir: ".tmp/test-playwright-popup-profile", headless: true },
    async () => ({ chromium: { async launchPersistentContext() { return context; } } })
  );

  await browser.open("https://news.baidu.com");
  const result = await browser.click(
    { strategy: "css", value: "div[id=\"1\"] a", score: 0.74 },
    { css: "div[id=\"1\"] a" }
  );
  const snapshot = await browser.snapshot();
  await browser.close();

  assert(result.ok, "popup click should succeed");
  assert(result.data.openedPopupUrl === "https://baijiahao.baidu.com/s?id=1", "popup click should report opened popup url");
  assert(snapshot.url === "https://baijiahao.baidu.com/s?id=1", "playwright runtime should switch current page to opened popup");
}

async function testRunViewModeCreatesExpectedBrowserRuntime() {
  const visibleBrowser = createBrowser("playwright", ".tmp/test-playwright-profile", undefined, "visible");
  const silentBrowser = createBrowser("playwright", ".tmp/test-playwright-profile", undefined, "silent");
  assert(visibleBrowser.config.headless === false, "visible run-once mode should launch a headed browser");
  assert(visibleBrowser.config.actionDelayMs > 0, "visible run-once mode should slow actions for debugging");
  assert(silentBrowser.config.headless === true, "silent run-once mode should launch headless");
  assert(silentBrowser.config.actionDelayMs === 0, "silent run-once mode should not add visual debug delay");
}

async function testOpenLoginArgs() {
  const options = parseOpenLoginArgs([
    "node",
    "open-login.js",
    "--user-data-dir",
    "browser-profiles/custom",
    "--url",
    "https://example.com/login",
    "--headless",
    "true",
    "--executable-path",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ]);
  assert(options.userDataDir === "browser-profiles/custom", "login args should parse user data dir");
  assert(options.url === "https://example.com/login", "login args should parse url");
  assert(options.headless === true, "login args should parse headless flag");
  assert(options.executablePath?.includes("Google Chrome"), "login args should parse executable path");
}

async function testDoctorReportsLocalReadiness() {
  await rm(".tmp/doctor-runs.json", { force: true });
  await rm(".tmp/doctor-workflows.json", { force: true });
  await rm(".tmp/doctor-profile", { recursive: true, force: true });
  const args = parseDoctorArgs([
    "node",
    "doctor.js",
    "--user-data-dir",
    ".tmp/doctor-profile",
    "--store",
    ".tmp/doctor-runs.json",
    "--workflow-store",
    ".tmp/doctor-workflows.json",
    "--sample",
    "examples/products.csv",
    "--executable-path",
    "package.json"
  ]);
  assert(args.userDataDir === ".tmp/doctor-profile", "doctor args should parse profile path");
  assert(args.storePath === ".tmp/doctor-runs.json", "doctor args should parse run store path");
  assert(args.executablePath === "package.json", "doctor args should parse executable path");

  const report = await runDoctor(args);
  assert(report.ok, "doctor should return a structured report");
  assert(report.value.status === "warning", "doctor should warn when browser profile is not initialized");
  assert(report.value.checks.some((check) => check.name === "workflow" && check.status === "ok"), "doctor should validate default workflow");
  assert(report.value.checks.some((check) => check.name === "sample_input" && check.status === "ok"), "doctor should parse sample input");
  assert(report.value.checks.some((check) => check.name === "electron_package"), "doctor should report Electron package availability");
  assert(report.value.checks.some((check) => check.name === "playwright_package"), "doctor should report Playwright package availability");
  assert(report.value.checks.some((check) => check.name === "browser_executable" && check.status === "ok"), "doctor should validate configured executable path");
  assert(report.value.checks.some((check) => check.name === "browser_profile" && check.status === "warning"), "doctor should report profile warnings");

  await writeFile(".tmp/doctor-bad-runs.json", "{}", "utf8");
  const badReport = await runDoctor({
    ...args,
    storePath: ".tmp/doctor-bad-runs.json"
  });
  assert(badReport.ok, "doctor should return reports even when checks fail");
  assert(badReport.value.status === "error", "doctor should mark bad stores as errors");
  assert(badReport.value.checks.some((check) => check.name === "run_store" && check.status === "error"), "doctor should report run store errors");

  const missingExecutableReport = await runDoctor({
    ...args,
    executablePath: ".tmp/missing-browser-executable"
  });
  assert(missingExecutableReport.ok, "doctor should report missing executable paths without throwing");
  assert(missingExecutableReport.value.status === "error", "doctor should mark missing executable paths as errors");
  assert(
    missingExecutableReport.value.checks.some((check) => check.name === "browser_executable" && check.status === "error"),
    "doctor should include executable path errors"
  );
}

async function testJsonFileRunStorePersistsRuns() {
  const filePath = ".tmp/test-runs.json";
  await rm(filePath, { force: true });
  const app = new BaiyingMvpAppService(new JsonFileRunStore(filePath));
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run"
  });
  assert(result.ok, "file-backed app service run should succeed");

  const secondStore = new JsonFileRunStore(filePath);
  const runs = await secondStore.list();
  assert(runs.length === 1, "file store should persist run summary across instances");
  const run = await secondStore.get(runs[0].runId);
  assert(run?.items[0].item.rowId === "row-1", "file store should retrieve saved run items");
  assert(run.traces.length > 0, "file store should persist trace entries");
  assert(await secondStore.delete(runs[0].runId), "file store should delete saved runs by id");
  assert((await secondStore.list()).length === 0, "file store delete should remove run summary");
  assert(!(await secondStore.delete(runs[0].runId)), "file store delete should report missing runs");

  const traceHtml = renderTraceViewer(run);
  assert(traceHtml.includes("Trace Viewer"), "trace viewer should render title");
  assert(traceHtml.includes(run.summary.runId), "trace viewer should render run id");
  assert(traceHtml.includes("Trace Entries"), "trace viewer should render trace metric");

  await writeFile(".tmp/bad-runs.json", "{}", "utf8");
  const badRunStore = new JsonFileRunStore(".tmp/bad-runs.json");
  await assertRejects(
    () => badRunStore.list(),
    "Expected run store .tmp/bad-runs.json to contain a JSON array.",
    "file store should reject invalid run store shape"
  );

  await writeFile(".tmp/bad-workflow-versions.json", "{}", "utf8");
  const badWorkflowStore = new JsonFileWorkflowVersionStore(".tmp/bad-workflow-versions.json");
  await assertRejects(
    () => badWorkflowStore.list(),
    "Expected workflow version store .tmp/bad-workflow-versions.json to contain a JSON array.",
    "workflow version store should reject invalid store shape"
  );

  const workflowStorePath = ".tmp/test-delete-workflow-versions.json";
  await rm(workflowStorePath, { force: true });
  const workflowStore = new JsonFileWorkflowVersionStore(workflowStorePath);
  await workflowStore.save({
    summary: {
      versionId: "version-to-delete",
      workflowId: baiyingAddProductWorkflow.workflowId,
      name: baiyingAddProductWorkflow.name,
      createdAt: new Date().toISOString()
    },
    workflow: baiyingAddProductWorkflow
  });
  assert((await workflowStore.list()).length === 1, "workflow version store should save versions");
  assert(await workflowStore.delete("version-to-delete"), "workflow version store should delete versions by id");
  assert((await workflowStore.list()).length === 0, "workflow version store delete should remove summaries");
  assert(!(await workflowStore.delete("version-to-delete")), "workflow version store delete should report missing versions");
}

async function testSqliteRunStoreScopesRunsByEmployeeColumn() {
  const filePath = ".tmp/test-sqlite-runs.sqlite";
  await rm(filePath, { force: true });
  const store = new SqliteRunStore(filePath);
  const app = new BaiyingMvpAppService(store);

  const firstRun = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    employeeId: "p0002",
    employeeName: "员工 P0002"
  });
  const secondRun = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/b,商品B",
    mode: "dry_run",
    employeeId: "p0005",
    employeeName: "员工 P0005"
  });
  assert(firstRun.ok && secondRun.ok, "sqlite-backed employee runs should succeed");

  const db = new DatabaseSync(filePath);
  try {
    const columns = db.prepare("PRAGMA table_info(runs)").all();
    assert(columns.some((column) => column.name === "employee_id"), "runs table should store employee_id as a first-class column");
    const rows = db.prepare("SELECT id, employee_id FROM runs ORDER BY id ASC").all();
    assert(rows.some((row) => row.id === firstRun.value.summary.runId && row.employee_id === "p0002"), "sqlite runs should persist p0002 in employee_id");
    assert(rows.some((row) => row.id === secondRun.value.summary.runId && row.employee_id === "p0005"), "sqlite runs should persist p0005 in employee_id");
  } finally {
    db.close();
  }

  const p0002Runs = await app.listRunsForEmployee("p0002");
  const p0005Runs = await app.listRunsForEmployee("p0005");
  assert(p0002Runs.length === 1 && p0002Runs[0].runId === firstRun.value.summary.runId, "employee run list should use employee_id column for p0002");
  assert(p0005Runs.length === 1 && p0005Runs[0].runId === secondRun.value.summary.runId, "employee run list should use employee_id column for p0005");
  assert(!(await app.getEmployeeRunConsole("p0002", secondRun.value.summary.runId)), "employee run detail should reject runs with another employee_id");
  assert(await app.deleteEmployeeRun("p0005", secondRun.value.summary.runId), "employee run delete should use employee_id column");
  assert((await app.listRunsForEmployee("p0005")).length === 0, "employee run delete should remove only the selected employee run");
  assert((await app.listRunsForEmployee("p0002")).length === 1, "employee run delete should not remove other employee runs");

  const legacyPath = ".tmp/test-legacy-sqlite-runs.sqlite";
  await rm(legacyPath, { force: true });
  const legacyDb = new DatabaseSync(legacyPath);
  try {
    legacyDb.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        document_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    const insert = legacyDb.prepare("INSERT INTO runs (id, document_json, started_at, updated_at) VALUES (?, ?, ?, ?)");
    insert.run(firstRun.value.summary.runId, JSON.stringify({ ...firstRun.value, summary: firstRun.value.summary }), firstRun.value.summary.startedAt, firstRun.value.summary.completedAt ?? firstRun.value.summary.startedAt);
    insert.run(secondRun.value.summary.runId, JSON.stringify({ ...secondRun.value, summary: secondRun.value.summary }), secondRun.value.summary.startedAt, secondRun.value.summary.completedAt ?? secondRun.value.summary.startedAt);
  } finally {
    legacyDb.close();
  }
  const legacyStore = new SqliteRunStore(legacyPath);
  const deletedLegacyRuns = await legacyStore.clearForEmployee("p0002");
  assert(deletedLegacyRuns === 1, "employee run clear should delete legacy rows after adding employee_id column");
  const migratedDb = new DatabaseSync(legacyPath);
  try {
    const columns = migratedDb.prepare("PRAGMA table_info(runs)").all();
    assert(columns.some((column) => column.name === "employee_id"), "legacy runs table should gain employee_id during clear");
    const remainingRows = migratedDb.prepare("SELECT id, employee_id FROM runs ORDER BY id ASC").all();
    assert(remainingRows.length === 1 && remainingRows[0].employee_id === "p0005", "legacy clear should keep runs for other employees");
  } finally {
    migratedDb.close();
  }
}

async function testRunConsoleHtmlIncludesOperationalPanels() {
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run"
  });
  assert(result.ok, "console render fixture should run");
  const html = renderRunConsole(result.value);
  assert(html.includes("Batch Add Products To Window"), "console should include workflow title");
  assert(html.includes("Run Configuration"), "console should include run configuration panel");
  assert(html.includes("Workflow Status"), "console should include status panel");
  assert(html.includes("Run Results"), "console should include result table");
  assert(html.includes("<th>Retry</th>"), "console should include retry column");
  assert(html.includes("<th>Failed Step</th>"), "console should include failed step column");
  assert(html.includes("<th>Resume Step</th>"), "console should include resume step column");
  assert(html.includes("<th>Category</th>"), "console should include failure category column");
  assert(html.includes("Trace Preview"), "console should include trace preview");
  assert(html.includes("dry_run"), "console should show selected dry_run mode");
  assert(html.includes("step.succeeded / open_baiying"), "console should render real trace timeline entries");
  assert(html.includes("Locator: role=button:添加商品"), "console should render locator evidence");
}

async function testLowConfidenceLocatorRequiresApproval() {
  const workflow = {
    ...baiyingAddProductWorkflow,
    workflowId: "low-confidence-locator",
    steps: [
      {
        id: "unsafe_xpath_click",
        type: "browser.click",
        target: {
          xpath: "//button[1]"
        }
      }
    ]
  };
  const app = new BaiyingMvpAppService();
  const result = await app.runProducts({
    csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
    mode: "dry_run",
    workflow
  });
  assert(result.ok, "low confidence workflow should return structured console view");
  assert(result.value.summary.status === "requires_approval", "low confidence locator should require approval");
  assert(result.value.rows[0].errorCategory === "approval_required", "low confidence locator should classify approval category");
  assert(result.value.rows[0].resumeStepId === "unsafe_xpath_click", "low confidence locator should suggest failed step for resume");
  assert(result.value.rows[0].timeline.some((entry) => entry.data?.confidence === "manual" || entry.data?.locator?.confidence === "manual"), "timeline should expose manual locator decision");
}

async function testWorkflowPatchUpdatesStepTarget() {
  const result = applyWorkflowPatch(baiyingAddProductWorkflow, {
    stepId: "click_add_product",
    target: {
      role: "button",
      text: "添加到橱窗"
    },
    note: "Confirmed from Baiying page"
  });
  assert(result.ok, "workflow patch should succeed for click/input step targets");
  const patchedStep = result.value.workflow.steps.find((step) => step.id === "click_add_product");
  assert(patchedStep.target.text === "添加到橱窗", "workflow patch should replace target");
  assert(validateWorkflow(result.value.workflow).ok, "patched workflow should remain valid");
}

async function testWorkflowPatchRejectsUnsupportedStep() {
  const result = applyWorkflowPatch(baiyingAddProductWorkflow, {
    stepId: "ensure_login",
    target: {
      text: "百应"
    }
  });
  assert(!result.ok, "workflow patch should reject non-target steps");
}

async function testSuggestTargetFromLocatorEvidence() {
  const target = suggestTargetFromLocatorEvidence({
    locator: {
      selected: {
        strategy: "role",
        value: "button:添加商品",
        score: 0.94
      },
      confidence: "auto"
    }
  });
  assert(target.role === "button", "locator evidence should suggest role");
  assert(target.text === "添加商品", "locator evidence should suggest text");
}

async function testRecorderBuildsValidWorkflow() {
  let session = createRecorderSession("session-1", "Recorded Baiying Flow");
  session = appendRecordedAction(session, {
    type: "open",
    url: "https://buyin.jinritemai.com"
  });
  session = appendRecordedAction(session, {
    type: "click",
    intent: "click_add_product",
    target: { role: "button", text: "添加商品" }
  });
  session = appendRecordedAction(session, {
    type: "input",
    target: { role: "textbox", label: "商品链接" },
    value: "{{productUrl}}"
  });
  session = appendRecordedAction(session, {
    type: "press",
    intent: "press_enter_search",
    target: { role: "textbox", label: "关键词" },
    key: "Enter"
  });
  session = appendRecordedAction(session, {
    type: "extract",
    intent: "extract_articles",
    extract: {
      entity: "articles",
      selector: ".result",
      limit: 5,
      fields: {
        title: { selector: "a", text: true },
        url: { selector: "a", attr: "href" }
      }
    }
  });
  session = appendRecordedAction(session, {
    type: "strategy",
    intent: "select_best_result",
    name: "选择最佳商品",
    strategyType: "strategy.select",
    strategy: {
      kind: "select",
      goal: "从搜索结果中选择标题最匹配的商品",
      inputs: ["title", "productUrl"],
      pageScope: "search_results",
      allowedActions: ["read", "click"],
      deniedActions: ["submit", "delete", "payment"],
      successCriteria: "被点击的结果标题应包含输入商品标题",
      failureBehavior: "record_and_continue",
      evidenceRequired: true
    }
  });
  const workflow = recordedActionsToWorkflow(session, "recorded-baiying-flow");
  const result = validateWorkflow(workflow);
  assert(result.ok, "recorded actions should produce a valid workflow");
  assert(workflow.steps.length === 6, "recorder workflow should include all actions");
  assert(workflow.steps[1].id === "click_add_product", "recorder should use semantic intent as step id");
  assert(workflow.steps[3].type === "browser.press" && workflow.steps[3].key === "Enter", "recorder should convert key events to browser.press steps");
  assert(workflow.steps[4].type === "browser.extract" && workflow.steps[4].extract.entity === "articles", "recorder should convert extraction actions to browser.extract steps");
  assert(workflow.steps[5].type === "strategy.select" && workflow.steps[5].strategy.kind === "select", "recorder should convert strategy annotations to strategy workflow nodes");

  let duplicateSession = createRecorderSession("session-duplicates", "Duplicate Intents");
  duplicateSession = appendRecordedAction(duplicateSession, {
    type: "click",
    intent: "click_add_product",
    target: { role: "button", text: "添加商品" }
  });
  duplicateSession = appendRecordedAction(duplicateSession, {
    type: "click",
    intent: "click_add_product",
    target: { role: "button", text: "再次添加" }
  });
  duplicateSession = appendRecordedAction(duplicateSession, {
    id: "click_add_product",
    type: "click",
    target: { role: "button", text: "第三次添加" }
  });
  const duplicateWorkflow = recordedActionsToWorkflow(duplicateSession, "recorded-duplicate-flow");
  assert(validateWorkflow(duplicateWorkflow).ok, "recorder should make duplicate action ids unique");
  assert(duplicateWorkflow.steps.map((step) => step.id).join(",") === "click_add_product,click_add_product_2,click_add_product_3", "recorder should append numeric suffixes to duplicate ids");
}

async function testRunCsvFileProducesConsoleAndStore() {
  const outHtmlPath = ".tmp/test-console.html";
  const storePath = ".tmp/test-run-csv-runs.json";
  await rm(outHtmlPath, { force: true });
  await rm(storePath, { force: true });
  const result = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    outHtmlPath,
    storePath
  });
  assert(result.ok, "runCsvFile should succeed for examples/products.csv");
  assert(result.value.totalItems === 2, "runCsvFile should process two sample rows");
  const html = await readFile(outHtmlPath, "utf8");
  assert(html.includes("Run Results"), "runCsvFile should write console HTML");
  const store = await readFile(storePath, "utf8");
  assert(store.includes(result.value.runId), "runCsvFile should persist run JSON");
  assert(store.includes("\"traces\""), "runCsvFile should persist trace JSON");

  const blocked = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "batch",
    approvals: ["batch", "final_submit"],
    browser: "playwright",
    userDataDir: ".tmp/missing-run-csv-profile",
    headless: true,
    outHtmlPath: ".tmp/blocked-playwright-console.html",
    storePath: ".tmp/blocked-playwright-runs.json"
  });
  assert(!blocked.ok, "runCsvFile should block approved Playwright runs without login profile");
  assert(blocked.errors.join("\n").includes("prepared Douyin Baiying browser profile"), "blocked run should explain profile requirement");

  const blockedByPlan = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "batch",
    approvals: [],
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    outHtmlPath: ".tmp/blocked-plan-console.html",
    storePath: ".tmp/blocked-plan-runs.json"
  });
  assert(blockedByPlan.ok, "runCsvFile should return a structured preflight plan result");
  assert(blockedByPlan.value.status === "needs_attention", "runCsvFile should not execute when the plan needs attention");
  assert(blockedByPlan.value.plan.missingApprovals.includes("batch"), "runCsvFile preflight should include missing approvals");

  const recoverySource = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    approvals: [],
    startStepId: "missing_step",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    outHtmlPath: ".tmp/recovery-source-console.html",
    storePath: ".tmp/recovery-source-runs.json"
  });
  assert(recoverySource.ok, "runCsvFile should create a run for recovery export");
  const recoveryExport = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    recoveryFromRunId: recoverySource.value.runId,
    outHtmlPath: ".tmp/recovery-export-console.html",
    storePath: ".tmp/recovery-source-runs.json"
  });
  assert(recoveryExport.ok, "runCsvFile should export recovery plan from stored run");
  assert(recoveryExport.value.recovery.totalRecoverableRows === 2, "CLI recovery export should include recoverable rows");
  assert(recoveryExport.value.recovery.rowIds.includes("row-1"), "CLI recovery export should include row ids");
  assert(recoveryExport.value.recovery.groups[0].count === 2, "CLI recovery export should group recoverable rows");
  assert(recoveryExport.value.recovery.groups[0].rowIdsArg === "row-1,row-2", "CLI recovery export should include grouped row ids arg");

  await rm(".tmp/plan-only-console.html", { force: true });
  const planOnly = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "batch",
    approvals: [],
    rowIds: ["row-2"],
    browser: "playwright",
    userDataDir: ".tmp/missing-plan-only-profile",
    headless: true,
    planOnly: true,
    planOutPath: ".tmp/plan-only.json",
    outHtmlPath: ".tmp/plan-only-console.html",
    storePath: ".tmp/plan-only-runs.json"
  });
  assert(planOnly.ok, "runCsvFile plan-only should not require Playwright profile readiness");
  assert(planOnly.value.status === "needs_attention", "runCsvFile plan-only should report missing approvals");
  assert(planOnly.value.totalItems === 1, "runCsvFile plan-only should apply rowIds filter");
  assert(planOnly.value.plan.missingApprovals.includes("batch"), "runCsvFile plan-only should include batch approval requirement");
  assert(planOnly.value.plan.steps.some((step) => step.status === "requires_approval"), "runCsvFile plan-only should include step-level approval status");
  assert(planOnly.value.planOutPath.endsWith("plan-only.json"), "runCsvFile plan-only should return plan output path");
  const planOnlyJson = JSON.parse(await readFile(".tmp/plan-only.json", "utf8"));
  assert(planOnlyJson.workflowId === "douyin-baiying-add-product-to-window", "runCsvFile plan-only should write plan JSON");
  assert(planOnlyJson.steps.some((step) => step.stepId === "confirm_add"), "plan JSON should include step-level details");

  const missingRow = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    rowIds: ["missing-row"],
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    planOnly: true,
    outHtmlPath: ".tmp/missing-row-console.html",
    storePath: ".tmp/missing-row-runs.json"
  });
  assert(!missingRow.ok, "runCsvFile should reject missing row ids");

  const customWorkflow = {
    ...baiyingAddProductWorkflow,
    workflowId: "cli-custom-baiying-workflow",
    name: "CLI Custom Baiying Workflow",
    steps: baiyingAddProductWorkflow.steps.map((step) => step.id === "click_add_product"
      ? { ...step, target: { role: "button", text: "添加到橱窗" } }
      : step)
  };
  await writeFile(".tmp/test-cli-workflow.json", JSON.stringify(customWorkflow, null, 2), "utf8");
  const workflowPlan = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    workflowPath: ".tmp/test-cli-workflow.json",
    planOnly: true,
    outHtmlPath: ".tmp/test-cli-workflow-plan.html",
    storePath: ".tmp/test-cli-workflow-plan-runs.json"
  });
  assert(workflowPlan.ok, "runCsvFile plan-only should accept workflow JSON files");
  assert(workflowPlan.value.workflowId === "cli-custom-baiying-workflow", "runCsvFile plan-only should use workflow file id");

  const workflowRun = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    workflowPath: ".tmp/test-cli-workflow.json",
    outHtmlPath: ".tmp/test-cli-workflow-console.html",
    storePath: ".tmp/test-cli-workflow-runs.json"
  });
  assert(workflowRun.ok, "runCsvFile should run workflow JSON files");
  assert(workflowRun.value.workflowId === "cli-custom-baiying-workflow", "runCsvFile should return custom workflow id");
  const workflowRunStore = await readFile(".tmp/test-cli-workflow-runs.json", "utf8");
  assert(workflowRunStore.includes("button:添加到橱窗"), "runCsvFile should execute custom workflow target");

  const workflowExport = await runCsvFile({
    csvPath: "examples/products.csv",
    inputFormat: "auto",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    workflowPath: ".tmp/test-cli-workflow.json",
    exportWorkflowPath: ".tmp/exported-cli-workflow.json",
    outHtmlPath: ".tmp/exported-workflow-console.html",
    storePath: ".tmp/exported-workflow-runs.json"
  });
  assert(workflowExport.ok, "runCsvFile should export validated workflow JSON files");
  assert(workflowExport.value.status === "workflow_exported", "workflow export should not run product rows");
  assert(workflowExport.value.workflowExportPath.endsWith("exported-cli-workflow.json"), "workflow export should return output path");
  const exportedWorkflow = JSON.parse(await readFile(".tmp/exported-cli-workflow.json", "utf8"));
  assert(validateWorkflow(exportedWorkflow).ok, "exported workflow should remain valid");
  assert(exportedWorkflow.workflowId === "cli-custom-baiying-workflow", "workflow export should preserve workflow id");

  const parsed = parseRunCsvArgs(["node", "run-csv.js", "examples/products.csv", "--start-step", "click_add_product", "--plan-only", "true", "--plan-out", ".tmp/plan.json", "--workflow-file", ".tmp/test-cli-workflow.json", "--export-workflow", ".tmp/exported-cli-workflow.json", "--executable-path", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--row-ids", "row-1,row-2", "--recovery-from-run", "run-123"]);
  assert(parsed.startStepId === "click_add_product", "runCsv args should parse start step for resume");
  assert(parsed.planOnly, "runCsv args should parse plan-only mode");
  assert(parsed.planOutPath === ".tmp/plan.json", "runCsv args should parse plan output path");
  assert(parsed.workflowPath === ".tmp/test-cli-workflow.json", "runCsv args should parse workflow file path");
  assert(parsed.exportWorkflowPath === ".tmp/exported-cli-workflow.json", "runCsv args should parse workflow export path");
  assert(parsed.executablePath?.includes("Google Chrome"), "runCsv args should parse executable path");
  assert(parsed.rowIds.join(",") === "row-1,row-2", "runCsv args should parse row ids");
  assert(parsed.recoveryFromRunId === "run-123", "runCsv args should parse recovery run id");

  const jsonResult = await runCsvFile({
    csvPath: "examples/products.json",
    inputFormat: "json",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    outHtmlPath: ".tmp/test-json-console.html",
    storePath: ".tmp/test-json-runs.json"
  });
  assert(jsonResult.ok, "runCsvFile should run JSON product input files");
  assert(jsonResult.value.totalItems === 2, "JSON product input file should include two sample rows");

  await writeFile(".tmp/test-products.xlsx", createXlsxWorkbook([
    ["rowId", "productUrl", "title", "groupName", "remark"],
    ["row-xlsx", "https://example.com/xlsx", "商品XLSX", "默认分组", "xlsx sample"]
  ]));
  const xlsxResult = await runCsvFile({
    csvPath: ".tmp/test-products.xlsx",
    inputFormat: "auto",
    mode: "dry_run",
    browser: "fake",
    userDataDir: "browser-profiles/test",
    headless: true,
    outHtmlPath: ".tmp/test-xlsx-console.html",
    storePath: ".tmp/test-xlsx-runs.json"
  });
  assert(xlsxResult.ok, "runCsvFile should run XLSX product input files in auto mode");
  assert(xlsxResult.value.totalItems === 1, "XLSX product input file should include one sample row");
  const xlsxHtml = await readFile(".tmp/test-xlsx-console.html", "utf8");
  assert(xlsxHtml.includes("商品XLSX"), "runCsvFile XLSX input should render product title");
}

async function testConsoleServerRunsWorkflow() {
  let loginExecutablePath;
  await rm(".tmp/test-server-runs.json", { force: true });
  await rm(".tmp/test-workflow-versions.json", { force: true });
  await rm(".tmp/test-digital-employee.sqlite", { force: true });
  const handler = createConsoleHandler({
    storePath: ".tmp/test-server-runs.json",
    workflowStorePath: ".tmp/test-workflow-versions.json",
    databasePath: ".tmp/test-digital-employee.sqlite",
    userDataDir: "browser-profiles/test",
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    async loginOpener(input) {
      loginExecutablePath = input.executablePath;
      return {
        ok: true,
        value: {
          userDataDir: input.userDataDir,
          url: input.url,
          title: "百应",
          message: "fake login browser opened"
        }
      };
    }
  });

  const htmlResponse = await invokeHandler(handler, "GET", "/", "");
  assert(htmlResponse.body.includes("数字员工调度中心"), "server should render digital employee scheduling center");
  assert(htmlResponse.body.includes("新建员工"), "server console should include employee creation action");
  assert(htmlResponse.body.includes("我创建的员工"), "server console should include employee list");
  assert(htmlResponse.body.includes("id=\"employee-rows\""), "server console should render employees from API");
  assert(htmlResponse.body.includes("id=\"employee-actions\" class=\"toolbar-actions hidden\""), "server console should hide employee actions until a row is selected");
  assert(htmlResponse.body.includes("id=\"employee-delete\""), "server console should include employee delete action");
  assert(htmlResponse.body.includes("id=\"employee-search\""), "server console should include employee search input");
  assert(!htmlResponse.body.includes("↗ 分享"), "server console should remove employee share action");
  assert(!htmlResponse.body.includes("⋮ 更多</button>"), "server console should remove employee more action");
  assert(htmlResponse.body.includes("没有停用的员工"), "server console should include empty trash view");
  assert(htmlResponse.body.includes("id=\"designer-employee-name\""), "server console should render selected employee name in designer title");
  assert(htmlResponse.body.includes("id=\"rename-employee\""), "server console should include employee rename action");
  assert(htmlResponse.body.includes("新建员工"), "server console should include employee journey title");
  assert(htmlResponse.body.includes("data-journey-step=\"define\""), "server console should include define-work journey step");
  assert(!htmlResponse.body.includes("data-journey-step=\"data\""), "server console should not include a separate prepare-data journey step");
  assert(htmlResponse.body.includes("data-journey-step=\"record\""), "server console should include record-main-path journey step");
  assert(htmlResponse.body.includes("data-journey-step=\"strategy\""), "server console should include flexible-node journey step");
  assert(!htmlResponse.body.includes("data-journey-step=\"boundary\""), "server console should not include ineffective strategy-boundary journey step");
  assert(!htmlResponse.body.includes("data-journey-panel=\"boundary\""), "server console should not include ineffective strategy-boundary panel");
  assert(htmlResponse.body.includes("data-journey-step=\"test\""), "server console should include dry-run verification journey step");
  assert(!htmlResponse.body.includes("data-journey-step=\"publish\""), "server console should not include a separate publish journey step");
  assert(!htmlResponse.body.includes("data-journey-panel=\"publish\""), "server console should not include a visible publish journey panel");
  assert(!htmlResponse.body.includes("保存草稿与发布"), "server console should move publish-stage save behavior into the header publish action");
  assert(htmlResponse.body.includes("id=\"journey-goal\""), "server console should include natural-language work goal input");
  assert(!htmlResponse.body.includes("id=\"journey-employee-name\""), "define-work stage should not duplicate the employee name field");
  assert(htmlResponse.body.includes("打开独立录制窗口"), "server console should include independent recording entry");
  assert(htmlResponse.body.includes("主任务流程"), "server console should include main task panel");
  assert(!htmlResponse.body.includes("节点分类"), "server console should not render the node taxonomy panel in the left sidebar");
  assert(htmlResponse.body.includes("智能节点配置"), "server console should include strategy node catalog");
  assert(htmlResponse.body.includes("智能判断"), "server console should include decide strategy node");
  assert(htmlResponse.body.includes("智能选择"), "server console should include select strategy node");
  assert(htmlResponse.body.includes("智能抽取"), "server console should include extract strategy node");
  assert(htmlResponse.body.includes("异常恢复"), "server console should include recover strategy node");
  assert(htmlResponse.body.includes("id=\"insert-strategy-node\""), "server console should include one strategy insertion action");
  assert(!htmlResponse.body.includes("添加为智能选择节点"), "server console should not render one add button per strategy kind");
  assert(htmlResponse.body.includes("主任务流程"), "server console should render a visual action node list");
  assert(htmlResponse.body.includes("原始 JSON 数组"), "server console should render the raw JSON array editor");
  assert(htmlResponse.body.includes("selectedRecorderActionIndex"), "server console should track the selected recorder node for insertion");
  assert(htmlResponse.body.includes("定时任务"), "server console should include scheduled task navigation");
  assert(htmlResponse.body.includes("定时触发器"), "server console should include scheduled trigger modal");
  assert(htmlResponse.body.includes("任务名称:"), "server console should use task name copy");
  assert(htmlResponse.body.includes("员工名称:"), "server console should use employee name copy");
  assert(htmlResponse.body.includes("id=\"trigger-more-options\" class=\"more-options hidden\""), "server console should collapse advanced trigger options by default");
  assert(htmlResponse.body.includes("/api/triggers"), "server console should include trigger APIs");
  assert(htmlResponse.body.includes("data-trigger-edit"), "server console should let trigger names open the edit modal");
  assert(htmlResponse.body.includes("工作日志"), "server console should include work log page");
  assert(htmlResponse.body.includes("暂无日志"), "server console should include empty work log state");
  assert(htmlResponse.body.includes("输入 CSV / JSON / XLSX"), "server console should include XLSX input copy");
  assert(htmlResponse.body.includes("id=\"input-file\""), "server console should include file import control");
  assert(htmlResponse.body.includes("仅运行指定数据"), "server console should include rowIds recovery input");
  assert(htmlResponse.body.includes("预览输入"), "server console should include input preview action");
  assert(htmlResponse.body.includes("预览运行计划"), "server console should include run plan preview action");
  assert(htmlResponse.body.includes("id=\"test-context\""), "server console should bind dry-run context to the verification step");
  assert(htmlResponse.body.includes("id=\"run-test-panel\""), "server console should include an in-step dry-run action");
  assert(htmlResponse.body.includes("运行一次方式"), "server console should expose run-once visibility choices");
  assert(htmlResponse.body.includes("data-run-view-mode=\"visible\" class=\"selected\""), "run-once debug should default to visible mode");
  assert(htmlResponse.body.includes("静默模式"), "server console should support silent run-once mode");
  assert(htmlResponse.body.includes("function currentTrialBrowser()"), "server console should centralize trial browser selection");
  assert(htmlResponse.body.includes("state.mode === 'run_once' ? 'playwright'"), "run-once trials should use the real browser runtime by default");
  assert(!htmlResponse.body.includes("Product Title"), "run results should not use product upload table copy");
  assert(htmlResponse.body.includes("<th>员工</th><th>运行记录</th><th>状态</th>"), "run results should use run-history table copy");
  assert(htmlResponse.body.includes("<th>Step</th><th>Layer</th><th>Type</th><th>Status</th><th>Reason</th>"), "server console should render layered step-level run plan details");
  assert(htmlResponse.body.includes("payload.plan"), "server console should render returned preflight plans when run is blocked");
  assert(htmlResponse.body.includes("loadRuns"), "server console should load run history");
  assert(htmlResponse.body.includes("data-delete-run-id"), "server console should include run deletion action");
  assert(!htmlResponse.body.includes("应用恢复"), "server console should remove unused recovery apply action from run results");
  assert(!htmlResponse.body.includes("恢复 JSON"), "server console should remove unused recovery JSON action from run results");
  assert(!htmlResponse.body.includes("工作流版本与调试工具"), "server console should not render workflow debug tools in the publish stage");
  assert(htmlResponse.body.includes("data-delete-workflow-version-id"), "server console should include workflow version deletion action");
  assert(htmlResponse.body.includes("id=\"load-selected-workflow\""), "server console should keep the workflow version load hook");
  assert(!htmlResponse.body.includes("Default Workflow</h2>"), "server console should not render the default workflow debug panel");
  assert(htmlResponse.body.includes("id=\"validate-workflow\""), "server console should keep the workflow JSON validation hook");
  assert(htmlResponse.body.includes("id=\"save-workflow-version\""), "server console should keep the workflow editor save hook");
  assert(htmlResponse.body.includes("id=\"download-default-workflow\""), "server console should keep the default workflow download hook");
  assert(htmlResponse.body.includes("录制与导入"), "server console should include recorder and import panel");
  assert(htmlResponse.body.includes("id=\"save-employee\""), "server console should include explicit employee save action");
  assert(htmlResponse.body.includes("id=\"publish-employee\""), "server console should include publish action in the employee designer");
  assert(!htmlResponse.body.includes("id=\"employee-publish\""), "server console should not render publish action in the employee list toolbar");
  assert(htmlResponse.body.includes("data-employee-edit"), "server console should let employee names open the editor");
  assert(htmlResponse.body.includes("id=\"trash-rows\""), "server console should include disabled employee trash list");
  assert(htmlResponse.body.includes("id=\"recorder-frame\""), "server console should include recorder browser surface");
  assert(htmlResponse.body.includes("id=\"recorder-events\""), "server console should render recorded action list");
  assert(htmlResponse.body.includes("Local Doctor"), "server console should include local doctor panel");
  assert(htmlResponse.body.includes("/api/doctor"), "server console should load local doctor report");
  assert(htmlResponse.body.includes("Open Login Browser"), "server console should include login browser action");
  assert(htmlResponse.body.includes("查看 Trace"), "server console should include trace viewer action");
  assert(htmlResponse.body.includes("打开选中运行记录的可读 Trace 页面"), "server console should explain readable trace viewer action");
  assert(!htmlResponse.body.includes("应用恢复"), "server console should remove recovery apply action from run results");
  assert(!htmlResponse.body.includes("恢复 JSON"), "server console should remove recovery export action from run results");
  assert(htmlResponse.body.includes("id=\"clear-employee-runs\""), "server console should include employee-scoped run clearing action");
  assert(htmlResponse.body.includes("/api/employees/"), "server console should use employee-scoped run APIs");
  assert(htmlResponse.body.includes("Trace JSON"), "server console should include trace JSON export action");
  assert(htmlResponse.body.includes("打开选中运行记录的原始 Trace JSON 查看页，可返回试跑验证"), "server console should explain trace JSON viewer action");
  assert(htmlResponse.body.includes("'trace-json'"), "trace JSON action should open a returnable JSON viewer page");
  assert(htmlResponse.body.includes("aggregateRunSummaries"), "server console should aggregate run result metrics from all current employee runs");
  assert(htmlResponse.body.includes("选中运行 ID"), "server console should label selected run id separately from aggregate metrics");
  assert(htmlResponse.body.includes("orderedTraceStepIds"), "test flow nodes should fall back to trace step order when ids differ");
  assert(htmlResponse.body.includes("resetValidationStateForWorkflowChange"), "recorder changes should reset stale run status and trace previews");
  assert(htmlResponse.body.includes("renderRunRows"), "run result selection state should rerender independently from run history data");
  assert(htmlResponse.body.includes("finishRecorderSession"), "closing the recorder should finish recording and sync downstream steps");

  const employeesResponse = await invokeHandler(handler, "GET", "/api/employees", "");
  const employeesPayload = JSON.parse(employeesResponse.body);
  assert(employeesResponse.statusCode === 200, "server employee API should list published employees");
  assert(employeesPayload.ok && employeesPayload.value[0].id === "p0001", "employee API should expose p-prefixed employee ids");
  assert(/p\d{4}/.test(employeesPayload.value[0].id), "employee ids should use p plus four digits");
  assert(employeesPayload.value[0].status === "published" && employeesPayload.value[0].version === 1, "employee API should start employees as published v1");
  assert(employeesPayload.value[0].activeVersion === 1, "employee API should expose active published version");

  const createEmployeeResponse = await invokeHandler(handler, "POST", "/api/employees", "");
  const createEmployeePayload = JSON.parse(createEmployeeResponse.body);
  assert(createEmployeeResponse.statusCode === 200, "employee create API should create draft employees");
  assert(createEmployeePayload.value.id === "p0003", "new employee ids should increment using p plus four digits");
  assert(createEmployeePayload.value.status === "draft" && createEmployeePayload.value.version === 1, "new employees should start as draft v1");

  const renameEmployeeResponse = await invokeHandler(
    handler,
    "PATCH",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}`,
    JSON.stringify({ name: "录制专员" })
  );
  const renameEmployeePayload = JSON.parse(renameEmployeeResponse.body);
  assert(renameEmployeeResponse.statusCode === 200, "employee rename API should update employee names");
  assert(renameEmployeePayload.value.name === "录制专员", "employee rename API should persist the new name");

  const deleteCandidateResponse = await invokeHandler(handler, "POST", "/api/employees", "");
  const deleteCandidatePayload = JSON.parse(deleteCandidateResponse.body);
  const deleteEmployeeResponse = await invokeHandler(
    handler,
    "DELETE",
    `/api/employees/${encodeURIComponent(deleteCandidatePayload.value.id)}`,
    ""
  );
  const deleteEmployeePayload = JSON.parse(deleteEmployeeResponse.body);
  assert(deleteEmployeeResponse.statusCode === 200, "employee delete API should disable employees");
  assert(deleteEmployeePayload.ok && deleteEmployeePayload.value.status === "disabled", "employee delete API should return the disabled employee document");
  const deletedEmployeesResponse = await invokeHandler(handler, "GET", "/api/employees", "");
  const deletedEmployeesPayload = JSON.parse(deletedEmployeesResponse.body);
  assert(
    deletedEmployeesPayload.value.some((employee) => employee.id === deleteCandidatePayload.value.id && employee.status === "disabled"),
    "employee delete API should keep disabled employees in SQLite for the trash view"
  );
  const disabledEmployeeTriggerResponse = await invokeHandler(
    handler,
    "POST",
    "/api/triggers",
    JSON.stringify({
      name: "停用员工任务",
      employeeId: deleteCandidatePayload.value.id,
      frequency: "day",
      time: "09:00",
      enabled: true
    })
  );
  assert(disabledEmployeeTriggerResponse.statusCode === 400, "server trigger API should reject disabled employees");

  const saveEmployeeRecordingResponse = await invokeHandler(
    handler,
    "POST",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/recording`,
    JSON.stringify({
      sessionId: "employee-recording-test",
      name: "通用后台录制流程",
      workflowId: "通用后台录制流程",
      actions: [
        { type: "open", intent: "open_target_page", url: "https://example.com/admin" },
        { type: "click", intent: "click_new", target: { role: "button", text: "新建" } },
        { type: "press", intent: "press_enter_name", target: { role: "textbox", label: "任务名称" }, key: "Enter" },
        { type: "input", intent: "input_name", target: { role: "textbox", label: "任务名称" }, value: "每日巡检" }
      ],
      note: "Saved from employee designer recorder"
    })
  );
  const saveEmployeeRecordingPayload = JSON.parse(saveEmployeeRecordingResponse.body);
  assert(saveEmployeeRecordingResponse.statusCode === 200, "employee recording API should save recorder workflow to employee draft");
  assert(saveEmployeeRecordingPayload.ok, "employee recording API should return structured success");
  assert(saveEmployeeRecordingPayload.value.employee.draftScript.workflowVersionId, "employee recording should save workflow version id into draft script");
  assert(saveEmployeeRecordingPayload.value.employee.latestVersionId === saveEmployeeRecordingPayload.value.employee.draftScript.workflowVersionId, "employee recording should point latest_version at the saved workflow version");
  assert(!saveEmployeeRecordingPayload.value.employee.draftScript.workflow, "employee recording should not embed workflow JSON in employee records");
  assert(!saveEmployeeRecordingPayload.value.employee.draftScript.actions, "employee recording should not embed raw recorder actions in employee records");
  const employeeWorkflowResponse = await invokeHandler(
    handler,
    "GET",
    `/api/workflows/${encodeURIComponent(saveEmployeeRecordingPayload.value.employee.draftScript.workflowVersionId)}`,
    ""
  );
  const employeeWorkflowPayload = JSON.parse(employeeWorkflowResponse.body);
  assert(employeeWorkflowResponse.statusCode === 200, "employee recording should save full workflow version document");
  assert(employeeWorkflowPayload.value.workflow.steps.length === 4, "workflow_versions should save generated workflow");
  assert(employeeWorkflowPayload.value.actions.length === 4, "workflow_versions should preserve raw recorded actions");
  assert(employeeWorkflowPayload.value.employeeId === createEmployeePayload.value.id, "workflow version document should preserve employee id");
  assert(employeeWorkflowPayload.value.summary.employeeId === createEmployeePayload.value.id, "workflow version summary should expose employee id");
  const employeeWorkflowListResponse = await invokeHandler(handler, "GET", `/api/workflows?employeeId=${encodeURIComponent(createEmployeePayload.value.id)}`, "");
  const employeeWorkflowListPayload = JSON.parse(employeeWorkflowListResponse.body);
  assert(
    employeeWorkflowListPayload.value.length === 1 && employeeWorkflowListPayload.value[0].versionId === saveEmployeeRecordingPayload.value.versionId,
    "workflow version API should filter versions by employee_id"
  );
  const workflowDb = new DatabaseSync(".tmp/test-digital-employee.sqlite");
  try {
    const workflowColumns = workflowDb.prepare("PRAGMA table_info(workflow_versions)").all();
    assert(workflowColumns.some((column) => column.name === "employee_id"), "workflow_versions table should store employee_id");
    const workflowRow = workflowDb.prepare("SELECT employee_id FROM workflow_versions WHERE id = ?").get(saveEmployeeRecordingPayload.value.versionId);
    assert(workflowRow?.employee_id === createEmployeePayload.value.id, "workflow_versions.employee_id should match the recorded employee");
  } finally {
    workflowDb.close();
  }

  const otherEmployee = employeesPayload.value.find((employee) => employee.id !== createEmployeePayload.value.id);
  const otherEmployeeRunResponse = await invokeHandler(
    handler,
    "POST",
    `/api/employees/${encodeURIComponent(otherEmployee.id)}/run`,
    JSON.stringify({ mode: "run_once", browser: "fake", approvals: [] })
  );
  const otherEmployeeRunPayload = JSON.parse(otherEmployeeRunResponse.body);
  assert(otherEmployeeRunResponse.statusCode === 200, "published employee run API should run without explicit approvals");
  assert(otherEmployeeRunPayload.value.run.summary.employeeId === otherEmployee.id, "published employee run should be tagged with its employee id");
  assert(otherEmployeeRunPayload.value.run.summary.status === "completed", "non-dry employee run should not pause for approval by default");
  assert(otherEmployeeRunPayload.value.run.summary.approvalCount === 0, "non-dry employee run should not produce approval count by default");

  const employeeTrialResponse = await invokeHandler(
    handler,
    "POST",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/trial`,
    JSON.stringify({ mode: "dry_run", browser: "fake" })
  );
  const employeeTrialPayload = JSON.parse(employeeTrialResponse.body);
  assert(employeeTrialResponse.statusCode === 200, "employee trial API should run a draft employee workflow");
  assert(employeeTrialPayload.value.summary.employeeId === createEmployeePayload.value.id, "employee trial runs should be tagged with the current employee id");
  assert(employeeTrialPayload.value.summary.runId.startsWith(`${createEmployeePayload.value.id}-`), "employee trial run id should use employee id as prefix");
  const employeeRunOnceTrialResponse = await invokeHandler(
    handler,
    "POST",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/trial`,
    JSON.stringify({ mode: "run_once", browser: "fake" })
  );
  const employeeRunOnceTrialPayload = JSON.parse(employeeRunOnceTrialResponse.body);
  assert(employeeRunOnceTrialResponse.statusCode === 200, "employee trial API should support real run-once mode");
  assert(employeeRunOnceTrialPayload.value.summary.mode === "run_once", "run-once trial should preserve selected mode");
  assert(employeeRunOnceTrialPayload.value.summary.status === "completed", "run-once trial should execute the recorded workflow");
  const runOnceStepIds = employeeRunOnceTrialPayload.value.rows[0].timeline.map((event) => event.stepId).filter(Boolean);
  assert(runOnceStepIds.includes("open_target_page"), "run-once trial trace should include the recorded open step");
  assert(runOnceStepIds.includes("click_new"), "run-once trial trace should include the recorded click step");
  assert(runOnceStepIds.includes("input_name"), "run-once trial trace should include the recorded input step");
  assert(
    runOnceStepIds.indexOf("input_name") < runOnceStepIds.indexOf("press_enter_name"),
    "run-once trial should normalize trailing Enter so input executes before press"
  );
  const employeeRunsResponse = await invokeHandler(handler, "GET", `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/runs`, "");
  const employeeRunsPayload = JSON.parse(employeeRunsResponse.body);
  assert(employeeRunsPayload.ok && employeeRunsPayload.value.length === 2, "employee run API should list all current employee runs");
  assert(employeeRunsPayload.value.some((run) => run.runId === employeeTrialPayload.value.summary.runId), "employee run API should include dry-run trial");
  assert(employeeRunsPayload.value.some((run) => run.runId === employeeRunOnceTrialPayload.value.summary.runId), "employee run API should include run-once trial");
  const employeeTraceExportResponse = await invokeHandler(
    handler,
    "GET",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/runs/${encodeURIComponent(employeeTrialPayload.value.summary.runId)}/trace.json`,
    ""
  );
  const employeeTraceExportPayload = JSON.parse(employeeTraceExportResponse.body);
  assert(employeeTraceExportResponse.statusCode === 200, "employee scoped API should export current employee trace JSON");
  assert(employeeTraceExportPayload.summary.employeeId === createEmployeePayload.value.id, "employee scoped trace JSON should belong to current employee");
  assert(employeeTraceExportPayload.summary.workflowId === saveEmployeeRecordingPayload.value.workflow.workflowId, "employee scoped trace JSON should use the recorded employee workflow");
  assert(!employeeTraceExportPayload.summary.workflowId.includes("baiying"), "employee scoped trace JSON should not fall back to the legacy Baiying workflow");
  const employeeTraceJsonViewerResponse = await invokeHandler(
    handler,
    "GET",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/runs/${encodeURIComponent(employeeTrialPayload.value.summary.runId)}/trace-json`,
    ""
  );
  assert(employeeTraceJsonViewerResponse.statusCode === 200, "employee scoped API should render trace JSON viewer");
  assert(employeeTraceJsonViewerResponse.body.includes("返回试跑验证"), "trace JSON viewer should provide a return action");
  assert(employeeTraceJsonViewerResponse.body.includes("下载原始 JSON"), "trace JSON viewer should keep raw JSON download access");
  const employeeCsvExportResponse = await invokeHandler(
    handler,
    "GET",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/runs/${encodeURIComponent(employeeTrialPayload.value.summary.runId)}/export.csv`,
    ""
  );
  assert(employeeCsvExportResponse.statusCode === 200, "employee scoped API should export current employee CSV");
  assert(employeeCsvExportResponse.body.includes("employeeId,employeeName,runObjectId"), "employee scoped CSV should use employee run copy");
  const otherEmployeeRunsResponse = await invokeHandler(handler, "GET", `/api/employees/${encodeURIComponent(otherEmployee.id)}/runs`, "");
  const otherEmployeeRunsPayload = JSON.parse(otherEmployeeRunsResponse.body);
  assert(otherEmployeeRunsPayload.ok && otherEmployeeRunsPayload.value.every((run) => run.employeeId === otherEmployee.id), "employee run API should not leak runs from other employees");
  assert(!otherEmployeeRunsPayload.value.some((run) => run.runId === employeeTrialPayload.value.summary.runId), "other employee run API should not include current employee trial run");
  const wrongEmployeeRunViewResponse = await invokeHandler(
    handler,
    "GET",
    `/api/employees/${encodeURIComponent(otherEmployee.id)}/runs/${encodeURIComponent(employeeTrialPayload.value.summary.runId)}`,
    ""
  );
  assert(wrongEmployeeRunViewResponse.statusCode === 404, "employee run API should reject viewing another employee run");
  const currentEmployeeWrongRunViewResponse = await invokeHandler(
    handler,
    "GET",
    `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/runs/${encodeURIComponent(otherEmployeeRunPayload.value.run.summary.runId)}`,
    ""
  );
  assert(currentEmployeeWrongRunViewResponse.statusCode === 404, "current employee detail API should reject viewing another employee's run");
  const wrongEmployeeTraceExportResponse = await invokeHandler(
    handler,
    "GET",
    `/api/employees/${encodeURIComponent(otherEmployee.id)}/runs/${encodeURIComponent(employeeTrialPayload.value.summary.runId)}/trace.json`,
    ""
  );
  assert(wrongEmployeeTraceExportResponse.statusCode === 404, "employee scoped trace export should reject another employee run");
  const wrongEmployeeRunDeleteResponse = await invokeHandler(
    handler,
    "DELETE",
    `/api/employees/${encodeURIComponent(otherEmployee.id)}/runs/${encodeURIComponent(employeeTrialPayload.value.summary.runId)}`,
    ""
  );
  assert(wrongEmployeeRunDeleteResponse.statusCode === 404, "employee run API should reject deleting another employee run");
  const clearEmployeeRunsResponse = await invokeHandler(handler, "DELETE", `/api/employees/${encodeURIComponent(createEmployeePayload.value.id)}/runs`, "");
  const clearEmployeeRunsPayload = JSON.parse(clearEmployeeRunsResponse.body);
  assert(clearEmployeeRunsResponse.statusCode === 200 && clearEmployeeRunsPayload.value.deleted === 2, "employee run API should clear only current employee runs");

  const editEmployeeResponse = await invokeHandler(handler, "POST", `/api/employees/${encodeURIComponent(employeesPayload.value[0].id)}/edit`, "");
  const editEmployeePayload = JSON.parse(editEmployeeResponse.body);
  assert(editEmployeeResponse.statusCode === 200, "employee edit API should create a draft version");
  assert(editEmployeePayload.value.status === "draft" && editEmployeePayload.value.version === 2, "editing a published employee should create draft v2");
  assert(editEmployeePayload.value.activeVersion === 1, "editing a published employee should keep current published version active");

  const publishEmployeeResponse = await invokeHandler(handler, "POST", `/api/employees/${encodeURIComponent(employeesPayload.value[0].id)}/publish`, "");
  const publishEmployeePayload = JSON.parse(publishEmployeeResponse.body);
  assert(publishEmployeeResponse.statusCode === 200, "employee publish API should publish draft versions");
  assert(publishEmployeePayload.value.status === "published" && publishEmployeePayload.value.version === 2, "publishing draft should keep v2 and mark published");

  const emptyTriggersResponse = await invokeHandler(handler, "GET", "/api/triggers", "");
  const emptyTriggersPayload = JSON.parse(emptyTriggersResponse.body);
  assert(emptyTriggersResponse.statusCode === 200, "server trigger API should list scheduled triggers");
  assert(emptyTriggersPayload.ok && emptyTriggersPayload.value.length === 0, "server trigger API should start empty");

  const invalidEmployeeTriggerResponse = await invokeHandler(
    handler,
    "POST",
    "/api/triggers",
    JSON.stringify({
      name: "错误员工任务",
      employeeId: "p9999",
      frequency: "day",
      time: "09:00",
      enabled: true
    })
  );
  assert(invalidEmployeeTriggerResponse.statusCode === 400, "server trigger API should reject employees outside the active employee list");

  const createDraftEmployeeTriggerResponse = await invokeHandler(
    handler,
    "POST",
    "/api/triggers",
    JSON.stringify({
      name: "草稿员工定时任务",
      employeeId: createEmployeePayload.value.id,
      frequency: "day",
      time: "09:30",
      enabled: true
    })
  );
  const createDraftEmployeeTriggerPayload = JSON.parse(createDraftEmployeeTriggerResponse.body);
  assert(createDraftEmployeeTriggerResponse.statusCode === 200, "server trigger API should allow active draft employees to be selected");
  assert(createDraftEmployeeTriggerPayload.value.employee.id === createEmployeePayload.value.id, "draft employee trigger should bind the selected employee id");
  const draftEmployeeTriggersResponse = await invokeHandler(handler, "GET", `/api/triggers?employeeId=${encodeURIComponent(createEmployeePayload.value.id)}`, "");
  const draftEmployeeTriggersPayload = JSON.parse(draftEmployeeTriggersResponse.body);
  assert(
    draftEmployeeTriggersPayload.value.some((trigger) => trigger.id === createDraftEmployeeTriggerPayload.value.id),
    "trigger API should list triggers for active draft employees"
  );
  const deleteDraftEmployeeTriggerResponse = await invokeHandler(
    handler,
    "DELETE",
    `/api/triggers/${encodeURIComponent(createDraftEmployeeTriggerPayload.value.id)}`,
    ""
  );
  assert(deleteDraftEmployeeTriggerResponse.statusCode === 200, "server trigger API should delete the draft employee trigger test record");

  const createTriggerResponse = await invokeHandler(
    handler,
    "POST",
    "/api/triggers",
    JSON.stringify({
      name: "定时上新品",
      employeeId: employeesPayload.value[0].id,
      frequency: "day",
      time: "09:00",
      enabled: true,
      timeoutMinutes: 0
    })
  );
  const createTriggerPayload = JSON.parse(createTriggerResponse.body);
  assert(createTriggerResponse.statusCode === 200, "server trigger API should create scheduled trigger");
  assert(createTriggerPayload.ok, "server trigger create API should return structured success");
  assert(createTriggerPayload.value.name === "定时上新品", "created trigger should preserve name");
  assert(createTriggerPayload.value.employee.id === employeesPayload.value[0].id, "created trigger should bind a published employee id");
  assert(createTriggerPayload.value.employee.name === employeesPayload.value[0].name, "created trigger should derive employee name from employee API");
  assert(createTriggerPayload.value.employee.script.workflowId, "created trigger should preserve the bound employee script");
  assert(createTriggerPayload.value.conditionText.includes("每天的 09 时 00 分执行"), "created trigger should include schedule condition text");
  assert(createTriggerPayload.value.nextRuns.length === 5, "created trigger should include upcoming run plan");
  const persistedTriggersResponse = await invokeHandler(handler, "GET", "/api/triggers", "");
  const persistedTriggersPayload = JSON.parse(persistedTriggersResponse.body);
  assert(persistedTriggersPayload.value.some((trigger) => trigger.name === "定时上新品"), "created trigger should persist to SQLite");
  const employeeTriggersResponse = await invokeHandler(handler, "GET", `/api/triggers?employeeId=${encodeURIComponent(employeesPayload.value[0].id)}`, "");
  const employeeTriggersPayload = JSON.parse(employeeTriggersResponse.body);
  assert(
    employeeTriggersPayload.value.length === 1 && employeeTriggersPayload.value[0].id === createTriggerPayload.value.id,
    "trigger API should filter scheduled triggers by employee_id"
  );
  const triggerDb = new DatabaseSync(".tmp/test-digital-employee.sqlite");
  try {
    const triggerColumns = triggerDb.prepare("PRAGMA table_info(scheduled_triggers)").all();
    assert(triggerColumns.some((column) => column.name === "employee_id"), "scheduled_triggers table should store employee_id");
    const triggerRow = triggerDb.prepare("SELECT employee_id FROM scheduled_triggers WHERE id = ?").get(createTriggerPayload.value.id);
    assert(triggerRow?.employee_id === employeesPayload.value[0].id, "scheduled_triggers.employee_id should match the bound employee");
  } finally {
    triggerDb.close();
  }
  const triggerId = createTriggerPayload.value.id;

  const updateTriggerResponse = await invokeHandler(
    handler,
    "PUT",
    `/api/triggers/${encodeURIComponent(triggerId)}`,
    JSON.stringify({
      name: "定时上新品-编辑",
      employeeId: employeesPayload.value[0].id,
      frequency: "day",
      time: "10:30",
      enabled: true,
      timeoutMinutes: 3
    })
  );
  const updateTriggerPayload = JSON.parse(updateTriggerResponse.body);
  assert(updateTriggerResponse.statusCode === 200, "server trigger API should update scheduled trigger");
  assert(updateTriggerPayload.value.id === triggerId, "trigger update should keep trigger id");
  assert(updateTriggerPayload.value.name === "定时上新品-编辑", "trigger update should save edited name");
  assert(updateTriggerPayload.value.schedule.time === "10:30", "trigger update should save edited time");
  assert(updateTriggerPayload.value.conditionText.includes("每天的 10 时 30 分执行"), "updated trigger should refresh condition text");

  const disableTriggerResponse = await invokeHandler(
    handler,
    "PATCH",
    `/api/triggers/${encodeURIComponent(triggerId)}/enabled`,
    JSON.stringify({ enabled: false })
  );
  const disableTriggerPayload = JSON.parse(disableTriggerResponse.body);
  assert(disableTriggerResponse.statusCode === 200, "server trigger API should toggle scheduled trigger");
  assert(disableTriggerPayload.value.schedule.enabled === false, "trigger toggle should update enabled state");

  const runTriggerResponse = await invokeHandler(handler, "POST", `/api/triggers/${encodeURIComponent(triggerId)}/run`, "");
  const runTriggerPayload = JSON.parse(runTriggerResponse.body);
  assert(runTriggerResponse.statusCode === 200, "server trigger API should record manual runs");
  assert(runTriggerPayload.value.params.trigger.id === triggerId, "trigger run log should include trigger params");
  assert(runTriggerPayload.value.result.ok === false, "disabled trigger run should record skipped result");

  const triggerLogsResponse = await invokeHandler(handler, "GET", "/api/work-logs", "");
  const triggerLogsPayload = JSON.parse(triggerLogsResponse.body);
  assert(triggerLogsPayload.ok && triggerLogsPayload.value.length >= 1, "server trigger API should list run logs");
  assert(triggerLogsPayload.value.some((log) => log.triggerName === "定时上新品-编辑"), "trigger run should persist work logs to SQLite");

  const profileResponse = await invokeHandler(handler, "GET", "/api/browser/profile", "");
  const profilePayload = JSON.parse(profileResponse.body);
  assert(profileResponse.statusCode === 200, "server API should return browser profile status");
  assert(profilePayload.ok, "server profile API should return structured status");
  assert(profilePayload.value.userDataDir === "browser-profiles/test", "server profile API should use configured userDataDir");

  const doctorResponse = await invokeHandler(handler, "GET", "/api/doctor", "");
  const doctorPayload = JSON.parse(doctorResponse.body);
  assert(doctorResponse.statusCode === 200, "server API should return local doctor report");
  assert(doctorPayload.ok, "server doctor API should return structured success");
  assert(doctorPayload.value.checks.some((check) => check.name === "workflow"), "server doctor API should include workflow check");
  assert(doctorPayload.value.checks.some((check) => check.name === "electron_package"), "server doctor API should include Electron package check");
  assert(doctorPayload.value.checks.some((check) => check.name === "playwright_package"), "server doctor API should include Playwright package check");
  assert(doctorPayload.value.checks.some((check) => check.name === "browser_executable"), "server doctor API should include executable path check");

  const loginResponse = await invokeHandler(handler, "POST", "/api/browser/login", "");
  const loginPayload = JSON.parse(loginResponse.body);
  assert(loginResponse.statusCode === 200, "server API should open login browser");
  assert(loginPayload.ok, "server login API should return structured result");
  assert(loginPayload.value.userDataDir === "browser-profiles/test", "server login API should use configured profile");
  assert(loginExecutablePath?.includes("Google Chrome"), "server login API should pass executablePath to opener");

  const defaultWorkflowResponse = await invokeHandler(handler, "GET", "/api/workflow/default", "");
  const defaultWorkflowPayload = JSON.parse(defaultWorkflowResponse.body);
  assert(defaultWorkflowResponse.statusCode === 200, "server API should return default workflow");
  assert(defaultWorkflowPayload.ok, "default workflow API should return structured payload");
  assert(defaultWorkflowPayload.value.workflowId === "douyin-baiying-add-product-to-window", "default workflow API should return Baiying workflow");

  const defaultWorkflowJsonResponse = await invokeHandler(handler, "GET", "/api/workflow/default.json", "");
  const defaultWorkflowJson = JSON.parse(defaultWorkflowJsonResponse.body);
  assert(defaultWorkflowJsonResponse.statusCode === 200, "server API should export default workflow JSON");
  assert(defaultWorkflowJson.workflowId === "douyin-baiying-add-product-to-window", "default workflow JSON should contain workflow id");

  const editedWorkflow = {
    ...defaultWorkflowJson,
    workflowId: "edited-baiying-flow",
    name: "Edited Baiying Flow"
  };
  const validateWorkflowResponse = await invokeHandler(
    handler,
    "POST",
    "/api/workflow/validate",
    JSON.stringify({
      workflow: editedWorkflow
    })
  );
  const validateWorkflowPayload = JSON.parse(validateWorkflowResponse.body);
  assert(validateWorkflowResponse.statusCode === 200, "server API should validate workflow JSON without saving");
  assert(validateWorkflowPayload.ok, "workflow validation should return structured success");
  assert(validateWorkflowPayload.value.workflowId === "edited-baiying-flow", "workflow validation should return workflow id");
  assert(validateWorkflowPayload.value.stepCount === editedWorkflow.steps.length, "workflow validation should return step count");

  const saveWorkflowResponse = await invokeHandler(
    handler,
    "POST",
    "/api/workflow/version",
    JSON.stringify({
      workflow: editedWorkflow,
      note: "saved from test"
    })
  );
  const saveWorkflowPayload = JSON.parse(saveWorkflowResponse.body);
  assert(saveWorkflowResponse.statusCode === 200, "server API should save a valid workflow JSON version");
  assert(saveWorkflowPayload.ok, "workflow JSON save should return structured success");
  assert(saveWorkflowPayload.value.workflow.workflowId === "edited-baiying-flow", "saved workflow should preserve edited id");
  assert(saveWorkflowPayload.value.versionId.includes("edited-baiying-flow"), "workflow JSON save should return the saved version id");

  const invalidWorkflowResponse = await invokeHandler(
    handler,
    "POST",
    "/api/workflow/version",
    JSON.stringify({
      workflow: {
        schemaVersion: 1,
        workflowId: "invalid",
        name: "Invalid"
      }
    })
  );
  assert(invalidWorkflowResponse.statusCode === 400, "server API should reject invalid workflow JSON");

  const invalidValidateResponse = await invokeHandler(
    handler,
    "POST",
    "/api/workflow/validate",
    JSON.stringify({
      workflow: {
        schemaVersion: 1,
        workflowId: "invalid",
        name: "Invalid"
      }
    })
  );
  const invalidValidatePayload = JSON.parse(invalidValidateResponse.body);
  assert(invalidValidateResponse.statusCode === 400, "server API should reject invalid workflow JSON during validation");
  assert(!invalidValidatePayload.ok, "invalid workflow validation should return structured errors");
  assert(invalidValidatePayload.errors.some((error) => error.includes("steps")), "invalid workflow validation should include schema errors");

  const inputPreviewResponse = await invokeHandler(
    handler,
    "POST",
    "/api/input/preview",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
      inputFormat: "auto"
    })
  );
  const inputPreviewPayload = JSON.parse(inputPreviewResponse.body);
  assert(inputPreviewResponse.statusCode === 200, "server API should preview CSV product input");
  assert(inputPreviewPayload.ok, "input preview should return structured success");
  assert(inputPreviewPayload.value.totalItems === 2, "input preview should return total item count");
  assert(inputPreviewPayload.value.rows[0].title === "商品A", "input preview should include sample rows");

  const xlsxPreviewResponse = await invokeHandler(
    handler,
    "POST",
    "/api/input/preview",
    JSON.stringify({
      inputBytes: Array.from(new Uint8Array(createXlsxWorkbook([
        ["rowId", "productUrl", "title", "groupName", "remark"],
        ["row-xlsx", "https://example.com/xlsx", "商品XLSX", "默认分组", "xlsx sample"]
      ]))),
      inputFormat: "xlsx"
    })
  );
  const xlsxPreviewPayload = JSON.parse(xlsxPreviewResponse.body);
  assert(xlsxPreviewResponse.statusCode === 200, "server API should preview XLSX product input");
  assert(xlsxPreviewPayload.value.totalItems === 1, "XLSX preview should return total item count");
  assert(xlsxPreviewPayload.value.rows[0].rowId === "row-xlsx", "XLSX preview should include sample rows");

  const invalidInputPreviewResponse = await invokeHandler(
    handler,
    "POST",
    "/api/input/preview",
    JSON.stringify({
      csv: "rowId,title\nrow-missing,缺少商品",
      inputFormat: "csv"
    })
  );
  const invalidInputPreviewPayload = JSON.parse(invalidInputPreviewResponse.body);
  assert(invalidInputPreviewResponse.statusCode === 400, "server API should reject invalid product input preview");
  assert(!invalidInputPreviewPayload.ok, "invalid input preview should return structured errors");

  const dryRunPlanResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run/plan",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "dry_run",
      approvals: []
    })
  );
  const dryRunPlanPayload = JSON.parse(dryRunPlanResponse.body);
  assert(dryRunPlanResponse.statusCode === 200, "server API should preview dry_run plans");
  assert(dryRunPlanPayload.ok, "dry_run plan should return structured success");
  assert(dryRunPlanPayload.value.canRun, "dry_run plan should be runnable without approvals");
  assert(dryRunPlanPayload.value.warnings.some((warning) => warning.includes("dry_run")), "dry_run plan should explain skipped submit behavior");
  assert(dryRunPlanPayload.value.steps.some((step) => step.stepId === "confirm_add" && step.status === "skipped"), "dry_run plan should expose skipped submit step");

  const batchPlanResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run/plan",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
      mode: "batch",
      approvals: []
    })
  );
  const batchPlanPayload = JSON.parse(batchPlanResponse.body);
  assert(batchPlanResponse.statusCode === 200, "server API should preview batch plans");
  assert(!batchPlanPayload.value.canRun, "batch plan should not be runnable without approvals");
  assert(batchPlanPayload.value.missingApprovals.includes("batch"), "batch plan should require batch approval");
  assert(batchPlanPayload.value.missingApprovals.includes("final_submit"), "batch plan should require final_submit approval");
  assert(batchPlanPayload.value.steps.some((step) => step.stepId === "confirm_add" && step.status === "requires_approval"), "batch plan should expose approval step");

  const blockedRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "batch",
      browser: "fake",
      approvals: []
    })
  );
  const blockedRunPayload = JSON.parse(blockedRunResponse.body);
  assert(blockedRunResponse.statusCode === 409, "server API should block runs that fail preflight plan checks");
  assert(!blockedRunPayload.ok, "blocked preflight run should return structured failure");
  assert(blockedRunPayload.plan.missingApprovals.includes("batch"), "blocked preflight run should include plan details");

  const approvedBatchPlanResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run/plan",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
      mode: "batch",
      approvals: ["batch", "final_submit"]
    })
  );
  const approvedBatchPlanPayload = JSON.parse(approvedBatchPlanResponse.body);
  assert(approvedBatchPlanPayload.value.canRun, "approved batch plan should be runnable");
  assert(approvedBatchPlanPayload.value.totalItems === 2, "approved batch plan should report parsed item count");

  const rowFilteredPlanResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run/plan",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
      mode: "batch",
      approvals: ["batch", "final_submit"],
      rowIds: ["row-2"]
    })
  );
  const rowFilteredPlanPayload = JSON.parse(rowFilteredPlanResponse.body);
  assert(rowFilteredPlanPayload.value.totalItems === 1, "server run plan should apply rowIds filter");

  const runResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
        csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
        mode: "dry_run",
        browser: "fake",
        approvals: []
      })
  );
  const payload = JSON.parse(runResponse.body);
  assert(runResponse.statusCode === 200, "server API should return 200");
  assert(payload.ok, "server API should run fake-browser workflow");
  assert(payload.value.summary.totalItems === 1, "server API should return console view");
  assert(payload.value.rows[0].timeline.length > 0, "server API should return trace timeline");

  const rowFilteredRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
      mode: "batch",
      browser: "fake",
      approvals: ["batch", "final_submit"],
      rowIds: ["row-2"]
    })
  );
  const rowFilteredRunPayload = JSON.parse(rowFilteredRunResponse.body);
  assert(rowFilteredRunPayload.ok, "server API should run rowIds-filtered batches");
  assert(rowFilteredRunPayload.value.summary.totalItems === 1, "server rowIds run should execute one item");
  assert(rowFilteredRunPayload.value.rows[0].rowId === "row-2", "server rowIds run should preserve requested row");

  const missingRowRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "dry_run",
      browser: "fake",
      rowIds: ["missing-row"]
    })
  );
  assert(missingRowRunResponse.statusCode === 400, "server API should reject missing rowIds");

  const resumeResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "dry_run",
      browser: "fake",
      startStepId: "click_add_product",
      approvals: []
    })
  );
  const resumePayload = JSON.parse(resumeResponse.body);
  assert(resumeResponse.statusCode === 200, "server API should accept startStepId resume runs");
  assert(resumePayload.ok, "server resume run should succeed");
  assert(resumePayload.value.rows[0].timeline.some((entry) => entry.type === "item.resumed"), "server resume run should emit item.resumed");

  const jsonRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: '[{"rowId":"row-json","productUrl":"https://example.com/json","title":"商品JSON"}]',
      inputFormat: "json",
      mode: "dry_run",
      browser: "fake",
      approvals: []
    })
  );
  const jsonRunPayload = JSON.parse(jsonRunResponse.body);
  assert(jsonRunResponse.statusCode === 200, "server API should accept JSON product input");
  assert(jsonRunPayload.ok, "server JSON input run should succeed");
  assert(jsonRunPayload.value.rows[0].rowId === "row-json", "server JSON input run should preserve rowId");

  const xlsxRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      inputBytes: Array.from(new Uint8Array(createXlsxWorkbook([
        ["rowId", "productUrl", "title", "groupName", "remark"],
        ["row-xlsx", "https://example.com/xlsx", "商品XLSX", "默认分组", "xlsx sample"]
      ]))),
      inputFormat: "xlsx",
      mode: "dry_run",
      browser: "fake",
      approvals: []
    })
  );
  const xlsxRunPayload = JSON.parse(xlsxRunResponse.body);
  assert(xlsxRunResponse.statusCode === 200, "server API should accept XLSX product input bytes");
  assert(xlsxRunPayload.ok, "server XLSX input run should succeed");
  assert(xlsxRunPayload.value.rows[0].rowId === "row-xlsx", "server XLSX input run should preserve rowId");
  assert(xlsxRunPayload.value.rows[0].title === "商品XLSX", "server XLSX input run should preserve title");

  const runsResponse = await invokeHandler(handler, "GET", "/api/runs", "");
  const runsPayload = JSON.parse(runsResponse.body);
  assert(runsPayload.ok, "server API should list run history");
  assert(runsPayload.value.length >= 1, "server API should include at least one run summary");

  const runId = payload.value.summary.runId;
  const runViewResponse = await invokeHandler(handler, "GET", `/api/runs/${encodeURIComponent(runId)}`, "");
  const runViewPayload = JSON.parse(runViewResponse.body);
  assert(runViewPayload.ok, "server API should retrieve a saved run");
  assert(runViewPayload.value.summary.runId === runId, "retrieved run should match requested runId");

  const exportResponse = await invokeHandler(handler, "GET", `/api/runs/${encodeURIComponent(runId)}/export.csv`, "");
  assert(exportResponse.statusCode === 200, "server API should export a saved run as CSV");
  assert(exportResponse.headers["content-type"].includes("text/csv"), "server CSV export should use text/csv");
  assert(exportResponse.body.includes("row-1"), "server CSV export should include result row");

  const traceExportResponse = await invokeHandler(handler, "GET", `/api/runs/${encodeURIComponent(runId)}/trace.json`, "");
  const traceExportPayload = JSON.parse(traceExportResponse.body);
  assert(traceExportResponse.statusCode === 200, "server API should export a saved run trace as JSON");
  assert(traceExportPayload.summary.runId === runId, "server trace JSON should include run summary");
  assert(traceExportPayload.traces.length > 0, "server trace JSON should include trace entries");

  const recoveryResponse = await invokeHandler(handler, "GET", `/api/runs/${encodeURIComponent(runId)}/recovery.json`, "");
  const recoveryPayload = JSON.parse(recoveryResponse.body);
  assert(recoveryResponse.statusCode === 200, "server API should export a saved run recovery plan");
  assert(recoveryPayload.runId === runId, "server recovery plan should include run id");
  assert(Array.isArray(recoveryPayload.rows), "server recovery plan should include rows array");

  const traceViewerResponse = await invokeHandler(handler, "GET", `/api/runs/${encodeURIComponent(runId)}/trace`, "");
  assert(traceViewerResponse.statusCode === 200, "server API should render trace viewer");
  assert(traceViewerResponse.headers["content-type"].includes("text/html"), "trace viewer should use text/html");
  assert(traceViewerResponse.body.includes("Trace Viewer"), "trace viewer response should include title");
  assert(traceViewerResponse.body.includes(runId), "trace viewer response should include run id");

  const deleteRunResponse = await invokeHandler(handler, "DELETE", `/api/runs/${encodeURIComponent(runId)}`, "");
  const deleteRunPayload = JSON.parse(deleteRunResponse.body);
  assert(deleteRunResponse.statusCode === 200, "server API should delete a saved run");
  assert(deleteRunPayload.ok, "server delete run should return structured success");
  const deletedRunViewResponse = await invokeHandler(handler, "GET", `/api/runs/${encodeURIComponent(runId)}`, "");
  assert(deletedRunViewResponse.statusCode === 404, "server API should not return deleted runs");

  const approvedBatchResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A\nrow-2,https://example.com/b,商品B",
      mode: "batch",
      browser: "fake",
      approvals: ["batch", "final_submit"]
    })
  );
  const approvedBatch = JSON.parse(approvedBatchResponse.body);
  assert(approvedBatch.ok, "server API should accept approval grants");
  assert(approvedBatch.value.summary.successCount === 2, "approved server batch should run all rows");

  const blockedPlaywrightResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "batch",
      browser: "playwright",
      approvals: ["batch", "final_submit"]
    })
  );
  const blockedPlaywright = JSON.parse(blockedPlaywrightResponse.body);
  assert(blockedPlaywrightResponse.statusCode === 409, "server API should block approved Playwright runs without login profile");
  assert(!blockedPlaywright.ok, "blocked Playwright run should return structured errors");
  assert(blockedPlaywright.errors.join("\n").includes("prepared Douyin Baiying browser profile"), "blocked Playwright run should explain profile requirement");

  const patchResponse = await invokeHandler(
    handler,
    "POST",
    "/api/workflow/patch",
    JSON.stringify({
      stepId: "click_add_product",
      target: {
        role: "button",
        text: "添加到橱窗"
      }
    })
  );
  const patchPayload = JSON.parse(patchResponse.body);
  assert(patchResponse.statusCode === 200, "server API should validate workflow patch");
  assert(patchPayload.value.changedStepId === "click_add_product", "server patch API should return changed step id");
  assert(patchPayload.value.versionId.includes("douyin-baiying-add-product-to-window"), "server patch API should return the saved version id");

  const workflowListResponse = await invokeHandler(handler, "GET", "/api/workflows", "");
  const workflowListPayload = JSON.parse(workflowListResponse.body);
  assert(workflowListPayload.ok, "server API should list workflow versions");
  assert(workflowListPayload.value.some((version) => version.versionId === saveWorkflowPayload.value.versionId), "server API should persist workflow editor versions");
  assert(workflowListPayload.value.some((version) => version.versionId === patchPayload.value.versionId), "server API should persist workflow patch versions");
  assert(workflowListPayload.value.some((version) => version.versionId === saveEmployeeRecordingPayload.value.versionId), "server API should persist employee recorder workflow versions");

  const workflowVersionId = patchPayload.value.versionId;
  const workflowReadResponse = await invokeHandler(handler, "GET", `/api/workflows/${encodeURIComponent(workflowVersionId)}`, "");
  const workflowReadPayload = JSON.parse(workflowReadResponse.body);
  assert(workflowReadPayload.ok, "server API should read workflow version");
  assert(workflowReadPayload.value.workflow.steps.some((step) => step.target?.text === "添加到橱窗"), "saved workflow version should include patched target");

  const versionedRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "dry_run",
      browser: "fake",
      workflowVersionId
    })
  );
  const versionedRunPayload = JSON.parse(versionedRunResponse.body);
  assert(versionedRunResponse.statusCode === 200, "server API should run a selected workflow version");
  assert(versionedRunPayload.ok, "selected workflow version run should succeed");
  assert(versionedRunPayload.value.summary.workflowVersionId === workflowVersionId, "selected workflow version run should persist version provenance");
  assert(
    versionedRunPayload.value.rows[0].timeline.some((entry) => entry.data?.locator?.selected?.value === "button:添加到橱窗"),
    "selected workflow version run should use the patched locator target"
  );

  const restartedHandler = createConsoleHandler({
    storePath: ".tmp/restarted-server-runs.json",
    workflowStorePath: ".tmp/restarted-workflow-versions.json",
    databasePath: ".tmp/test-digital-employee.sqlite",
    userDataDir: "browser-profiles/test",
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  });
  const restartedEmployeesResponse = await invokeHandler(restartedHandler, "GET", "/api/employees", "");
  const restartedEmployeesPayload = JSON.parse(restartedEmployeesResponse.body);
  assert(
    restartedEmployeesPayload.value.some((employee) => employee.id === createEmployeePayload.value.id && employee.draftScript?.source === "recorder"),
    "server should read employee scripts from SQLite after restart"
  );
  const restartedWorkflowsResponse = await invokeHandler(restartedHandler, "GET", "/api/workflows", "");
  const restartedWorkflowsPayload = JSON.parse(restartedWorkflowsResponse.body);
  assert(
    restartedWorkflowsPayload.value.some((version) => version.versionId === workflowVersionId),
    "server should read workflow versions from SQLite after restart"
  );
  const restartedRunsResponse = await invokeHandler(restartedHandler, "GET", "/api/runs", "");
  const restartedRunsPayload = JSON.parse(restartedRunsResponse.body);
  assert(
    restartedRunsPayload.value.some((run) => run.runId === versionedRunPayload.value.summary.runId),
    "server should read run history from SQLite after restart"
  );
  const restartedLogsResponse = await invokeHandler(restartedHandler, "GET", "/api/work-logs", "");
  const restartedLogsPayload = JSON.parse(restartedLogsResponse.body);
  assert(
    restartedLogsPayload.value.some((log) => log.triggerName === "定时上新品-编辑"),
    "server should read work logs from SQLite after restart"
  );

  const missingVersionRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "dry_run",
      browser: "fake",
      workflowVersionId: "missing-version"
    })
  );
  assert(missingVersionRunResponse.statusCode === 404, "server API should reject missing workflow versions");

  const recorderResponse = await invokeHandler(
    handler,
    "POST",
    "/api/recorder/workflow",
    JSON.stringify({
      sessionId: "session-from-test",
      name: "Recorded Baiying Test Flow",
      workflowId: "Recorded Baiying Test Flow",
      actions: [
        {
          type: "open",
          intent: "open_baiying",
          url: "https://buyin.jinritemai.com"
        },
        {
          type: "verify",
          intent: "ensure_login",
          expectation: { anyTextExists: ["百应", "橱窗", "商品"] }
        },
        {
          type: "click",
          intent: "click_recorded_add",
          target: { role: "button", text: "添加商品" }
        },
        {
          type: "input",
          intent: "input_recorded_product",
          target: { role: "textbox", label: "商品链接" },
          value: "{{productUrl}}"
        }
      ]
    })
  );
  const recorderPayload = JSON.parse(recorderResponse.body);
  assert(recorderResponse.statusCode === 200, "server API should convert recorded actions into a workflow version");
  assert(recorderPayload.ok, "recorder workflow import should succeed");
  assert(recorderPayload.value.workflow.workflowId === "recorded-baiying-test-flow", "recorder workflow id should be normalized");
  assert(recorderPayload.value.versionId.includes("recorded-baiying-test-flow"), "recorder workflow import should return the saved version id");
  assert(
    recorderPayload.value.workflow.steps.some((step) => step.id === "click_recorded_add"),
    "recorder workflow should preserve semantic action intent as step id"
  );

  const workflowListAfterRecordingResponse = await invokeHandler(handler, "GET", "/api/workflows", "");
  const workflowListAfterRecording = JSON.parse(workflowListAfterRecordingResponse.body);
  const recordedWorkflowVersionId = recorderPayload.value.versionId;
  assert(recordedWorkflowVersionId, "recorded workflow version should be listed");
  assert(
    workflowListAfterRecording.value.some((version) => version.versionId === recordedWorkflowVersionId),
    "recorder returned workflow version id should be listed"
  );
  assert(
    workflowListAfterRecording.value.some((version) => version.workflowId === "edited-baiying-flow"),
    "workflow editor version should remain listed after recorder import"
  );

  const recordedRunResponse = await invokeHandler(
    handler,
    "POST",
    "/api/run",
    JSON.stringify({
      csv: "rowId,productUrl,title\nrow-1,https://example.com/a,商品A",
      mode: "dry_run",
      browser: "fake",
      workflowVersionId: recordedWorkflowVersionId
    })
  );
  const recordedRunPayload = JSON.parse(recordedRunResponse.body);
  assert(recordedRunPayload.ok, "server API should run recorder-generated workflow versions");
  assert(recordedRunPayload.value.summary.workflowId === "recorded-baiying-test-flow", "recorded workflow run should use imported workflow id");

  const deleteWorkflowResponse = await invokeHandler(handler, "DELETE", `/api/workflows/${encodeURIComponent(recordedWorkflowVersionId)}`, "");
  const deleteWorkflowPayload = JSON.parse(deleteWorkflowResponse.body);
  assert(deleteWorkflowResponse.statusCode === 200, "server API should delete workflow versions");
  assert(deleteWorkflowPayload.ok, "workflow version delete should return structured success");
  const deletedWorkflowReadResponse = await invokeHandler(handler, "GET", `/api/workflows/${encodeURIComponent(recordedWorkflowVersionId)}`, "");
  assert(deletedWorkflowReadResponse.statusCode === 404, "server API should not return deleted workflow versions");

  const badPatchResponse = await invokeHandler(
    handler,
    "POST",
    "/api/workflow/patch",
    JSON.stringify({
      stepId: "ensure_login",
      target: {
        text: "百应"
      }
    })
  );
  assert(badPatchResponse.statusCode === 400, "server API should reject unsupported workflow patch");
}

async function testDevConsoleInjectsViteClient() {
  await rm(".tmp/test-dev-console.sqlite", { force: true });
  const port = 4297;
  const server = await createDevConsoleServer({
    host: "127.0.0.1",
    port,
    storePath: ".tmp/test-dev-console-runs.json",
    workflowStorePath: ".tmp/test-dev-console-workflows.json",
    databasePath: ".tmp/test-dev-console.sqlite",
    userDataDir: "browser-profiles/test"
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    assert(response.status === 200, "dev console should serve the interactive console");
    assert(html.includes("/@vite/client"), "dev console should inject Vite client for automatic reload");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function invokeHandler(handler, method, url, body) {
  const listeners = {};
  const request = {
    method,
    url,
    on(event, listener) {
      listeners[event] = listener;
    }
  };
  const response = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(data = "") {
      this.body = data;
    }
  };

  const handling = handler(request, response);
  if (body) {
    listeners.data?.(new TextEncoder().encode(body));
  }
  listeners.end?.();
  await handling;
  return response;
}

function createXlsxWorkbook(rows) {
  return createZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`],
    ["xl/worksheets/sheet1.xml", worksheetXml(rows)]
  ]);
}

function worksheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
${rows.map((row, rowIndex) => `    <row r="${rowIndex + 1}">
${row.map((cell, columnIndex) => `      <c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`).join("\n")}
    </row>`).join("\n")}
  </sheetData>
</worksheet>`;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name);
    const contentBuffer = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 6);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(contentBuffer.length, 18);
    local.writeUInt32LE(contentBuffer.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, contentBuffer);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 8);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(contentBuffer.length, 20);
    central.writeUInt32LE(contentBuffer.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + contentBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function columnName(index) {
  let value = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    value = String.fromCharCode(((current - 1) % 26) + 65) + value;
  }
  return value;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

for (const test of [
  testWorkflowValidation,
  testWorkflowNodeTaxonomyAndStrategyNodes,
  testCsvParsing,
  testPackageDeclaresOptionalPlaywright,
  testElectronDesktopShellUsesLocalConsole,
  testDryRunSkipsFinalSubmit,
  testBatchRequiresApproval,
  testRunRecoveryPlan,
  testRunOnceLimitsToFirstProduct,
  testWorkflowExtractStepPersistsRows,
  testRowIdsFilterProducts,
  testProductIdOnlyRowsBindToProductInput,
  testBatchWithApprovalsCanRun,
  testHighRiskWorkflowStepsAreBlocked,
  testBrowserProfileInspection,
  testWorkflowPausesForCaptchaSignal,
  testAppServicePersistsConsoleRun,
  testWorkflowRetriesFailedSteps,
  testBrowserExceptionsBecomeRecoverableFailures,
  testWorkflowClosesBrowserRuntime,
  testWorkflowResumeFromStartStep,
  testStepTimeoutsReachBrowserRuntime,
  testPlaywrightAdapterUsesInjectedDriver,
  testPlaywrightClickFallsBackFromRecordedTitlePrefix,
  testPlaywrightLabelFallsBackToCssForRecordedInputs,
  testPlaywrightClickTracksPopupPage,
  testRunViewModeCreatesExpectedBrowserRuntime,
  testOpenLoginArgs,
  testDoctorReportsLocalReadiness,
  testJsonFileRunStorePersistsRuns,
  testSqliteRunStoreScopesRunsByEmployeeColumn,
  testRunConsoleHtmlIncludesOperationalPanels,
  testLowConfidenceLocatorRequiresApproval,
  testWorkflowPatchUpdatesStepTarget,
  testWorkflowPatchRejectsUnsupportedStep,
  testSuggestTargetFromLocatorEvidence,
  testRecorderBuildsValidWorkflow,
  testRunCsvFileProducesConsoleAndStore,
  testConsoleServerRunsWorkflow,
  testDevConsoleInjectsViteClient
]) {
  await test();
  console.log(`ok ${test.name}`);
}
