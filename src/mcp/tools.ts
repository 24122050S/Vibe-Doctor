import path from 'node:path';
import { searchIndexedFunctions } from '../ast/functionSearch.js';
import { buildFunctionIndex, loadOrBuildFunctionIndex } from '../ast/indexer.js';
import { loadArchRules } from '../config/loader.js';
import type { runAudit as RunAuditFn } from '../index.js';
import {
  AgentRuleTarget,
  DEFAULT_RULE_TARGETS,
  syncAgentRules,
} from '../reporters/ruleSync.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const VIBE_MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'vibe_audit',
    description:
      'Audit a TypeScript/JavaScript project with Vibe Doctor (layer boundaries, circular dependencies, file/function size limits, approved package whitelist, and optional Tier 2 LLM semantic duplicate & PRD compliance checks). Returns structured violations and an actionable fixPrompt.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: {
          type: 'string',
          description: 'Target project directory path (defaults to workspace root).',
        },
        staged: {
          type: 'boolean',
          description: 'Only scan Git staged files (git diff --staged). Default: false.',
        },
        semantic: {
          type: 'boolean',
          description: 'Also invoke Tier 2 LLM semantic duplicate & PRD alignment checks. Default: false.',
        },
        strict: {
          type: 'boolean',
          description: 'Treat WARNING issues as blocking failures. Default: false.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vibe_search_functions',
    description:
      'Search existing functions and utilities indexed in the project (.vibe-cache.json) by keyword, name, or domain intent BEFORE writing a new helper/service function to prevent semantic duplication.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords, e.g. "format currency VND" or "shipping discount". Leave empty to list exported functions.',
        },
        projectRoot: {
          type: 'string',
          description: 'Target project directory path (defaults to workspace root).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching functions to return (1-50, default: 12).',
        },
        refreshIndex: {
          type: 'boolean',
          description: 'Rebuild .vibe-cache.json from source files before searching. Default: false.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vibe_sync_rules',
    description:
      'Synchronize .archrules.yaml and exported function signatures into AI Coding Agent rule files (.cursor/rules/vibe-doctor.mdc, AGENTS.md, CLAUDE.md, .windsurfrules) non-destructively.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: {
          type: 'string',
          description: 'Target project directory path (defaults to workspace root).',
        },
        targets: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['cursor', 'agents', 'claude', 'windsurf'],
          },
          description: 'Agent targets to generate/update (default: ["cursor", "agents", "claude"]).',
        },
      },
      additionalProperties: false,
    },
  },
] as const;

export async function executeVibeMcpTool(
  toolName: string,
  rawArgs: Record<string, unknown> | undefined,
  defaultProjectRoot: string,
  runAuditFn: typeof RunAuditFn
): Promise<McpToolCallResult> {
  const args = rawArgs ?? {};
  const projectRoot =
    typeof args.projectRoot === 'string' && args.projectRoot.trim()
      ? path.resolve(defaultProjectRoot, args.projectRoot)
      : path.resolve(defaultProjectRoot);

  try {
    if (toolName === 'vibe_audit') {
      const staged = Boolean(args.staged);
      const semantic = Boolean(args.semantic);
      const strict = Boolean(args.strict);

      const report = await runAuditFn({
        projectRoot,
        staged,
        semantic,
        ai: semantic,
        strict,
      });

      const payload = {
        passed: report.passed,
        projectRoot: report.projectRoot,
        mode: report.mode,
        metrics: report.metrics,
        summary: {
          critical: report.issues.filter((i) => i.severity === 'critical').length,
          warning: report.issues.filter((i) => i.severity === 'warning').length,
          totalIssues: report.issues.length,
        },
        issues: report.issues,
        fixPrompt: report.fixPrompt,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: false,
      };
    }

    if (toolName === 'vibe_search_functions') {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 12;
      const refreshIndex = Boolean(args.refreshIndex);

      const cache = refreshIndex
        ? buildFunctionIndex(projectRoot, { persist: true })
        : loadOrBuildFunctionIndex(projectRoot);

      const matches = searchIndexedFunctions(cache.entries, query, limit);
      const payload = {
        projectRoot,
        totalIndexed: cache.entries.length,
        query,
        matches: matches.map((m) => ({
          id: m.id,
          file: m.file,
          line: m.line,
          exported: m.exported,
          signature: m.signature,
          jsdoc: m.jsdoc ?? null,
          summary: m.summary,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: false,
      };
    }

    if (toolName === 'vibe_sync_rules') {
      const validSet = new Set<AgentRuleTarget>(['cursor', 'agents', 'claude', 'windsurf']);
      const requestedTargets = Array.isArray(args.targets)
        ? args.targets
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.toLowerCase() as AgentRuleTarget)
            .filter((t) => validSet.has(t))
        : [];
      const targets = requestedTargets.length > 0 ? requestedTargets : DEFAULT_RULE_TARGETS;

      const { config } = loadArchRules(projectRoot);
      const cache = buildFunctionIndex(projectRoot, { persist: true });
      const synced = syncAgentRules(projectRoot, config, {
        targets,
        exportedFunctions: cache.entries,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(synced, null, 2) }],
        isError: false,
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown MCP tool: '${toolName}'` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing '${toolName}': ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
