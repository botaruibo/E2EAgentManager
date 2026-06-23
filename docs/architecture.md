# MVP 架构说明

本文档定义“数字员工调度中心”的 MVP 实现边界。项目目标不是做一个聊天机器人，也不是单一抖音百应自动化工具，而是做一个可恢复、可审计、可长期运行的浏览器数字员工管理平台。

抖音百应“批量添加商品到橱窗”当前只是内置示例 Workflow，用于验证 Browser Runtime、Workflow DSL、Trace 和回放能力。

## 架构参考

MVP 借鉴以下系统的思想，但不直接把它们作为核心 Runtime：

* Playwright codegen：录制用户动作，并优先生成 role、text、test-id 等更稳健的 Locator。
* Playwright trace viewer：把自动化执行证据保存在本地，便于失败后复盘。
* Temporal：将持久化工作流状态和浏览器点击、文件 IO 等副作用分离。
* XState/statecharts：用状态、事件、守卫和转换描述长任务。
* Electron 进程模型：Node-only 服务放在主进程，本地 UI 通过窄 API 访问。

当前项目采用“轻 Agent / 重 Runtime”的路线：AI 或 UI 可以提出运行请求，但真正的浏览器执行由 Runtime 接管。

## Runtime 边界

```text
输入文件
  -> Local Data Adapter
  -> Workflow DSL
  -> Workflow Engine
  -> Policy Engine
  -> Replay Engine
  -> Browser Runtime
  -> Trace Store
```

Runtime 负责确定性执行、检查点、重试、策略拦截和证据保存。UI、未来 Agent、Recorder 都不直接控制浏览器。

## 核心模块

### DSL Service

定义工作流、步骤、目标、策略和输入规格，并在运行前校验工作流是否可执行。

校验范围包括：schema 标识、输入规格、必填步骤字段、支持的步骤类型、唯一步骤 ID、步骤级 `timeoutMs`、策略安全字段、审批 key、批量上限和重试上限。

输入规格支持 `string` 和 `enum`。`enum` 值必须是字符串，默认值必须合法。

### Local Data Service

将 CSV、JSON、XLSX 统一解析成 `ProductInput[]`。

CLI 在 `--input-format auto` 下会根据文件后缀和内容自动判断格式。XLSX MVP 只读取第一个工作表，字段与 CSV 一致：

```text
rowId, productUrl, productId, title, groupName, remark
```

每行必须包含 `productUrl` 或 `productId`。默认变量绑定使用 `{{productUrl || productId}}`，因此只有商品 ID 的行也能进入百应商品输入框。

### Recorder Service

把语义化录制动作转换成 Workflow DSL 步骤。当前 MVP 已接入员工设计器录制入口：

* Electron 客户端使用 `<webview>` 打开真实目标网页，并通过注入脚本采集点击、输入和键盘事件。
* 普通 Web 端使用内置 iframe 示例页作为 fallback，保证 Web 控制台也能完整验证录制链路。
* 录制动作保存到当前员工草稿脚本 JSON，发布后成为调度运行版本。

支持的录制动作包括：

* open
* click
* input
* press
* verify
* extract
* wait

`extract` 用于将页面内容按实体和字段规则保存到运行 Trace，例如文章列表和评论列表。

Recorder 使用语义目标，而不是屏幕坐标。重复动作 ID 会自动追加数字后缀，保证生成的工作流仍然可恢复、可 Patch。

本地 Console 通过 Recorder 面板和 `POST /api/employees/:id/recording` 将录制结果保存到员工草稿脚本；也保留 `POST /api/recorder/workflow` 用于导入独立 Recorder JSON 并保存为工作流版本。

### Workflow Healing Service

将人工确认过的 Locator 修正写回 Workflow DSL。

MVP 支持：

* Patch `browser.click` 和 `browser.input` 的目标。
* 使用 Locator 证据推荐更合适的目标。
* 保存 Patch 后的工作流版本。
* 在后续 dry run 或真实运行中选择该版本。

这部分是后续 Locator Self Healing 的基础。

