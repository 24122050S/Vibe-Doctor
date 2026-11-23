import fs from 'node:fs';
import path from 'node:path';
import {
  ArchRulesConfig,
  getAllowedDependencyPatterns,
  getBannedDependencyPatterns,
} from '../config/schema.js';
import { FunctionSignatureEntry } from '../types.js';

export type AgentRuleTarget = 'cursor' | 'agents' | 'claude' | 'windsurf';

export const DEFAULT_RULE_TARGETS: AgentRuleTarget[] = ['cursor', 'agents', 'claude'];

export const VIBE_DOCTOR_START_MARKER = '<!-- VIBE-DOCTOR:START -->';
export const VIBE_DOCTOR_END_MARKER = '<!-- VIBE-DOCTOR:END -->';

export interface SyncRulesOptions {
  targets?: AgentRuleTarget[];
  exportedFunctions?: FunctionSignatureEntry[];
  maxFunctionsListed?: number;
}

export interface SyncedRuleFile {
  target: AgentRuleTarget;
  filePath: string;
  action: 'created' | 'updated';
}

export interface SyncRulesResult {
  projectRoot: string;
  files: SyncedRuleFile[];
}

function renderCoreGuardrailsMarkdown(
  config: ArchRulesConfig,
  exportedFunctions: FunctionSignatureEntry[],
  maxFunctions: number
): string {
  const lines: string[] = [
    '## 🩺 Vibe Doctor — Architecture & Code Governance Rules',
    '',
    '> Auto-generated from `.archrules.yaml`. Do not edit inside this managed block; run `npx vibe-doctor sync-rules` after updating `.archrules.yaml`.',
    '',
    `### 1. Layer Boundaries (\`project_type: ${config.project_type}\`)`,
  ];

  const layerEntries = Object.entries(config.layers);
  if (layerEntries.length === 0) {
    lines.push('- No explicit layer restrictions configured.');
  } else {
    for (const [layerName, rule] of layerEntries) {
      const pathsText = (Array.isArray(rule.path) ? rule.path : [rule.path])
        .map((p) => `\`${p}\``)
        .join(', ');
      const forbiddenText =
        rule.cannot_import.length > 0
          ? rule.cannot_import.map((p) => `\`${p}\``).join(', ')
          : '*(none)*';
      lines.push(
        `- **Layer \`${layerName}\`** (${pathsText}): **MUST NOT** import from ${forbiddenText}.`
      );
    }
  }

  lines.push(
    '',
    '### 2. Clean Code & Module Graph Rules',
    `- **Max lines per file:** \`${config.thresholds.max_file_lines}\` lines. Split large modules into focused sub-modules.`,
    `- **Max lines per function:** \`${config.thresholds.max_function_lines}\` lines. Extract small, single-purpose helpers.`,
    ...(config.thresholds.detect_circular_dependencies
      ? [
          '- **Zero Circular Dependencies:** Never introduce runtime import cycles (`A -> B -> A`). Extract shared types/contracts into dedicated leaf modules or use `import type`.',
        ]
      : [])
  );

  const allowedDeps = getAllowedDependencyPatterns(config.dependencies);
  const bannedDeps = getBannedDependencyPatterns(config.dependencies);

  lines.push('', '### 3. Dependency Policy');
  lines.push(
    `- **Strict Whitelist Mode:** \`${config.dependencies.strict_mode ? 'ENABLED (do NOT install or import unapproved third-party packages)' : 'DISABLED'}\``
  );
  if (allowedDeps.length > 0) {
    lines.push(`- **Approved Packages:** ${allowedDeps.map((d) => `\`${d}\``).join(', ')}`);
  }
  if (bannedDeps.length > 0) {
    lines.push(`- **Banned Packages (Forbidden):** ${bannedDeps.map((d) => `\`${d}\``).join(', ')}`);
  }

  if (config.ai_eval.check_prd_compliance) {
    lines.push(
      '',
      '### 4. Business Logic & PRD Alignment',
      `- Always verify business rules, thresholds, and domain invariants against \`${config.ai_eval.prd_path}\` before implementing or modifying service logic.`
    );
  }

  const publicFns = exportedFunctions.filter((fn) => fn.exported).slice(0, maxFunctions);
  if (publicFns.length > 0) {
    lines.push(
      '',
      '### 5. Existing Reusable Functions (Reuse — Do Not Duplicate)',
      'Before writing a new helper or service function, reuse these existing exported functions:'
    );
    for (const fn of publicFns) {
      const docSuffix = fn.jsdoc ? ` — ${fn.jsdoc.slice(0, 90)}` : '';
      lines.push(`- \`${fn.file}\` -> \`${fn.name}${fn.params}: ${fn.returnType}\`${docSuffix}`);
    }
  }

  lines.push(
    '',
    '### 6. Pre-Commit Self-Check',
    '- After completing code edits, run `npx vibe-doctor audit` and resolve any `CRITICAL` or `WARNING` issues before committing.'
  );

  return lines.join('\n');
}

