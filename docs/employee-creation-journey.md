# 员工创建用户旅程草案

本文档记录“通过自然语言定义流程，并由 LLM 辅助生成浏览器 DOM 操作流程”的员工创建方案。后续讨论可以基于本文继续迭代。

## 1. 产品判断

员工创建页不应设计成传统流程图编辑器，也不应设计成纯聊天式“说一句就直接生产运行”。更合适的形态是：

> 自然语言定义目标 + 浏览器示范/录制主路径 + 标注灵活策略节点 + LLM 编译成可审计 DOM Workflow + 小样本试跑 + 发布版本。

LLM 主要参与创建、补全、解释和修复；正式运行应尽量走确定性的 Workflow DSL、DOM locator、policy、trace 和版本机制。

这与当前平台定位一致：面向任意 Web 后台和浏览器操作流程的 Browser Operating Runtime，而不是单一站点自动化工具。

核心设计原则：

- 先录制稳定主路径，再把不稳定、不确定、需要判断的地方标成策略节点。
- LLM/Stagehand 这类能力是设计器助理和节点策略解释器，不是流程引擎本身。
- 策略节点必须有输入、页面范围、允许动作、禁止动作、成功标准、失败行为和证据留存。

## 2. 竞品和参考方向

### Stagehand / Browserbase

Stagehand 接近“代码 + 自然语言混合控制浏览器”的技术方向。它说明自然语言适合辅助寻找页面元素、生成动作和处理动态页面，但产品层仍需要结构化步骤和可回放执行。

参考：https://docs.stagehand.dev/v3/first-steps/introduction

### Browser Use

Browser Use 偏向“给 AI 一个任务，让它自主操作浏览器”。这种模式适合探索、采集和一次性任务，但企业流程复用时会面临稳定性、审计、成本和权限问题。

参考：https://browser-use.com/

### Skyvern

Skyvern 与本项目方向较近，强调 AI 浏览器自动化、表单填写、数据抽取、SOP 转 workflow、录制浏览器操作等能力。它的启发是：员工创建页可以把自然语言说明、SOP、录制、截图和结构化 JSON 都作为流程输入来源。

参考：https://www.skyvern.com/

### Axiom.ai / Browserflow / Automa / Ui.Vision

这些产品更接近 no-code browser automation 和传统浏览器 RPA。它们说明流程编辑需要可视化、可回放、可调试，不能只有 JSON。

参考：

- https://axiom.ai/
- https://browserflow.app/
- https://github.com/AutomaApp/automa
- https://ui.vision/

### UiPath Autopilot / OpenAI Operator / Amazon Nova Act / Microsoft Browser Automation

这些产品证明“自然语言驱动浏览器任务”是明确趋势。但企业级后台流程需要更强的版本、权限、审批、定时、审计和失败恢复能力。

参考：

- https://docs.uipath.com/autopilot/other/latest/user-guide/about-autopilot
- https://openai.com/index/introducing-operator/
- https://labs.amazon.science/blog/nova-act
- https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/browser-automation

## 3. 节点模型

员工流程节点分三层：

### 3.1 Primitive Action

确定性 DOM 操作节点，用于表达录制和回放中的基础浏览器动作。

典型节点：

- `browser.open`：打开页面。
- `browser.click`：点击按钮、链接、菜单项。
- `browser.input`：输入字段值。
- `browser.press`：按 Enter、Tab、Escape 等键盘键。
- `browser.wait`：等待页面或短暂延迟。
- `browser.verify`：校验页面状态。
- `browser.extract`：按规则抽取页面数据。

### 3.2 Control / Data Flow

流程控制和数据流节点，用于表达循环、条件、重试、审批和参数映射。它们不直接代表某一次 DOM 点击，而是控制普通节点和策略节点如何运行。

建议节点：

- `flow.if`：根据变量、页面状态或上一步结果分支。
- `flow.loop`：对 CSV 行、页面列表或抽取结果循环。
- `flow.map`：把输入数据映射成节点参数。
- `flow.retry`：配置失败重试策略。
- `flow.approval`：插入人工审批或确认点。

### 3.3 Strategy Node

自然语言策略节点，用于处理页面和业务规则中的不确定性。策略节点不是“让 AI 随便操作浏览器”，而是受边界约束的智能判断单元。

MVP 优先支持四类：

- `strategy.decide`：判断当前页面属于成功、失败、需登录、需验证码、无结果、网络异常等状态。
- `strategy.select`：从列表、搜索结果或表格中选择符合条件的一项或多项。
- `strategy.extract`：在 DOM 结构不稳定时，用自然语言描述要抽取的字段和证据。
- `strategy.recover`：普通 locator 或校验失败时，尝试找到替代元素、给出修复建议或暂停人工处理。

策略节点应包含：

- 策略名称。
- 自然语言目标。
- 输入变量，例如 `productName`、`maxPrice`。
- 页面范围，例如搜索结果区域、当前弹窗、指定表格。
- 允许动作，例如读取页面文本、点击一条结果、填写字段。
- 禁止动作，例如付款、删除、发消息、提交未确认表单。
- 成功标准。
- 失败行为，例如重试、跳过、暂停人工、终止。
- 证据要求，例如页面文本、候选项、选择理由、截图/DOM 快照。

示例：

```json
{
  "id": "select_product_result",
  "type": "strategy.select",
  "name": "选择要添加的商品",
  "strategy": {
    "goal": "从搜索结果中选择最符合条件的一项",
    "inputs": ["productName", "maxPrice"],
    "pageScope": "search_results",
    "allowedActions": ["read", "click"],
    "deniedActions": ["submit_payment", "delete", "send_message"],
    "successCriteria": "点击的商品标题包含 productName，且价格 <= maxPrice",
    "failureBehavior": "record_and_continue",
    "evidenceRequired": true
  }
}
```

