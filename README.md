# 数字员工调度中心

这是一个面向任意 Web 后台和浏览器操作流程的数字员工管理平台 MVP。平台支持创建员工、设计脚本、发布版本、配置定时触发器、运行员工脚本并记录工作日志。

抖音百应“批量添加商品到橱窗”目前保留为内置示例员工模板，用于验证 Browser Runtime、Workflow DSL、Trace、录制导入和回放能力；它不再是项目唯一定位。

完整录制、保存、发布和运行步骤见 [用户手册](docs/user-manual.md)。

## 当前能力

* 管理数字员工：新建临时草稿、保存、发布、编辑生成新版本、运行选中员工、软停用员工。
* 为存在发布版本且未停用的员工创建定时触发器，触发器只能绑定员工列表中可运行的员工。
* 将员工、计划任务、工作日志、运行历史和 Workflow 版本作为完整 JSON 文档保存到 SQLite。
* 校验默认示例 Workflow DSL。
* 解析 CSV、JSON、简单 XLSX 商品行。
* 对每一行商品执行事件驱动工作流。
* 支持失败重试、检查点、从指定步骤恢复。
* 支持步骤级 `timeoutMs`，适配百应后台慢页面或弹窗。
* 支持 `rowIds` 精准重跑失败商品。
* 支持 `dry_run`、`run_once`、`batch` 三种运行模式。
* 执行前进行安全策略检查，包括批量审批、最终提交审批和高风险动作拦截。
* 遇到登录失效、验证码、风控等页面信号时暂停，等待人工介入。
* 保存运行结果、事件、Trace、截图、DOM 文本、Console 日志、网络摘要和 Locator 证据。
* 提供恢复计划 `recovery.json`、完整 Trace JSON、Trace Viewer 页面和结果 CSV 导出。
* 提供工作流 JSON 查看、编辑、校验、保存、版本选择和删除。
* 支持在员工设计器中打开数字员工浏览器录制动作，并保存为当前员工草稿脚本。
* 支持导入语义化 Recorder JSON 并生成可执行工作流版本。
* 支持人工确认 Locator Patch，并保存为后续可复用的工作流版本。
* 提供本地 Console Server 和 Electron 桌面壳。
* 提供 `doctor` 自检，检查 Node、工作流、样例输入、存储、Electron、Playwright、浏览器 profile 等状态。

## 常用命令

```bash
npm run build
npm test
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
npm run dev:serve -- --port 4173
npm run desktop -- --port 4173
npm run desktop:dev -- --port 4174 --user-data-dir browser-profiles/baiying
npm run lint
```

`npm run demo` 使用假浏览器和样例 CSV 跑一次默认 `dry_run`。

`npm run console` 会生成静态运行结果页面 `.tmp/console.html`。

`npm run doctor` 检查本地环境是否就绪：Node 版本、默认工作流、样例输入、本地存储、Electron 包、Playwright 包、可选浏览器路径，以及浏览器 profile。

`npm run run:csv` 是当前最主要的本地 MVP 入口。它读取商品文件，调用 App Service 执行工作流，保存运行 JSON，并生成 Run Console HTML。

`npm run serve` 启动交互式本地控制台。打开 `http://127.0.0.1:4173` 后，可以粘贴商品行、导入 CSV/JSON/XLSX、选择运行模式和浏览器 Runtime，然后点击运行。

`npm run desktop` 用 Electron 打开同一套 Console/API。Electron 只是外壳，核心运行路径仍然复用本地服务。

开发 UI 时优先使用 Vite 热更新入口：

```bash
npm run dev:serve -- --port 4173
npm run desktop:dev -- --port 4174 --user-data-dir browser-profiles/baiying
```

`dev:serve` 和 `desktop:dev` 会先构建服务端入口，再以 `--dev` 模式启动本地 Console。页面由 Vite 从 `apps/desktop/src/interactive-console.ts` 实时加载，并注入 `/@vite/client`；修改该文件后浏览器会自动刷新。HMR WebSocket 默认使用应用端口 `+1`，例如页面端口 `4174` 对应 HMR 端口 `4175`。

本地 Console/API 的员工、计划任务、工作日志、运行历史和 Workflow 版本默认保存到 `data/digital-employee.sqlite`。员工删除是软停用，记录仍保存在 `employees.document_json` 中并显示到回收站。需要隔离环境时可以指定：

```bash
npm run serve -- --database .tmp/dev-digital-employee.sqlite
npm run desktop -- --database .tmp/dev-digital-employee.sqlite
```

## 输入格式

CSV、JSON 和 XLSX 使用同一组字段：

```text
rowId, productUrl, productId, title, groupName, remark
```

说明：

* `productUrl` 或 `productId` 至少填写一个。
* `rowId` 可选，但如果填写必须唯一；恢复计划和 `rowIds` 过滤会使用它。
* 表头大小写不敏感，允许 UTF-8 BOM。
* 未知字段会被拒绝，避免误把脏数据送进真实后台。
* JSON 中的数字 ID 会转换成字符串。
* 默认工作流使用 `{{productUrl || productId}}` 填入百应商品搜索/输入框。
* XLSX 仅支持 MVP 范围：读取第一个工作表，并按普通表格解析。

## 运行模式与审批

模式：

