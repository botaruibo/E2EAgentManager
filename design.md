# 数字员工调度中心设计文档

任意基于浏览器操作的数字员工管理平台（MVP V2.0）

## 一、项目定位

本项目的定位已经从“抖音百应端到端运行员工”调整为：

> 面向任意 Web 后台和浏览器操作流程的数字员工设计、发布、调度、运行与审计平台。

平台不绑定某一个业务系统。抖音百应“批量添加商品到橱窗”只作为当前内置示例员工和默认 Workflow 模板，用于验证 Browser Runtime、录制/回放、触发器和日志能力。

第一阶段要验证的核心问题是：

1. 能否把人工浏览器操作沉淀为可复用的员工脚本。
2. 能否管理员工的草稿、版本和发布状态。
3. 能否为存在发布版本的员工配置定时任务。
4. 能否在任务到点后运行对应员工脚本并记录工作日志。
5. 能否保留 Trace、参数、执行结果和恢复线索，便于审计和调试。

长期方向是一个通用 Browser Operating Runtime，而不是单一电商平台自动化工具。

## 二、产品对象与状态模型

### 2.1 员工

员工是一个可运行的浏览器自动化能力单元，包含：

```ts
interface Employee {
  id: string;           // p + 四位数字，例如 p0001
  name: string;         // 展示为 员工名称(员工id)
  status: "draft" | "published" | "disabled";
  version: number;
  activeVersion?: number;
  updatedAt: string;
  script: {
    workflowId: string;
    workflowName: string;
  };
  draftScript?: {
    workflowId: string;
    workflowName: string;
  };
  versions: Array<{
    version: number;
    status: "draft" | "published";
    script: {
      workflowId: string;
      workflowName: string;
    };
    createdAt: string;
    updatedAt: string;
  }>;
}
```

员工状态机：

```text
新建员工
  -> 草稿 v1
  -> 发布
  -> 已发布 v1
  -> 编辑
  -> 草稿 v2
  -> 发布
  -> 已发布 v2
  -> 删除
  -> 停用
```

规则：

* 新建员工生成唯一 ID，格式为 `p0001`、`p0002`、`p0003` 递增。
* 点击“新建员工”只创建前端临时草稿并进入员工设计器；只有点击“保存”后才写入 SQLite。
* 员工列表展示格式为 `{员工名称}({员工id})`。
* 操作栏默认隐藏，只有选中某一行员工后才展示。
* 员工操作只针对当前选中的员工。
* MVP 操作按钮保留：运行、编辑、发布、删除。
* 删除员工不会硬删除数据，而是将员工 JSON 的 `status` 改为 `disabled`；员工页隐藏，回收站展示停用员工。
* 全新草稿和停用员工不能被定时触发器选择；定时任务只能绑定已经存在发布版本且未停用的员工。
* 已发布员工进入编辑时，会生成新的草稿版本，但 `activeVersion` 仍指向当前发布版本。
* 只有新草稿再次发布后，`activeVersion` 才切换到新版本，定时任务后续运行新脚本。

### 2.2 员工脚本

员工脚本本质是 Workflow DSL。

脚本来源可以是：

* 员工设计器中的数字员工浏览器录制。
* 手工导入语义化 Recorder JSON。
* 手工编辑 Workflow JSON。
* 后续由 LLM 生成并通过 schema / policy 校验。

录制链路：

* Electron 客户端优先使用 `<webview>` 打开真实目标网页，并注入轻量事件采集脚本。
* 普通 Web 端使用内置 iframe 示例页作为 fallback，保持 PC Web 可测试。
* 录制得到的 open / click / input / press / verify / extract / wait 动作会转换成 Workflow DSL。
* `press` 用于复现 Enter、Tab、Escape 等键盘事件；`extract` 用于将页面数据按实体和字段规则保存到运行 Trace。
* 保存录制结果时，平台调用 `POST /api/employees/:id/recording`，将 `workflowVersionId`、`workflow` 和原始 `actions` 写入该员工草稿脚本 JSON。
* 录制保存后仍是草稿版本，只有发布后才切换为可运行版本。

当前内置示例：

```text
workflowId: browser-operation-digital-employee
workflowName: 浏览器操作数字员工脚本
```

该示例只用于验证能力，不代表平台只服务抖音百应。

### 2.3 触发器任务

触发器任务描述“什么时候运行哪个存在发布版本的员工”。

```ts
interface ScheduledTriggerDocument {
  id: string;
  name: string; // 任务名称
  type: "scheduled";
  employee: {
    id: string;
    name: string;
    script?: {
      workflowId: string;
      workflowName: string;
    };
  };
  schedule: {
    frequency: "minute" | "hour" | "day" | "week" | "month" | "advanced";
    time: string;
    timezone: string;
    enabled: boolean;
    endEnabled: boolean;
    calendarEnabled: boolean;
    queueEnabled: boolean;
    timeoutMinutes: number;
  };
  createdAt: string;
  updatedAt: string;
}
```