## 4. 建议的员工创建旅程

入口名称建议使用“新建员工”，不要叫“新建脚本”。用户心智应是“我要创建一个数字员工完成某件事”。

### 4.1 定义工作

第一屏让用户描述员工要做什么：

- 员工名称，例如“百应商品上架助手”。
- 工作目标，例如“每天读取商品表，把符合条件的商品添加到抖音百应橱窗”。
- 目标网站或后台地址。
- 运行方式：手动、定时、API 触发。
- 数据来源：CSV、表格、手动输入、页面现有数据。

这一屏的目标不是生成最终流程，而是让 LLM 帮用户拆出主任务、输入、输出和风险点。

### 4.2 录制主路径

当前版本提供两个入口：

- 我来操作一遍：录制浏览器动作，适合作为 MVP 默认路径。
- 导入 SOP / JSON：用于后续承接文档化流程或已有 Workflow。

MVP 默认推荐“我来操作一遍”，因为当前 recorder、Workflow DSL、trace 和 runtime 已经围绕这个方向成型。

员工设计器建议采用工作台布局：

- 左侧：员工任务大纲，展示 LLM 生成或用户确认的步骤。
- 中间：真实浏览器 webview。
- 右侧：已捕获动作列表和参数面板。
- 底部：录制状态、撤销、暂停、保存草稿、试跑。

用户操作时，每一步应展示为语义动作，而不是只展示底层 selector。例如：

- 打开“商品管理”页面。
- 点击“添加商品”。
- 在“商品链接”输入 `${productUrl}`。
- 点击“确认添加”。
- 校验页面出现“添加成功”。

### 4.3 标注灵活节点

录制完成后，用户可以在动作列表中把某些节点标注为“智能策略节点”。适合标注的情况包括：

- 页面上可能出现多个候选结果，需要按业务规则选择。
- 页面状态不确定，需要判断成功、失败、登录、验证码、风控。
- DOM 结构不稳定，但用户能用自然语言描述想抽取的数据。
- 某个 locator 失败时，希望系统尝试恢复或给出修复建议。

策略编辑面板不要求用户写代码，而是填写结构化约束：

```text
策略名称：选择要添加的商品
策略目标：从搜索结果中选择最符合条件的一项
判断依据：
- 商品标题应包含输入表里的 productName
- 价格不能高于 maxPrice
- 优先选择销量最高的
- 如果没有合适结果，记录失败并跳过

允许操作：
- 读取页面文本
- 点击一条搜索结果
- 记录失败原因

禁止操作：
- 不允许点击付款
- 不允许删除商品
- 不允许提交没有确认过的表单
```

### 4.4 配置策略边界

发布前需要有“运行配置”和“策略边界”确认页。LLM 在这里主要做四件事：

- 合并无意义动作，例如多余点击、等待、误输入。
- 把固定文本识别成参数，例如商品链接、商品名称、价格区间。
- 补上校验节点，例如成功提示、列表出现新商品、错误提示抽取。
- 把用户标注的灵活节点转换成受 policy 约束的 `strategy.*` 节点。

整理后的输出应是可读流程，同时可映射到底层 Workflow DSL。

示例：

```text
1. 打开目标后台
2. 进入商品橱窗页面
3. 对每一行商品执行：
   - 输入商品链接
   - 点击添加
   - 等待结果
   - 抽取成功/失败原因
4. 生成运行报告
```

- 输入参数：CSV 字段映射、默认值、必填校验。
- 输出结果：成功数、失败原因、截图、trace。
- 风险动作：提交、删除、付款、发消息等动作需要人工审批。
- 登录态要求：使用哪个浏览器 profile。
- 策略权限：每个策略节点可读、可点、可填、可提交的动作范围。
- 失败行为：策略失败时跳过、重试、暂停人工或终止。

这一步是平台区别于普通 AI browser agent 的关键：企业用户需要知道这个员工会操作哪些页面、提交什么内容、失败后留下什么证据。

### 4.5 试跑验证

发布前应使用 1 条样例数据试跑。试跑结果页展示：

- CSV / JSON / XLSX、手动参数或页面抽取结果等运行输入。
- 字段映射草稿，例如 `productName`、`productUrl`、`maxPrice`、`groupName`，并标注必填、默认值和示例值。
- 每个节点是否成功。
- 当前页面截图或 DOM 证据。
- 失败节点原因。
- LLM 修复建议，例如“按钮文案从 添加商品 变为 加入橱窗，是否更新 locator？”
- 策略节点证据，例如候选项、判断理由、最终选择、被禁止的动作。

### 4.6 发布运行

保存后生成草稿版本，例如草稿 v1。试跑通过后允许发布。发布后才允许：

- 手动运行。
- 被触发器选择。
- 定时执行。
- 生成工作日志。

## 5. 页面结构建议

员工创建可以设计成 6 个阶段：

```text
新建员工
  1. 定义工作
  2. 录制主路径
  3. 标注灵活节点
  4. 配置策略边界
  5. 试跑验证
  6. 发布运行
```

视觉上建议使用顶部轻量步骤条 + 中间工作台，而不是笨重的表单向导。核心页面是员工设计器。

## 6. 推荐产品表达

可以将创建页核心价值表达为：

> 用一句话说明工作，用一次浏览器示范教会员工，把不确定的地方标成智能策略，用可审计流程稳定运行。

真正的产品壁垒不只是 LLM 会操作 DOM，而是录制、DSL、locator evidence、policy、版本、触发器、工作日志和失败恢复能力组合形成的企业可用 Browser Runtime。
