export function sharedComponentStyles(): string {
  return `
    .flow-node-list {
      width:100%;
      min-height:240px;
      max-height:420px;
      overflow:auto;
      margin:0;
      padding:0;
      display:grid;
      align-content:start;
      gap:8px;
      list-style:none;
    }
    .flow-node-list.compact {
      min-height:0;
      max-height:none;
      overflow:visible;
    }
    .flow-node-empty {
      border:1px dashed #dfe4ec;
      border-radius:8px;
      padding:18px;
      color:#98a2b3;
      display:grid;
      gap:6px;
      background:#fff;
    }
    .flow-node-empty span {
      color:#667085;
      font-size:13px;
      line-height:1.35;
      font-weight:850;
    }
    .flow-node-empty small {
      color:#98a2b3;
      font-size:12px;
      line-height:1.4;
      font-weight:700;
    }
    .flow-node-item {
      width:100%;
      box-sizing:border-box;
      display:grid;
      grid-template-columns:28px minmax(0, 1fr) auto;
      gap:10px;
      align-items:center;
      min-height:60px;
      border:1px solid #e4eaf3;
      border-radius:8px;
      background:#f8fafc;
      padding:10px;
    }
    .flow-node-item.selectable {
      cursor:pointer;
    }
    .flow-node-item.draggable {
      cursor:grab;
    }
    .flow-node-item.selected {
      border-color:#ff8b93;
      background:#fff5f5;
      box-shadow:0 0 0 2px rgba(255,77,85,.12);
    }
    .flow-node-item.dragging {
      opacity:.5;
      border-color:#3b82f6;
    }
    .flow-node-index {
      width:24px;
      height:24px;
      border-radius:6px;
      display:grid;
      place-items:center;
      background:#eef4ff;
      color:#175cd3;
      font-style:normal;
      font-weight:900;
      font-size:12px;
      line-height:1;
    }
    .flow-node-content {
      min-width:0;
    }
    .flow-node-title {
      display:block;
      color:#344054;
      font-size:13px;
      line-height:1.3;
      font-weight:850;
      min-width:0;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .flow-node-detail {
      display:block;
      margin-top:3px;
      color:#667085;
      font-size:12px;
      line-height:1.35;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .flow-node-trailing {
      min-width:0;
      justify-self:end;
    }
    .ui-collapsible-panel {
      border:1px dashed #dbe2ee;
      border-radius:8px;
      background:#fff;
      padding:8px 10px;
    }
    .ui-collapsible-summary,
    .ui-collapsible-toggle {
      cursor:pointer;
      color:#475467;
      font-size:12px;
      line-height:18px;
      font-weight:900;
    }
    .ui-collapsible-toggle {
      width:100%;
      border:1px dashed #dbe2ee;
      border-radius:8px;
      background:#fff;
      display:grid;
      grid-template-columns:auto auto minmax(0, 1fr);
      align-items:center;
      gap:8px;
      padding:8px 10px;
      text-align:left;
      font:inherit;
      font-size:12px;
      line-height:18px;
      font-weight:900;
    }
    .ui-collapsible-toggle:hover {
      background:#f8fafc;
      border-color:#cfd6e3;
    }
    .ui-collapsible-toggle::after {
      content:"";
      height:0;
      border-top:1px dashed #e4e7ec;
      margin-left:8px;
    }
    .ui-collapsible-chevron {
      width:8px;
      height:8px;
      border-right:2px solid currentColor;
      border-bottom:2px solid currentColor;
      transform:rotate(45deg);
      transition:transform .16s ease;
      margin-top:-3px;
    }
    .ui-collapsible-toggle.expanded .ui-collapsible-chevron {
      transform:rotate(225deg);
      margin-top:3px;
    }
  `;
}