规则：

* 触发器弹窗中“任务名称”用于任务命名。
* “员工名称”是下拉框，只能从员工接口返回的可运行员工中选择。
* 下拉框只显示员工名称，内部 value 使用员工 ID。
* 触发器服务端会校验员工 ID，不允许绑定不存在或没有发布版本的员工。
* 到达配置时间后，调度器按员工 ID 重新读取当前 `activeVersion` 的脚本，并写入工作日志。

### 2.4 工作日志

工作日志记录手动运行、定时运行和后续真实脚本运行结果。

```ts
interface TriggerRunLogDocument {
  id: string;
  triggerId: string;
  triggerName: string;
  startedAt: string;
  finishedAt: string;
  params: Record<string, unknown>;
  result: {
    ok: boolean;
    message: string;
  };
}
```

当前日志会记录：

* 触发器信息。
* 绑定员工信息。
* 员工脚本信息。
* 执行来源：`manual_employee`、`manual_trigger`、`scheduled`。
* 执行结果、提示信息、`runId`、运行参数和 summary。
* 手动运行和触发器运行都会复用 `WorkflowEngine`；详细步骤、抽取结果和截图/DOM 证据保存到 `runs`。

## 三、MVP 范围

### 3.1 已实现的产品页面

#### 员工页

能力：

* 列出员工 ID、员工名称、更新时间、状态和版本。
* 新建员工：先创建前端临时草稿，点击保存后创建草稿 v1 并写入 SQLite。
* 选中某一行后展示运行、编辑、发布、删除按钮。
* 编辑已发布员工：生成草稿新版本，当前发布版本继续作为运行版本。
* 发布草稿员工：状态变为已发布，并切换 activeVersion。
* 删除员工：状态变为停用，员工页隐藏，回收站展示。
* 运行员工：调用真实 Workflow Runtime，保存运行历史和工作日志；草稿员工提示需要发布后才能运行。

#### 员工设计器

能力：

* 进入设计器时收起外层侧栏。
* 展示“员工设计器”。
* 左侧“主要任务”与主流程步骤保持一致。
* 支持数字员工浏览器录制脚本，并展示已录制动作列表。
* 支持语义化 Recorded Actions JSON 导入。
* 可查看、校验、保存 Workflow JSON 版本。

#### 触发器页

能力：

* 左侧按钮在触发器上下文显示为“新建任务”。
* 点击后弹出定时触发器配置弹窗。
* 表单字段包括任务名称、员工名称、频率、触发时间、定时结束、更多参数。
* “更多”默认收起，展开后显示按指定日历触发、排队执行、运行超时。
* 保存后生成计划任务列表。
* 计划任务支持启用/禁用、查看未来执行时间、执行一次、删除。

#### 工作日志页

能力：

* 原“运行日志”已更名为“工作日志”。
* 无数据时展示“暂无日志”。
* 执行任务后展示运行时间、任务名称、执行结果和参数 JSON。
* 左侧展示工作日志数量。

### 3.2 当前仍作为示例存在的百应流程

当前代码仍保留默认浏览器 Workflow 模板：

```text
browser-operation-digital-employee
```

它用于：

* 验证 Browser Runtime。
* 验证 CSV / JSON / XLSX 输入。
* 验证 Policy、Trace、Locator、Workflow Patch。
* 作为“浏览器数字员工脚本”的示例模板。

后续可以新增任意浏览器后台脚本，例如：

* 内部 CRM 数据录入。
* 广告后台巡检。
* 财务系统下载报表。
* 客服后台批量查询。
* 运营后台配置检查。

## 四、核心架构原则

### 4.1 轻 Agent，重 Runtime

本项目不是 ChatBot，也不是单次问答式 Workflow。

核心是长期运行、有状态、可恢复、可审计的 Browser Runtime。

```text
员工 / 触发器 / 用户操作
  -> Workflow DSL
  -> Runtime
  -> Browser Runtime
  -> Trace / Log / Checkpoint
```

LLM 或 LangGraph 后续可以作为员工脚本生成和多员工编排层，但不进入 Runtime 核心。

### 4.2 DSL First

AI、UI、Recorder 都不直接控制浏览器。

所有动作必须先表达为 Workflow DSL / Action DSL，再由 Runtime 执行。

```text
Recorded Actions
  -> Workflow DSL
  -> Policy Check
  -> Replay Engine
  -> Browser Runtime
```

### 4.3 DOM First