### Workflow Engine

Workflow Engine 是事件驱动 FSM，按商品行执行工作流。它负责状态转换、检查点、重试计数、运行状态和资源清理。

输出包括：

* runtime events
* checkpoints
* item result
* failedStepId
* errorCategory
* resumeStepId

瞬时失败会按照 `workflow.policy.maxRetryPerItem` 重试。审批暂停不会重试。浏览器异常会被转换为结构化失败结果，而不是直接中断整个批次。

`startStepId` 支持从指定步骤恢复。结合 `rowIds` 可以只重跑失败商品。Engine 会发出 `item.resumed` 事件，并跳过更早的步骤。

每个批次结束后，如果 Browser Runtime 暴露 `close()`，Engine 会尝试关闭浏览器上下文。清理失败不会覆盖业务运行结果。

### Policy Engine

Policy Engine 在浏览器动作开始前阻断危险操作。

初始规则：

* `batch` 模式必须有 `batch` 审批。
* 最终提交步骤必须有 `final_submit` 审批，除非处于 `dry_run`。
* 批量大小不能超过 `maxBatchSize`。
* 重试次数不能超过 `maxRetryPerItem`。
* 涉及删除、移除、改价、广告、退款、充值、支付等高风险动作的步骤会被阻断。
* 登录失效、验证码、滑块、风控等页面信号会暂停执行，等待人工介入。

运行模式语义：

* `dry_run`：跳过最终提交和提交后校验。
* `run_once`：只处理第一行。
* `batch`：处理全部行，但需要 `batch` 审批。

### Replay Engine

Replay Engine 负责变量绑定、Locator 解析、浏览器动作执行和后置校验。

输入是工作流步骤和商品上下文，输出是步骤结果和 Trace 事件。步骤级 `timeoutMs` 会透传给 Browser Runtime，用于适配慢页面。

### Browser Runtime

Browser Runtime 把 Playwright 或未来浏览器驱动封装在统一接口下，测试可以使用假实现。

接口动作：

* `open`
* `click`
* `input`
* `verify`
* `wait`
* `snapshot`

Playwright 适配器支持：

* 专用百应登录目录 `userDataDir`
* `headless` 开关
* 本地 Chrome/Chromium `executablePath`
* viewport 配置
* Console 日志和网络摘要
* 运行前创建 profile 目录
* 缺少浏览器二进制或 profile 异常时给出结构化错误

真实百应运行前，操作者需要先用同一个 `userDataDir` 打开登录浏览器并完成登录。`run_once`、`batch` 和带 `final_submit` 审批的运行会检查 Chromium Cookie 标记，避免未登录时误执行。

### Locator Engine

Locator Engine 为候选目标评分，并选择最安全的可执行 Locator。

阈值：

* `>= 0.90`：自动执行。
* `0.70 - 0.89`：需要额外确认。
* `< 0.70`：暂停，等待人工确认。

低置信度目标会返回 `requires_approval`，避免弱 XPath 或歧义目标直接操作真实后台。

### Trace Service

Trace 记录一次运行为什么会得到当前结果。

Trace 内容包括：

* workflow input
* 选中的 Locator
* 候选 Locator 评分
* 步骤耗时
* 错误信息
* 可见 DOM 文本摘要
* 可选 accessibility snapshot
* Console 日志
* 网络摘要
* Playwright 截图

截图以 `{ mimeType, bytes, base64 }` 形式保存在 snapshot 中。截图或 accessibility 采集失败会记录错误字段，不会中断工作流。

App Service 和 Console 可以导出：

* `trace.json`：完整运行证据。
* `recovery.json`：失败或审批暂停行的恢复计划。
* Trace Viewer HTML：本地可视化查看运行证据。

### Storage Service

Storage Service 通过接口持久化运行摘要、商品结果和事件。

MVP 实现：

