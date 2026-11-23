import fs from 'node:fs';
import path from 'node:path';
import { AuditReport, DependencyEdge } from '../types.js';
import { escapeHtml, renderReportDocument } from './htmlTemplate.js';

interface GraphNode {
  id: string;
  label: string;
  layer: string;
  x: number;
  y: number;
  hasViolation: boolean;
}

function renderEdgesSvg(edges: DependencyEdge[], nodes: Map<string, GraphNode>): string {
  const sortedEdges = [...edges].sort((a, b) => Number(a.violated) - Number(b.violated));
  return sortedEdges
    .map((edge) => {
      const src = nodes.get(edge.from);
      const dst = nodes.get(edge.to);
      if (!src || !dst) return '';

      const startX = src.x + (dst.x >= src.x ? 85 : -85);
      const endX = dst.x + (dst.x >= src.x ? -88 : 88);
      const midX = (startX + endX) / 2;
      const d =
        src.x === dst.x
          ? `M ${src.x + 85} ${src.y} C ${src.x + 145} ${src.y}, ${dst.x + 145} ${dst.y}, ${dst.x + 85} ${dst.y}`
          : `M ${startX} ${src.y} C ${midX} ${src.y}, ${midX} ${dst.y}, ${endX} ${dst.y}`;

      const stroke = edge.violated ? '#ef4444' : '#38bdf8';
      const strokeOpacity = edge.violated ? '0.95' : '0.45';
      const strokeWidth = edge.violated ? '2.8' : '1.6';
      const dash = edge.violated ? 'stroke-dasharray="7 5" class="violated-edge"' : '';
      const marker = edge.violated ? 'url(#arrow-error)' : 'url(#arrow-ok)';
      const title = `${edge.from}:${edge.line} -> ${edge.to} (${edge.specifier})${
        edge.violated ? ' [VI PHẠM RANH GIỚI TẦNG]' : ''
      }`;
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" marker-end="${marker}" ${dash}><title>${escapeHtml(
        title
      )}</title></path>`;
    })
    .join('\n');
}

function renderNodesSvg(nodes: Map<string, GraphNode>): string {
  return Array.from(nodes.values())
    .map((node) => {
      const border = node.hasViolation ? '#ef4444' : '#334155';
      const bg = node.hasViolation ? '#2a1215' : '#0f172a';
      const textFill = node.hasViolation ? '#fecaca' : '#e2e8f0';
      const displayLabel = node.label.length > 22 ? `${node.label.slice(0, 19)}...` : node.label;
      return `
        <g class="graph-node" transform="translate(${node.x - 85}, ${node.y - 20})">
          <title>${escapeHtml(`${node.id} (layer: ${node.layer})`)}</title>
          <rect width="170" height="40" rx="8" fill="${bg}" stroke="${border}" stroke-width="${
            node.hasViolation ? '2' : '1.2'
          }" />
          <text x="85" y="18" text-anchor="middle" fill="${textFill}" font-size="12" font-weight="600">${escapeHtml(
            displayLabel
          )}</text>
          <text x="85" y="32" text-anchor="middle" fill="#64748b" font-size="10">${escapeHtml(
            node.id.length > 26 ? `…${node.id.slice(-25)}` : node.id
          )}</text>
        </g>`;
    })
    .join('\n');
}

/**
 * Computes deterministic layered swimlane coordinates for SVG Dependency Graph rendering.
 */
function buildSvgDependencyGraph(edges: DependencyEdge[]): string {
  if (edges.length === 0) {
    return `<div class="empty-graph">Chưa có kết nối import nội bộ nào được ghi nhận trong lần quét này.</div>`;
  }

  const nodeLayers = new Map<string, string>();
  const violatedNodes = new Set<string>();
  for (const edge of edges) {
    if (!nodeLayers.has(edge.from)) nodeLayers.set(edge.from, edge.fromLayer ?? 'other');
    if (!nodeLayers.has(edge.to)) nodeLayers.set(edge.to, edge.toLayer ?? 'other');
    if (edge.violated) {
      violatedNodes.add(edge.from);
      violatedNodes.add(edge.to);
    }
  }

  const preferredOrder = ['app', 'ui', 'services', 'db', 'other'];
  const columnsMap = new Map<string, string[]>();
  for (const [nodeId, layer] of nodeLayers.entries()) {
    const colKey = preferredOrder.includes(layer) ? layer : 'other';
    const list = columnsMap.get(colKey) ?? [];
    list.push(nodeId);
    columnsMap.set(colKey, list);
  }

  const activeColumns = [
    ...preferredOrder.filter((col) => (columnsMap.get(col)?.length ?? 0) > 0),
    ...Array.from(columnsMap.keys()).filter((col) => !preferredOrder.includes(col)),
  ];

  const colSpacing = 280;
  const rowSpacing = 68;
  const padX = 130;
  const padY = 80;
  const maxRows = Math.max(1, ...activeColumns.map((c) => columnsMap.get(c)?.length ?? 0));
  const width = Math.max(880, padX * 2 + Math.max(0, activeColumns.length - 1) * colSpacing + 180);
  const height = Math.max(340, padY * 2 + maxRows * rowSpacing);

  const nodes = new Map<string, GraphNode>();
  activeColumns.forEach((col, colIdx) => {
    (columnsMap.get(col) ?? []).sort().forEach((id, rowIdx) => {
      nodes.set(id, {
        id,
        label: path.posix.basename(id),
        layer: nodeLayers.get(id) ?? 'other',
        x: padX + colIdx * colSpacing,
        y: padY + rowIdx * rowSpacing,
        hasViolation: violatedNodes.has(id),
      });
    });
  });

  const layerHeadersSvg = activeColumns
    .map((col, colIdx) => {
      const x = padX + colIdx * colSpacing;
      return `<g><rect x="${x - 85}" y="18" width="170" height="30" rx="15" fill="#1e293b" stroke="#334155" /><text x="${x}" y="38" text-anchor="middle" fill="#94a3b8" font-size="12" font-weight="700" letter-spacing="0.06em">LAYER: ${escapeHtml(
        col.toUpperCase()
      )}</text></g>`;
    })
    .join('\n');

  return `<div class="svg-wrapper"><svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <defs>
      <marker id="arrow-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" fill-opacity="0.7" /></marker>
      <marker id="arrow-error" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" /></marker>
    </defs>
    ${layerHeadersSvg}
    ${renderEdgesSvg(edges, nodes)}
    ${renderNodesSvg(nodes)}
  </svg></div>`;
}

/**
 * Generates a standalone interactive HTML dashboard (`vibe-report.html`).
 */
export function generateHtmlReport(report: AuditReport, outputPath?: string): string {
  const targetFile = outputPath
    ? path.resolve(outputPath)
    : path.join(report.projectRoot, 'vibe-report.html');

  const graphHtml = buildSvgDependencyGraph(report.edges);
  const issuesRowsHtml =
    report.issues.length === 0
      ? `<div class="clean-banner">🎉 Không phát hiện lỗi kiến trúc hay trùng lặp ngữ nghĩa nào!</div>`
      : report.issues
          .map(
            (iss) => `<div class="issue-card" data-severity="${escapeHtml(iss.severity)}" data-tier="${escapeHtml(
              iss.tier
            )}">
            <div class="issue-header">
              <span class="badge badge-${escapeHtml(iss.severity)}">${escapeHtml(iss.severity.toUpperCase())}</span>
              <span class="badge badge-tier">${iss.tier === 'ast' ? 'Tầng 1 · AST' : 'Tầng 2 · AI'}</span>
              <span class="rule-tag">${escapeHtml(iss.ruleId)}</span>
              <code class="file-loc">${escapeHtml(iss.file)}:${iss.line}</code>
            </div>
            <p class="issue-msg">${escapeHtml(iss.message)}</p>
            ${iss.snippet ? `<pre class="code-snippet">${escapeHtml(iss.snippet)}</pre>` : ''}
            <div class="issue-fix"><strong>💡 Gợi ý khắc phục:</strong> ${escapeHtml(iss.suggestion)}</div>
          </div>`
          )
          .join('\n');

  fs.writeFileSync(targetFile, renderReportDocument(report, graphHtml, issuesRowsHtml), 'utf-8');
  return targetFile;
}