运行时优先使用 DOM 和 Accessibility 信息定位元素，而不是屏幕坐标。

Locator 优先级：

```text
Role
  -> Label
  -> Text
  -> CSS
  -> XPath
```

截图用于 Trace 和诊断，不作为常规定位方式。

### 4.4 Event Driven FSM

Workflow Engine 采用事件驱动状态机。

FSM 负责“现在该做什么”。

Event 负责记录“发生了什么”。

Checkpoint 负责“失败后从哪里恢复”。

Trace 负责“为什么这样执行”。

## 五、总体架构

```text
Electron / Web Console
  |
  +-- Employee Management
  |     +-- draft / published / version
  |
  +-- Employee Designer
  |     +-- Recorder
  |     +-- Workflow JSON Editor
  |
  +-- Scheduler
  |     +-- Scheduled Trigger
  |     +-- Work Logs
  |
  v
Local Console API
  |
  +-- Employee API
  +-- Trigger API
  +-- Workflow API
  +-- Run API
  |
  v
Runtime
  |
  +-- Workflow Engine
  +-- Replay Engine
  +-- Locator Engine
  +-- Policy Engine
  +-- Trace Engine
  +-- Browser Runtime
  |
  v
Target Browser / Any Web Admin System
```

## 六、代码实现现状

### 6.1 前端入口

文件：

```text
apps/desktop/src/interactive-console.ts
```

当前使用服务端渲染 HTML + 原生 JS，后续可替换为 React / Vite。

已实现：

* 数字员工调度中心主界面。
* 员工页、回收站、触发器页、工作日志页。
* 员工设计器。
* 触发器弹窗。
* 员工行选中后展示操作栏。
* 触发器计划列表和详情浮层。
* 工作日志列表和空状态。

### 6.2 本地 API

文件：

```text
apps/desktop/src/serve.ts
```

已实现 API：

```text
GET  /api/employees
POST /api/employees
PATCH /api/employees/:id
DELETE /api/employees/:id
POST /api/employees/:id/edit
POST /api/employees/:id/publish
POST /api/employees/:id/run

GET  /api/triggers
POST /api/triggers
PATCH /api/triggers/:id/enabled
POST /api/triggers/:id/run
DELETE /api/triggers/:id

GET  /api/work-logs

GET  /api/workflows
GET  /api/workflow/default
POST /api/workflow/validate
POST /api/workflow/version
POST /api/recorder/workflow

POST /api/run/plan
POST /api/run
GET  /api/runs
GET  /api/runs/:runId
```

### 6.3 本地调度器

当前 `serve.ts` 中包含一个 MVP 调度循环：

* 每 30 秒扫描启用的触发器。
* 按分钟判断是否到达计划时间。
* 同一个触发器同一分钟只执行一次。
* 只执行绑定可运行员工的触发器。
* 每次触发前按员工 ID 读取 SQLite 中当前 `activeVersion` 脚本。
* 命中后写入工作日志。

当前调度器先记录“已按计划执行员工脚本”，后续需要接入真实 Runtime Run。

### 6.4 存储

本地 Console/API 使用 SQLite 作为产品主数据，覆盖员工、触发器、工作日志、运行历史和 Workflow 版本。

默认文件：

```text
data/digital-employee.sqlite
```

实现：

```text
packages/storage/src/index.ts
  SqliteEmployeeStore
  SqliteScheduledTriggerStore
```

特点：

* `employees` 保存员工主数据、状态和版本指针；`workflow_versions` 保存完整 workflow 文档。
* `employees.online_version` 指向最后一次发布的 `workflow_versions.id`，`employees.latest_version` 指向最近一次编辑保存但未发布的 `workflow_versions.id`。
* 员工 `version` 从 1 开始；编辑已发布员工会生成下一版草稿，发布后该版本成为 `activeVersion/online_version`。
* `employees.document_json` 只保存轻量员工文档和脚本摘要，不再内嵌完整 workflow/actions。
* `workflow_versions.document_json` 保存完整 workflow、录制动作、来源、员工 ID、员工版本和发布状态。
* 触发器启停、删除、运行日志、运行历史和 Workflow 版本都通过 Store 接口读写 SQLite。
* Store 使用接口隔离，后续可替换为其他本地或远端存储。

## 七、Workflow DSL 示例

平台 DSL 是通用浏览器动作 DSL。下面以通用后台页面示例说明形态：