* `dry_run`：执行到最终提交前，跳过提交和提交后校验。
* `run_once`：只执行第一行商品。
* `batch`：执行全部商品，但必须授予 `batch` 审批。

审批示例：

```bash
npm run run:csv -- examples/products.csv --mode run_once --approvals final_submit
npm run run:csv -- examples/products.csv --mode batch --approvals batch,final_submit
```

安全建议：真实业务账号上先使用 `dry_run`，确认定位、页面流和 Trace 后，再考虑 `run_once`。`batch` 和 `final_submit` 应该最后启用。

## 使用真实浏览器

你已经安装了 Electron/Playwright，并且可以打开浏览器登录目标 Web 后台。抖音百应仍是当前默认示例，后续建议按这个顺序推进：

1. 先确认登录 profile 状态：

```bash
npm run doctor
```

如果 `browser_profile` 仍提示不存在或没有 Cookie 标记，重新用同一个目录打开登录浏览器：

```bash
npm run login:browser -- --user-data-dir browser-profiles/baiying
```

登录后不要更换 `--user-data-dir`，真实运行必须复用这个目录。

2. 启动本地控制台：

```bash
npm run serve -- --port 4173 --user-data-dir browser-profiles/baiying
```

打开 `http://127.0.0.1:4173`，查看 Local Doctor 和 Browser Profile 面板。

3. 准备一份只含 1 个商品的测试文件，建议从 `examples/products.csv` 复制后替换为你百应后台可搜索的商品链接或商品 ID。

4. 在 Console 中先选择：

```text
Runtime: fake 或 playwright
Mode: dry_run
Approvals: 不勾 final_submit
```

先用 Preview Input 和 Preview Run Plan 确认解析结果、审批缺口和步骤状态。

5. 用 Playwright 跑真实 `dry_run`：

```bash
npm run run:csv -- examples/products.csv --mode dry_run --browser playwright --user-data-dir browser-profiles/baiying
```

如果页面结构和默认工作流不匹配，查看生成的 Trace、截图和 Locator 证据，再通过 Workflow Patch 或编辑 Workflow JSON 修正目标。

6. 单商品链路稳定后，再执行：

```bash
npm run run:csv -- examples/products.csv --mode run_once --browser playwright --user-data-dir browser-profiles/baiying --approvals final_submit
```

确认真的能添加到橱窗后，再考虑 `batch`。

## 本地控制台功能

交互式 Console 支持：

* 导入或粘贴 CSV/JSON/XLSX。
* Preview Input：预览解析结果。
* Preview Run Plan：预览缺失审批、策略阻断和每个步骤状态。
* Run：执行假浏览器或真实 Playwright 工作流。
* Local Doctor：查看本地环境、浏览器 profile 和存储状态。
* Open Login Browser：打开专用登录浏览器。
* Recent Runs：查看或删除历史运行。
* Export CSV：导出行级结果。
* Recovery JSON：导出恢复计划。
* Apply Recovery：把恢复计划中的第一组 `rowIds` 和 `resumeStepId` 填回表单。
* Trace JSON / View Trace：导出或查看完整运行证据。
* Workflow Patch：修正 click/input 步骤目标。
* Default Workflow：查看、编辑、校验、下载或保存工作流 JSON。
* Recorder Import：导入语义化录制动作并生成工作流版本。

## 检查点恢复

如果某些商品失败，可以用上一次运行给出的 `resumeStepId` 和 `rowId` 定向恢复：

```bash
npm run run:csv -- examples/products.csv --mode dry_run --row-ids row-2 --start-step click_add_product
```

也可以从历史运行生成恢复计划：

```bash
npm run run:csv -- --recovery-from-run <runId> --store .tmp/runs.json
```

## 项目结构

```text
apps/desktop/          本地 Console、CLI、登录浏览器、Server、Electron 入口
apps/desktop/src/electron-main.ts
                       Electron 生命周期与本地 Console 窗口
apps/desktop/src/render-console.ts
                       静态 Run Console HTML 渲染器
apps/desktop/src/serve.ts
                       本地 HTTP Console 和 API
packages/shared/       共享领域类型
packages/dsl/          工作流定义与校验
packages/local-data/   CSV/JSON/XLSX 商品输入解析
packages/recorder/     语义化录制动作转工作流
packages/workflow-healing/
                       工作流目标 Patch 与 Locator 证据辅助
packages/policy/       安全策略与审批检查
packages/locator/      Locator 候选评分
packages/browser/      Browser Runtime 接口、假浏览器、Playwright 适配器
packages/trace/        Trace 采集
packages/storage/      RunStore 与 WorkflowVersionStore
packages/replay/       步骤执行
packages/workflow/     事件驱动 FSM Runner
packages/app-service/  面向桌面的用例封装
packages/runtime/      Runtime 公共入口
docs/                  架构与调研文档
examples/              示例输入文件
tests/                 Node 集成测试
```

## 后续实现步骤

1. 继续增强 Electron webview 录制能力，补齐 iframe、跨域、弹窗、多标签和文件上传等复杂场景。
2. 为员工版本补充可视化 diff、回滚和发布审批。
3. 为 SQLite 数据补充清理、导出和备份能力。
4. 将默认百应模板抽象为可替换的员工脚本模板库。
5. 用 React/Vite 替换当前静态 Console 渲染器。