* `InMemoryRunStore`：用于确定性测试。
* `JsonFileRunStore`：保留给 CLI 和旧测试的轻量本地持久化。
* `SqliteRunStore`：用于本地 Console/API 的运行历史持久化。
* `InMemoryWorkflowVersionStore`
* `JsonFileWorkflowVersionStore`：保留给 CLI 和旧测试的轻量本地持久化。
* `SqliteWorkflowVersionStore`：用于本地 Console/API 的 Workflow 版本持久化。
* `SqliteEmployeeStore`：用于数字员工、版本和脚本文档持久化。
* `SqliteScheduledTriggerStore`：用于计划任务和工作日志持久化。

本地 Console/API 默认使用 `data/digital-employee.sqlite`。JSON Store 仍按 run ID 追加保存，作为 CLI 兼容路径保留；损坏的 JSON 文件会被拒绝，不会静默当作空历史覆盖。

这些 Store 均以接口隔离，后续可以替换为其他本地或远端存储实现，而不改变 App Service 和 UI 合同。

### App Service

App Service 是桌面端和本地 API 的用例门面。Renderer 或 Electron Main 应该调用这一层，而不是直接拼接 Runtime 内部模块。

当前用例：

* 从商品输入运行工作流。
* 生成运行计划。
* 保存和读取运行历史。
* 导出结果、Trace 和恢复计划。
* 读取、保存、选择和删除工作流版本。

### Employee / Scheduler Service

数字员工管理是当前产品层的核心能力。

员工状态机：

```text
新建员工 -> 前端临时草稿 -> 保存 -> 草稿 v1 -> 发布 -> 已发布 v1 -> 编辑 -> 草稿 v2 -> 发布 -> 已发布 v2 -> 删除 -> 停用
```

约束：

* 员工 ID 使用 `p` + 四位数字，例如 `p0001`。
* 员工列表展示 `{员工名称}({员工id})`。
* 点击“新建员工”只进入员工设计器并创建前端临时草稿；点击“保存”后才调用 `POST /api/employees` 写入 SQLite。
* 员工页操作栏默认隐藏，只有选中行后展示运行、编辑、发布、删除。
* 编辑已发布员工会生成草稿新版本，当前 `activeVersion` 继续作为运行版本。
* 删除员工是软停用：员工 JSON 的 `status` 变为 `disabled`，员工页隐藏，回收站展示。
* 触发器只能绑定存在 `activeVersion` 且未停用的可运行员工。
* 定时任务到点后重新读取员工当前发布脚本，并写入工作日志。

员工、触发器、工作日志、运行历史和 Workflow 版本使用 SQLite 存储：

```text
data/digital-employee.sqlite
```

表结构保持产品文档优先，但员工和工作流版本分层存储：`employees` 保存员工名称、状态、版本号、`online_version` 和 `latest_version` 指针，`document_json` 只保存轻量员工文档；`workflow_versions.document_json` 保存完整 workflow、录制动作、员工 ID、员工版本和发布状态。触发器、工作日志和运行历史仍以完整 JSON 文档保存，便于后续扩展调度参数和运行证据。

### Run Console Renderer

`apps/desktop/src/render-console.ts` 将 `RunConsoleView` 渲染成静态 HTML，是完整 Electron/React UI 前的 MVP 桥接层。

页面展示：

* 输入和运行配置。
* 审批与安全状态。
* 工作流汇总指标。
* 商品行结果。
* 重试次数和失败步骤。
* Trace 预览。

### Local Console Server

`apps/desktop/src/serve.ts` 提供无前端依赖的本地 HTTP Console。

主要 API：