```yaml
schemaVersion: 1
workflowId: browser-operation-digital-employee
name: Browser Operation Digital Employee

inputs:
  productUrl:
    type: string
    required: false
  productId:
    type: string
    required: false
  mode:
    type: enum
    values: [dry_run, run_once, batch]
    default: dry_run

policy:
  requireApprovalFor:
    - batch
    - final_submit
  maxBatchSize: 100
  maxRetryPerItem: 2

steps:
  - id: open_target_site
    type: browser.open
    url: https://example.com

  - id: ensure_login
    type: browser.verify
    expectation:
      anyTextExists:
        - 工作台
        - 首页

  - id: click_entry
    type: browser.click
    target:
      role: button
      text: 新建

  - id: input_value
    type: browser.input
    target:
      role: textbox
      label: 目标输入框
    value: "{{inputValue}}"

  - id: final_submit
    type: browser.click
    target:
      role: button
      text: 确认
    approvalRequired: true
    skipWhen: "{{mode == 'dry_run'}}"
```

实际菜单、按钮和输入框文案以 Recorder 捕获结果为准。

## 八、关键运行流程

### 8.1 新建员工

```text
点击新建员工
  -> 创建前端临时草稿，不写入 SQLite
  -> 进入员工设计器
  -> 点击保存
  -> POST /api/employees
  -> 生成 p + 四位数字 ID
  -> status=draft, version=1
  -> 写入 SQLite employees.document_json
```

### 8.2 编辑已发布员工

```text
选中员工
  -> 点击编辑
  -> POST /api/employees/:id/edit
  -> 生成 draft v(N+1)
  -> activeVersion 仍指向 published vN
  -> 进入员工设计器
```

### 8.3 发布员工

```text
选中草稿员工
  -> 点击发布
  -> POST /api/employees/:id/publish
  -> draft vN 变为 published vN
  -> activeVersion 切换到 vN
```

### 8.4 创建定时任务

```text
进入触发器页
  -> 点击新建任务
  -> GET /api/employees
  -> 下拉只展示存在 activeVersion 且未停用的员工名称
  -> 服务端再次用同一个员工 Store 校验 employeeId
  -> 保存任务
  -> POST /api/triggers
  -> 写入 SQLite scheduled_triggers.document_json
```

### 8.5 任务到点运行

```text
Local Scheduler Tick
  -> 读取启用触发器
  -> 校验绑定员工仍存在 activeVersion 且未停用
  -> 判断计划时间
  -> 读取 activeVersion 对应员工脚本并运行
  -> 写入工作日志、runId 和运行 summary
```

当前“运行绑定员工脚本”已经接入 App Service / Workflow Engine；真实浏览器运行使用 Playwright，运行失败会以工作日志和运行 Trace 的形式保留诊断信息。

## 九、开发路线

### Phase 1：管理平台骨架

已实现：

* Electron 桌面壳。
* 员工列表。
* 员工设计器。
* 触发器页。
* 工作日志页。
* SQLite 员工、计划任务、工作日志、运行历史和 Workflow 版本存储。

### Phase 2：员工状态机与触发器绑定

已实现：

* 员工 ID：`p` + 四位数字。
* 草稿 / 已发布 / activeVersion 版本状态机。
* 触发器只能选择存在发布版本的员工。
* 任务到点写入工作日志。

### Phase 3：真实浏览器录制

目标：

* 从用户实际浏览器操作录制 Action DSL。
* 生成 Workflow DSL。
* 支持元素库、变量、参数和运行日志。

### Phase 4：真实 Runtime 调度执行

目标：

* 调度器到点后调用真实 Workflow Runtime。
* 工作日志关联 Run、Trace、输入参数和执行结果。
* 支持失败重试、暂停、人工接管。

### Phase 5：通用化员工市场 / 模板

目标：

* 百应员工模板只是一个示例。
* 支持任意浏览器后台模板。
* 支持导入、导出、复制、版本回滚。

## 十、关键风险与策略

### 10.1 登录态与验证码

任意后台都可能出现登录失效、验证码、二次确认或风控。

策略：

* 使用持久化浏览器 profile。
* 登录失效暂停。
* 验证码不自动绕过，交给用户处理。

### 10.2 页面变化

后台页面结构可能变化。

策略：

* DOM First。
* 多 Locator 候选。
* Trace 保存。
* Locator Patch 需要人工确认后生效。

### 10.3 批量误操作

浏览器后台操作可能影响真实业务数据。

策略：

* 默认 dry-run。
* 高风险动作需要审批。
* final submit 前确认。
* batch 前确认。
* 每次运行保留 Trace 和工作日志。

## 十一、当前最小可交付版本

当前 MVP 定义为：

> 用户可以在数字员工调度中心创建和发布浏览器数字员工，为存在发布版本的员工配置定时任务，任务到点后运行对应员工脚本并记录工作日志；同时平台保留百应商品发布流程作为默认示例，用于验证 Browser Runtime、Workflow DSL、Trace 和回放能力。

这不是单一电商 Agent，而是一个通用浏览器数字员工管理平台的执行地基。
