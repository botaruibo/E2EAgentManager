import type { RunConsoleView } from "../../../packages/app-service/src/index.js";
import { sharedComponentStyles } from "./shared-ui-styles.js";

export function renderInteractiveConsole(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>数字员工调度中心</title>
  <style>${styles()}</style>
</head>
<body>
  <div class="client-frame">
    <header class="app-topnav">
      <div class="brand">
        <div class="brand-mark">数</div>
        <strong>数字员工调度中心</strong>
      </div>
      <nav class="primary-tabs">
        <button class="top-tab active" data-view="employees">员工</button>
        <button class="top-tab" data-view="triggers">定时任务</button>
      </nav>
      <div class="account-chip">b</div>
      <span id="runtime-label" class="runtime-chip">Local Fake Runtime</span>
    </header>
    <div class="app-shell">
      <aside class="sidebar">
          <button id="new-employee" class="create-button">＋ 新建员工</button>
        <div class="side-group" data-side-group="employees">
          <span class="side-title">我的员工</span>
          <button class="side-item selected" data-view="employees"><span>▦ 我创建的员工</span><em id="employee-count">0</em></button>
          <button class="side-item" data-view="trash"><span>♲ 回收站</span><em id="trash-count">0</em></button>
        </div>
        <div class="side-group hidden" data-side-group="triggers">
          <button class="side-item selected" data-view="triggers"><span>◴ 定时任务</span><em id="trigger-count">0</em></button>
          <button class="side-item" data-view="work-logs"><span>▤ 工作日志</span><em id="work-log-count">0</em></button>
        </div>
        <div class="sidebar-foot">本地运行 · 仅用于个人非商业用途</div>
      </aside>
      <main>
        <section class="app-view active" data-panel="employees">
          <section class="home-card">
            <div class="list-toolbar">
              <h1>我创建的员工</h1>
              <div id="employee-actions" class="toolbar-actions hidden">
                <button class="icon-action" id="employee-run">▷ 运行</button>
                <button class="icon-action" id="employee-edit">✎ 编辑</button>
                <button class="icon-action danger-action" id="employee-delete">× 删除</button>
              </div>
              <label class="search-box">⌕ <input id="employee-search" placeholder="搜索员工"></label>
            </div>
            <table class="employee-table">
              <thead><tr><th>员工名称</th><th>更新时间</th><th>状态</th></tr></thead>
              <tbody id="employee-rows"></tbody>
            </table>
          </section>
        </section>

        <section class="app-view" data-panel="trash">
          <section class="home-card">
            <div class="list-toolbar">
              <h1>回收站</h1>
            </div>
            <div id="trash-empty" class="empty-inline compact">
              <div class="empty-robot">♲</div>
              <h1>没有停用的员工</h1>
              <p>删除后的员工会变为停用状态，并显示在这里。</p>
            </div>
            <table id="trash-table" class="employee-table hidden">
              <thead><tr><th>员工名称</th><th>停用时间</th><th>状态</th></tr></thead>
              <tbody id="trash-rows"></tbody>
            </table>
          </section>
        </section>

        <section class="app-view" data-panel="triggers">
          <section class="trigger-list-card">
            <div class="trigger-page-toolbar">
              <h1>定时任务</h1>
              <div id="trigger-actions" class="toolbar-actions trigger-actions hidden">
                <button id="bulk-enable" class="icon-action muted-action">✓ 启用</button>
                <button id="bulk-disable" class="icon-action muted-action">⊘ 禁用</button>
                <button id="trigger-edit" class="icon-action muted-action">✎ 编辑</button>
              </div>
              <label class="search-box">⌕ <input id="trigger-search" placeholder="输入名称搜索"></label>
            </div>
            <div id="trigger-empty" class="empty-inline">
              <div class="empty-robot">⏱</div>
              <h1>暂无定时任务</h1>
              <p>点击左侧“新建任务”创建定时任务，让数字员工按计划运行。</p>
            </div>
            <div id="trigger-table-wrap" class="hidden">
              <table class="trigger-table">
                <thead><tr><th>名称</th><th>类型</th><th>员工名称</th><th>条件</th><th>启用</th></tr></thead>
                <tbody id="trigger-rows"></tbody>
              </table>
            </div>
            <div id="trigger-plan-popover" class="trigger-popover hidden"></div>
          </section>
        </section>

        <section class="app-view" data-panel="work-logs">
          <section class="trigger-list-card">
            <div class="trigger-page-toolbar">
              <h1>工作日志</h1>
              <div class="toolbar-actions trigger-actions">
                <button id="refresh-work-logs" class="icon-action">刷新</button>
              </div>
            </div>
            <div id="work-log-list" class="work-log-list"></div>
          </section>
        </section>

        ${designerJourneyMarkup()}
      </main>
    </div>
    <div id="trigger-modal" class="modal-backdrop hidden">
      <section class="trigger-modal-card" role="dialog" aria-modal="true" aria-labelledby="trigger-modal-title">
        <header>
          <div class="modal-icon">⏱</div>
          <div>
            <h1 id="trigger-modal-title">定时触发器</h1>
            <p>在特定时间运行指定的员工</p>
          </div>
          <button id="close-trigger-modal" class="modal-close">×</button>
        </header>
        <div class="trigger-modal-body">
          <label class="form-row"><span>任务名称:</span><input id="trigger-name" value="定时上新品"></label>
          <label class="form-row"><span>员工名称:</span><select id="trigger-employee"></select></label>
          <div class="form-row"><span>频率:</span>
            <div class="radio-line" id="trigger-frequency">
              <label><input type="radio" name="trigger-frequency" value="minute"> 每分</label>
              <label><input type="radio" name="trigger-frequency" value="hour"> 每时</label>
              <label><input type="radio" name="trigger-frequency" value="day" checked> 每天</label>
              <label><input type="radio" name="trigger-frequency" value="week"> 每周</label>
              <label><input type="radio" name="trigger-frequency" value="month"> 月份</label>
              <label><input type="radio" name="trigger-frequency" value="advanced"> 高级</label>
            </div>
          </div>
          <label class="form-row compact-row"><span></span><strong>触发时间:</strong><input id="trigger-time" type="time" value="09:00"></label>
          <p id="trigger-summary" class="schedule-summary">⏱ 每天的 09 时 00 分执行 <button class="link-button">详情</button></p>
          <label class="check-row"><input id="trigger-end-enabled" type="checkbox"> 定时结束 <span>ⓘ</span></label>
          <button id="trigger-more-toggle" class="ui-collapsible-toggle more-row" type="button">更多 <span class="ui-collapsible-chevron" aria-hidden="true"></span></button>
          <div id="trigger-more-options" class="more-options hidden">
            <label class="check-row"><input id="trigger-calendar-enabled" type="checkbox"> 按指定日历触发 <span>ⓘ</span></label>
            <label class="check-row"><input id="trigger-queue-enabled" type="checkbox"> 排队执行 <span>ⓘ</span></label>
            <label class="timeout-row">运行超过 <input id="trigger-timeout" type="number" min="0" value="0"> 分钟后强制结束</label>
          </div>
          <p id="trigger-form-error" class="form-error"></p>
        </div>
        <footer>
          <label class="enable-check"><input id="trigger-enabled" type="checkbox" checked> 启用</label>
          <div>
            <button id="save-trigger" class="confirm-button">确定</button>
            <button id="cancel-trigger" class="cancel-button">取消</button>
          </div>
        </footer>
      </section>
    </div>
  </div>
  <script>${clientScript()}</script>
</body>
</html>`;
}

export function viewToJson(view: RunConsoleView): string {
  return JSON.stringify(view);
}

function designerJourneyMarkup(): string {
  return `
        <section class="app-view designer-view" data-panel="designer">
          <div class="designer-shell journey-shell">
            <section class="journey-header">
              <div class="journey-title-group">
                <button id="back-employees" class="back-button">‹</button>
                <div>
                  <h1><span id="designer-employee-name">新建员工</span><button id="rename-employee" class="link-button" title="修改员工名称">✎</button></h1>
                  <p><span id="designer-employee-id" class="employee-id-label">未保存</span></p>
                </div>
              </div>
              <div class="journey-actions">
                <div class="journey-primary-actions">
                  <button id="save-employee" class="tool-button">▣ 保存</button>
                  <button id="run" class="tool-button run-tool">▶ 试跑</button>
                  <button id="publish-employee" class="tool-button publish-tool">✈ 发布</button>
                </div>
              </div>
              <div class="hidden" aria-hidden="true">
                <button id="record-script" class="tool-button selected" type="button">▣ 录制脚本</button>
                <button id="open-login" class="tool-button" type="button">◉ 浏览器</button>
              </div>
            </section>

            <div class="journey-grid">
              <aside class="command-panel journey-nav-panel">
                <div class="command-title">创建流程</div>
                <div class="journey-stepper" aria-label="员工创建步骤">
                  <button class="journey-step active" data-journey-step="define"><em>1</em><span>定义工作</span><small>目标、网站、运行方式</small></button>
                  <button class="journey-step" data-journey-step="record"><em>2</em><span>录制主路径</span><small>浏览器示范操作</small></button>
                  <button class="journey-step" data-journey-step="strategy"><em>3</em><span>标注灵活节点</span><small>四类智能策略</small></button>
                  <button class="journey-step" data-journey-step="test"><em>4</em><span>试跑验证</span><small>运行和 Trace</small></button>
                </div>
              </aside>

              <section class="journey-workspace">
                <section class="journey-panel journey-define-panel active" data-journey-panel="define">
                  <div class="journey-panel-title">
                    <h2>定义工作</h2>
                    <span>先让平台理解这个员工要完成什么，而不是先写脚本。</span>
                  </div>
                  <div class="journey-form-grid">
                    <label class="define-target-field">目标网站<input id="journey-target-url" value="https://example.com/admin"></label>
                    <label class="span-2">工作目标<textarea id="journey-goal" spellcheck="false">执行「浏览器操作流程」工作流。</textarea></label>
                    <label>运行方式<select id="journey-run-mode"><option>手动运行</option><option>定时运行</option><option>API 触发</option></select></label>
                    <label>数据来源<select id="journey-data-source"><option>CSV / JSON / XLSX</option><option>手动输入参数</option><option>页面现有数据</option><option>页面抽取结果</option></select></label>
                  </div>
                </section>

                <section class="journey-panel" data-journey-panel="record">
                  <div class="journey-panel-title">
                    <h2>录制主路径</h2>
                    <span>主流程列表是主体。录制、导入和节点详情只作为右侧上下文能力。</span>
                  </div>
                  <div class="recording-layout">
                    <div class="main-flow-panel">
                      <div class="panel-title">
                        <h2>主任务流程</h2>
                        <span>录制后实时生成，可继续整理节点</span>
                      </div>
                      <ul class="flow-node-list compact" id="recorded-task-list"></ul>
                    </div>
                    <aside class="recording-context-panel">
                      <section class="context-card">
                        <div class="panel-title compact-title"><h2>录制与导入</h2><span>当前页面只同步节点</span></div>
                        <div class="recorder-toolbar">
                          <input id="recorder-url" value="https://example.com/admin" aria-label="录制目标地址">
                          <button id="recorder-open-page" class="secondary primary-secondary" type="button">打开独立录制窗口</button>
                          <button id="recorder-clear" class="secondary" type="button">清空记录</button>
                        </div>
                        <div class="recorder-mode-note">
                          <strong>录制方式</strong><span>在独立窗口完成真实网页操作，当前页只负责同步主流程节点。</span>
                        </div>
                        <button id="recorder-add-extract" class="secondary wide-secondary" type="button">导入 SOP / JSON / 插入抽取模板</button>
                      </section>
                      <section class="context-card">
                        <div class="panel-title compact-title"><h2>节点详情</h2><span>选中节点后编辑</span></div>
                        <div id="record-node-detail" class="node-detail-summary">
                          <strong>当前节点</strong>
                          <span>从左侧主流程中选择节点后查看定位证据、成功条件和失败处理。</span>
                        </div>
                      </section>
                      <ol id="recorder-events" class="hidden" aria-hidden="true"></ol>
                    </aside>
                  </div>
                </section>

                <section class="journey-panel" data-journey-panel="strategy">
                  <div class="journey-panel-title">
                    <h2>标注灵活节点</h2>
                    <span>把不稳定、不确定、需要判断的地方标成受约束的策略节点。</span>
                  </div>
                  <div class="recording-actions-editor strategy-layout">
                    <section class="visual-node-panel">
                      <div class="panel-title compact-title"><h2>主任务流程</h2><span>选中节点后，智能节点插入到其前方</span></div>
                      <ol id="recording-node-list" class="flow-node-list compact"></ol>
                    </section>
                    <section class="strategy-side-panel">
                      <div class="context-card">
                        <div class="panel-title compact-title"><h2>智能节点配置</h2><span>插入到选中节点之前</span></div>
                        <div class="strategy-catalog">
                          <button type="button" class="strategy-chip" data-strategy-kind="decide">智能判断</button>
                          <button type="button" class="strategy-chip selected" data-strategy-kind="select">智能选择</button>
                          <button type="button" class="strategy-chip" data-strategy-kind="extract">智能抽取</button>
                          <button type="button" class="strategy-chip" data-strategy-kind="recover">异常恢复</button>
                        </div>
                        <div class="strategy-editor">
                          <label>策略名称<input id="strategy-name" value="选择要添加的商品"></label>
                          <label>策略目标<textarea id="strategy-goal" spellcheck="false">从搜索结果中选择最符合条件的一项。</textarea></label>
                          <label>安全约束<select id="strategy-safety"><option>使用系统默认策略，可在高级设置中调整</option></select></label>
                          <label class="hidden" aria-hidden="true">判断依据<textarea id="strategy-rules" spellcheck="false">商品标题应包含输入表里的 title；优先选择销量最高；没有合适结果时记录失败并跳过。</textarea></label>
                          <div class="strategy-actions-row">
                            <button type="button" class="secondary primary-secondary" id="insert-strategy-node">插入智能节点</button>
                          </div>
                        </div>
                      </div>
                      <details class="json-node-panel">
                        <summary>原始 JSON 数组</summary>
                        <textarea id="recording-actions" spellcheck="false">${escapeHtml(sampleRecordedActionsJson())}</textarea>
                      </details>
                    </section>
                  </div>
                </section>

                <section class="journey-panel" data-journey-panel="test">
                  <div class="journey-panel-title">
                    <h2>试跑验证</h2>
                    <span>发布前以当前录制脚本预览运行计划，必要时再补充输入样例。</span>
                  </div>
                  <div class="test-grid">
                    <section class="test-main">
                      <section class="panel config trial-controls-panel">
                        <div class="trial-control-row">
                          <button id="run-test-panel" class="run-panel-button" type="button">开始试跑</button>
                          <div class="trial-mode-control">
                            <div class="segments" id="mode" role="radiogroup" aria-label="运行模式">
                              <button data-mode="dry_run" class="selected" role="radio" aria-checked="true">安全试跑(dry_run)</button>
                              <button data-mode="run_once" role="radio" aria-checked="false">真实运行一条</button>
                              <button data-mode="batch" role="radio" aria-checked="false">批量运行</button>
                            </div>
                          </div>
                        </div>
                        <div id="run-view-panel" class="run-view-panel hidden">
                          <div class="run-view-copy">
                            <strong>运行一次方式</strong>
                            <span>调试默认可视模式；后台或无需观察时再切静默。</span>
                          </div>
                          <div class="run-view-segments" id="run-view-mode" role="radiogroup" aria-label="运行一次方式">
                            <button data-run-view-mode="visible" class="selected" role="radio" aria-checked="true">可视模式<span>打开浏览器并放慢动作</span></button>
                            <button data-run-view-mode="silent" role="radio" aria-checked="false">静默模式<span>后台执行，不打开窗口</span></button>
                          </div>
                        </div>
                        <details class="ui-collapsible-panel advanced-debug-panel">
                          <summary class="ui-collapsible-summary">高级调试设置</summary>
                          <div class="advanced-debug-grid">
                            <label>运行环境<select id="browser"><option value="fake">系统默认</option><option value="playwright">Playwright Runtime</option></select><span id="runtime-mode-hint" class="field-hint">真实运行一条会自动使用 Playwright。</span></label>
                            <label for="row-ids">仅运行指定数据<input id="row-ids" placeholder="可选，逗号分隔，例如 row-3,row-8"></label>
                          </div>
                        </details>
                        <div class="hidden" aria-hidden="true">
                          <div id="test-context" class="test-context">当前验证对象：未选择员工。</div>
                          <label for="csv">输入 CSV / JSON / XLSX（可选）</label>
                          <input id="input-file" type="file" accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                          <p id="input-file-status">可以粘贴输入数据，也可以导入 CSV、JSON 或 XLSX 文件。</p>
                          <textarea id="csv" spellcheck="false"></textarea>
                          <button id="preview-input" class="secondary">预览输入</button>
                          <div id="input-preview" class="input-preview">暂无输入预览。</div>
                          <button id="preview-plan" class="secondary">预览运行计划</button>
                          <div id="run-plan" class="input-preview">暂无运行计划。</div>
                          <label for="start-step">从步骤恢复</label>
                          <input id="start-step" placeholder="可选步骤 ID，例如 click_add_product">
                          <div class="toggles">
                            <span>授权最终提交</span>
                            <label class="check"><input id="approve-final" type="checkbox"> final_submit</label>
                            <span>授权批量运行</span>
                            <label class="check"><input id="approve-batch" type="checkbox"> batch</label>
                          </div>
                        </div>
                        <p id="error"></p>
                      </section>
                      <section class="panel test-flow-panel">
                        <div class="panel-title">
                          <h2>主任务流程运行状态</h2>
                          <span>以当前保存或录制的主流程为准</span>
                        </div>
                        <ol id="test-flow-list" class="flow-node-list test-flow-list"></ol>
                      </section>
                      <section class="panel trace">
                        <div class="panel-title"><h2>Trace Preview</h2><span id="trace-status">等待中</span></div>
                        <h3 id="trace-title">未选择运行记录</h3>
                        <ol id="timeline"></ol>
                      </section>
                      <section class="panel results">
                        <div class="panel-title">
                          <h2>运行结果</h2>
                          <span class="run-result-summary">
                            <span>状态 <strong id="status">暂无记录</strong></span>
                            <span>运行次数 <strong id="total">0</strong></span>
                            <span>成功 <strong id="success">0</strong></span>
                            <span>失败 <strong id="failed">0</strong></span>
                            <span>审批 <strong id="approval">0</strong></span>
                            <span id="run-id">暂无运行</span>
                            <button id="view-trace" class="link-button" title="打开选中运行记录的可读 Trace 页面" disabled>查看 Trace</button>
                            <button id="export-trace" class="link-button" title="打开选中运行记录的原始 Trace JSON 查看页，可返回试跑验证" disabled>Trace JSON</button>
                            <button id="export-results" class="link-button" disabled>导出 CSV</button>
                            <button id="clear-employee-runs" class="link-button danger" type="button">清除</button>
                          </span>
                        </div>
                        <table>
                          <thead><tr><th>#</th><th>员工</th><th>运行记录</th><th>状态</th><th>运行次数</th><th>成功</th><th>失败</th><th>审批</th><th>模式</th><th>开始时间</th></tr></thead>
                          <tbody id="rows"></tbody>
                        </table>
                      </section>
                    </section>
                  </div>
                </section>

                <section id="recorder-modal" class="recorder-modal hidden" aria-label="独立录制窗口">
                  <div class="recorder-modal-card">
                    <header>
                      <div>
                        <h2>独立录制窗口</h2>
                        <p>在这里完成真实网页操作，动作会同步到主任务流程。</p>
                      </div>
                      <button id="close-recorder-modal" class="secondary" type="button">关闭</button>
                    </header>
                    <webview id="recorder-webview" class="recorder-webview hidden" partition="persist:digital-employee-recorder" allowpopups></webview>
                    <iframe id="recorder-frame" class="hidden" title="数字员工浏览器" sandbox="allow-scripts allow-forms"></iframe>
                  </div>
                </section>

                <div class="hidden" aria-hidden="true">
                  <section class="panel profile embedded-panel">
                    <div class="panel-title">
                      <h2>Local Doctor</h2>
                      <span><button id="refresh-profile" class="link-button">Run Doctor</button></span>
                    </div>
                    <div id="profile-status" class="profile-status">Loading local readiness...</div>
                  </section>
                  <input id="recording-name" value="浏览器操作流程">
                  <button id="save-recording" type="button"></button>
                  <p id="recording-result"></p>
                  <button id="refresh-runs" type="button"></button>
                  <div id="recent-runs"></div>
                  <button id="view-default-workflow" type="button"></button>
                  <button id="validate-workflow" type="button"></button>
                  <button id="save-workflow-version" type="button"></button>
                  <button id="download-default-workflow" type="button"></button>
                  <textarea id="workflow-preview" class="collapsed" spellcheck="false"></textarea>
                  <p id="workflow-save-result"></p>
                  <input id="patch-step" value="click_add_product">
                  <textarea id="patch-target" spellcheck="false">{"role":"button","text":"添加商品"}</textarea>
                  <button id="patch" type="button"></button>
                  <p id="patch-result"></p>
                  <button id="refresh-workflows" type="button"></button>
                  <strong id="selected-workflow">Default workflow</strong>
                  <button id="load-selected-workflow" type="button"></button>
                  <button id="use-default-workflow" type="button"></button>
                  <div id="workflow-versions"></div>
                </div>
              </section>
            </div>
          </div>
        </section>`;
}

function sampleRecordedActionsJson(): string {
  return JSON.stringify(
    [
      {
        type: "open",
        intent: "open_news_home",
        url: "https://news.baidu.com/"
      },
      {
        type: "input",
        intent: "input_keyword",
        target: {
          role: "textbox",
          label: "关键词"
        },
        value: "人工智能"
      },
      {
        type: "press",
        intent: "press_enter_search",
        target: {
          role: "textbox",
          label: "关键词"
        },
        key: "Enter"
      },
      {
        type: "wait",
        intent: "wait_search_results",
        timeoutMs: 1500
      },
      {
        type: "extract",
        intent: "extract_article_list",
        extract: {
          entity: "articles",
          selector: ".result, .news-item, article",
          limit: 5,
          fields: {
            articleId: { selector: "a", attr: "href" },
            articleUrl: { selector: "a", attr: "href" },
            articleName: { selector: "a", text: true },
            articleSummary: { selector: "p, .summary", text: true },
            publishedAt: { selector: "time, .time, .date", text: true }
          }
        }
      }
    ],
    null,
    2
  );
}

function clientScript(): string {
  return `
    const NEW_EMPLOYEE_ID = '__new_employee__';
    const journeySteps = ['define', 'record', 'strategy', 'test'];
    const state = { mode: 'dry_run', runViewMode: 'visible', runId: null, runSummaries: [], currentRunView: null, currentTraceRow: null, selectedTestFlowIndex: null, workflowVersionId: null, workflowSteps: [], recorderSourceVersionId: null, recorderDirty: false, inputBytes: null, inputFileName: null, currentView: 'employees', currentJourneyStep: 'define', triggers: [], selectedTriggerId: null, editingTriggerId: null, employees: [], selectedEmployeeId: null, pendingEmployee: null, employeeSearch: '', recorderActions: [], recentRecorderActionSignatures: {}, selectedRecorderActionIndex: null, selectedStrategyKind: 'select' };
    const modeEl = document.getElementById('mode');
    const runViewModeEl = document.getElementById('run-view-mode');
    const runViewPanelEl = document.getElementById('run-view-panel');
    const runEl = document.getElementById('run');
    const errorEl = document.getElementById('error');
    const inputFileEl = document.getElementById('input-file');
    const inputFileStatusEl = document.getElementById('input-file-status');
    const previewInputEl = document.getElementById('preview-input');
    const inputPreviewEl = document.getElementById('input-preview');
    const previewPlanEl = document.getElementById('preview-plan');
    const runPlanEl = document.getElementById('run-plan');
    const runTestPanelEl = document.getElementById('run-test-panel');
    const browserEl = document.getElementById('browser');
    const runtimeModeHintEl = document.getElementById('runtime-mode-hint');
    const recentRunsEl = document.getElementById('recent-runs');
    const refreshRunsEl = document.getElementById('refresh-runs');
    const exportResultsEl = document.getElementById('export-results');
    const exportTraceEl = document.getElementById('export-trace');
    const viewTraceEl = document.getElementById('view-trace');
    const clearEmployeeRunsEl = document.getElementById('clear-employee-runs');
    const patchEl = document.getElementById('patch');
    const patchResultEl = document.getElementById('patch-result');
    const workflowVersionsEl = document.getElementById('workflow-versions');
    const refreshWorkflowsEl = document.getElementById('refresh-workflows');
    const selectedWorkflowEl = document.getElementById('selected-workflow');
    const useDefaultWorkflowEl = document.getElementById('use-default-workflow');
    const loadSelectedWorkflowEl = document.getElementById('load-selected-workflow');
    const viewDefaultWorkflowEl = document.getElementById('view-default-workflow');
    const validateWorkflowEl = document.getElementById('validate-workflow');
    const saveWorkflowVersionEl = document.getElementById('save-workflow-version');
    const downloadDefaultWorkflowEl = document.getElementById('download-default-workflow');
    const workflowPreviewEl = document.getElementById('workflow-preview');
    const workflowSaveResultEl = document.getElementById('workflow-save-result');
    const saveRecordingEl = document.getElementById('save-recording');
    const recordingResultEl = document.getElementById('recording-result');
    const recorderUrlEl = document.getElementById('recorder-url');
    const recorderFrameEl = document.getElementById('recorder-frame');
    const recorderWebviewEl = document.getElementById('recorder-webview');
    const recorderEventsEl = document.getElementById('recorder-events');
    const recorderAddExtractEl = document.getElementById('recorder-add-extract');
    const recordedTaskListEl = document.getElementById('recorded-task-list');
    const recordNodeDetailEl = document.getElementById('record-node-detail');
    const recordingActionsEl = document.getElementById('recording-actions');
    const recordingNodeListEl = document.getElementById('recording-node-list');
    const testFlowListEl = document.getElementById('test-flow-list');
    const defaultDesignerSnapshot = {
      targetUrl: document.getElementById('journey-target-url').value,
      goal: document.getElementById('journey-goal').value,
      recordingName: document.getElementById('recording-name').value,
      recorderActions: JSON.parse(recordingActionsEl.value || '[]')
    };
    let webviewPollTimer = null;
    const refreshProfileEl = document.getElementById('refresh-profile');
    const openLoginEl = document.getElementById('open-login');
    const profileStatusEl = document.getElementById('profile-status');
    const createButtonEl = document.getElementById('new-employee');
    const employeeActionsEl = document.getElementById('employee-actions');
    const employeeRowsEl = document.getElementById('employee-rows');
    const employeeCountEl = document.getElementById('employee-count');
    const employeeSearchEl = document.getElementById('employee-search');
    const designerEmployeeIdEl = document.getElementById('designer-employee-id');
    const trashCountEl = document.getElementById('trash-count');
    const trashRowsEl = document.getElementById('trash-rows');
    const trashTableEl = document.getElementById('trash-table');
    const trashEmptyEl = document.getElementById('trash-empty');
    const designerEmployeeNameEl = document.getElementById('designer-employee-name');
    const renameEmployeeButtonEl = document.getElementById('rename-employee');
    const triggerModalEl = document.getElementById('trigger-modal');
    const triggerRowsEl = document.getElementById('trigger-rows');
    const triggerActionsEl = document.getElementById('trigger-actions');
    const triggerEmptyEl = document.getElementById('trigger-empty');
    const triggerTableWrapEl = document.getElementById('trigger-table-wrap');
    const triggerCountEl = document.getElementById('trigger-count');
    const workLogListEl = document.getElementById('work-log-list');
    const workLogCountEl = document.getElementById('work-log-count');
    const triggerPlanPopoverEl = document.getElementById('trigger-plan-popover');
    const triggerFormErrorEl = document.getElementById('trigger-form-error');

    loadRuns();
    loadWorkflowVersions();
    loadDoctorStatus();
    loadEmployees();
    loadTriggers();
    loadWorkLogs();

    document.querySelectorAll('[data-view]').forEach((control) => {
      control.addEventListener('click', () => showProductView(control.dataset.view));
    });
    createButtonEl.addEventListener('click', () => {
      if (state.currentView === 'triggers' || state.currentView === 'work-logs') {
        openTriggerModal();
        return;
      }
      createEmployee();
    });
    document.getElementById('employee-run').addEventListener('click', runSelectedEmployee);
    document.getElementById('employee-edit').addEventListener('click', editSelectedEmployee);
    document.getElementById('employee-delete').addEventListener('click', deleteSelectedEmployee);
    renameEmployeeButtonEl.addEventListener('click', () => {
      const input = document.getElementById('designer-employee-name-input');
      if (input) {
        void renameSelectedEmployee(input.value);
        return;
      }
      startInlineRename();
    });
    document.getElementById('save-employee').addEventListener('click', saveCurrentEmployee);
    document.getElementById('publish-employee').addEventListener('click', publishSelectedEmployee);
    employeeSearchEl.addEventListener('input', () => {
      state.employeeSearch = employeeSearchEl.value.trim();
      renderEmployees();
    });
    employeeRowsEl.addEventListener('click', (event) => {
      const editTarget = event.target.closest('[data-employee-edit]');
      if (editTarget) {
        state.selectedEmployeeId = editTarget.dataset.employeeEdit;
        void editSelectedEmployee();
        return;
      }
      const row = event.target.closest('.employee-row');
      if (row) selectEmployee(row.dataset.employeeId);
    });
    employeeRowsEl.addEventListener('dblclick', editSelectedEmployee);
    document.querySelector('[data-panel="employees"] .home-card').addEventListener('click', (event) => {
      if (event.target.closest('.employee-row, #employee-actions, .search-box')) return;
      clearEmployeeSelection();
    });
    document.getElementById('back-employees').addEventListener('click', () => showProductView('employees'));
    document.getElementById('close-trigger-modal').addEventListener('click', closeTriggerModal);
    document.getElementById('cancel-trigger').addEventListener('click', closeTriggerModal);
    document.getElementById('save-trigger').addEventListener('click', saveTrigger);
    document.getElementById('bulk-enable').addEventListener('click', () => setSelectedTriggerEnabled(true));
    document.getElementById('bulk-disable').addEventListener('click', () => setSelectedTriggerEnabled(false));
    document.getElementById('trigger-edit').addEventListener('click', openSelectedTriggerForEdit);
    document.getElementById('refresh-work-logs').addEventListener('click', loadWorkLogs);
    document.getElementById('trigger-search').addEventListener('input', renderTriggers);
    document.getElementById('trigger-time').addEventListener('input', updateTriggerSummary);
    document.getElementById('trigger-frequency').addEventListener('change', updateTriggerSummary);
    document.getElementById('trigger-more-toggle').addEventListener('click', toggleTriggerMoreOptions);
    triggerModalEl.addEventListener('click', (event) => {
      if (event.target === triggerModalEl) closeTriggerModal();
    });
    triggerRowsEl.addEventListener('click', handleTriggerTableClick);
    document.querySelector('[data-panel="triggers"] .trigger-list-card').addEventListener('click', (event) => {
      if (event.target.closest('.trigger-row, #trigger-actions, .search-box, #trigger-plan-popover')) return;
      clearTriggerSelection();
    });
    document.querySelectorAll('[data-journey-step]').forEach((step) => {
      step.addEventListener('click', () => selectJourneyStep(step.dataset.journeyStep));
    });
    document.getElementById('insert-strategy-node').addEventListener('click', () => addStrategyNode(state.selectedStrategyKind));
    document.querySelectorAll('[data-strategy-kind]').forEach((button) => {
      button.addEventListener('click', () => selectStrategyKind(button.dataset.strategyKind));
    });
    document.getElementById('journey-target-url').addEventListener('input', (event) => {
      recorderUrlEl.value = event.target.value || recorderUrlEl.value;
    });
    document.getElementById('record-script').addEventListener('click', () => {
      const button = document.getElementById('record-script');
      button.classList.add('recording');
      button.textContent = '● 录制中';
      selectJourneyStep('record');
      loadRecorderPage(true);
    });
    document.getElementById('recorder-open-page').addEventListener('click', () => loadRecorderPage(true));
    document.getElementById('close-recorder-modal').addEventListener('click', () => {
      finishRecorderSession();
    });
    document.getElementById('recorder-clear').addEventListener('click', clearRecorder);
    recorderAddExtractEl.addEventListener('click', addExtractTemplates);
    recordedTaskListEl.addEventListener('click', handleRecordedTaskListClick);
    testFlowListEl.addEventListener('click', handleTestFlowListClick);
    document.querySelectorAll('[data-designer-tab]').forEach((tab) => {
      tab.addEventListener('click', () => selectDesignerTab(tab.dataset.designerTab));
    });
    recordingActionsEl.addEventListener('input', syncRecordedActionsFromJson);
    recordingNodeListEl.addEventListener('dragstart', handleNodeDragStart);
    recordingNodeListEl.addEventListener('dragover', handleNodeDragOver);
    recordingNodeListEl.addEventListener('drop', handleNodeDrop);
    recordingNodeListEl.addEventListener('dragend', handleNodeDragEnd);
    recordingNodeListEl.addEventListener('click', handleNodeListClick);
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.source !== 'digital-employee-recorder') return;
      recordAction(event.data.action);
    });

    function showProductView(view) {
      state.currentView = view;
      document.querySelector('.app-shell').classList.toggle('designer-mode', view === 'designer');
      document.querySelectorAll('.app-view').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === view);
      });
      document.querySelectorAll('.top-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.view === view);
      });
      document.querySelectorAll('.side-item[data-view]').forEach((item) => {
        item.classList.toggle('selected', item.dataset.view === view);
      });
      document.querySelectorAll('[data-side-group]').forEach((group) => {
        group.classList.toggle('hidden', group.dataset.sideGroup !== (view === 'triggers' || view === 'work-logs' ? 'triggers' : 'employees'));
      });
      createButtonEl.textContent = view === 'triggers' || view === 'work-logs' ? '＋ 新建任务' : '＋ 新建员工';
      if (view === 'designer') {
        document.querySelectorAll('.top-tab').forEach((tab) => tab.classList.remove('active'));
        selectJourneyStep(state.currentJourneyStep || 'define');
      }
    }

    function selectJourneyStep(stepName) {
      if (!journeySteps.includes(stepName)) return;
      state.currentJourneyStep = stepName;
      document.querySelectorAll('[data-journey-step]').forEach((step) => {
        const active = step.dataset.journeyStep === stepName;
        step.classList.toggle('active', active);
        step.setAttribute('aria-current', active ? 'step' : 'false');
      });
      document.querySelectorAll('[data-journey-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.journeyPanel === stepName);
      });
      if (stepName === 'test') {
        updateTestContext();
      }
      if (['record', 'strategy', 'test'].includes(stepName)) {
        void refreshMainFlowFromSavedWorkflow();
      }
      if (viewIsDesigner()) {
        window.scrollTo({ top: 0, left: 0 });
      }
    }

    function viewIsDesigner() {
      return document.querySelector('[data-panel="designer"]')?.classList.contains('active');
    }

    function updateTestContext() {
      const contextEl = document.getElementById('test-context');
      const employee = selectedEmployee();
      const actionCount = state.recorderActions.length;
      const workflowText = state.workflowVersionId ? '工作流版本 ' + state.workflowVersionId : '当前草稿动作';
      contextEl.textContent = '当前验证对象：' + (employee ? employee.name : '新建员工') + ' · ' + workflowText + ' · ' + actionCount + ' 个录制动作。';
    }

    function selectStrategyKind(kind) {
      const allowedKinds = ['decide', 'select', 'extract', 'recover'];
      state.selectedStrategyKind = allowedKinds.includes(kind) ? kind : 'select';
      document.querySelectorAll('[data-strategy-kind]').forEach((button) => {
        button.classList.toggle('selected', button.dataset.strategyKind === state.selectedStrategyKind);
      });
      const presets = {
        decide: ['判断当前页面状态', '判断当前页面是成功、失败、需登录、需验证码还是风控状态。'],
        select: ['选择要添加的商品', '从搜索结果中选择最符合条件的一项。'],
        extract: ['抽取业务结果', '抽取页面上的成功状态、失败原因和原始文本证据。'],
        recover: ['恢复失效定位', '当普通 locator 失效时寻找替代按钮并给出修复建议。']
      };
      const preset = presets[state.selectedStrategyKind];
      if (!preset) return;
      document.getElementById('strategy-name').value = preset[0];
      document.getElementById('strategy-goal').value = preset[1];
    }

    function addStrategyNode(kind) {
      const allowedKinds = ['decide', 'select', 'extract', 'recover'];
      const strategyKind = allowedKinds.includes(kind) ? kind : 'select';
      const name = document.getElementById('strategy-name').value.trim() || strategyKind + ' strategy';
      const goal = document.getElementById('strategy-goal').value.trim() || '处理当前页面中的不确定性。';
      const rules = document.getElementById('strategy-rules').value.trim();
      const action = {
        type: 'strategy',
        intent: 'strategy_' + strategyKind + '_' + String(state.recorderActions.length + 1),
        strategyType: 'strategy.' + strategyKind,
        name,
        strategy: {
          kind: strategyKind,
          goal,
          inputs: ['title', 'productUrl', 'productId'],
          pageScope: strategyKind === 'select' ? 'search_results' : 'current_page',
          allowedActions: strategyKind === 'select' ? ['read', 'click'] : strategyKind === 'extract' ? ['read', 'extract'] : ['read', 'record_failure'],
          deniedActions: ['submit', 'delete', 'payment'],
          successCriteria: rules || '必须输出明确结果和页面证据。',
          failureBehavior: 'record_and_continue',
          evidenceRequired: true
        }
      };
      insertStrategyAction(action);
      recordingResultEl.textContent = '已添加策略节点：' + name + '。保存前可继续编辑 JSON。';
    }

    function insertStrategyAction(action) {
      const index = Number(state.selectedRecorderActionIndex);
      if (Number.isInteger(index) && index >= 0 && index < state.recorderActions.length) {
        state.recorderActions.splice(index, 0, action);
        state.selectedRecorderActionIndex = index;
      } else {
        state.recorderActions.push(action);
        state.selectedRecorderActionIndex = state.recorderActions.length - 1;
      }
      syncRecorderEditors({ dirty: true });
    }

    async function openTriggerModal() {
      triggerFormErrorEl.textContent = '';
      state.editingTriggerId = null;
      await loadEmployees();
      document.getElementById('trigger-name').value = '定时上新品';
      document.getElementById('trigger-time').value = '09:00';
      document.getElementById('trigger-enabled').checked = true;
      document.getElementById('trigger-end-enabled').checked = false;
      document.getElementById('trigger-calendar-enabled').checked = false;
      document.getElementById('trigger-queue-enabled').checked = false;
      document.getElementById('trigger-timeout').value = '0';
      setTriggerMoreOptions(false);
      renderTriggerEmployeeOptions();
      document.querySelector('input[name="trigger-frequency"][value="day"]').checked = true;
      updateTriggerSummary();
      triggerModalEl.classList.remove('hidden');
    }

    async function openSelectedTriggerForEdit() {
      const trigger = state.triggers.find((item) => item.id === state.selectedTriggerId);
      if (!trigger) return;
      triggerFormErrorEl.textContent = '';
      state.editingTriggerId = trigger.id;
      await loadEmployees();
      document.getElementById('trigger-name').value = trigger.name;
      document.getElementById('trigger-time').value = trigger.schedule.time || '09:00';
      document.getElementById('trigger-enabled').checked = Boolean(trigger.schedule.enabled);
      document.getElementById('trigger-end-enabled').checked = Boolean(trigger.schedule.endEnabled);
      document.getElementById('trigger-calendar-enabled').checked = Boolean(trigger.schedule.calendarEnabled);
      document.getElementById('trigger-queue-enabled').checked = Boolean(trigger.schedule.queueEnabled);
      document.getElementById('trigger-timeout').value = String(trigger.schedule.timeoutMinutes ?? 0);
      setTriggerMoreOptions(Boolean(trigger.schedule.calendarEnabled || trigger.schedule.queueEnabled || trigger.schedule.timeoutMinutes));
      renderTriggerEmployeeOptions(trigger.employee.id);
      const frequency = trigger.schedule.frequency || 'day';
      const radio = document.querySelector('input[name="trigger-frequency"][value="' + frequency + '"]');
      if (radio) radio.checked = true;
      updateTriggerSummary();
      triggerModalEl.classList.remove('hidden');
    }

    function closeTriggerModal() {
      state.editingTriggerId = null;
      triggerModalEl.classList.add('hidden');
    }

    function startInlineRename() {
      const employee = selectedEmployee();
      if (!employee) return;
      const input = document.createElement('input');
      input.id = 'designer-employee-name-input';
      input.className = 'designer-title-input';
      input.value = employee.name;
      input.setAttribute('aria-label', '员工名称');
      designerEmployeeNameEl.classList.add('hidden');
      renameEmployeeButtonEl.classList.add('editing');
      renameEmployeeButtonEl.textContent = '✓';
      designerEmployeeNameEl.insertAdjacentElement('afterend', input);
      input.focus();
      input.select();
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void renameSelectedEmployee(input.value);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelInlineRename();
        }
      });
      input.addEventListener('blur', () => {
        if (document.body.contains(input)) {
          void renameSelectedEmployee(input.value);
        }
      });
    }

    function selectedTriggerFrequency() {
      return document.querySelector('input[name="trigger-frequency"]:checked').value;
    }

    function updateTriggerSummary() {
      const time = document.getElementById('trigger-time').value || '09:00';
      const [hour, minute] = time.split(':');
      const frequency = selectedTriggerFrequency();
      const prefix = frequency === 'hour' ? '每小时' : frequency === 'minute' ? '每分钟' : frequency === 'week' ? '每周' : frequency === 'month' ? '每月' : frequency === 'advanced' ? '按高级规则' : '每天';
      document.getElementById('trigger-summary').innerHTML = '⏱ ' + prefix + '的 ' + hour + ' 时 ' + minute + ' 分执行 <button class="link-button">详情</button>';
    }

    function toggleTriggerMoreOptions() {
      const options = document.getElementById('trigger-more-options');
      setTriggerMoreOptions(options.classList.contains('hidden'));
    }

    function setTriggerMoreOptions(expanded) {
      const options = document.getElementById('trigger-more-options');
      const toggle = document.getElementById('trigger-more-toggle');
      options.classList.toggle('hidden', !expanded);
      toggle.classList.toggle('expanded', expanded);
    }

    function selectDesignerTab(tabName) {
      document.querySelectorAll('[data-designer-tab]').forEach((tab) => {
        const active = tab.dataset.designerTab === tabName;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('[data-designer-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.designerPanel === tabName);
      });
    }

    function loadRecorderPage(reset) {
      const url = recorderUrlEl.value.trim() || 'https://example.com/admin';
      document.getElementById('recorder-modal').classList.remove('hidden');
      if (reset) {
        state.recorderActions = [];
        state.selectedRecorderActionIndex = null;
        state.selectedTestFlowIndex = null;
        resetValidationStateForWorkflowChange();
      }
      if (canUseElectronWebview()) {
        recorderFrameEl.classList.add('hidden');
        recorderWebviewEl.classList.remove('hidden');
        recorderWebviewEl.src = url;
        attachWebviewRecorder();
      } else {
        recorderWebviewEl.classList.add('hidden');
        recorderFrameEl.classList.remove('hidden');
        recorderFrameEl.srcdoc = recorderFrameHtml(url);
      }
      recordAction({
        type: 'open',
        intent: 'open_target_page',
        url
      });
    }

    function canUseElectronWebview() {
      return recorderWebviewEl && typeof recorderWebviewEl.executeJavaScript === 'function';
    }

    function attachWebviewRecorder() {
      if (!canUseElectronWebview()) return;
      if (webviewPollTimer) {
        clearInterval(webviewPollTimer);
        webviewPollTimer = null;
      }
      const inject = () => {
        recorderWebviewEl.executeJavaScript(webviewRecorderScript()).catch(() => undefined);
      };
      if (!recorderWebviewEl.dataset.recorderInjectAttached) {
        recorderWebviewEl.dataset.recorderInjectAttached = 'true';
        recorderWebviewEl.addEventListener('dom-ready', inject);
        recorderWebviewEl.addEventListener('did-finish-load', inject);
        recorderWebviewEl.addEventListener('did-navigate', inject);
        recorderWebviewEl.addEventListener('did-navigate-in-page', inject);
        recorderWebviewEl.addEventListener('console-message', (event) => {
          const marker = '__DIGITAL_EMPLOYEE_RECORDER__';
          const message = String(event.message || '');
          if (!message.startsWith(marker)) return;
          try {
            recordAction(JSON.parse(message.slice(marker.length)));
          } catch {
            // Ignore non-recorder console messages from the guest page.
          }
        });
      }
      if (!recorderWebviewEl.dataset.popupRecorderAttached) {
        recorderWebviewEl.dataset.popupRecorderAttached = 'true';
        recorderWebviewEl.addEventListener('new-window', (event) => {
          const popupUrl = event.url;
          if (!popupUrl) return;
          event.preventDefault?.();
          recordAction({ type: 'open', intent: 'open_new_window', url: popupUrl, newWindow: true });
          recorderWebviewEl.src = popupUrl;
        });
        recorderWebviewEl.addEventListener('did-create-window', (_event) => {
          recordAction({ type: 'open', intent: 'open_new_window', url: recorderWebviewEl.getURL?.() || recorderUrlEl.value, newWindow: true });
        });
      }
      webviewPollTimer = setInterval(async () => {
        try {
          const actions = await recorderWebviewEl.executeJavaScript('window.__digitalEmployeeRecordedActions ? window.__digitalEmployeeRecordedActions.splice(0) : []');
          if (Array.isArray(actions)) {
            actions.forEach(recordAction);
          }
        } catch {
          // Cross-page navigations can briefly reject injection/polling. The next tick will retry.
        }
      }, 50);
    }

    function finishRecorderSession() {
      document.getElementById('recorder-modal').classList.add('hidden');
      if (webviewPollTimer) {
        clearInterval(webviewPollTimer);
        webviewPollTimer = null;
      }
      const button = document.getElementById('record-script');
      button.classList.remove('recording');
      button.textContent = '▣ 录制脚本';
      syncRecorderEditors({ dirty: true });
      updateTestContext();
      recordingResultEl.textContent = '录制已结束，主流程节点已同步到标注和试跑步骤。';
    }

    function clearRecorder() {
      state.recorderActions = [];
      state.selectedRecorderActionIndex = null;
      state.selectedTestFlowIndex = null;
      syncRecorderEditors({ dirty: true });
      recordingResultEl.textContent = '已清空录制动作。';
    }

    function addExtractTemplates() {
      [
        {
          type: 'extract',
          intent: 'extract_article_list',
          extract: {
            entity: 'articles',
            selector: '.result, .news-item, article',
            limit: 5,
            fields: {
              articleId: { selector: 'a', attr: 'href' },
              articleUrl: { selector: 'a', attr: 'href' },
              articleName: { selector: 'a', text: true },
              articleSummary: { selector: 'p, .summary', text: true },
              publishedAt: { selector: 'time, .time, .date', text: true }
            }
          }
        },
        {
          type: 'extract',
          intent: 'extract_comment_list',
          extract: {
            entity: 'comments',
            selector: '.comment, .comment-item, [class*=comment]',
            limit: 50,
            fields: {
              articleId: { selector: 'body', attr: 'data-article-id' },
              commenterId: { selector: '[data-user-id]', attr: 'data-user-id' },
              commenterName: { selector: '.user, .name, [class*=name]', text: true },
              commentId: { selector: '[data-comment-id]', attr: 'data-comment-id' },
              content: { selector: '.content, .text, p', text: true },
              commentTime: { selector: 'time, .time, .date', text: true },
              region: { selector: '.region, .location, [class*=region]', text: true }
            }
          }
        }
      ].forEach(recordAction);
      recordingResultEl.textContent = '已插入文章列表和评论列表抽取模板，可在 JSON 中调整 selector。';
    }

    function recordAction(action) {
      if (!action || !action.type) return;
      const signature = JSON.stringify(action);
      const now = Date.now();
      if (state.recentRecorderActionSignatures[signature] && now - state.recentRecorderActionSignatures[signature] < 1000) {
        return;
      }
      state.recentRecorderActionSignatures[signature] = now;
      Object.keys(state.recentRecorderActionSignatures).forEach((key) => {
        if (now - state.recentRecorderActionSignatures[key] > 3000) {
          delete state.recentRecorderActionSignatures[key];
        }
      });
      if (action.type === 'input') {
        const last = state.recorderActions[state.recorderActions.length - 1];
        const sameTarget = last && last.type === 'input' && JSON.stringify(last.target || {}) === JSON.stringify(action.target || {});
        if (sameTarget) {
          state.recorderActions[state.recorderActions.length - 1] = action;
          syncRecorderEditors({ dirty: true });
          return;
        }
        const trailingPress = last && last.type === 'press' && ['Enter', 'Tab'].includes(last.key || '') && sameRecorderTarget(last.target, action.target);
        if (trailingPress) {
          const beforePress = state.recorderActions[state.recorderActions.length - 2];
          if (beforePress && beforePress.type === 'input' && sameRecorderTarget(beforePress.target, action.target)) {
            state.recorderActions[state.recorderActions.length - 2] = action;
          } else {
            state.recorderActions.splice(state.recorderActions.length - 1, 0, action);
          }
          syncRecorderEditors({ dirty: true });
          return;
        }
      }
      state.recorderActions.push(action);
      syncRecorderEditors({ dirty: true });
    }

    function sameRecorderTarget(left, right) {
      return JSON.stringify(left || {}) === JSON.stringify(right || {});
    }

    function syncRecordedActionsFromJson(options = {}) {
      try {
        const actions = JSON.parse(recordingActionsEl.value || '[]');
        state.recorderActions = Array.isArray(actions) ? actions : [];
      } catch {
        state.recorderActions = [];
      }
      state.recorderDirty = options.dirty !== false;
      if (state.recorderDirty) {
        state.recorderSourceVersionId = null;
      }
      if (!Number.isInteger(state.selectedRecorderActionIndex) || state.selectedRecorderActionIndex >= state.recorderActions.length) {
        state.selectedRecorderActionIndex = null;
      }
      if (!Number.isInteger(state.selectedTestFlowIndex) || state.selectedTestFlowIndex >= state.recorderActions.length) {
        state.selectedTestFlowIndex = null;
      }
      if (state.recorderDirty) {
        resetValidationStateForWorkflowChange();
      }
      renderRecorderEvents();
    }

    function syncRecorderEditors(options = {}) {
      state.recorderDirty = options.dirty !== false;
      if (state.recorderDirty) {
        state.recorderSourceVersionId = null;
      }
      recordingActionsEl.value = JSON.stringify(state.recorderActions, null, 2);
      if (state.recorderDirty) {
        resetValidationStateForWorkflowChange();
      }
      renderRecorderEvents();
      if (state.currentJourneyStep === 'test') {
        updateTestContext();
      }
    }

    async function refreshMainFlowFromSavedWorkflow(options = {}) {
      if (!state.workflowVersionId || (state.recorderDirty && !options.force)) {
        renderRecorderEvents();
        return;
      }
      if (state.recorderSourceVersionId === state.workflowVersionId && !options.force) {
        renderRecorderEvents();
        return;
      }
      const stored = await loadStoredWorkflowVersion(state.workflowVersionId);
      if (!stored) return;
      state.recorderActions = cloneForClient(actionsFromStoredWorkflow(stored));
      state.workflowSteps = cloneForClient(stored.workflow?.steps || []);
      state.recorderSourceVersionId = state.workflowVersionId;
      state.recorderDirty = false;
      state.selectedRecorderActionIndex = null;
      const firstOpen = state.recorderActions.find((action) => action.type === 'open' && action.url);
      if (firstOpen?.url) {
        document.getElementById('journey-target-url').value = firstOpen.url;
        recorderUrlEl.value = firstOpen.url;
      }
      if (stored.workflow?.name) {
        document.getElementById('recording-name').value = stored.workflow.name;
      }
      syncRecorderEditors({ dirty: false });
      updateTestContext();
    }

    function renderRecorderEvents() {
      renderRecordedTaskList();
      renderRecordingNodeList();
      renderTestFlowList();
      renderRecordNodeDetail();
      recorderEventsEl.innerHTML = state.recorderActions.length === 0
        ? '<li class="muted">暂无动作</li>'
        : state.recorderActions.map((action) => {
          const item = actionTaskItem(action);
          return '<li><code>' + escapeHtmlText(action.type) + '</code><span>' + escapeHtmlText(item.title + '：' + item.detail) + '</span></li>';
        }).join('');
    }

    function renderRecordingNodeList() {
      recordingNodeListEl.innerHTML = state.recorderActions.length === 0
        ? flowNodeEmptyHtml('暂无动作节点', '录制、插入智能节点或编辑右侧 JSON 后会同步显示')
        : state.recorderActions.map((action, index) => {
          const item = actionTaskItem(action);
          return flowNodeHtml({
            index,
            title: item.title,
            detail: item.detail,
            classes: ['selectable', 'draggable', index === state.selectedRecorderActionIndex ? 'selected' : ''].filter(Boolean),
            attrs: 'draggable="true" data-node-index="' + index + '"',
            trailing: '<span class="drag-handle flow-node-trailing" aria-hidden="true">⋮⋮</span>'
          });
        }).join('');
    }

    function renderTestFlowList() {
      if (!testFlowListEl) return;
      testFlowListEl.innerHTML = state.recorderActions.length === 0
        ? flowNodeEmptyHtml('暂无主流程节点', '录制或导入流程后，这里会显示试跑时的节点状态。')
        : state.recorderActions.map((action, index) => {
          const item = actionTaskItem(action);
          const status = testFlowNodeStatus(action, index);
          return flowNodeHtml({
            index,
            title: item.title,
            detail: item.detail,
            classes: ['selectable', 'test-flow-node', index === state.selectedTestFlowIndex ? 'selected' : ''],
            attrs: 'data-test-node-index="' + index + '"',
            trailing: '<span class="badge ' + statusClass(status) + ' flow-node-trailing">' + statusText(status) + '</span>'
          });
        }).join('');
    }

    function handleRecordedTaskListClick(event) {
      const item = event.target.closest('[data-record-node-index]');
      if (!item) return;
      state.selectedRecorderActionIndex = Number(item.dataset.recordNodeIndex);
      renderRecordedTaskList();
      renderRecordingNodeList();
      renderRecordNodeDetail();
    }

    function handleTestFlowListClick(event) {
      const item = event.target.closest('[data-test-node-index]');
      if (!item) return;
      state.selectedTestFlowIndex = Number(item.dataset.testNodeIndex);
      renderTestFlowList();
      renderSelectedTestFlowTrace();
    }

    function handleNodeListClick(event) {
      const item = event.target.closest('[data-node-index]');
      if (!item) return;
      state.selectedRecorderActionIndex = Number(item.dataset.nodeIndex);
      renderRecordingNodeList();
      renderRecordedTaskList();
      renderRecordNodeDetail();
    }

    function handleNodeDragStart(event) {
      const item = event.target.closest('[data-node-index]');
      if (!item) return;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.nodeIndex);
    }

    function handleNodeDragOver(event) {
      if (!event.target.closest('[data-node-index]')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }

    function handleNodeDrop(event) {
      const item = event.target.closest('[data-node-index]');
      if (!item) return;
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer.getData('text/plain'));
      const toIndex = Number(item.dataset.nodeIndex);
      if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
      const [moved] = state.recorderActions.splice(fromIndex, 1);
      state.recorderActions.splice(toIndex, 0, moved);
      if (state.selectedRecorderActionIndex === fromIndex) {
        state.selectedRecorderActionIndex = toIndex;
      } else if (Number.isInteger(state.selectedRecorderActionIndex)) {
        if (fromIndex < state.selectedRecorderActionIndex && toIndex >= state.selectedRecorderActionIndex) {
          state.selectedRecorderActionIndex -= 1;
        } else if (fromIndex > state.selectedRecorderActionIndex && toIndex <= state.selectedRecorderActionIndex) {
          state.selectedRecorderActionIndex += 1;
        }
      }
      syncRecorderEditors({ dirty: true });
    }

    function handleNodeDragEnd() {
      recordingNodeListEl.querySelectorAll('.dragging').forEach((item) => item.classList.remove('dragging'));
    }

    function renderRecordedTaskList() {
      recordedTaskListEl.innerHTML = state.recorderActions.length === 0
        ? flowNodeEmptyHtml('暂无任务', '录制或编辑 JSON 后会同步生成任务列表')
        : state.recorderActions.map((action, index) => {
          const item = actionTaskItem(action);
          return flowNodeHtml({
            index,
            title: item.title,
            detail: item.detail,
            classes: ['selectable', index === state.selectedRecorderActionIndex ? 'selected' : ''].filter(Boolean),
            attrs: 'data-record-node-index="' + index + '"'
          });
        }).join('');
    }

    function renderRecordNodeDetail() {
      if (!recordNodeDetailEl) return;
      const index = Number(state.selectedRecorderActionIndex);
      const action = Number.isInteger(index) ? state.recorderActions[index] : null;
      if (!action) {
        recordNodeDetailEl.innerHTML = '<strong>当前节点</strong><span>从左侧主流程中选择节点后查看定位证据、成功条件和失败处理。</span>';
        return;
      }
      const item = actionTaskItem(action);
      const target = action.target ? JSON.stringify(action.target) : (action.url || action.key || '-');
      recordNodeDetailEl.innerHTML =
        '<strong>节点 ' + (index + 1) + '</strong>' +
        '<span><b>' + escapeHtmlText(item.title) + '</b><br>' +
        escapeHtmlText(item.detail) + '<br>' +
        '类型：' + escapeHtmlText(action.type || '-') + '<br>' +
        '意图：' + escapeHtmlText(action.intent || action.id || '-') + '<br>' +
        '目标：' + escapeHtmlText(target) + '</span>';
    }

    function renderSelectedTestFlowTrace() {
      const index = Number(state.selectedTestFlowIndex);
      if (!Number.isInteger(index) || index < 0 || index >= state.recorderActions.length) {
        renderTrace(state.currentTraceRow);
        return;
      }
      renderTrace(state.currentTraceRow, { actionIndex: index });
    }

    function flowNodeEmptyHtml(title, detail) {
      return '<li class="flow-node-empty"><span>' + escapeHtmlText(title) + '</span><small>' + escapeHtmlText(detail) + '</small></li>';
    }

    function flowNodeHtml(input) {
      const classes = ['flow-node-item'].concat(input.classes || []).join(' ');
      const attrs = input.attrs ? ' ' + input.attrs : '';
      const trailing = input.trailing || '<span class="flow-node-trailing"></span>';
      return '<li class="' + escapeAttr(classes) + '"' + attrs + '>' +
        '<em class="flow-node-index">' + (input.index + 1) + '</em>' +
        '<div class="flow-node-content"><strong class="flow-node-title">' + escapeHtmlText(input.title) + '</strong><small class="flow-node-detail">' + escapeHtmlText(input.detail) + '</small></div>' +
        trailing +
      '</li>';
    }

    function actionTaskItem(action) {
      const targetText = action.target && (action.target.label || action.target.text || action.target.css || action.target.role);
      if (action.type === 'open') {
        return { title: '打开网页', detail: action.url || '未配置 URL' };
      }
      if (action.type === 'input') {
        return { title: '填写输入框(web)', detail: '在 ' + (targetText || '字段') + ' 中输入 ' + (action.value || '') };
      }
      if (action.type === 'press') {
        return { title: '按键(web)', detail: '按下 ' + (action.key || 'Enter') + (targetText ? ' · ' + targetText : '') };
      }
      if (action.type === 'click') {
        return { title: '点击元素(web)', detail: '点击 ' + (targetText || action.intent || '元素') };
      }
      if (action.type === 'verify') {
        const expected = action.expectation?.textExists || (action.expectation?.anyTextExists || []).join(' / ');
        return { title: '校验页面', detail: expected || '校验页面状态' };
      }
      if (action.type === 'extract') {
        return { title: '抽取数据', detail: (action.extract?.entity || '页面数据') + ' · ' + (action.extract?.selector || '默认选择器') };
      }
      if (action.type === 'wait') {
        return { title: '等待', detail: '等待 ' + (action.timeoutMs || 1000) + 'ms' };
      }
      return { title: action.type || '未知动作', detail: action.intent || '' };
    }

    function recorderFrameHtml(url) {
      const title = '目标页面 · ' + url;
      return [
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
        '<style>',
        'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f6f8fb;color:#344054;}',
        'header{height:48px;display:flex;align-items:center;gap:10px;padding:0 18px;background:#fff;border-bottom:1px solid #e5e9f0;font-weight:800;}',
        'main{padding:18px;display:grid;gap:14px;}',
        '.card{background:#fff;border:1px solid #e5e9f0;border-radius:8px;padding:16px;display:grid;gap:12px;}',
        'label{display:grid;gap:6px;font-size:13px;font-weight:800;color:#475467;}',
        'input,textarea,select{border:1px solid #dfe4ec;border-radius:6px;padding:10px 12px;font:inherit;}',
        'button{width:max-content;border:0;border-radius:6px;background:#ff4d55;color:#fff;font-weight:900;padding:10px 16px;cursor:pointer;}',
        '.secondary{background:#f3f6fb;color:#344054;}',
        '</style></head><body>',
        '<header><span>🌐</span><span>' + escapeHtmlText(title) + '</span></header>',
        '<main>',
        '<section class="card"><strong>示例后台表单</strong><label>任务名称<input data-label="任务名称" value="每日巡检"></label><label>目标输入框<textarea data-label="目标输入框" rows="3" placeholder="输入要提交的内容"></textarea></label><label>处理类型<select data-label="处理类型"><option>新增</option><option>更新</option><option>巡检</option></select></label><button data-label="保存配置">保存配置</button><button class="secondary" data-label="预览结果">预览结果</button></section>',
        '<section class="card"><strong>操作区</strong><button data-label="新建">新建</button><button data-label="提交" data-approval="true">提交</button><a href="https://example.com/detail" target="_blank" data-label="打开详情页">打开详情页</a></section>',
        '</main>',
        '<script>',
        'function cssPath(el){if(el.id)return \"#\"+el.id;var parts=[];while(el&&el.nodeType===1&&parts.length<4){var name=el.tagName.toLowerCase();var parent=el.parentElement;if(parent){var peers=Array.from(parent.children).filter(function(item){return item.tagName===el.tagName});if(peers.length>1)name += \":nth-of-type(\"+(peers.indexOf(el)+1)+\")\";}parts.unshift(name);el=parent;}return parts.join(\" > \");}',
        'function labelFor(el){return el.getAttribute(\"data-label\")||el.getAttribute(\"aria-label\")||el.name||el.placeholder||el.textContent.trim().slice(0,40)||el.tagName.toLowerCase();}',
        'function post(action){parent.postMessage({source:\"digital-employee-recorder\",action:action},\"*\");}',
        'var originalOpen=window.open;function delayedNavigate(url){setTimeout(function(){try{window.location.href=String(url);}catch{}},120);}',
        'window.open=function(url,name,features){if(url){post({type:\"open\",intent:\"open_new_window\",url:String(url),newWindow:true});delayedNavigate(url);return null;}return originalOpen?originalOpen.apply(window,arguments):null;};',
        'function inputAction(el){return {type:\"input\",intent:(\"input_\"+labelFor(el)).replace(/[^a-zA-Z0-9_\\u4e00-\\u9fa5]+/g,\"_\"),target:{role:el.tagName.toLowerCase()===\"select\"?\"combobox\":\"textbox\",label:labelFor(el),css:cssPath(el)},value:el.value};}',
        'function pressAction(el,key){return {type:\"press\",intent:(\"press_\"+key+\"_\"+labelFor(el)).replace(/[^a-zA-Z0-9_\\u4e00-\\u9fa5]+/g,\"_\"),target:{role:el&&/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)?(el.tagName.toLowerCase()===\"select\"?\"combobox\":\"textbox\"):undefined,label:el?labelFor(el):undefined,css:el?cssPath(el):undefined},key:key};}',
        'document.addEventListener(\"click\",function(event){var el=event.target.closest(\"button,a,input[type=button],input[type=submit],[role=button]\");if(!el)return;var tag=el.tagName.toLowerCase();post({type:\"click\",intent:(\"click_\"+labelFor(el)).replace(/[^a-zA-Z0-9_\\u4e00-\\u9fa5]+/g,\"_\"),target:{role:tag===\"a\"?\"link\":\"button\",text:labelFor(el),css:cssPath(el)},approvalRequired:el.getAttribute(\"data-approval\")===\"true\",skipWhen:el.getAttribute(\"data-approval\")===\"true\"?\"{{mode == \\'dry_run\\'}}\":undefined});if(tag===\"a\"&&el.target===\"_blank\"&&el.href){event.preventDefault();post({type:\"open\",intent:\"open_new_window\",url:el.href,newWindow:true});delayedNavigate(el.href);}} ,true);',
        'document.addEventListener(\"submit\",function(event){var form=event.target;if(!form||form.__digitalEmployeeDelayedSubmit)return;event.preventDefault();form.__digitalEmployeeDelayedSubmit=true;setTimeout(function(){try{HTMLFormElement.prototype.submit.call(form);}catch{form.submit();}},120);},true);',
        'document.addEventListener(\"change\",function(event){var el=event.target;if(!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))return;if(el.tagName===\"SELECT\")post(inputAction(el));});',
        'document.addEventListener(\"blur\",function(event){var el=event.target;if(!/^(INPUT|TEXTAREA)$/.test(el.tagName))return;post(inputAction(el));},true);',
        'document.addEventListener(\"keydown\",function(event){if(![\"Enter\",\"Tab\",\"Escape\"].includes(event.key))return;post(pressAction(event.target,event.key));});',
        '<\\/script></body></html>'
      ].join('');
    }

    function webviewRecorderScript() {
      return [
        '(() => {',
        'if (window.__digitalEmployeeRecorderInstalled) return true;',
        'window.__digitalEmployeeRecorderInstalled = true;',
        'window.__digitalEmployeeRecordedActions = window.__digitalEmployeeRecordedActions || [];',
        'var carryPrefix=\"__digitalEmployeeRecorderActions__\";',
        'function cssPath(el){if(el.id)return \"#\"+el.id;var parts=[];while(el&&el.nodeType===1&&parts.length<5){var name=el.tagName.toLowerCase();var parent=el.parentElement;if(parent){var peers=Array.from(parent.children).filter(function(item){return item.tagName===el.tagName});if(peers.length>1)name += \":nth-of-type(\"+(peers.indexOf(el)+1)+\")\";}parts.unshift(name);el=parent;}return parts.join(\" > \");}',
        'function labelFor(el){return el.getAttribute(\"data-label\")||el.getAttribute(\"aria-label\")||el.name||el.placeholder||el.innerText?.trim().slice(0,60)||el.value?.slice(0,60)||el.tagName.toLowerCase();}',
        'function push(action){window.__digitalEmployeeRecordedActions.push(action);}',
        'function emit(action){push(action);try{console.info(\"__DIGITAL_EMPLOYEE_RECORDER__\"+JSON.stringify(action));}catch{}}',
        'try{if(typeof window.name===\"string\"&&window.name.indexOf(carryPrefix)===0){JSON.parse(window.name.slice(carryPrefix.length)).forEach(push);window.name=\"\";}}catch{}',
        'window.addEventListener(\"pagehide\",function(){try{if(window.__digitalEmployeeRecordedActions.length>0){window.name=carryPrefix+JSON.stringify(window.__digitalEmployeeRecordedActions);}}catch{}});',
        'function delayedNavigate(url){setTimeout(function(){try{window.location.href=String(url);}catch{}},120);}',
        'var originalOpen=window.open;window.open=function(url,name,features){if(url){emit({type:\"open\",intent:\"open_new_window\",url:String(url),newWindow:true});delayedNavigate(url);return null;}return originalOpen?originalOpen.apply(window,arguments):null;};',
        'function inputAction(el){return {type:\"input\",intent:(\"input_\"+labelFor(el)).replace(/[^a-zA-Z0-9_\\u4e00-\\u9fa5]+/g,\"_\"),target:{role:el.tagName.toLowerCase()===\"select\"?\"combobox\":\"textbox\",label:labelFor(el),css:cssPath(el)},value:el.value};}',
        'function pressAction(el,key){return {type:\"press\",intent:(\"press_\"+key+\"_\"+labelFor(el)).replace(/[^a-zA-Z0-9_\\u4e00-\\u9fa5]+/g,\"_\"),target:{role:el&&/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)?(el.tagName.toLowerCase()===\"select\"?\"combobox\":\"textbox\"):undefined,label:el?labelFor(el):undefined,css:el?cssPath(el):undefined},key:key};}',
        'document.addEventListener(\"click\",function(event){var el=event.target.closest(\"button,a,[role=button],input[type=button],input[type=submit]\");if(!el)return;var tag=el.tagName.toLowerCase();var role=tag===\"a\"?\"link\":\"button\";emit({type:\"click\",intent:(\"click_\"+labelFor(el)).replace(/[^a-zA-Z0-9_\\u4e00-\\u9fa5]+/g,\"_\"),target:{role:role,text:labelFor(el),css:cssPath(el)}});if(tag===\"a\"&&el.target===\"_blank\"&&el.href){event.preventDefault();emit({type:\"open\",intent:\"open_new_window\",url:el.href,newWindow:true});delayedNavigate(el.href);}},true);',
        'document.addEventListener(\"submit\",function(event){var form=event.target;if(!form||form.__digitalEmployeeDelayedSubmit)return;event.preventDefault();form.__digitalEmployeeDelayedSubmit=true;setTimeout(function(){try{HTMLFormElement.prototype.submit.call(form);}catch{form.submit();}},120);},true);',
        'document.addEventListener(\"change\",function(event){var el=event.target;if(!/^(SELECT)$/.test(el.tagName))return;emit(inputAction(el));},true);',
        'document.addEventListener(\"blur\",function(event){var el=event.target;if(!/^(INPUT|TEXTAREA)$/.test(el.tagName))return;if([\"button\",\"submit\",\"reset\",\"checkbox\",\"radio\"].includes((el.type||\"\").toLowerCase()))return;emit(inputAction(el));},true);',
        'document.addEventListener(\"keydown\",function(event){if(![\"Enter\",\"Tab\",\"Escape\"].includes(event.key))return;emit(pressAction(event.target,event.key));},true);',
        'true;',
        '})()'
      ].join('');
    }

    async function saveTrigger() {
      triggerFormErrorEl.textContent = '';
      const employee = document.getElementById('trigger-employee');
      if (!employee.value) {
        triggerFormErrorEl.textContent = '请先选择一个员工，再创建触发器。';
        return;
      }
      const body = {
        name: document.getElementById('trigger-name').value.trim(),
        employeeId: employee.value,
        frequency: selectedTriggerFrequency(),
        time: document.getElementById('trigger-time').value,
        timezone: 'Asia/Shanghai',
        enabled: document.getElementById('trigger-enabled').checked,
        endEnabled: document.getElementById('trigger-end-enabled').checked,
        calendarEnabled: document.getElementById('trigger-calendar-enabled').checked,
        queueEnabled: document.getElementById('trigger-queue-enabled').checked,
        timeoutMinutes: Number(document.getElementById('trigger-timeout').value || '0')
      };
      const editingTriggerId = state.editingTriggerId;
      const response = await fetch(editingTriggerId ? '/api/triggers/' + encodeURIComponent(editingTriggerId) : '/api/triggers', {
        method: editingTriggerId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        triggerFormErrorEl.textContent = (payload.errors || ['保存触发器失败']).join('\\n');
        return;
      }
      closeTriggerModal();
      showProductView('triggers');
      await loadTriggers();
    }

    async function loadEmployees() {
      const response = await fetch('/api/employees');
      const payload = await response.json();
      state.employees = payload.ok ? payload.value : [];
      if (state.selectedEmployeeId && !state.employees.some((employee) => employee.id === state.selectedEmployeeId)) {
        if (state.selectedEmployeeId !== NEW_EMPLOYEE_ID) {
          state.selectedEmployeeId = null;
        }
      }
      renderEmployees();
      renderTrashEmployees();
      renderTriggerEmployeeOptions();
      renderDesignerTitle();
    }

    async function createEmployee() {
      state.pendingEmployee = {
        id: NEW_EMPLOYEE_ID,
        name: '新建员工',
        status: 'draft',
        version: 1,
        updatedAt: new Date().toISOString()
      };
      state.selectedEmployeeId = NEW_EMPLOYEE_ID;
      state.currentJourneyStep = 'define';
      resetDesignerForNewEmployee();
      showProductView('designer');
      renderDesignerTitle();
    }

    function renderEmployees() {
      const activeEmployees = activeEmployeeList();
      employeeCountEl.textContent = String(activeEmployees.length);
      const employees = filteredEmployees();
      employeeRowsEl.innerHTML = employees.length === 0
        ? '<tr class="employee-empty-row"><td colspan="3">没有匹配的员工</td></tr>'
        : employees.map((employee, index) => (
        '<tr class="employee-row ' + (employee.id === state.selectedEmployeeId ? 'selected' : '') + '" data-employee-id="' + escapeAttr(employee.id) + '">' +
          '<td><span class="new-badge">' + (index === 0 ? '新' : '已') + '</span><button type="button" class="employee-name-link" data-employee-edit="' + escapeAttr(employee.id) + '">' + escapeHtmlText(employee.name) + '(' + escapeHtmlText(employee.id) + ')</button></td>' +
          '<td>' + escapeHtmlText(relativeTime(employee.updatedAt)) + '</td>' +
          '<td>' + escapeHtmlText(employeeStatusText(employee)) + '</td>' +
        '</tr>'
      )).join('');
      employeeActionsEl.classList.toggle('hidden', !state.selectedEmployeeId || !employees.some((employee) => employee.id === state.selectedEmployeeId));
      renderDesignerTitle();
    }

    function filteredEmployees() {
      const keyword = state.employeeSearch.toLowerCase();
      const employees = activeEmployeeList();
      if (!keyword) return employees;
      return employees.filter((employee) => {
        const haystack = [employee.name, employee.id, employeeStatusText(employee)].join(' ').toLowerCase();
        return haystack.includes(keyword);
      });
    }

    function activeEmployeeList() {
      return state.employees.filter((employee) => employee.status !== 'disabled');
    }

    function disabledEmployeeList() {
      return state.employees.filter((employee) => employee.status === 'disabled');
    }

    function renderTrashEmployees() {
      const employees = disabledEmployeeList();
      trashCountEl.textContent = String(employees.length);
      trashEmptyEl.classList.toggle('hidden', employees.length > 0);
      trashTableEl.classList.toggle('hidden', employees.length === 0);
      trashRowsEl.innerHTML = employees.map((employee) => (
        '<tr class="employee-row disabled-row">' +
          '<td><span class="new-badge disabled-badge">停</span><strong>' + escapeHtmlText(employee.name) + '(' + escapeHtmlText(employee.id) + ')</strong></td>' +
          '<td>' + escapeHtmlText(relativeTime(employee.updatedAt)) + '</td>' +
          '<td>' + escapeHtmlText(employeeStatusText(employee)) + '</td>' +
        '</tr>'
      )).join('');
    }

    function selectEmployee(employeeId) {
      if (state.selectedEmployeeId !== employeeId) {
        resetRunState();
      }
      state.selectedEmployeeId = employeeId;
      renderEmployees();
    }

    function clearEmployeeSelection() {
      state.selectedEmployeeId = null;
      renderEmployees();
    }

    function selectedEmployee() {
      if (state.selectedEmployeeId === NEW_EMPLOYEE_ID) {
        return state.pendingEmployee;
      }
      return state.employees.find((employee) => employee.id === state.selectedEmployeeId);
    }

    function renderDesignerTitle() {
      const employee = selectedEmployee();
      designerEmployeeNameEl.textContent = employee ? employee.name : '员工';
      designerEmployeeIdEl.textContent = employee && employee.id !== NEW_EMPLOYEE_ID ? employee.id : '未保存';
    }

    async function saveCurrentEmployee() {
      const employee = selectedEmployee();
      if (!employee) return null;
      if (employee.id !== NEW_EMPLOYEE_ID) {
        await loadEmployees();
        return selectedEmployee();
      }
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: employee.name })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        window.alert((payload.errors || ['保存员工失败']).join('\\n'));
        return null;
      }
      state.pendingEmployee = null;
      state.selectedEmployeeId = payload.value.id;
      await loadEmployees();
      renderDesignerTitle();
      return payload.value;
    }

    function finishInlineRename() {
      const input = document.getElementById('designer-employee-name-input');
      input?.remove();
      designerEmployeeNameEl.classList.remove('hidden');
      renameEmployeeButtonEl.classList.remove('editing');
      renameEmployeeButtonEl.textContent = '✎';
    }

    function cancelInlineRename() {
      finishInlineRename();
    }

    async function renameSelectedEmployee(nextName) {
      const employee = selectedEmployee();
      if (!employee) return;
      const input = document.getElementById('designer-employee-name-input');
      input?.classList.remove('error');
      const name = String(nextName ?? '').trim();
      if (!name) {
        input?.classList.add('error');
        return;
      }
      if (employee.id === NEW_EMPLOYEE_ID) {
        state.pendingEmployee = { ...employee, name, updatedAt: new Date().toISOString() };
        renderDesignerTitle();
        finishInlineRename();
        return;
      }
      const response = await fetch('/api/employees/' + encodeURIComponent(employee.id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        input?.classList.add('error');
        return;
      }
      state.selectedEmployeeId = payload.value.id;
      await loadEmployees();
      renderDesignerTitle();
      finishInlineRename();
    }

    async function publishSelectedEmployee() {
      let employee = selectedEmployee();
      if (!employee) return;
      const publishButton = document.getElementById('publish-employee');
      publishButton.disabled = true;
      publishButton.textContent = '发布中...';
      try {
        const saved = await saveRecordedWorkflowDraft({ silent: true });
        employee = saved.employee;
        if (!employee || employee.id === NEW_EMPLOYEE_ID) return;
        const response = await fetch('/api/employees/' + encodeURIComponent(employee.id) + '/publish', { method: 'POST' });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['发布员工失败']).join('\\n'));
        }
        recordingResultEl.textContent = '已保存录制脚本并发布员工。';
        await loadEmployees();
        await loadTriggers();
        renderDesignerTitle();
      } catch (error) {
        recordingResultEl.textContent = error.message;
        window.alert(error.message);
      } finally {
        publishButton.disabled = false;
        publishButton.textContent = '✈ 发布';
      }
    }

    async function deleteSelectedEmployee() {
      const employee = selectedEmployee();
      if (!employee || employee.id === NEW_EMPLOYEE_ID) return;
      if (!window.confirm('确定删除员工 “' + employee.name + '(' + employee.id + ')” 吗？')) return;
      const response = await fetch('/api/employees/' + encodeURIComponent(employee.id), { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        window.alert((payload.errors || ['删除员工失败']).join('\\n'));
        return;
      }
      state.selectedEmployeeId = null;
      await loadEmployees();
      await loadTriggers();
    }

    async function editSelectedEmployee() {
      const employee = selectedEmployee();
      if (!employee || employee.id === NEW_EMPLOYEE_ID) return;
      const response = await fetch('/api/employees/' + encodeURIComponent(employee.id) + '/edit', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        window.alert((payload.errors || ['打开员工编辑页失败']).join('\\n'));
        return;
      }
      await loadEmployees();
      await hydrateDesignerFromEmployee(payload.value);
      state.currentJourneyStep = 'record';
      showProductView('designer');
    }

    function resetDesignerForNewEmployee() {
      document.getElementById('journey-target-url').value = defaultDesignerSnapshot.targetUrl;
      document.getElementById('journey-goal').value = defaultDesignerSnapshot.goal;
      document.getElementById('recording-name').value = defaultDesignerSnapshot.recordingName;
      recorderUrlEl.value = defaultDesignerSnapshot.targetUrl;
      state.workflowVersionId = null;
      state.workflowSteps = [];
      state.recorderSourceVersionId = null;
      state.recorderDirty = false;
      state.inputBytes = null;
      state.inputFileName = null;
      document.getElementById('csv').value = '';
      inputFileEl.value = '';
      inputFileStatusEl.textContent = '可以粘贴输入数据，也可以导入 CSV、JSON 或 XLSX 文件。';
      inputPreviewEl.textContent = '暂无输入预览。';
      runPlanEl.textContent = '暂无运行计划。';
      state.recorderActions = cloneForClient(defaultDesignerSnapshot.recorderActions);
      state.selectedRecorderActionIndex = null;
      syncRecorderEditors({ dirty: false });
      selectWorkflowVersion(null);
      updateTestContext();
    }

    async function hydrateDesignerFromEmployee(employee) {
      if (!employee) return;
      state.pendingEmployee = null;
      state.selectedEmployeeId = employee.id;
      const script = employee.draftScript || employee.script || {};
      const versionId = script.workflowVersionId || employee.latestVersionId || employee.onlineVersionId || null;
      document.getElementById('recording-name').value = script.workflowName || employee.name || '浏览器操作流程';
      document.getElementById('journey-goal').value = script.workflowName
        ? '执行「' + script.workflowName + '」工作流。'
        : '编辑员工「' + employee.name + '」的浏览器操作流程。';
      document.getElementById('csv').value = '';
      inputPreviewEl.textContent = '暂无输入预览。';
      runPlanEl.textContent = '暂无运行计划。';
      state.inputBytes = null;
      state.inputFileName = null;
      inputFileEl.value = '';
      inputFileStatusEl.textContent = '可以粘贴输入数据，也可以导入 CSV、JSON 或 XLSX 文件。';

      let actions = [];
      let workflowName = script.workflowName || employee.name;
      if (versionId) {
        const stored = await loadStoredWorkflowVersion(versionId);
        if (stored) {
          workflowName = stored.workflow?.name || workflowName;
          actions = actionsFromStoredWorkflow(stored);
          state.workflowSteps = cloneForClient(stored.workflow?.steps || []);
          selectWorkflowVersion(versionId);
          state.recorderSourceVersionId = versionId;
        } else {
          state.workflowSteps = [];
          selectWorkflowVersion(null);
          state.recorderSourceVersionId = null;
        }
      } else {
        state.workflowSteps = [];
        selectWorkflowVersion(null);
        state.recorderSourceVersionId = null;
      }

      state.recorderActions = cloneForClient(actions);
      state.recorderDirty = false;
      state.selectedRecorderActionIndex = null;
      const firstOpen = state.recorderActions.find((action) => action.type === 'open' && action.url);
      const targetUrl = firstOpen?.url || defaultDesignerSnapshot.targetUrl;
      document.getElementById('journey-target-url').value = targetUrl;
      recorderUrlEl.value = targetUrl;
      document.getElementById('recording-name').value = workflowName || employee.name || '浏览器操作流程';
      syncRecorderEditors({ dirty: false });
      renderDesignerTitle();
      updateTestContext();
      resetRunState();
      await loadRuns();
    }

    async function loadStoredWorkflowVersion(versionId) {
      try {
        const response = await fetch('/api/workflows/' + encodeURIComponent(versionId));
        const payload = await response.json();
        return response.ok && payload.ok !== false ? payload.value : null;
      } catch {
        return null;
      }
    }

    function actionsFromStoredWorkflow(stored) {
      return Array.isArray(stored?.actions) && stored.actions.length > 0
        ? stored.actions
        : workflowStepsToRecordedActions(stored?.workflow?.steps || []);
    }

    function workflowStepsToRecordedActions(steps) {
      return (Array.isArray(steps) ? steps : []).map((step) => {
        const base = { id: step.id };
        if (step.type === 'browser.open') return { ...base, type: 'open', intent: step.id, url: step.url };
        if (step.type === 'browser.click') return { ...base, type: 'click', intent: step.id, target: step.target, approvalRequired: step.approvalRequired, skipWhen: step.skipWhen };
        if (step.type === 'browser.input') return { ...base, type: 'input', intent: step.id, target: step.target, value: step.value };
        if (step.type === 'browser.press') return { ...base, type: 'press', intent: step.id, target: step.target, key: step.key };
        if (step.type === 'browser.verify') return { ...base, type: 'verify', intent: step.id, expectation: step.expectation, skipWhen: step.skipWhen };
        if (step.type === 'browser.extract') return { ...base, type: 'extract', intent: step.id, extract: step.extract };
        if ((step.type || '').startsWith('strategy.')) return { ...base, type: 'strategy', intent: step.id, name: step.name, strategyType: step.type, strategy: step.strategy };
        return { ...base, type: 'wait', intent: step.id, timeoutMs: step.timeoutMs };
      }).filter((action) => action.type);
    }

    function cloneForClient(value) {
      return JSON.parse(JSON.stringify(value || []));
    }

    async function runSelectedEmployee() {
      const employee = selectedEmployee();
      if (!employee || employee.id === NEW_EMPLOYEE_ID) return;
      await fetch('/api/employees/' + encodeURIComponent(employee.id) + '/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(currentRunRequest())
      });
      await loadWorkLogs();
      showProductView('work-logs');
    }

    function currentRunRequest() {
      const csvText = document.getElementById('csv')?.value || '';
      return {
        mode: state.mode || 'run_once',
        browser: currentTrialBrowser(),
        runViewMode: currentRunViewMode(),
        approvals: approvals(),
        csv: csvText.trim() ? csvText : undefined,
        inputFormat: 'auto'
      };
    }

    function currentTrialBrowser() {
      return state.mode === 'run_once' ? 'playwright' : browserEl.value;
    }

    function currentRunViewMode() {
      return state.mode === 'run_once'
        ? state.runViewMode
        : browserEl.value === 'playwright'
          ? 'visible'
          : 'silent';
    }

    function updateTrialRuntimeControls() {
      const isRunOnce = state.mode === 'run_once';
      runViewPanelEl.classList.toggle('hidden', !isRunOnce);
      browserEl.disabled = isRunOnce;
      runtimeModeHintEl.textContent = isRunOnce
        ? '真实运行一条会自动使用 Playwright；可在上方选择可视或静默。'
        : '用于安全试跑或批量运行的执行环境。';
      document.getElementById('runtime-label').textContent = runtimeLabelText();
    }

    function runtimeLabelText() {
      if (state.mode === 'run_once') {
        return state.runViewMode === 'visible' ? 'Playwright 可视调试' : 'Playwright 静默运行';
      }
      return browserEl.value === 'playwright' ? 'Playwright Runtime' : 'Local Fake Runtime';
    }

    function employeeStatusText(employee) {
      if (employee.status === 'disabled') {
        return '停用 · v' + employee.version;
      }
      if (employee.status === 'draft' && employee.activeVersion) {
        return '草稿 · v' + employee.version + '（已发布 v' + employee.activeVersion + ' 生效中）';
      }
      return (employee.status === 'published' ? '已发布' : '草稿') + ' · v' + employee.version;
    }

    function relativeTime(value) {
      if (!value) return '刚刚';
      const elapsed = Date.now() - new Date(value).getTime();
      if (elapsed < 60_000) return '刚刚';
      if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + '分钟前';
      return new Date(value).toLocaleString();
    }

    function renderTriggerEmployeeOptions(selectedEmployeeId) {
      const select = document.getElementById('trigger-employee');
      const current = selectedEmployeeId || select.value;
      const availableEmployees = activeEmployeeList();
      select.innerHTML = availableEmployees.map((employee) => (
        '<option value="' + escapeAttr(employee.id) + '">' + escapeHtmlText(employee.name) + '(' + escapeHtmlText(employee.id) + ')</option>'
      )).join('') || '<option value="">暂无可选员工</option>';
      select.disabled = availableEmployees.length === 0;
      if (availableEmployees.some((employee) => employee.id === current)) {
        select.value = current;
      }
    }

    async function loadTriggers() {
      const response = await fetch('/api/triggers');
      const payload = await response.json();
      state.triggers = payload.ok ? payload.value : [];
      if (state.selectedTriggerId && !state.triggers.some((trigger) => trigger.id === state.selectedTriggerId)) {
        state.selectedTriggerId = null;
      }
      renderTriggers();
    }

    function renderTriggers() {
      const keyword = (document.getElementById('trigger-search')?.value || '').trim();
      const triggers = state.triggers.filter((trigger) => !keyword || trigger.name.includes(keyword));
      triggerCountEl.textContent = String(state.triggers.length);
      triggerEmptyEl.classList.toggle('hidden', triggers.length > 0);
      triggerTableWrapEl.classList.toggle('hidden', triggers.length === 0);
      triggerRowsEl.innerHTML = triggers.map((trigger) => {
        return '<tr class="trigger-row ' + (trigger.id === state.selectedTriggerId ? 'selected' : '') + '" data-trigger-id="' + escapeAttr(trigger.id) + '">' +
          '<td><button type="button" class="trigger-name-link" data-trigger-edit="' + escapeAttr(trigger.id) + '">' + escapeHtmlText(trigger.name) + '</button></td>' +
          '<td>定时</td>' +
          '<td>' + escapeHtmlText(trigger.employee.name + '(' + trigger.employee.id + ')') + '</td>' +
          '<td><button class="trigger-detail" data-trigger-detail="' + escapeAttr(trigger.id) + '">⏱ ' + escapeHtmlText(trigger.conditionText) + ' <span>详情</span></button></td>' +
          '<td><button class="switch ' + (trigger.schedule.enabled ? 'on' : '') + '" data-trigger-toggle="' + escapeAttr(trigger.id) + '" aria-label="启用状态"><span></span></button></td>' +
        '</tr>';
      }).join('');
      triggerActionsEl.classList.toggle('hidden', !state.selectedTriggerId || !triggers.some((trigger) => trigger.id === state.selectedTriggerId));
    }

    async function handleTriggerTableClick(event) {
      const editTarget = event.target.closest('[data-trigger-edit]');
      const detail = event.target.closest('[data-trigger-detail]');
      const toggle = event.target.closest('[data-trigger-toggle]');
      if (editTarget) {
        state.selectedTriggerId = editTarget.dataset.triggerEdit;
        renderTriggers();
        await openSelectedTriggerForEdit();
        return;
      }
      if (detail) {
        showTriggerPlan(detail.dataset.triggerDetail, detail);
        return;
      }
      if (toggle) {
        const trigger = state.triggers.find((item) => item.id === toggle.dataset.triggerToggle);
        if (!trigger) return;
        await fetch('/api/triggers/' + encodeURIComponent(trigger.id) + '/enabled', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !trigger.schedule.enabled })
        });
        await loadTriggers();
        return;
      }
      const row = event.target.closest('.trigger-row');
      if (row) {
        selectTrigger(row.dataset.triggerId);
      }
    }

    function selectTrigger(triggerId) {
      state.selectedTriggerId = triggerId;
      renderTriggers();
    }

    function clearTriggerSelection() {
      state.selectedTriggerId = null;
      renderTriggers();
    }

    async function setSelectedTriggerEnabled(enabled) {
      const trigger = state.triggers.find((item) => item.id === state.selectedTriggerId);
      if (!trigger) return;
      await fetch('/api/triggers/' + encodeURIComponent(trigger.id) + '/enabled', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      await loadTriggers();
    }

    function showTriggerPlan(triggerId, anchor) {
      const trigger = state.triggers.find((item) => item.id === triggerId);
      if (!trigger) return;
      const rect = anchor.getBoundingClientRect();
      triggerPlanPopoverEl.innerHTML = '<h3>ⓘ 提示</h3><p>预期将在以下时间点执行:</p><ol>' +
        trigger.nextRuns.map((time) => '<li>' + escapeHtmlText(time) + '</li>').join('') +
        '</ol><p>...</p>';
      triggerPlanPopoverEl.style.left = Math.min(rect.left, window.innerWidth - 310) + 'px';
      triggerPlanPopoverEl.style.top = (rect.bottom + 12) + 'px';
      triggerPlanPopoverEl.classList.remove('hidden');
    }

    async function loadWorkLogs() {
      const response = await fetch('/api/work-logs');
      const payload = await response.json();
      const logs = payload.ok ? payload.value : [];
      workLogCountEl.textContent = String(logs.length);
      workLogListEl.innerHTML = logs.length === 0
        ? '<div class="empty-inline work-log-empty"><div class="empty-robot document-empty">▤</div><h1>暂无日志</h1><p>应用运行后会产生日志，可在此追溯运行情况</p></div>'
        : logs.map((log) => '<article class="work-log-item"><strong>' + escapeHtmlText(log.triggerName) + '</strong><span>' + escapeHtmlText(log.startedAt) + '</span><p>' + escapeHtmlText(log.result.message) + '</p><pre>' + escapeHtmlText(JSON.stringify(log.params, null, 2)) + '</pre></article>').join('');
    }

    modeEl.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-mode]');
      if (!button) return;
      state.mode = button.dataset.mode;
      modeEl.querySelectorAll('button').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-checked', String(selected));
      });
      updateTrialRuntimeControls();
    });

    runViewModeEl.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-run-view-mode]');
      if (!button) return;
      state.runViewMode = button.dataset.runViewMode;
      runViewModeEl.querySelectorAll('button').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-checked', String(selected));
      });
      updateTrialRuntimeControls();
    });

    browserEl.addEventListener('change', updateTrialRuntimeControls);

    inputFileEl.addEventListener('change', async () => {
      const file = inputFileEl.files && inputFileEl.files[0];
      state.inputBytes = null;
      state.inputFileName = null;
      if (!file) {
        inputFileStatusEl.textContent = 'Paste rows below or import a CSV, JSON, or XLSX file.';
        return;
      }
      state.inputFileName = file.name;
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        state.inputBytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        inputFileStatusEl.textContent = 'Loaded XLSX file: ' + file.name + '. Run will parse the first worksheet.';
        await previewInput();
        return;
      }
      document.getElementById('csv').value = await file.text();
      inputFileStatusEl.textContent = 'Loaded text file: ' + file.name + '.';
      await previewInput();
    });

    previewInputEl.addEventListener('click', previewInput);
    previewPlanEl.addEventListener('click', previewRunPlan);

    runEl.addEventListener('click', runDesignerTrial);
    runTestPanelEl.addEventListener('click', runDesignerTrial);

    async function runDesignerTrial() {
      selectJourneyStep('test');
      updateTestContext();
      errorEl.textContent = '';
      runEl.disabled = true;
      runTestPanelEl.disabled = true;
      runEl.textContent = '试跑中...';
      runTestPanelEl.textContent = '试跑中...';
      document.getElementById('status').textContent = 'running';
      document.getElementById('run-id').textContent = 'Running...';
      try {
        const trialContext = await ensureRecordedWorkflowForTrial();
        await previewInput();
        await previewRunPlan({ skipEnsure: true });
        const employee = trialContext.employee || selectedEmployee();
        const endpoint = employee && employee.id !== NEW_EMPLOYEE_ID
          ? '/api/employees/' + encodeURIComponent(employee.id) + '/trial'
          : '/api/run';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...inputPayload(),
            mode: state.mode,
            browser: currentTrialBrowser(),
            runViewMode: currentRunViewMode(),
            workflowVersionId: state.workflowVersionId,
            rowIds: rowIds(),
            startStepId: document.getElementById('start-step').value.trim() || undefined,
            approvals: approvals()
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          if (payload.plan) {
            runPlanEl.innerHTML = runPlanHtml(payload.plan);
          }
          throw new Error((payload.errors || ['Run failed']).join('\\n'));
        }
        await render(payload.value);
        await loadRuns({ selectedRunId: payload.value.summary.runId });
      } catch (error) {
        errorEl.textContent = error.message;
      } finally {
        runEl.disabled = false;
        runTestPanelEl.disabled = false;
        runEl.textContent = '▶ 试跑';
        runTestPanelEl.textContent = '▶ 开始试跑';
      }
    }

    async function previewInput() {
      if (!state.inputBytes && !document.getElementById('csv').value.trim()) {
        inputPreviewEl.innerHTML = '<span class="empty">未提供输入数据；试跑会以当前录制脚本为准，并使用 1 条内部试跑样例驱动流程。</span>';
        return;
      }
      inputPreviewEl.textContent = '正在预览输入...';
      previewInputEl.disabled = true;
      try {
        const response = await fetch('/api/input/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(inputPayload())
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Input preview failed']).join('\\n'));
        }
        inputPreviewEl.innerHTML = inputPreviewHtml(payload.value);
      } catch (error) {
        inputPreviewEl.textContent = error.message;
      } finally {
        previewInputEl.disabled = false;
      }
    }

    function inputPayload() {
      const csvText = document.getElementById('csv').value;
      const trimmedCsv = csvText.trim();
      return {
        csv: state.inputBytes ? '' : (trimmedCsv || fallbackTrialCsv()),
        inputBytes: state.inputBytes,
        inputFormat: state.inputBytes ? 'xlsx' : 'auto'
      };
    }

    function fallbackTrialCsv() {
      const employee = selectedEmployee();
      const name = (employee?.name || '新建员工').replace(/"/g, '""');
      return 'rowId,productUrl,title,groupName,remark\\nmanual-run,https://example.com/employee-run,"' + name + '",,auto generated for employee trial';
    }

    async function ensureRecordedWorkflowForTrial() {
      if (state.workflowVersionId && !state.recorderDirty) {
        await refreshMainFlowFromSavedWorkflow({ force: true });
        updateTestContext();
        return { employee: selectedEmployee(), versionId: state.workflowVersionId };
      }
      const saved = await saveRecordedWorkflowDraft({ silent: true });
      updateTestContext();
      return saved;
    }

    async function previewRunPlan(options = {}) {
      runPlanEl.textContent = '正在预览运行计划...';
      previewPlanEl.disabled = true;
      try {
        if (!options.skipEnsure) {
          await ensureRecordedWorkflowForTrial();
        }
        const response = await fetch('/api/run/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...inputPayload(),
            mode: state.mode,
            workflowVersionId: state.workflowVersionId,
            rowIds: rowIds(),
            approvals: approvals()
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Run plan failed']).join('\\n'));
        }
        runPlanEl.innerHTML = runPlanHtml(payload.value);
      } catch (error) {
        runPlanEl.textContent = error.message;
      } finally {
        previewPlanEl.disabled = false;
      }
    }

    refreshRunsEl.addEventListener('click', loadRuns);
    clearEmployeeRunsEl.addEventListener('click', clearEmployeeRuns);
    refreshProfileEl.addEventListener('click', loadDoctorStatus);
    openLoginEl.addEventListener('click', openLoginBrowser);
    exportResultsEl.addEventListener('click', () => {
      if (!state.runId) return;
      window.location.href = employeeRunAssetUrl(state.runId, 'export.csv');
    });
    exportTraceEl.addEventListener('click', () => {
      if (!state.runId) return;
      window.open(employeeRunAssetUrl(state.runId, 'trace-json'), '_blank');
    });
    viewTraceEl.addEventListener('click', () => {
      if (!state.runId) return;
      window.open(employeeRunAssetUrl(state.runId, 'trace'), '_blank');
    });

    patchEl.addEventListener('click', async () => {
      patchResultEl.textContent = '';
      try {
        const response = await fetch('/api/workflow/patch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            stepId: document.getElementById('patch-step').value,
            target: JSON.parse(document.getElementById('patch-target').value),
            note: 'Validated from local console'
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Patch failed']).join('\\n'));
        }
        patchResultEl.textContent = 'Patch valid for step ' + payload.value.changedStepId;
        await loadWorkflowVersions();
        selectWorkflowVersion(payload.value.versionId);
      } catch (error) {
        patchResultEl.textContent = error.message;
      }
    });
    refreshWorkflowsEl.addEventListener('click', loadWorkflowVersions);
    useDefaultWorkflowEl.addEventListener('click', () => selectWorkflowVersion(null));
    loadSelectedWorkflowEl.addEventListener('click', loadSelectedWorkflow);
    viewDefaultWorkflowEl.addEventListener('click', loadDefaultWorkflow);
    validateWorkflowEl.addEventListener('click', validateWorkflowJson);
    saveWorkflowVersionEl.addEventListener('click', saveWorkflowVersion);
    downloadDefaultWorkflowEl.addEventListener('click', () => {
      window.location.href = '/api/workflow/default.json';
    });
    saveRecordingEl.addEventListener('click', saveRecording);

    workflowVersionsEl.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('button[data-delete-workflow-version-id]');
      if (deleteButton) {
        deleteWorkflowVersion(deleteButton.dataset.deleteWorkflowVersionId);
        return;
      }
      const button = event.target.closest('button[data-workflow-version-id]');
      if (!button) return;
      selectWorkflowVersion(button.dataset.workflowVersionId);
    });

    recentRunsEl.addEventListener('click', async (event) => {
      const deleteButton = event.target.closest('button[data-delete-run-id]');
      if (deleteButton) {
        await deleteRun(deleteButton.dataset.deleteRunId);
        return;
      }
      const button = event.target.closest('button[data-open-run-id]');
      if (!button) return;
      await openRunHistory(button.dataset.openRunId);
    });

    document.getElementById('rows').addEventListener('click', async (event) => {
      const row = event.target.closest('[data-run-row-id]');
      if (!row) return;
      await openRunHistory(row.dataset.runRowId);
    });

    async function deleteRun(runId) {
      if (!runId) return;
      errorEl.textContent = '';
      try {
        const response = await fetch(employeeRunUrl(runId), { method: 'DELETE' });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Unable to delete run']).join('\\n'));
        }
        if (state.runId === runId) {
          state.runId = null;
          state.currentRunView = null;
          state.currentTraceRow = null;
          state.selectedTestFlowIndex = null;
          exportResultsEl.disabled = true;
          exportTraceEl.disabled = true;
          viewTraceEl.disabled = true;
          renderRunSummary();
          renderRunRows();
          renderTestFlowList();
          renderTrace(null);
        }
        await loadRuns();
      } catch (error) {
        errorEl.textContent = error.message;
      }
    }

    async function clearEmployeeRuns() {
      const employee = selectedEmployee();
      if (!employee || employee.id === NEW_EMPLOYEE_ID) {
        errorEl.textContent = '请先保存或选择员工，再清除运行记录。';
        return;
      }
      errorEl.textContent = '';
      clearEmployeeRunsEl.disabled = true;
      try {
        const response = await fetch(employeeRunsUrl(), { method: 'DELETE' });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Unable to clear runs']).join('\\n'));
        }
        resetRunDisplayState({ clearSummaries: true });
        await loadRuns();
      } catch (error) {
        errorEl.textContent = error.message;
      } finally {
        clearEmployeeRunsEl.disabled = false;
      }
    }

    async function deleteWorkflowVersion(versionId) {
      if (!versionId) return;
      workflowSaveResultEl.textContent = '';
      try {
        const response = await fetch('/api/workflows/' + encodeURIComponent(versionId), { method: 'DELETE' });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Unable to delete workflow version']).join('\\n'));
        }
        if (state.workflowVersionId === versionId) {
          selectWorkflowVersion(null);
        }
        workflowSaveResultEl.textContent = 'Deleted workflow version ' + versionId + '.';
        await loadWorkflowVersions();
      } catch (error) {
        workflowSaveResultEl.textContent = error.message;
      }
    }

    async function saveRecordedWorkflowDraft(options = {}) {
      const silent = Boolean(options.silent);
      if (!silent) {
        recordingResultEl.textContent = '';
        saveRecordingEl.disabled = true;
        saveRecordingEl.textContent = '保存中...';
      }
      try {
        const nameInput = document.getElementById('recording-name');
        const employeeBeforeSave = selectedEmployee();
        const name = (nameInput?.value || employeeBeforeSave?.name || '浏览器操作流程').trim() || '浏览器操作流程';
        const actions = JSON.parse(document.getElementById('recording-actions').value);
        if (!Array.isArray(actions) || actions.length === 0) {
          throw new Error('当前没有可保存的录制动作。');
        }
        let employee = employeeBeforeSave;
        if (employee && employee.id === NEW_EMPLOYEE_ID) {
          employee = await saveCurrentEmployee();
        }
        const endpoint = employee
          ? '/api/employees/' + encodeURIComponent(employee.id) + '/recording'
          : '/api/recorder/workflow';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'console-recording',
            name,
            workflowId: name,
            actions,
            note: employee ? 'Saved from employee designer recorder' : 'Imported from local console recorder JSON'
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Recording import failed']).join('\\n'));
        }
        await loadWorkflowVersions();
        selectWorkflowVersion(payload.value.versionId);
        state.workflowSteps = cloneForClient(payload.value.workflow?.steps || []);
        state.recorderSourceVersionId = payload.value.versionId;
        state.recorderDirty = false;
        await loadEmployees();
        const savedEmployee = employee ? selectedEmployee() || payload.value.employee || employee : null;
        if (!silent) {
          recordingResultEl.textContent = employee
            ? '已保存到员工 ' + payload.value.employee.name + '(' + payload.value.employee.id + ') 的草稿脚本。发布后生效。'
            : 'Saved workflow ' + payload.value.workflow.workflowId;
        }
        return { employee: savedEmployee, versionId: payload.value.versionId, payload };
      } catch (error) {
        if (!silent) {
          recordingResultEl.textContent = error.message;
        }
        throw error;
      } finally {
        if (!silent) {
          saveRecordingEl.disabled = false;
          saveRecordingEl.textContent = '保存为员工工作流';
        }
      }
    }

    async function saveRecording() {
      recordingResultEl.textContent = '';
      saveRecordingEl.disabled = true;
      saveRecordingEl.textContent = '保存中...';
      try {
        await saveRecordedWorkflowDraft({ silent: false });
      } catch (error) {
        recordingResultEl.textContent = error.message;
      } finally {
        saveRecordingEl.disabled = false;
        saveRecordingEl.textContent = '保存为员工工作流';
      }
    }

    async function loadDefaultWorkflow() {
      try {
        const response = await fetch('/api/workflow/default');
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Workflow not found']).join('\\n'));
        }
        workflowPreviewEl.value = JSON.stringify(payload.value, null, 2);
        workflowPreviewEl.classList.remove('collapsed');
      } catch (error) {
        workflowPreviewEl.value = error.message;
        workflowPreviewEl.classList.remove('collapsed');
      }
    }

    async function loadSelectedWorkflow() {
      workflowSaveResultEl.textContent = '';
      if (!state.workflowVersionId) {
        await loadDefaultWorkflow();
        workflowSaveResultEl.textContent = 'Loaded default workflow into editor.';
        return;
      }
      try {
        const response = await fetch('/api/workflows/' + encodeURIComponent(state.workflowVersionId));
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Workflow version not found']).join('\\n'));
        }
        workflowPreviewEl.value = JSON.stringify(payload.value.workflow, null, 2);
        workflowPreviewEl.classList.remove('collapsed');
        workflowSaveResultEl.textContent = 'Loaded workflow version ' + state.workflowVersionId + ' into editor.';
      } catch (error) {
        workflowSaveResultEl.textContent = error.message;
      }
    }

    async function saveWorkflowVersion() {
      workflowSaveResultEl.textContent = '';
      try {
        const workflow = JSON.parse(workflowPreviewEl.value);
        const response = await fetch('/api/workflow/version', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workflow,
            note: 'Saved from local console workflow JSON editor'
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Workflow save failed']).join('\\n'));
        }
        workflowSaveResultEl.textContent = 'Saved workflow version for ' + payload.value.workflow.workflowId;
        await loadWorkflowVersions();
        selectWorkflowVersion(payload.value.versionId);
      } catch (error) {
        workflowSaveResultEl.textContent = error.message;
      }
    }

    async function validateWorkflowJson() {
      workflowSaveResultEl.textContent = '';
      try {
        const workflow = JSON.parse(workflowPreviewEl.value);
        const response = await fetch('/api/workflow/validate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workflow })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Workflow validation failed']).join('\\n'));
        }
        workflowSaveResultEl.textContent =
          'Workflow valid: ' + payload.value.workflowId + ' · ' + payload.value.stepCount + ' steps';
      } catch (error) {
        workflowSaveResultEl.textContent = error.message;
      }
    }

    async function render(view) {
      state.runId = view.summary.runId;
      document.getElementById('runtime-label').textContent = runtimeLabelText();
      renderRunDetails(view);
      await loadRuns({ selectedRunId: view.summary.runId, skipAutoOpen: true });
    }

    function renderRunDetails(view) {
      state.runId = view.summary.runId;
      state.currentRunView = view;
      exportResultsEl.disabled = false;
      exportTraceEl.disabled = false;
      viewTraceEl.disabled = false;
      renderRunSummary();
      state.currentTraceRow = view.rows.find((row) => row.error || row.status === 'requires_approval') || view.rows[0];
      renderTestFlowList();
      renderSelectedTestFlowTrace();
    }

    function renderRunSummary() {
      const aggregate = aggregateRunSummaries(state.runSummaries);
      document.getElementById('run-id').textContent = state.runId ? '选中运行 ID ' + state.runId : '暂无选中运行';
      document.getElementById('total').textContent = aggregate.total;
      document.getElementById('success').textContent = aggregate.success;
      document.getElementById('failed').textContent = aggregate.failed;
      document.getElementById('approval').textContent = aggregate.approval;
      document.getElementById('status').textContent = aggregate.statusText;
    }

    function renderRunRows() {
      document.getElementById('rows').innerHTML = state.runSummaries.length === 0
        ? '<tr class="run-history-empty"><td colspan="10">暂无运行记录</td></tr>'
        : state.runSummaries.map((run, index) => runHistoryRowHtml(run, index)).join('');
    }

    function resetValidationStateForWorkflowChange() {
      resetRunDisplayState({ clearSummaries: true });
    }

    function aggregateRunSummaries(runs) {
      const total = runs.length;
      const failed = runs.filter((run) => run.status === 'failed' || Number(run.failedCount || 0) > 0).length;
      const approval = runs.filter((run) => run.status === 'requires_approval' || Number(run.approvalCount || 0) > 0).length;
      const running = runs.filter((run) => run.status === 'running').length;
      const success = runs.filter((run) => (run.status === 'completed' || run.status === 'success') && Number(run.failedCount || 0) === 0 && Number(run.approvalCount || 0) === 0).length;
      const statusText = total === 0
        ? '暂无记录'
        : failed > 0
          ? '有失败'
          : approval > 0
            ? '有待审批'
            : running > 0
              ? '运行中'
              : '全部完成';
      return { total, success, failed, approval, statusText };
    }

    function approvals() {
      const values = new Set();
      if (state.mode !== 'dry_run') values.add('final_submit');
      if (state.mode === 'batch') values.add('batch');
      if (document.getElementById('approve-final').checked) values.add('final_submit');
      if (document.getElementById('approve-batch').checked) values.add('batch');
      return [...values];
    }

    function rowIds() {
      return document.getElementById('row-ids').value.split(',').map((rowId) => rowId.trim()).filter(Boolean);
    }

    async function loadRuns(options = {}) {
      const response = await fetch(employeeRunsUrl());
      const payload = await response.json();
      if (!payload.ok) return;
      state.runSummaries = payload.value;
      if (options.selectedRunId) {
        state.runId = options.selectedRunId;
      } else if (state.runId && !state.runSummaries.some((run) => run.runId === state.runId)) {
        state.runId = null;
      }
      if (!state.runId && state.runSummaries.length > 0) {
        state.runId = state.runSummaries[0].runId;
      }
      renderRunSummary();
      renderRunRows();
      recentRunsEl.innerHTML = payload.value.length === 0
        ? '<span class="empty">暂无历史运行。</span>'
        : payload.value.slice(0, 6).map((run) => runSummaryHtml(run)).join('');
      if (state.runSummaries.length === 0) {
        renderRunSummary();
        state.currentRunView = null;
        state.currentTraceRow = null;
        state.selectedTestFlowIndex = null;
        renderTestFlowList();
        renderTrace(null);
        exportResultsEl.disabled = true;
        exportTraceEl.disabled = true;
        viewTraceEl.disabled = true;
        return;
      }
      if (!options.skipAutoOpen && state.runId) {
        await openRunHistory(state.runId, { skipListRefresh: true });
      }
    }

    function resetRunState() {
      resetRunDisplayState({ clearSummaries: true });
    }

    function resetRunDisplayState(options = {}) {
      state.runId = null;
      state.currentRunView = null;
      state.currentTraceRow = null;
      state.selectedTestFlowIndex = null;
      if (options.clearSummaries) {
        state.runSummaries = [];
      }
      document.getElementById('rows').innerHTML = '<tr class="run-history-empty"><td colspan="10">暂无运行记录</td></tr>';
      recentRunsEl.innerHTML = '<span class="empty">暂无历史运行。</span>';
      renderRunSummary();
      renderRunRows();
      renderTestFlowList();
      renderTrace(null);
      exportResultsEl.disabled = true;
      exportTraceEl.disabled = true;
      viewTraceEl.disabled = true;
    }

    async function openRunHistory(runId, options = {}) {
      if (!runId) return;
      errorEl.textContent = '';
      try {
        const response = await fetch(employeeRunUrl(runId));
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Run not found']).join('\\n'));
        }
        renderRunDetails(payload.value);
        if (!options.skipListRefresh) {
          await loadRuns({ selectedRunId: runId, skipAutoOpen: true });
        }
      } catch (error) {
        errorEl.textContent = error.message;
      }
    }

    function employeeRunsUrl() {
      const employee = selectedEmployee();
      return employee && employee.id !== NEW_EMPLOYEE_ID
        ? '/api/employees/' + encodeURIComponent(employee.id) + '/runs'
        : '/api/runs';
    }

    function employeeRunUrl(runId) {
      const employee = selectedEmployee();
      return employee && employee.id !== NEW_EMPLOYEE_ID
        ? '/api/employees/' + encodeURIComponent(employee.id) + '/runs/' + encodeURIComponent(runId)
        : '/api/runs/' + encodeURIComponent(runId);
    }

    function employeeRunAssetUrl(runId, suffix) {
      return employeeRunUrl(runId) + '/' + suffix;
    }

    async function loadDoctorStatus() {
      const response = await fetch('/api/doctor');
      const payload = await response.json();
      if (!payload.ok) return;
      profileStatusEl.innerHTML = doctorHtml(payload.value);
    }

    async function openLoginBrowser() {
      openLoginEl.disabled = true;
      openLoginEl.textContent = 'Opening...';
      try {
        const response = await fetch('/api/browser/login', { method: 'POST' });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error((payload.errors || ['Unable to open login browser']).join('\\n'));
        }
        profileStatusEl.innerHTML =
          '<strong>Login browser opened</strong>' +
          '<span>' + escapeHtml(payload.value.message) + '</span>' +
          '<span>' + escapeHtml(payload.value.userDataDir) + '</span>';
      } catch (error) {
        profileStatusEl.innerHTML = '<strong>Unable to open login browser</strong><span>' + escapeHtml(error.message) + '</span>';
      } finally {
        openLoginEl.disabled = false;
        openLoginEl.textContent = 'Open Login Browser';
      }
    }

    function runSummaryHtml(run) {
      const workflow = run.workflowVersionId ? '版本 ' + run.workflowVersionId : '默认工作流';
      return '<div class="run-item">' +
        '<button class="run-open" data-open-run-id="' + escapeHtml(run.runId) + '">' +
          '<strong>' + escapeHtml(statusText(run.status)) + '</strong>' +
          '<span>' + escapeHtml(modeText(run.mode)) + ' · ' + run.totalItems + ' 条 · ' + escapeHtml(workflow) + ' · ' + escapeHtml(run.startedAt) + '</span>' +
        '</button>' +
        '<button class="link-button danger" data-delete-run-id="' + escapeHtml(run.runId) + '">删除</button>' +
        '</div>';
    }

    function doctorHtml(report) {
      const rows = report.checks.map((check) => '<li>' +
        '<strong><span class="badge ' + statusClass(check.status === 'error' ? 'failed' : check.status === 'warning' ? 'approval' : 'success') + '">' + escapeHtml(check.status) + '</span> ' + escapeHtml(check.name) + '</strong>' +
        '<span>' + escapeHtml(check.message) + '</span>' +
      '</li>').join('');
      return '<strong>Doctor: ' + escapeHtml(report.status) + '</strong><ul>' + rows + '</ul>';
    }

    async function loadWorkflowVersions() {
      const response = await fetch('/api/workflows');
      const payload = await response.json();
      if (!payload.ok) return;
      if (state.workflowVersionId && !payload.value.some((version) => version.versionId === state.workflowVersionId)) {
        selectWorkflowVersion(null);
      }
      workflowVersionsEl.innerHTML = payload.value.length === 0
        ? '<span class="empty">No saved workflow versions.</span>'
        : payload.value.slice(0, 5).map((version) => workflowVersionHtml(version)).join('');
    }

    function workflowVersionHtml(version) {
      const selected = version.versionId === state.workflowVersionId;
      return '<div class="run-item workflow-version' + (selected ? ' selected' : '') + '">' +
        '<button class="run-open" data-workflow-version-id="' + escapeHtml(version.versionId) + '">' +
          '<strong>' + escapeHtml(version.workflowId) + '</strong>' +
          '<span>' + (selected ? 'Selected · ' : '') + escapeHtml(version.createdAt) + (version.note ? ' · ' + escapeHtml(version.note) : '') + '</span>' +
        '</button>' +
        '<button class="link-button danger" data-delete-workflow-version-id="' + escapeHtml(version.versionId) + '">Delete</button>' +
        '</div>';
    }

    function selectWorkflowVersion(versionId) {
      state.workflowVersionId = versionId || null;
      if (!state.workflowVersionId) {
        state.recorderSourceVersionId = null;
      } else if (state.recorderSourceVersionId !== state.workflowVersionId) {
        state.recorderSourceVersionId = null;
      }
      selectedWorkflowEl.textContent = state.workflowVersionId || 'Default workflow';
      workflowVersionsEl.querySelectorAll('[data-workflow-version-id]').forEach((button) => {
        const selected = button.dataset.workflowVersionId === state.workflowVersionId;
        const item = button.closest('.workflow-version') || button;
        item.classList.toggle('selected', selected);
        const span = button.querySelector('span');
        if (span) span.textContent = span.textContent.replace(/^Selected · /, '');
        if (selected && span) span.textContent = 'Selected · ' + span.textContent;
      });
    }

    function runHistoryRowHtml(run, index) {
      const employee = selectedEmployee();
      const employeeName = employee?.name || run.workflowId || '员工运行';
      return '<tr class="run-history-row ' + (run.runId === state.runId ? 'selected' : '') + '" data-run-row-id="' + escapeAttr(run.runId) + '">' +
        '<td>' + (index + 1) + '</td>' +
        '<td>' + escapeHtml(employeeName) + '</td>' +
        '<td>' + escapeHtml(run.runId) + '</td>' +
        '<td><span class=\"badge ' + statusClass(run.status) + '\">' + escapeHtml(statusText(run.status)) + '</span></td>' +
        '<td>' + escapeHtml(run.totalItems) + '</td>' +
        '<td>' + escapeHtml(run.successCount) + '</td>' +
        '<td>' + escapeHtml(run.failedCount) + '</td>' +
        '<td>' + escapeHtml(run.approvalCount) + '</td>' +
        '<td>' + escapeHtml(modeText(run.mode)) + '</td>' +
        '<td>' + escapeHtml(run.startedAt || '-') + '</td>' +
        '</tr>';
    }

    function inputPreviewHtml(preview) {
      const rows = preview.rows.length === 0
        ? '<span class="empty">No rows parsed.</span>'
        : '<table><thead><tr><th>rowId</th><th>Title</th><th>Product</th><th>Group</th></tr></thead><tbody>' +
          preview.rows.map((row) => '<tr>' +
            '<td>' + escapeHtml(row.rowId || '-') + '</td>' +
            '<td>' + escapeHtml(row.title || '-') + '</td>' +
            '<td>' + escapeHtml(row.productUrl || row.productId || '-') + '</td>' +
            '<td>' + escapeHtml(row.groupName || '-') + '</td>' +
          '</tr>').join('') +
          '</tbody></table>';
      return '<strong>' + preview.totalItems + ' product rows parsed</strong>' + rows;
    }

    function runPlanHtml(plan) {
      const status = plan.canRun ? 'Ready to run' : 'Needs attention';
      const missing = plan.missingApprovals.length
        ? '<li>Missing approvals: ' + escapeHtml(plan.missingApprovals.join(', ')) + '</li>'
        : '';
      const blockers = plan.blockers.map((blocker) => '<li>' + escapeHtml(blocker) + '</li>').join('');
      const warnings = plan.warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join('');
      const details = [missing, blockers, warnings].filter(Boolean).join('');
      const steps = plan.steps && plan.steps.length
        ? '<table><thead><tr><th>Step</th><th>Layer</th><th>Type</th><th>Status</th><th>Reason</th></tr></thead><tbody>' +
          plan.steps.map((step) => '<tr>' +
            '<td>' + escapeHtml(step.stepId) + '</td>' +
            '<td>' + escapeHtml(step.layer || nodeLayerForType(step.type)) + '</td>' +
            '<td>' + escapeHtml(step.type) + '</td>' +
            '<td><span class="badge ' + statusClass(step.status === 'requires_approval' ? 'requires_approval' : step.status === 'blocked' ? 'failed' : step.status === 'ready' ? 'success' : 'neutral') + '">' + escapeHtml(step.status) + '</span></td>' +
            '<td>' + escapeHtml(step.reason || '-') + '</td>' +
          '</tr>').join('') +
          '</tbody></table>'
        : '';
      return '<strong>' + escapeHtml(status) + ' · ' + plan.totalItems + ' item(s) · ' + escapeHtml(plan.mode) + '</strong>' +
        '<span>Workflow: ' + escapeHtml(plan.workflowVersionId || plan.workflowId) + '</span>' +
        (details ? '<ul>' + details + '</ul>' : '<span class="ok">No missing approvals or blockers.</span>') +
        steps;
    }

    function nodeLayerForType(type) {
      if ((type || '').startsWith('flow.')) return 'control';
      if ((type || '').startsWith('strategy.')) return 'strategy';
      return 'primitive';
    }

    function renderTrace(row, options = {}) {
      const action = Number.isInteger(options.actionIndex) ? state.recorderActions[options.actionIndex] : null;
      const entries = row && action ? timelineEntriesForAction(row.timeline, action, options.actionIndex) : (row?.timeline || []);
      document.getElementById('trace-title').textContent = row
        ? (action ? '节点 ' + (options.actionIndex + 1) + ' · ' + actionTaskItem(action).title : (row.title || row.rowId))
        : '未选择运行记录';
      document.getElementById('trace-status').textContent = row ? (action ? statusText(testFlowNodeStatus(action, options.actionIndex)) : statusText(row.status)) : '等待中';
      document.getElementById('timeline').innerHTML = row ? (entries.length === 0
        ? '<li><strong>暂无该节点事件</strong><span>当前运行记录中没有匹配到这个节点的执行事件。</span></li>'
        : entries.map((entry) => {
        const label = entry.stepId ? entry.type + ' / ' + entry.stepId : entry.type;
        const locator = locatorSummary(entry.data);
        const snapshot = entry.snapshot ? ' Snapshot: ' + snapshotSummary(entry.snapshot) : '';
        return '<li><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml((entry.message || '无消息。') + locator + snapshot) + '</span></li>';
      }).join('')) : '';
    }

    function timelineEntriesForAction(timeline, action, index) {
      const ids = actionStepIds(action, index);
      let entries = (timeline || []).filter((entry) => entry.stepId && ids.includes(entry.stepId));
      if (entries.length === 0 && Number.isInteger(index) && canUseOrderedTraceFallback()) {
        const fallbackStepId = orderedTraceStepIds(timeline)[index];
        if (fallbackStepId) {
          entries = (timeline || []).filter((entry) => entry.stepId === fallbackStepId);
        }
      }
      return entries;
    }

    function canUseOrderedTraceFallback() {
      const runWorkflowVersionId = state.currentRunView?.summary?.workflowVersionId;
      return Boolean(runWorkflowVersionId && state.workflowVersionId && runWorkflowVersionId === state.workflowVersionId);
    }

    function testFlowNodeStatus(action, index) {
      if (!state.currentTraceRow) return index === 0 ? 'ready' : 'idle';
      const entries = timelineEntriesForAction(state.currentTraceRow.timeline, action, index);
      if (entries.some((entry) => entry.type === 'step.failed')) return 'failed';
      if (entries.some((entry) => entry.type === 'step.requires_approval')) return 'requires_approval';
      if (entries.some((entry) => entry.type === 'step.succeeded')) return 'success';
      if (entries.some((entry) => entry.type === 'step.started')) return 'running';
      return 'idle';
    }

    function actionStepIds(action, index) {
      const ids = new Set();
      const workflowStepId = state.workflowSteps[index]?.id;
      [workflowStepId, action.id, action.intent, normalizeActionId(action.intent), normalizeActionId(action.id), action.type ? action.type + '_' + (index + 1) : null]
        .filter(Boolean)
        .forEach((id) => ids.add(id));
      return [...ids];
    }

    function orderedTraceStepIds(timeline) {
      const seen = new Set();
      return (timeline || [])
        .filter((entry) => entry.stepId && (entry.type === 'step.started' || entry.type === 'step.succeeded' || entry.type === 'step.failed' || entry.type === 'step.skipped' || entry.type === 'step.requires_approval'))
        .map((entry) => entry.stepId)
        .filter((stepId) => {
          if (seen.has(stepId)) return false;
          seen.add(stepId);
          return true;
        });
    }

    function normalizeActionId(value) {
      const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return normalized || null;
    }

    function statusText(status) {
      if (status === 'success') return '成功';
      if (status === 'failed') return '失败';
      if (status === 'requires_approval') return '待审批';
      if (status === 'completed') return '已完成';
      if (status === 'running') return '运行中';
      if (status === 'skipped') return '已跳过';
      if (status === 'ready') return '待运行';
      if (status === 'idle') return '未运行';
      return status || '未知';
    }

    function modeText(mode) {
      if (mode === 'dry_run') return '安全试跑';
      if (mode === 'run_once') return '真实运行一条';
      if (mode === 'batch') return '批量运行';
      return mode || '未知模式';
    }

    function locatorSummary(data) {
      if (!data || !data.locator || !data.locator.selected) return '';
      const selected = data.locator.selected;
      const score = typeof selected.score === 'number' ? selected.score.toFixed(2) : '-';
      return ' Locator: ' + selected.strategy + '=' + selected.value + ' score=' + score + ' confidence=' + (data.locator.confidence || '-') + '.';
    }

    function snapshotSummary(snapshot) {
      const screenshot = snapshot.screenshot && typeof snapshot.screenshot.bytes === 'number'
        ? snapshot.screenshot.bytes + ' screenshot bytes'
        : undefined;
      const screenshotError = typeof snapshot.screenshotError === 'string' ? 'screenshot error: ' + snapshot.screenshotError : undefined;
      return [snapshot.title, snapshot.url, snapshot.openedUrl, typeof snapshot.htmlLength === 'number' ? snapshot.htmlLength + ' html chars' : undefined, screenshot, screenshotError].filter(Boolean).join(' | ') || 'captured';
    }

    function statusClass(status) {
      if (status === 'success') return 'success';
      if (status === 'failed') return 'failed';
      if (status === 'requires_approval') return 'approval';
      return 'neutral';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
    }

    function escapeHtmlText(value) {
      return escapeHtml(value);
    }

    function escapeAttr(value) {
      return escapeHtml(value);
    }

    syncRecordedActionsFromJson({ dirty: false });
    updateTrialRuntimeControls();
    selectDesignerTab('recording');
  `;
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
    ${sharedComponentStyles()}
    :root { color-scheme: light; --bg:#f5f7fb; --panel:#fff; --line:#dbe2ee; --text:#111827; --muted:#667085; --blue:#2563eb; --green:#16a34a; --red:#dc2626; --orange:#ea580c; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); }
    .client-frame { min-height:100vh; background:#f5f7fb; }
    .hidden { display:none !important; }
    button, .icon-action, .link-button, .tool-button, .create-button, .side-item, .top-tab, .flow-tab, .switch { transition:background-color .16s ease, color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .12s ease, opacity .16s ease; }
    button:hover:not(:disabled), .icon-action:hover:not(:disabled), .link-button:hover:not(:disabled), .tool-button:hover:not(:disabled) { transform:translateY(-1px); }
    button:active:not(:disabled), .icon-action:active:not(:disabled), .link-button:active:not(:disabled), .tool-button:active:not(:disabled) { transform:translateY(0) scale(.98); }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline:2px solid rgba(255,77,85,.34); outline-offset:2px; }
    .app-topnav { position:sticky; top:0; z-index:60; height:70px; display:grid; grid-template-columns:260px minmax(0, 1fr) auto auto; align-items:center; gap:18px; padding:0 28px; background:#fff; border-bottom:1px solid #eef1f6; box-shadow:0 10px 30px rgba(15,23,42,.04); }
    .app-topnav .brand { gap:14px; }
    .app-topnav .brand strong { font-size:18px; }
    .brand-mark { width:32px; height:32px; border-radius:50%; background:#ff4d55; color:#fff; display:grid; place-items:center; font-weight:900; }
    .primary-tabs { display:flex; align-items:stretch; gap:52px; height:100%; }
    .primary-tabs .top-tab { position:relative; border:0; background:transparent; color:#4b5565; padding:0 4px; border-radius:0; font-size:17px; font-weight:800; cursor:pointer; }
    .primary-tabs .top-tab:focus { outline:none; }
    .primary-tabs .top-tab.active { color:#ff4d55; }
    .primary-tabs .top-tab.active::after { content:""; position:absolute; left:0; right:0; bottom:0; height:3px; background:#ff4d55; border-radius:999px 999px 0 0; }
    .account-chip { width:36px; height:36px; border-radius:50%; background:#d8d3ec; color:#3e365a; display:grid; place-items:center; font-weight:800; }
    .runtime-chip { color:#98a2b3; font-size:12px; white-space:nowrap; }
    .app-shell { display:grid; grid-template-columns:260px minmax(0, 1fr); min-height:calc(100vh - 70px); }
    .sidebar { background:#fff; border-right:1px solid #edf1f7; padding:28px 22px; display:flex; flex-direction:column; gap:24px; }
    .create-button { width:100%; border:0; border-radius:999px; background:#ff4d55; color:#fff; padding:14px 18px; font-size:16px; font-weight:900; box-shadow:0 12px 24px rgba(255,77,85,.18); cursor:pointer; }
    .create-button:hover { background:#f0444d; box-shadow:0 16px 30px rgba(255,77,85,.24); }
    .create-button.small { width:auto; border-radius:10px; padding:11px 18px; }
    .side-group { display:grid; gap:10px; }
    .side-title { color:#98a2b3; font-size:13px; font-weight:800; margin:0 0 4px; }
    .side-item { display:flex; justify-content:space-between; align-items:center; width:100%; border:0; background:transparent; color:#475467; text-align:left; border-radius:7px; padding:12px 14px; font-size:15px; font-weight:800; cursor:pointer; }
    .side-item:hover { background:#f6f8fb; color:#344054; }
    .side-item.selected { background:#f1f4f9; color:#1f2937; }
    .side-item em { color:#98a2b3; font-style:normal; }
    .sidebar-foot { margin-top:auto; color:#c1c7d0; font-size:12px; }
    main { min-width:0; padding:28px 34px; overflow-x:hidden; }
    .app-view { display:none; min-width:0; }
    .app-view.active { display:block; }
    .home-card, .empty-card, .trigger-card, .trigger-list-card { min-height:620px; background:#fff; border:1px solid #edf1f7; border-radius:10px; padding:42px; box-shadow:0 1px 2px rgba(16,24,40,.03); }
    .list-toolbar { display:grid; grid-template-columns:minmax(0, 1fr) auto auto; align-items:center; gap:18px; margin-bottom:34px; }
    .list-toolbar h1, .empty-card h1 { margin:0; font-size:22px; font-weight:900; color:#344054; }
    .toolbar-actions { display:flex; align-items:center; justify-content:flex-end; gap:18px; min-width:0; color:#667085; }
    .icon-action { border:0; background:transparent; color:#667085; padding:6px 0; font-size:14px; font-weight:800; cursor:pointer; }
    .icon-action:hover { color:#344054; }
    .danger-action { color:#b42318; }
    .search-box, .command-search { display:flex; align-items:center; gap:8px; margin:0; background:#f7f8fb; border:1px solid transparent; border-radius:999px; padding:0 14px; color:#98a2b3; font-weight:600; }
    .search-box input, .command-search input { border:0; outline:none; background:transparent; height:38px; width:180px; font:inherit; color:#344054; }
    .employee-table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .employee-table th { color:#98a2b3; font-size:13px; background:#fff; border-bottom:1px solid #edf1f7; }
    .employee-table td { background:#fff; border:0; border-bottom:1px solid #edf1f7; color:#98a2b3; padding:18px 22px; }
    .employee-table tbody tr:hover td { background:#f5f7fb; }
    .employee-row { cursor:pointer; }
    .employee-row.selected td { background:#eef4ff; box-shadow:none; }
    .employee-row strong { color:#344054; margin-left:14px; }
    .employee-name-link, .trigger-name-link { margin-left:14px; border:0; background:transparent; color:#344054; padding:0; font:inherit; font-weight:900; cursor:pointer; text-align:left; }
    .trigger-name-link { margin-left:0; }
    .employee-name-link:hover, .trigger-name-link:hover { color:#2563eb; text-decoration:underline; text-underline-offset:3px; }
    .employee-empty-row td { background:#fff; border:0; color:#98a2b3; text-align:center; padding:42px 0; }
    .new-badge { display:inline-grid; place-items:center; width:32px; height:32px; border-radius:5px; background:#16a34a; color:#fff; font-weight:900; }
    .empty-card { display:grid; place-items:center; align-content:center; text-align:center; gap:14px; color:#98a2b3; }
    .empty-robot { width:112px; height:112px; border-radius:50%; display:grid; place-items:center; font-size:50px; background:#eef4ff; color:#4f72f3; box-shadow:inset 0 0 0 14px #fff, 0 14px 30px rgba(79,114,243,.12); }
    .empty-card p { max-width:520px; margin:0; font-size:15px; line-height:1.8; }
    .ghost-pill { border:1px solid #e4e7ec; background:#fff; color:#344054; border-radius:999px; padding:10px 28px; font-weight:900; cursor:pointer; }
    .ghost-pill:hover, .cancel-button:hover { border-color:#cfd6e3; background:#f8fafc; }
    .trigger-card { margin-top:18px; min-height:auto; }
    .trigger-form { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:18px; align-items:end; }
    .trigger-form label { margin:0; color:#344054; }
    .trigger-form input, .trigger-form select { margin-top:8px; }
    .form-note { color:#16a34a; font-size:13px; }
    .trigger-list-card { position:relative; min-height:620px; }
    .trigger-page-toolbar { display:grid; grid-template-columns:minmax(0, 1fr) auto auto; align-items:center; gap:18px; margin-bottom:30px; }
    .trigger-page-toolbar h1 { margin:0; color:#344054; font-size:22px; font-weight:900; }
    .trigger-actions { gap:18px; }
    .muted-action { color:#a0a8b8; }
    .empty-inline { min-height:440px; display:grid; place-items:center; align-content:center; gap:12px; text-align:center; color:#98a2b3; }
    .empty-inline.compact { min-height:260px; }
    .trigger-table { table-layout:fixed; width:100%; }
    .trigger-table th:nth-child(1), .trigger-table td:nth-child(1) { width:18%; }
    .trigger-table th:nth-child(2), .trigger-table td:nth-child(2) { width:12%; }
    .trigger-table th:nth-child(3), .trigger-table td:nth-child(3) { width:24%; }
    .trigger-table th:nth-child(4), .trigger-table td:nth-child(4) { width:34%; }
    .trigger-table th:nth-child(5), .trigger-table td:nth-child(5) { width:12%; text-align:center; }
    .trigger-table th { color:#98a2b3; background:#fff; font-size:13px; border-bottom:1px solid #edf1f7; }
    .trigger-table td { color:#98a2b3; padding:22px 18px; border-bottom:1px solid #edf1f7; vertical-align:middle; overflow-wrap:anywhere; word-break:break-word; }
    .trigger-table tbody tr:hover td { background:#f5f7fb; }
    .trigger-row { cursor:pointer; }
    .trigger-row.selected td { background:#eef4ff; box-shadow:none; }
    .trigger-table strong { color:#1f2937; font-weight:900; }
    .trigger-detail { border:0; background:transparent; color:#98a2b3; font-weight:800; cursor:pointer; padding:0; white-space:normal; text-align:left; line-height:1.35; }
    .trigger-detail span { color:#3b82f6; margin-left:4px; }
    .switch { width:42px; height:22px; border:0; border-radius:999px; background:#d0d5dd; padding:2px; cursor:pointer; vertical-align:middle; }
    .switch:hover { box-shadow:0 0 0 4px rgba(255,77,85,.08); }
    .switch span { display:block; width:18px; height:18px; border-radius:50%; background:#fff; transition:transform .16s ease; box-shadow:0 1px 3px rgba(16,24,40,.18); }
    .switch.on { background:#ff4d55; }
    .switch.on span { transform:translateX(20px); }
    .trigger-popover { position:fixed; z-index:20; width:300px; padding:20px 24px; border-radius:6px; background:#fff; box-shadow:0 18px 45px rgba(15,23,42,.16); color:#475467; }
    .trigger-popover::before { content:""; position:absolute; top:-10px; left:50%; width:20px; height:20px; background:#fff; transform:translateX(-50%) rotate(45deg); }
    .trigger-popover h3 { margin:0 0 14px; color:#344054; font-size:16px; }
    .trigger-popover p { margin:0 0 14px; font-weight:700; }
    .trigger-popover ol { margin:0; padding-left:22px; display:grid; gap:12px; font-weight:800; }
    .work-log-list { display:grid; gap:14px; min-height:520px; }
    .work-log-empty { min-height:520px; }
    .document-empty { background:#f3f6ff; color:#5b7cf5; }
    .work-log-item { border:1px solid #edf1f7; border-radius:8px; padding:16px; color:#667085; }
    .work-log-item strong { display:block; color:#344054; font-size:15px; }
    .work-log-item span { display:block; margin-top:4px; color:#98a2b3; font-size:12px; }
    .work-log-item p { margin:10px 0; color:#16a34a; font-weight:800; }
    .work-log-item pre { max-height:180px; overflow:auto; background:#f7f8fb; border:1px solid #eef1f6; border-radius:6px; padding:10px; font-size:12px; white-space:pre-wrap; }
    .modal-backdrop { position:fixed; inset:0; z-index:50; display:grid; place-items:center; background:rgba(17,24,39,.46); padding:24px; }
    .trigger-modal-card { width:min(860px, 100%); max-height:calc(100vh - 48px); overflow:auto; background:#fff; border:1px solid #e5e9f0; border-radius:8px; box-shadow:0 24px 70px rgba(15,23,42,.26); }
    .trigger-modal-card header { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; gap:14px; align-items:center; padding:20px 30px 18px; border-bottom:1px solid #edf1f7; }
    .trigger-modal-card header h1 { margin:0; color:#1f2937; font-size:18px; font-weight:900; }
    .trigger-modal-card header p { margin:3px 0 0; color:#667085; font-size:12px; line-height:1.45; font-weight:700; }
    .modal-icon { width:36px; height:36px; border-radius:8px; display:grid; place-items:center; color:#667085; background:#f8fafc; font-size:24px; }
    .modal-close { border:0; background:transparent; color:#98a2b3; font-size:32px; cursor:pointer; }
    .modal-close:hover { color:#667085; }
    .trigger-modal-body { padding:22px 30px; display:grid; gap:10px; }
    .form-row { display:grid; grid-template-columns:100px minmax(0, 1fr); align-items:center; gap:14px; margin:0; color:#344054; font-size:13px; line-height:20px; font-weight:900; }
    .form-row input, .form-row select { width:100%; height:40px; border:1px solid #dfe4ec; border-radius:7px; padding:0 12px; color:#344054; font:inherit; font-weight:800; background:#fff; }
    .compact-row { grid-template-columns:100px auto 180px minmax(0, 1fr); justify-content:start; }
    .radio-line { display:flex; flex-wrap:wrap; align-items:center; gap:16px; font-size:13px; line-height:20px; font-weight:900; color:#344054; }
    .radio-line input { width:16px; height:16px; accent-color:#ff4d55; vertical-align:middle; margin-right:5px; }
    .schedule-summary { margin:0 0 0 114px; color:#667085; font-size:12px; line-height:1.45; font-weight:800; }
    .check-row { margin-left:114px; display:flex; align-items:center; gap:8px; min-height:26px; color:#344054; font-size:13px; line-height:20px; font-weight:900; }
    .check-row input, .enable-check input { width:16px; height:16px; accent-color:#ff4d55; }
    .more-options { margin-left:114px; padding:10px 0 2px; display:grid; gap:8px; }
    .more-options .check-row { margin-left:0; }
    .timeout-row { color:#344054; font-size:13px; line-height:20px; font-weight:900; }
    .timeout-row input { width:120px; height:34px; margin:0 8px; border:1px solid #dfe4ec; border-radius:7px; padding:0 10px; font:inherit; }
    .form-error { margin:0 0 0 114px; color:#b42318; font-weight:800; white-space:pre-wrap; }
    .trigger-modal-card footer { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:16px 30px; border-top:1px solid #edf1f7; }
    .enable-check { display:flex; align-items:center; gap:8px; color:#344054; font-size:13px; font-weight:900; }
    .confirm-button, .cancel-button { border-radius:7px; padding:0 28px; height:38px; font-size:14px; font-weight:900; cursor:pointer; }
    .confirm-button { border:0; background:#ff4d55; color:#fff; }
    .confirm-button:hover { background:#f0444d; box-shadow:0 10px 22px rgba(255,77,85,.2); }
    .cancel-button { margin-left:12px; border:1px solid #dfe4ec; background:#fff; color:#344054; }
    .designer-view { margin:-28px -34px; }
    .designer-shell { min-height:calc(100vh - 70px); background:#eef1f5; }
    .journey-shell { display:grid; grid-template-rows:minmax(0, 1fr); padding-top:88px; }
    .back-button { border:0; background:transparent; color:#475467; font-size:22px; line-height:1; padding:4px 6px; cursor:pointer; }
    .back-button:hover { color:#1f2937; background:#f6f8fb; border-radius:6px; }
    .designer-title { display:flex; align-items:center; gap:10px; color:#344054; font-size:16px; font-weight:900; }
    .designer-title-input { width:min(180px, 100%); height:32px; border:1px solid #dfe4ec; border-radius:6px; padding:0 10px; color:#344054; font:inherit; font-weight:900; outline:none; }
    .designer-title-input:focus { border-color:#ff4d55; box-shadow:0 0 0 3px rgba(255,77,85,.12); }
    .designer-title-input.error { border-color:#dc2626; box-shadow:0 0 0 3px rgba(220,38,38,.12); }
    #rename-employee.editing { color:#16a34a; }
    .robot-mark { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:#ff4d55; color:#fff; font-size:10px; }
    .tool-button { border:0; background:#f5f7fb; color:#475467; border-radius:6px; padding:0 14px; font-size:13px; font-weight:800; white-space:nowrap; cursor:pointer; }
    .tool-button:hover { background:#eaf1ff; color:#344054; box-shadow:0 6px 14px rgba(15,23,42,.08); }
    .tool-button.selected { background:#eef4ff; color:#344054; }
    .tool-button.recording { background:#fee4e2; color:#b42318; }
    .run-tool { background:#ecfdf3; color:#16a34a; min-width:160px; }
    .run-tool:hover { background:#dcfae6; color:#067647; box-shadow:0 8px 18px rgba(22,163,74,.12); }
    .journey-header { position:fixed; top:70px; left:0; right:0; z-index:55; min-height:88px; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:14px 28px; background:#fff; border-bottom:1px solid #e5e9f0; box-shadow:0 10px 24px rgba(15,23,42,.04); }
    .journey-title-group { display:flex; align-items:center; gap:12px; min-width:0; }
    .journey-header h1 { font-size:18px; line-height:1.2; margin:0; color:#1f2937; }
    .journey-header h1 .link-button { margin-left:6px; vertical-align:middle; }
    .journey-header p { margin:4px 0 0; color:#667085; font-size:12px; line-height:1.35; font-weight:700; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .employee-id-label { color:#344054; font-weight:900; white-space:nowrap; }
    .journey-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; }
    .journey-primary-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; }
    .journey-actions button { width:auto; min-width:88px; height:36px; padding:0 14px; }
    .journey-grid { display:grid; grid-template-columns:292px minmax(0, 1fr); min-height:calc(100vh - 190px); }
    .journey-nav-panel { position:fixed; top:158px; bottom:0; left:0; z-index:40; width:292px; padding:18px 16px; }
    .journey-stepper { display:grid; gap:8px; }
    .journey-step { width:100%; border:1px solid transparent; border-radius:8px; background:#fff; color:#344054; padding:10px 10px; display:grid; grid-template-columns:28px minmax(0, 1fr); gap:4px 10px; text-align:left; cursor:pointer; }
    .journey-step:hover { border-color:#dbe2ee; background:#f8fafc; }
    .journey-step.active { border-color:#ffb8bd; background:#fff5f5; box-shadow:0 8px 18px rgba(255,77,85,.08); }
    .journey-step em { grid-row:span 2; width:28px; height:28px; border-radius:7px; background:#eef2f6; color:#667085; display:grid; place-items:center; font-style:normal; font-weight:900; font-size:12px; }
    .journey-step.active em { background:#ff4d55; color:#fff; }
    .journey-step span { font-size:13px; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .journey-step small { grid-column:2; color:#98a2b3; font-size:11px; line-height:1.35; font-weight:700; }
    .journey-workspace { grid-column:2; min-width:0; padding:16px; overflow:auto; }
    .journey-panel { display:none; background:#fff; border:1px solid #e5e9f0; border-radius:8px; padding:20px; min-height:600px; box-shadow:0 10px 24px rgba(15,23,42,.04); }
    .journey-panel.active { display:block; }
    .journey-panel-title { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:18px; padding-bottom:14px; border-bottom:1px solid #edf1f7; }
    .journey-panel-title h2 { margin:0; font-size:18px; color:#1f2937; }
    .journey-panel-title span { max-width:520px; color:#667085; font-size:13px; line-height:1.55; font-weight:700; text-align:right; }
    .journey-form-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px 16px; }
    .journey-form-grid label, .strategy-editor label { margin:0; display:grid; gap:8px; color:#344054; font-size:13px; font-weight:900; }
    .journey-form-grid input, .journey-form-grid select, .journey-form-grid textarea, .strategy-editor input, .strategy-editor textarea { width:100%; border:1px solid #dfe4ec; border-radius:7px; padding:11px 12px; font:13px Inter, ui-sans-serif, system-ui, sans-serif; color:#344054; background:#fff; }
    .journey-form-grid textarea, .strategy-editor textarea { min-height:96px; white-space:pre-wrap; resize:vertical; }
    .span-2 { grid-column:1 / -1; }
    .journey-define-panel { max-width:none; }
    .journey-define-panel .journey-form-grid { gap:18px 20px; }
    .journey-define-panel .define-target-field { max-width:520px; }
    .journey-define-panel textarea { min-height:132px; font-size:14px; line-height:1.6; }
    .journey-define-panel input, .journey-define-panel select { min-height:42px; font-size:14px; }
    .journey-note-grid, .field-mapping-grid, .publish-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:14px; margin-top:18px; }
    .journey-note-grid div, .field-mapping-grid div, .publish-card { border:1px solid #edf1f7; border-radius:8px; background:#f8fafc; padding:14px; }
    .journey-note-grid strong, .field-mapping-grid strong, .publish-card h3 { display:block; margin:0 0 7px; color:#344054; font-size:13px; font-weight:900; }
    .journey-note-grid span, .field-mapping-grid span { display:block; color:#667085; font-size:12px; line-height:1.45; font-weight:700; }
    .embedded-panel { box-shadow:none; margin:0; }
    .creation-methods { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-bottom:16px; }
    .method-card { width:100%; border:1px solid #dbe2ee; background:#fff; color:#344054; border-radius:8px; padding:16px; text-align:left; display:grid; gap:6px; }
    .method-card.selected { border-color:#ff9ca3; background:#fff5f5; }
    .method-card strong { font-size:14px; }
    .method-card span { color:#667085; font-size:12px; font-weight:700; }
    .recording-layout { display:grid; grid-template-columns:minmax(0, 1fr) 360px; gap:16px; align-items:start; }
    .main-flow-panel, .visual-node-panel, .context-card { border:1px solid #edf1f7; border-radius:8px; padding:16px; background:#fff; box-shadow:0 8px 18px rgba(15,23,42,.035); }
    .recording-context-panel, .strategy-side-panel { display:grid; gap:14px; align-content:start; min-width:0; }
    .recorded-actions-panel { border:1px solid #edf1f7; border-radius:8px; padding:18px; background:#f8fafc; align-self:start; }
    .recorder-mode-note, .node-detail-summary { display:grid; grid-template-columns:88px minmax(0, 1fr); gap:8px; border-top:1px solid #edf1f7; border-bottom:1px solid #edf1f7; padding:10px 0; margin:12px 0; color:#667085; font-size:12px; line-height:1.45; font-weight:700; }
    .recorder-mode-note strong, .node-detail-summary strong { color:#344054; }
    .wide-secondary { float:none; width:100%; margin:0; }
    .primary-secondary { background:#2f63e6 !important; color:#fff !important; border-color:#2f63e6 !important; }
    .strategy-workbench { display:grid; grid-template-columns:260px minmax(0, 1fr); gap:16px; margin-bottom:16px; }
    .strategy-editor { display:grid; gap:12px; }
    .strategy-actions-row { display:flex; justify-content:flex-end; gap:8px; }
    .strategy-actions-row button { float:none; width:auto; min-width:150px; padding:10px 14px; font-size:12px; }
    .strategy-chip.selected { border-color:#8fb1ff; background:#eef4ff; color:#175cd3; }
    .test-grid { display:grid; grid-template-columns:minmax(0, 1fr) minmax(320px, 420px); gap:16px; align-items:start; margin-bottom:16px; }
    .test-main { display:contents; }
    .test-side { display:grid; gap:16px; align-content:start; min-width:0; }
    .publish-grid { grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); }
    .publish-card { background:#fff; }
    .publish-checks { margin:0; padding-left:20px; display:grid; gap:8px; color:#667085; font-size:13px; font-weight:700; }
    .designer-grid { display:grid; grid-template-columns:250px minmax(0, 1fr); gap:0; min-height:560px; }
    .command-panel { background:#fff; border-right:1px solid #e5e9f0; padding:18px; min-width:0; overflow:auto; }
    .command-title { font-size:16px; font-weight:900; margin-bottom:12px; }
    .command-panel ul { width:100%; list-style:none; padding:0; margin:0; display:grid; gap:13px; color:#475467; font-size:14px; font-weight:700; }
    .flow-workspace { min-width:0; padding:10px; overflow:auto; }
    .flow-tabs { display:flex; align-items:end; gap:8px; }
    .flow-tab { width:auto; min-width:128px; border:0; border-radius:6px 6px 0 0; background:#f7f8fb; color:#667085; padding:12px 18px; font-weight:900; cursor:pointer; }
    .flow-tab:hover { background:#fff; color:#344054; box-shadow:0 -2px 10px rgba(15,23,42,.06); }
    .flow-tab.active { background:#fff; color:#1f2937; }
    .designer-tab-panel { display:none; background:#fff; border-radius:0 8px 8px 8px; padding:18px; min-height:520px; }
    .designer-tab-panel.active { display:grid; gap:18px; align-content:start; }
    .designer-tab-panel[data-designer-panel="input"].active { grid-template-columns:minmax(0, 1fr); }
    .designer-tools-grid { display:grid; grid-template-columns:minmax(0, 1fr); gap:14px; margin-bottom:16px; }
    .flow-list { background:#fff; border-radius:0 8px 8px 8px; padding:24px 32px; min-height:420px; }
    .flow-step { display:grid; grid-template-columns:42px minmax(0, 1fr); gap:10px; padding:11px 0; color:#344054; }
    .flow-step em { grid-row:span 2; color:#98a2b3; font-style:normal; font-weight:900; }
    .flow-step span { font-weight:900; }
    .flow-step small { grid-column:2; color:#98a2b3; font-size:13px; }
    .flow-step b { color:#168b64; background:#e9fbf3; border-radius:4px; padding:2px 5px; }
    .flow-step.muted { opacity:.45; }
    .element-library { margin-top:10px; background:#fff; border-radius:8px; padding:18px; }
    .element-row { border-bottom:1px solid #eef1f6; padding:10px 0; color:#344054; font-weight:800; }
    .element-row.child { padding-left:24px; color:#667085; font-weight:700; }
    .runtime-drawer { padding:0 10px 24px; }
    .runtime-drawer details { background:#fff; border:1px solid #e5e9f0; border-radius:8px; padding:16px; }
    .runtime-drawer summary { cursor:pointer; font-weight:900; color:#344054; margin-bottom:14px; }
    .client-frame button { float:none; }
    .app-shell { display:grid; grid-template-columns:232px minmax(0, 1fr); min-height:100vh; }
    .sidebar { background:#fff; border-right:1px solid var(--line); padding:22px 18px; display:flex; flex-direction:column; gap:28px; }
    .brand { display:flex; gap:12px; align-items:center; }
    .brand-mark { width:36px; height:36px; border-radius:8px; background:#050505; color:#fff; display:grid; place-items:center; font-weight:800; }
    .brand strong, .brand span { display:block; }
    .brand span { color:var(--muted); font-size:12px; margin-top:2px; }
    nav { display:grid; gap:8px; }
    nav a { padding:12px 14px; border-radius:8px; color:#344054; text-decoration:none; font-size:14px; }
    nav a.active { background:#eaf1ff; color:var(--blue); font-weight:700; }
    main { min-width:0; padding:22px 28px 28px; overflow-x:hidden; }
    .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
    h1 { font-size:22px; margin:0; letter-spacing:0; }
    h2 { font-size:15px; margin:0 0 18px; }
    h3 { font-size:14px; margin:10px 0 16px; }
    .env { color:var(--muted); font-size:13px; }
    .env strong { margin-left:8px; color:var(--text); }
    .grid { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:18px; }
    .workspace { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 340px); gap:18px; margin-top:18px; align-items:start; }
    .panel { min-width:0; max-width:100%; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; box-shadow:0 1px 2px rgba(16,24,40,.04); overflow:hidden; }
    label { display:block; font-size:13px; font-weight:700; margin:14px 0 8px; }
    #input-file { width:100%; min-width:0; max-width:100%; border:1px solid var(--line); border-radius:7px; padding:9px 10px; background:#fff; }
    #input-file-status { color:var(--muted); font-size:12px; margin:8px 0 10px; }
    .input-preview { max-width:100%; border:1px solid var(--line); border-radius:7px; padding:10px; margin-top:10px; color:var(--muted); font-size:12px; overflow:auto; }
    .input-preview strong { display:block; color:var(--text); margin-bottom:8px; }
    .input-preview table { width:100%; min-width:0; font-size:12px; }
    .input-preview th, .input-preview td { padding:6px 8px; }
    .run-history-row { cursor:pointer; }
    .run-history-row:hover { background:#f8fafc; }
    .run-history-row.selected { background:#eef4ff; }
    .run-history-empty td { color:#98a2b3; text-align:center; }
    .test-context { border:1px solid #dbe7ff; background:#f5f8ff; color:#344054; border-radius:8px; padding:10px 12px; font-size:13px; font-weight:800; line-height:1.45; }
    .run-panel-button { float:none; width:100%; margin:0; background:#16a34a; color:#fff; height:40px; min-height:40px; padding:0 18px; font-size:14px; }
    textarea { display:block; width:100%; min-width:0; max-width:100%; min-height:142px; resize:vertical; overflow:auto; white-space:pre; border:1px dashed #b8c4d8; border-radius:8px; padding:14px; font:13px ui-monospace, SFMono-Regular, Menlo, monospace; color:#344054; }
    textarea.collapsed { display:none; }
    #patch-target { min-height:76px; }
    .recording-actions-editor { display:grid; grid-template-columns:minmax(280px, .9fr) minmax(0, 1.1fr); gap:16px; align-items:stretch; }
    .recording-actions-editor.strategy-layout { grid-template-columns:minmax(0, 1fr) 360px; align-items:start; }
    .visual-node-panel, .json-node-panel { min-width:0; border:1px solid #edf1f7; border-radius:8px; background:#fff; padding:14px; }
    .compact-title { align-items:center; margin-bottom:10px; }
    .compact-title h2 { margin:0; font-size:14px; color:#344054; }
    .drag-handle { color:#98a2b3; font-size:15px; letter-spacing:-2px; }
    .json-node-panel { border:1px solid #edf1f7; border-radius:8px; background:#fff; padding:12px; }
    .json-node-panel summary { cursor:pointer; color:#344054; font-size:13px; font-weight:900; }
    .json-node-panel label { margin:0 0 10px; display:block; color:#344054; font-size:13px; font-weight:900; }
    #recording-actions { min-height:300px; height:100%; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
    input, select, textarea { min-width:0; max-width:100%; }
    #patch-step, #recording-name, #row-ids, #start-step { width:100%; border:1px solid var(--line); border-radius:7px; padding:10px 12px; font:13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .patch-box { clear:both; border-top:1px solid var(--line); margin-top:18px; padding-top:16px; }
    .recorder-box { clear:both; border-top:0; margin-top:0; padding-top:0; }
    .browser-recorder { display:grid; gap:10px; border:1px solid #e5e9f0; border-radius:8px; background:#f8fafc; padding:12px; margin:12px 0 14px; }
    .recorder-toolbar { display:grid; grid-template-columns:minmax(0, 1fr); gap:8px; align-items:center; }
    .recorder-toolbar input { width:100%; border:1px solid var(--line); border-radius:7px; padding:10px 12px; font:13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .recorder-toolbar button { width:auto; margin:0; padding:10px 12px; white-space:nowrap; }
    #recorder-frame, .recorder-webview { width:100%; height:300px; border:1px solid #dfe4ec; border-radius:8px; background:#fff; }
    .recorder-modal { position:fixed; inset:86px 24px 24px 316px; z-index:80; background:rgba(15,23,42,.22); border-radius:10px; padding:18px; display:grid; place-items:stretch; }
    .recorder-modal-card { display:grid; grid-template-rows:auto minmax(0, 1fr); min-height:0; background:#fff; border:1px solid #dfe4ec; border-radius:10px; box-shadow:0 24px 70px rgba(15,23,42,.28); overflow:hidden; }
    .recorder-modal-card header { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:16px 18px; border-bottom:1px solid #edf1f7; }
    .recorder-modal-card h2 { margin:0; color:#1f2937; font-size:16px; }
    .recorder-modal-card p { margin:4px 0 0; color:#667085; font-size:12px; font-weight:700; }
    .recorder-modal-card #recorder-frame, .recorder-modal-card .recorder-webview { width:100%; height:100%; min-height:560px; border:0; border-radius:0; }
    .recorder-events { border:1px solid #edf1f7; border-radius:8px; background:#fff; padding:10px 12px; max-height:160px; overflow:auto; }
    .recorder-events strong { display:block; margin-bottom:8px; color:#344054; font-size:13px; }
    .recorder-events ol { margin:0; padding-left:20px; display:grid; gap:6px; }
    .recorder-events li { color:#667085; font-size:12px; }
    .recorder-events li.muted { color:#98a2b3; }
    .recorder-events code { margin-right:8px; color:#175cd3; background:#eff5ff; border-radius:4px; padding:1px 4px; }
    .node-catalog, .strategy-catalog { border-top:1px solid #edf1f7; margin-top:14px; padding-top:14px; display:grid; gap:8px; }
    .node-catalog strong, .strategy-catalog strong { font-size:12px; color:#344054; }
    .node-catalog span { display:block; color:#667085; font-size:12px; line-height:1.45; }
    .node-catalog b { color:#111827; margin-right:4px; }
    .strategy-chip { float:none; width:100%; margin:0; border:1px solid #dbe2ee; background:#fff; color:#344054; text-align:left; padding:8px 10px; border-radius:6px; font-size:12px; font-weight:800; }
    #patch-result, #recording-result, #workflow-save-result { clear:both; color:var(--muted); font-size:13px; white-space:pre-wrap; padding-top:10px; }
    select { width:100%; border:1px solid var(--line); border-radius:7px; padding:10px 12px; font:inherit; font-size:13px; background:#fff; }
    .segments { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; height:44px; padding:4px; border:1px solid #dbe2ee; border-radius:10px; background:#f4f7fb; box-shadow:inset 0 1px 0 rgba(255,255,255,.8); }
    .segments button { float:none; height:34px; min-height:34px; padding:0 12px; border:0; border-radius:7px; background:transparent; color:#475467; line-height:1; white-space:nowrap; font-size:13px; font-weight:800; box-shadow:none; }
    .segments button:hover { background:rgba(255,255,255,.72); color:#344054; }
    .segments .selected { color:#175cd3; background:#fff; box-shadow:0 1px 2px rgba(16,24,40,.08), inset 0 0 0 1px rgba(47,99,230,.34); }
    .trial-controls-panel { display:grid; gap:8px; padding:14px 16px; }
    .trial-controls-panel { grid-column:1 / -1; }
    .results { grid-column:1 / -1; }
    .trial-control-row { display:grid; grid-template-columns:180px minmax(0, 1fr); gap:10px; align-items:center; }
    .trial-mode-control { min-width:0; }
    .run-view-panel { display:grid; grid-template-columns:190px minmax(0, 1fr); gap:12px; align-items:center; border:1px solid #dbe2ee; border-radius:10px; padding:10px 12px; background:#fbfcff; }
    .run-view-copy { display:grid; gap:2px; }
    .run-view-copy strong { font-size:13px; color:#1f2937; }
    .run-view-copy span, .field-hint { color:#667085; font-size:11px; line-height:1.45; font-weight:700; }
    .run-view-segments { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .run-view-segments button { float:none; min-height:48px; border:1px solid #dbe2ee; border-radius:8px; background:#fff; color:#344054; padding:7px 12px; display:grid; gap:2px; justify-items:start; text-align:left; box-shadow:none; font-size:13px; font-weight:900; }
    .run-view-segments button span { color:#667085; font-size:11px; font-weight:700; }
    .run-view-segments .selected { color:#175cd3; border-color:rgba(47,99,230,.55); background:#eff5ff; box-shadow:inset 0 0 0 1px rgba(47,99,230,.18); }
    .run-view-segments .selected span { color:#3867d6; }
    .advanced-debug-grid label { display:grid; gap:6px; }
    .advanced-debug-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin-top:10px; }
    .advanced-debug-grid label { margin:0; }
    .test-flow-panel .panel-title { margin-bottom:10px; }
    .test-flow-list { max-height:none; }
    .test-flow-node { cursor:pointer; }
    .toggles { display:grid; grid-template-columns:1fr auto; gap:10px; margin:16px 0; font-size:13px; color:#344054; }
    .toggles strong { color:var(--blue); }
    .check { display:flex; justify-content:flex-end; align-items:center; gap:8px; margin:0; font-weight:700; color:var(--blue); }
    .check input { width:16px; height:16px; }
    button { border:0; border-radius:7px; background:var(--blue); color:#fff; padding:10px 20px; font-weight:700; float:right; cursor:pointer; }
    #preview-input, #preview-plan, .runtime-drawer #run, #patch, #save-recording { float:none; width:100%; margin-top:10px; }
    button.secondary { background:#fff; color:#344054; border:1px solid var(--line); }
    button:disabled { opacity:.6; cursor:not-allowed; }
    #error { clear:both; color:var(--red); font-size:13px; white-space:pre-wrap; padding-top:10px; }
    .panel-title { display:flex; justify-content:space-between; gap:16px; align-items:baseline; }
    .panel-title span { color:var(--muted); font-size:12px; }
    .run-result-summary { display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap; text-align:right; }
    .run-result-summary span { color:#667085; font-size:12px; font-weight:700; }
    .run-result-summary strong { color:#344054; font-weight:900; }
    .run-result-summary .link-button { padding:0; font-size:12px; }
    .metrics { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:12px; min-height:82px; }
    .metric span { display:block; color:var(--muted); font-size:12px; margin-bottom:8px; }
    .metric strong { font-size:24px; line-height:1; }
    .metric.blue strong { color:var(--blue); } .metric.green strong { color:var(--green); } .metric.red strong { color:var(--red); } .metric.orange strong { color:var(--orange); }
    .recent, .profile { margin-top:18px; border-top:1px solid var(--line); padding-top:16px; }
    .link-button { float:none; border:0; background:transparent; color:var(--blue); padding:0; font-size:12px; }
    .run-list { display:grid; gap:8px; }
    .run-item { float:none; width:100%; background:#f8fafc; color:var(--text); border:1px solid var(--line); text-align:left; padding:10px 12px; display:grid; gap:3px; }
    div.run-item { grid-template-columns:minmax(0, 1fr) auto; align-items:center; column-gap:10px; }
    .run-open { float:none; width:100%; color:var(--text); background:transparent; border:0; padding:0; text-align:left; display:grid; gap:3px; }
    .link-button.danger { color:var(--red); }
    .run-item.selected { border-color:var(--blue); background:#eff5ff; }
    .run-item strong { font-size:12px; text-transform:uppercase; }
    .run-item span, .empty { color:var(--muted); font-size:12px; }
    .selected-workflow { display:grid; grid-template-columns:auto minmax(0, 1fr) auto auto; gap:8px; align-items:center; border:1px solid var(--line); border-radius:7px; padding:10px 12px; margin:0 0 10px; font-size:12px; }
    .selected-workflow span { color:var(--muted); }
    .selected-workflow strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .profile-status { display:grid; gap:6px; font-size:12px; color:var(--muted); }
    .profile-status strong { color:var(--text); }
    .profile-status ul { margin:4px 0 0; padding-left:18px; }
    .profile-status .ok { color:var(--green); font-weight:700; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { border-bottom:1px solid var(--line); padding:12px 10px; text-align:left; vertical-align:middle; }
    th { color:#475467; font-size:12px; background:#f8fafc; }
    td a { color:var(--blue); text-decoration:none; }
    .badge { display:inline-flex; border-radius:5px; padding:4px 7px; font-size:11px; font-weight:800; text-transform:uppercase; }
    .badge.success { color:#067647; background:#dcfae6; } .badge.failed { color:#b42318; background:#fee4e2; } .badge.approval { color:#c2410c; background:#ffedd5; } .badge.neutral { color:#475467; background:#eef2f6; }
    .trace { max-height:none; overflow:visible; }
    .trace ol { margin:0; padding-left:20px; display:grid; gap:16px; }
    .trace li strong, .trace li span { display:block; }
    .trace li strong { font-size:13px; } .trace li span { color:var(--muted); font-size:12px; margin-top:4px; }
    .client-frame .app-shell { grid-template-columns:260px minmax(0, 1fr); min-height:calc(100vh - 70px); }
    .client-frame .app-shell.designer-mode { grid-template-columns:minmax(0, 1fr); }
    .client-frame .app-shell.designer-mode > .sidebar { display:none; }
    .client-frame .sidebar { padding:28px 22px; gap:24px; border-right:1px solid #edf1f7; }
    .client-frame main { padding:28px 34px; }
    .client-frame .brand-mark { width:32px; height:32px; border-radius:50%; background:#ff4d55; font-weight:900; }
    .client-frame .primary-tabs { display:flex; gap:52px; }
    .client-frame .primary-tabs button, .client-frame .side-item, .client-frame .icon-action, .client-frame .tool-button, .client-frame .ghost-pill, .client-frame .back-button, .client-frame .employee-name-link, .client-frame .trigger-name-link { float:none; }
    .client-frame .designer-view { margin:-28px -34px; }
    .client-frame .designer-grid { grid-template-columns:250px minmax(0, 1fr); }
    .client-frame .create-button { background:#ff4d55; color:#fff; border-radius:999px; }
    @media (max-width: 1180px) {
      .app-topnav { grid-template-columns:220px minmax(0, 1fr) auto; }
      .runtime-chip { display:none; }
      .primary-tabs { gap:28px; }
      .client-frame .designer-grid { grid-template-columns:220px minmax(0, 1fr); }
      .list-toolbar { align-items:flex-start; flex-direction:column; }
      .toolbar-actions { flex-wrap:wrap; }
    }
    @media (max-width: 980px) {
      .app-topnav { grid-template-columns:minmax(0, 1fr) auto; height:auto; min-height:64px; }
      .primary-tabs { grid-column:1 / -1; gap:18px; overflow:auto; }
      .client-frame .app-shell { grid-template-columns:1fr; }
      .client-frame .sidebar { display:none; }
      .client-frame main { padding:18px; }
      .client-frame .designer-view { margin:-18px; }
      .journey-header { align-items:flex-start; }
      .journey-actions { justify-items:start; }
      .client-frame .designer-grid { grid-template-columns:1fr; }
      .command-panel { display:none; }
      .journey-workspace { grid-column:1; }
      .trigger-form, .grid, .workspace, .form-row, .compact-row, .recording-actions-editor { grid-template-columns:1fr; }
      .home-card, .empty-card, .trigger-card, .trigger-list-card { padding:22px; }
      .trigger-page-toolbar, .trigger-modal-card footer { align-items:flex-start; flex-direction:column; }
      .schedule-summary, .check-row, .more-options, .form-error { margin-left:0; }
      .topbar { align-items:flex-start; flex-direction:column; gap:8px; }
    }
  `;
}