* `GET /`：返回交互式 Console。
* `GET /api/employees`：列出数字员工。
* `POST /api/employees`：保存前端临时草稿并新建草稿员工。
* `PATCH /api/employees/:id`：修改员工名称。
* `DELETE /api/employees/:id`：软停用员工，数据保留在 SQLite 回收站。
* `POST /api/employees/:id/edit`：编辑员工并生成草稿新版本。
* `POST /api/employees/:id/publish`：发布员工。
* `POST /api/employees/:id/run`：手动运行选中员工，复用 Workflow Engine，并写入运行历史和工作日志。
* `POST /api/employees/:id/recording`：将录制动作转换为 Workflow，并保存到员工草稿脚本。
* `GET /api/triggers`：列出计划任务。
* `POST /api/triggers`：创建计划任务。
* `PATCH /api/triggers/:id/enabled`：启用或禁用计划任务。
* `POST /api/triggers/:id/run`：手动执行计划任务，复用 Workflow Engine，并写入运行历史和工作日志。
* `DELETE /api/triggers/:id`：删除计划任务。
* `GET /api/work-logs`：列出工作日志。
* `POST /api/input/preview`：解析输入并预览商品行。
* `POST /api/run/plan`：生成运行计划，不启动浏览器。
* `POST /api/run`：执行工作流，并返回 `RunConsoleView`。
* `GET /api/runs`：列出历史运行。
* `GET /api/runs/:runId`：读取历史运行视图。
* `DELETE /api/runs/:runId`：删除历史运行。
* `GET /api/runs/:runId/export.csv`：导出行级结果。
* `GET /api/runs/:runId/recovery.json`：导出恢复计划。
* `GET /api/runs/:runId/trace`：返回 Trace Viewer HTML。
* `GET /api/runs/:runId/trace.json`：返回完整 Trace。
* `GET /api/browser/profile`：返回浏览器 profile 状态。
* `GET /api/doctor`：返回本地环境自检。
* `POST /api/browser/login`：打开持久化登录浏览器。
* `POST /api/workflow/patch`：校验并保存目标 Patch。
* `GET /api/workflow/default`：返回内置工作流。
* `GET /api/workflow/default.json`：返回原始工作流 JSON。
* `POST /api/workflow/validate`：校验完整 Workflow JSON。
* `POST /api/workflow/version`：保存工作流版本。
* `POST /api/recorder/workflow`：导入 Recorder JSON 并保存工作流版本。
* `GET /api/workflows`：列出工作流版本。
* `GET /api/workflows/:versionId`：读取工作流版本。
* `DELETE /api/workflows/:versionId`：删除工作流版本。

### Electron Shell

`apps/desktop/src/electron-main.ts` 将同一套本地 Console/API 包进 Electron `BrowserWindow`。

安全设置：

* 关闭 Node integration。
* 启用 context isolation。
* 启用 renderer sandbox。
* 退出桌面应用时关闭内嵌 HTTP Server。

这样 CLI、浏览器 Console、Electron 桌面端都复用同一个 App Service/API 路径。未来 React/Vite Renderer 只替换表现层，不替换核心 Runtime。

## 本地入口

```bash
npm run demo
npm run console
npm run doctor
npm run run:csv -- examples/products.csv --mode dry_run --out .tmp/manual-console.html --store .tmp/manual-runs.json
npm run run:csv -- examples/products.json --input-format json --mode dry_run
npm run run:csv -- products.xlsx --input-format auto --mode dry_run
npm run run:csv -- examples/products.csv --mode batch --plan-only true
npm run run:csv -- examples/products.csv --mode batch --plan-only true --plan-out .tmp/plan.json
npm run run:csv -- --export-workflow .tmp/default-workflow.json
npm run run:csv -- examples/products.csv --workflow-file .tmp/workflow.json --mode dry_run
npm run run:csv -- examples/products.csv --row-ids row-2 --start-step click_add_product --mode dry_run
npm run run:csv -- --recovery-from-run <runId> --store .tmp/runs.json
npm run login:browser -- --user-data-dir browser-profiles/baiying
npm run serve -- --port 4173
npm run desktop -- --port 4173
```

`run:csv` 是当前最接近软件运行流的 CLI 入口：

```text
input file -> App Service -> Runtime -> JSON store -> Run Console HTML
```

`serve` 是当前最接近桌面产品体验的入口：

```text
browser UI -> local API -> App Service -> Runtime -> JSON store -> Run Console view
```

`doctor` 用于真实运行前检查本地条件，包括 Node、工作流、样例输入、JSON 存储、Electron、Playwright、可选浏览器路径和浏览器 profile。

