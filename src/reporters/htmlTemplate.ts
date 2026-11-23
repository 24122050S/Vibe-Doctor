import { AuditReport } from '../types.js';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const REPORT_CSS = `
  :root { --bg:#0b0f19; --panel:#111827; --border:#1f2937; --text:#f3f4f6; --muted:#9ca3af; --critical:#ef4444; --warning:#f59e0b; --ok:#10b981; --accent:#38bdf8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--text); line-height:1.55; padding:32px 24px 64px; }
  .container { max-width:1200px; margin:0 auto; }
  header { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:16px; padding-bottom:20px; border-bottom:1px solid var(--border); margin-bottom:24px; }
  h1 { margin:0; font-size:24px; display:flex; align-items:center; gap:10px; }
  .status-pill { padding:6px 16px; border-radius:999px; font-weight:700; font-size:13px; letter-spacing:0.05em; }
  .status-pass { background:rgba(16,185,129,0.16); color:#34d399; border:1px solid #059669; }
  .status-fail { background:rgba(239,68,68,0.16); color:#f87171; border:1px solid #dc2626; }
  .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; margin-bottom:28px; }
  .kpi-card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px 18px; }
  .kpi-label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.05em; }
  .kpi-val { font-size:26px; font-weight:700; margin-top:6px; }
  section { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:22px; margin-bottom:24px; }
  h2 { margin-top:0; font-size:18px; display:flex; justify-content:space-between; align-items:center; }
  .legend { display:flex; gap:16px; font-size:12px; color:var(--muted); font-weight:500; }
  .legend span::before { content:""; display:inline-block; width:12px; height:3px; vertical-align:middle; margin-right:6px; }
  .leg-ok::before { background:var(--accent); }
  .leg-err::before { background:var(--critical); }
  .svg-wrapper { overflow-x:auto; background:#070b14; border:1px solid #1e293b; border-radius:10px; padding:12px; }
  @keyframes dashFlow { to { stroke-dashoffset:-24; } }
  .violated-edge { animation:dashFlow 1s linear infinite; }
  .empty-graph, .clean-banner { padding:28px; text-align:center; color:#34d399; background:rgba(16,185,129,0.08); border-radius:10px; }
  .prompt-box { position:relative; background:#090d16; border:1px solid #4c1d95; border-radius:10px; padding:16px; white-space:pre-wrap; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; color:#e9d5ff; }
  .copy-btn { background:#7c3aed; color:white; border:none; border-radius:8px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; }
  .copy-btn:hover { background:#6d28d9; }
  .filters { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .filter-btn { background:#1f2937; color:var(--text); border:1px solid #374151; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer; }
  .filter-btn.active { background:#2563eb; border-color:#3b82f6; }
  .issue-card { background:#0d1322; border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:12px; }
  .issue-header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
  .badge { padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700; }
  .badge-critical { background:rgba(239,68,68,0.2); color:#fca5a5; border:1px solid #ef4444; }
  .badge-warning { background:rgba(245,158,11,0.2); color:#fcd34d; border:1px solid #f59e0b; }
  .badge-tier { background:rgba(56,189,248,0.15); color:#7dd3fc; }
  .rule-tag { color:var(--muted); font-size:12px; }
  .file-loc { color:#93c5fd; font-size:13px; }
  .issue-msg { margin:6px 0; }
  .code-snippet { background:#050811; border-left:3px solid var(--critical); padding:8px 12px; border-radius:6px; font-size:12px; overflow-x:auto; color:#fca5a5; }
  .issue-fix { color:#6ee7b7; font-size:13px; margin-top:8px; }
`;

export function renderReportDocument(
  report: AuditReport,
  graphHtml: string,
  issuesRowsHtml: string
): string {
  const criticalCount = report.issues.filter((i) => i.severity === 'critical').length;
  const warningCount = report.issues.filter((i) => i.severity === 'warning').length;
  const violatedEdgesCount = report.edges.filter((e) => e.violated).length;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vibe Doctor — Architecture Audit Report</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🩺 Vibe Doctor — Báo cáo Kiểm toán Kiến trúc</h1>
        <div style="color:var(--muted);font-size:13px;margin-top:4px;">
          Dự án: <code>${escapeHtml(report.projectRoot)}</code> · Thời gian: ${escapeHtml(report.timestamp)}
        </div>
      </div>
      <div class="status-pill ${report.passed ? 'status-pass' : 'status-fail'}">
        ${report.passed ? '✔ ARCHITECTURE PASSED' : '✖ ARCHITECTURE BLOCKED'}
      </div>
    </header>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Files đã quét</div><div class="kpi-val">${report.metrics.filesScanned}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tốc độ Tầng 1 (AST)</div><div class="kpi-val" style="color:#34d399;">${report.metrics.astDurationMs.toFixed(1)} ms</div></div>
      <div class="kpi-card"><div class="kpi-label">Lỗi Critical</div><div class="kpi-val" style="color:${criticalCount > 0 ? '#f87171' : '#34d399'};">${criticalCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Cảnh báo Warning</div><div class="kpi-val" style="color:${warningCount > 0 ? '#fbbf24' : '#9ca3af'};">${warningCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Đường nối lỗi</div><div class="kpi-val" style="color:${violatedEdgesCount > 0 ? '#f87171' : '#38bdf8'};">${violatedEdgesCount} / ${report.edges.length}</div></div>
    </div>
    <section>
      <h2><span>🕸️ Sơ đồ Phụ thuộc Phân tầng (Dependency Graph)</span><div class="legend"><span class="leg-ok">Import hợp lệ</span><span class="leg-err">Vi phạm ranh giới tầng (CRITICAL)</span></div></h2>
      ${graphHtml}
    </section>
    ${
      report.fixPrompt
        ? `<section><h2><span>🤖 Auto Fix-Prompt cho AI Coding Agent</span><button class="copy-btn" onclick="copyFixPrompt(this)">📋 Copy Fix Prompt</button></h2><div id="fix-prompt-content" class="prompt-box">${escapeHtml(report.fixPrompt)}</div></section>`
        : ''
    }
    <section>
      <h2>📋 Danh sách Chi tiết Vi phạm (${report.issues.length})</h2>
      <div class="filters">
        <button class="filter-btn active" onclick="filterIssues('all', this)">Tất cả (${report.issues.length})</button>
        <button class="filter-btn" onclick="filterIssues('critical', this)">Critical (${criticalCount})</button>
        <button class="filter-btn" onclick="filterIssues('warning', this)">Warning (${warningCount})</button>
        <button class="filter-btn" onclick="filterIssues('ast', this)">Tầng 1: AST</button>
        <button class="filter-btn" onclick="filterIssues('ai', this)">Tầng 2: AI</button>
      </div>
      <div id="issues-list">${issuesRowsHtml}</div>
    </section>
  </div>
  <script>
    function copyFixPrompt(btn) {
      const el = document.getElementById('fix-prompt-content');
      if (!el) return;
      navigator.clipboard.writeText(el.innerText).then(() => {
        const prev = btn.innerText;
        btn.innerText = '✔ Đã copy!';
        setTimeout(() => { btn.innerText = prev; }, 2000);
      });
    }
    function filterIssues(filter, btn) {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.issue-card').forEach((card) => {
        const sev = card.getAttribute('data-severity');
        const tier = card.getAttribute('data-tier');
        card.style.display = (filter === 'all' || sev === filter || tier === filter) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}