/**
 * Inserts or updates a marker-fenced section inside a Markdown file without losing user content.
 */
export function upsertMarkedMarkdownFile(
  filePath: string,
  bodyMarkdown: string
): 'created' | 'updated' {
  const managedBlock = `${VIBE_DOCTOR_START_MARKER}\n${bodyMarkdown}\n${VIBE_DOCTOR_END_MARKER}`;

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${managedBlock}\n`, 'utf-8');
    return 'created';
  }

  const existing = fs.readFileSync(filePath, 'utf-8');
  const startIdx = existing.indexOf(VIBE_DOCTOR_START_MARKER);
  const endIdx = existing.indexOf(VIBE_DOCTOR_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + VIBE_DOCTOR_END_MARKER.length);
    fs.writeFileSync(filePath, `${before}${managedBlock}${after}`, 'utf-8');
    return 'updated';
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(filePath, `${existing}${separator}${managedBlock}\n`, 'utf-8');
  return 'updated';
}

function writeDedicatedRuleFile(filePath: string, content: string): 'created' | 'updated' {
  const existed = fs.existsSync(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return existed ? 'updated' : 'created';
}

/**
 * Generates proactive AI Coding Agent instruction files (`.cursor/rules/vibe-doctor.mdc`,
 * `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`) directly from `.archrules.yaml` + function index.
 */
export function syncAgentRules(
  projectRoot: string,
  config: ArchRulesConfig,
  options: SyncRulesOptions = {}
): SyncRulesResult {
  const resolvedRoot = path.resolve(projectRoot);
  const targets = options.targets ?? DEFAULT_RULE_TARGETS;
  const exportedFunctions = options.exportedFunctions ?? [];
  const maxFunctions = options.maxFunctionsListed ?? 35;

  const coreMarkdown = renderCoreGuardrailsMarkdown(config, exportedFunctions, maxFunctions);
  const files: SyncedRuleFile[] = [];

  for (const target of targets) {
    if (target === 'cursor') {
      const cursorPath = path.join(resolvedRoot, '.cursor', 'rules', 'vibe-doctor.mdc');
      const mdcContent = [
        '---',
        'description: Vibe Doctor Architecture Guardrails & Clean Code Rules (auto-generated from .archrules.yaml)',
        'globs: "**/*"',
        'alwaysApply: true',
        '---',
        '',
        coreMarkdown,
        '',
      ].join('\n');
      const action = writeDedicatedRuleFile(cursorPath, mdcContent);
      files.push({ target, filePath: cursorPath, action });
    } else if (target === 'agents') {
      const agentsPath = path.join(resolvedRoot, 'AGENTS.md');
      const action = upsertMarkedMarkdownFile(agentsPath, coreMarkdown);
      files.push({ target, filePath: agentsPath, action });
    } else if (target === 'claude') {
      const claudePath = path.join(resolvedRoot, 'CLAUDE.md');
      const action = upsertMarkedMarkdownFile(claudePath, coreMarkdown);
      files.push({ target, filePath: claudePath, action });
    } else if (target === 'windsurf') {
      const windsurfPath = path.join(resolvedRoot, '.windsurfrules');
      const action = upsertMarkedMarkdownFile(windsurfPath, coreMarkdown);
      files.push({ target, filePath: windsurfPath, action });
    }
  }

  return { projectRoot: resolvedRoot, files };
}