## 包结构

```text
packages/
  shared/       共享领域类型和 Result helper
  dsl/          工作流 Schema 与校验
  recorder/     语义化录制动作转换
  workflow-healing/
                工作流目标 Patch 与 Locator 证据辅助
  local-data/   CSV/JSON/XLSX 商品输入解析
  policy/       安全检查与审批决策
  locator/      候选 Locator 评分与选择
  browser/      Browser Runtime 接口、假驱动、Playwright 适配器
  trace/        Trace 事件采集
  storage/      RunStore 与 WorkflowVersionStore
  replay/       基于 Browser + Locator 的步骤执行
  workflow/     事件驱动 FSM 编排
  app-service/  面向桌面的用例门面
  runtime/      Runtime 公共门面
apps/
  desktop/      Electron 壳、本地 Console、CLI、登录浏览器和 Server
```

## 第一个实现切片

第一个代码切片必须在没有真实抖音百应账号的情况下运行，因此默认使用假浏览器 Runtime。它证明以下能力：

1. 工作流定义可以被校验。
2. 商品行可以从 CSV、JSON、简单 XLSX 解析。
3. 运行可以发出确定性事件。
4. 策略可以暂停危险提交步骤。
5. Trace 可以记录步骤级证据。

真实 Playwright 集成已经可用，但端到端验证仍需要本地浏览器环境和已登录的百应 session。

## Playwright 适配器边界

`packages/browser/src/playwright.ts` 在 `BrowserRuntime` 接口后实现真实适配器。`playwright` 是可选依赖并动态加载，因此测试可以注入假驱动，仓库也能在不启动浏览器的情况下构建。

关键配置：

* `userDataDir`：专用目标站点登录 profile。百应示例默认使用 `browser-profiles/baiying`。
* `headless`：是否无头运行。
* `executablePath`：使用本地 Chrome/Chromium。
* viewport：浏览器视口。
* snapshot：包含 Console 日志、网络事件、DOM 文本、截图等证据。

## 登录后真实验证流程

你现在已经能打开浏览器并登录抖音百应。接下来建议严格按下面顺序走，减少误操作风险：

1. 确认你登录时使用的目录是 `browser-profiles/baiying`。后续命令必须复用同一个 `--user-data-dir`。
2. 执行 `npm run doctor`，确认 `electron_package`、`playwright_package` 为 `ok`，并查看 `browser_profile` 是否仍有 warning。
3. 启动 Console：

```bash
npm run serve -- --port 4173 --user-data-dir browser-profiles/baiying
```

4. 打开 `http://127.0.0.1:4173`，查看 Local Doctor 和 Browser Profile。
5. 准备 1 行真实可测试商品数据，优先只填 `productId` 或 `productUrl`。
6. 先执行 Preview Input，再执行 Preview Run Plan。
7. 选择 `browser: playwright`、`mode: dry_run`，不要给 `final_submit` 审批。
8. 如果 `dry_run` 因 Locator 或页面路径失败，打开 Trace Viewer，看截图和 Locator 证据，优先通过 Workflow Patch 修正。
9. 只有当 `dry_run` 稳定走到最终提交前，再用 `run_once + final_submit` 测 1 个商品。
10. 单商品真实添加成功后，再考虑 `batch + batch,final_submit`。

CLI 等价命令：

```bash
npm run run:csv -- examples/products.csv --mode dry_run --browser playwright --user-data-dir browser-profiles/baiying
npm run run:csv -- examples/products.csv --mode run_once --browser playwright --user-data-dir browser-profiles/baiying --approvals final_submit
npm run run:csv -- examples/products.csv --mode batch --browser playwright --user-data-dir browser-profiles/baiying --approvals batch,final_submit
```

## 后续路线

1. 基于真实百应 Trace 修正默认工作流。
2. 完善 SQLite 数据清理、导出和备份能力。
3. 接入真实浏览器事件 Recorder。
4. 增强 Locator Self Healing。
5. 用 React/Vite 构建正式桌面 Renderer。
