# 数字员工调度中心用户手册

## 1. 启动应用

开发模式推荐使用 Vite 热更新：

```bash
npm run serve -- --dev --port 4174 --user-data-dir browser-profiles/baiying
```

浏览器访问 `http://127.0.0.1:4174`。如需 Electron 客户端样式：

```bash
npm run desktop -- --dev --port 4174 --user-data-dir browser-profiles/baiying
```

真实浏览器运行前，先用同一个 `user-data-dir` 登录目标网站。

## 2. 新建员工

1. 进入“员工”页。
2. 点击“新建员工”。
3. 进入员工设计器后，点击标题旁的铅笔图标，可直接在标题区域内编辑员工名称。
4. 点击“保存”，系统才会创建员工 ID，例如 `p0003`，并保存为草稿 v1。

未点击“保存”的新建员工不会写入数据库。

## 3. 录制操作脚本

1. 在员工设计器中点击“录制脚本”。
2. 在“录制目标地址”输入目标页面，例如 `https://news.baidu.com/`。
3. 点击“打开内置浏览器”。
4. 在内置浏览器里按正常人工流程操作页面。

当前录制会记录：

* 打开页面：`open`
* 点击按钮/链接：`click`
* 输入文字：`input`
* 回车、Tab、Esc：`press`
* 等待：`wait`

如需保存页面数据，点击“插入抽取模板”，再在“录制动作 JSON”中调整 `extract.selector` 和字段选择器。

## 4. 百度新闻测试示例

推荐录制流程：

1. 打开 `https://news.baidu.com/`。
2. 在搜索框输入关键词，例如“人工智能”。
3. 按 Enter。
4. 等待结果页加载。
5. 插入文章抽取模板，抽取前 5 条文章。
6. 对前 5 条结果逐一点击打开，滚动到页面底部。
7. 插入评论抽取模板，调整评论区选择器。

目标保存两个实体：

* `articles`：`articleId`、`articleUrl`、`articleName`、`articleSummary`、`publishedAt`
* `comments`：`articleId`、`commenterId`、`commenterName`、`commentId`、`content`、`commentTime`、`region`

说明：不同新闻来源的评论区 DOM 结构不一致，`extract` 的 CSS selector 需要按实际页面微调。若目标页面没有评论区或需要登录，运行结果会在 Trace 中保留失败原因。

## 5. 保存和发布

1. 确认“录制动作 JSON”无误。
2. 点击“保存为员工工作流”。
3. 该脚本会保存到当前员工的草稿版本。
4. 返回员工列表，选中该员工。
5. 点击“发布”，草稿版本变为已发布版本。

只有已发布员工才能被运行或被触发器选择。

## 6. 运行脚本

手动运行：

1. 在员工列表选中员工。
2. 点击“运行”。
3. 系统调用 Workflow Runtime 执行员工脚本。
4. 运行结束后跳转到“工作日志”。

定时运行：

1. 进入“触发器”页。
2. 点击“新建任务”。
3. 填写任务名称。
4. 从“员工名称”下拉框选择已发布员工。
5. 配置频率和触发时间。
6. 点击“确定”保存。

触发器到点后会读取该员工当前 `activeVersion` 对应脚本运行。

## 7. 查看结果

运行结果保存到 SQLite 的 `runs` 和 `work_logs`：

* 工作日志：查看任务名称、运行时间、参数、执行结果、`runId`。
* 运行历史：查看每次运行 summary。
* Trace JSON：查看每一步动作、页面快照、抽取结果和失败诊断。
* Export CSV：导出行级运行结果。

抽取实体会出现在对应 `extract` 步骤的 `step.succeeded.data.rows` 中。
