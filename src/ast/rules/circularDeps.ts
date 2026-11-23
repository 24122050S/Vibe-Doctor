import { SourceFile } from 'ts-morph';
import { AuditIssue, DependencyEdge } from '../../types.js';
import {
  extractModuleImports,
  PathAliasConfig,
  resolveSpecifierToProjectPath,
} from '../parser.js';

interface OutgoingImportEdge {
  toFile: string;
  specifier: string;
  line: number;
  column: number;
  snippet: string;
}

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

/**
 * Maps an extensionless or directory-level internal path (e.g. `src/services/user` or `src/db`)
 * to the exact canonical relative POSIX key inside `knownFiles` (e.g. `src/services/user.ts` or `src/db/index.ts`).
 */
function resolveToKnownSourceFile(
  resolvedPath: string,
  knownFiles: Set<string>
): string | null {
  const clean = resolvedPath.replace(/^\.\//, '').replace(/\/+$/, '');
  if (knownFiles.has(clean)) {
    return clean;
  }

  for (const ext of CANDIDATE_EXTENSIONS) {
    const withExt = `${clean}${ext}`;
    if (knownFiles.has(withExt)) {
      return withExt;
    }
  }

  for (const ext of CANDIDATE_EXTENSIONS) {
    const indexCandidate = `${clean}/index${ext}`;
    if (knownFiles.has(indexCandidate)) {
      return indexCandidate;
    }
  }

  return null;
}

/**
 * Rotates a cycle node array `[n0, n1, ..., nk-1]` so the lexicographically smallest file comes first,
 * producing a unique canonical key for deduplicating identical cycles discovered from different entry nodes.
 */
function canonicalizeCycleNodes(cycleNodes: string[]): string[] {
  if (cycleNodes.length <= 1) return cycleNodes;
  let minIdx = 0;
  for (let i = 1; i < cycleNodes.length; i++) {
    if (cycleNodes[i].localeCompare(cycleNodes[minIdx]) < 0) {
      minIdx = i;
    }
  }
  return [...cycleNodes.slice(minIdx), ...cycleNodes.slice(0, minIdx)];
}

function buildRuntimeAdjacencyGraph(
  projectRoot: string,
  sourceFiles: Map<string, SourceFile>,
  knownFiles: Set<string>,
  aliasConfig: PathAliasConfig
): Map<string, OutgoingImportEdge[]> {
  const adjacency = new Map<string, OutgoingImportEdge[]>();

  for (const [fromFile, sf] of sourceFiles.entries()) {
    const outgoing: OutgoingImportEdge[] = [];
    for (const imp of extractModuleImports(sf)) {
      if (imp.isTypeOnly) continue;
      const rawResolved = resolveSpecifierToProjectPath(
        projectRoot,
        fromFile,
        imp.specifier,
        aliasConfig
      );
      if (!rawResolved) continue;

      const targetFile = resolveToKnownSourceFile(rawResolved, knownFiles);
      if (!targetFile || targetFile === fromFile) continue;

      outgoing.push({
        toFile: targetFile,
        specifier: imp.specifier,
        line: imp.line,
        column: imp.column,
        snippet: imp.snippet,
      });
    }
    adjacency.set(fromFile, outgoing);
  }

  return adjacency;
}

/**
 * Detects runtime circular dependencies (`A -> B -> ... -> A`) across scanned `sourceFiles` using DFS.
 * Ignores TypeScript `import type` statements since they are erased at compile time.
 * Also marks participating `DependencyEdge` items as `violated = true` for HTML graph visualization.
 */
export function checkCircularDependencies(
  projectRoot: string,
  sourceFiles: Map<string, SourceFile>,
  aliasConfig: PathAliasConfig,
  edges?: DependencyEdge[]
): AuditIssue[] {
  const knownFiles = new Set<string>(sourceFiles.keys());
  const adjacency = buildRuntimeAdjacencyGraph(projectRoot, sourceFiles, knownFiles, aliasConfig);

  // Visit states: 0 = unvisited, 1 = visiting (on current recursion stack), 2 = completely explored
  const state = new Map<string, 0 | 1 | 2>();
  const stackNodes: string[] = [];
  const stackEdges: OutgoingImportEdge[] = [];
  const seenCycles = new Set<string>();
  const cyclePairs = new Set<string>();
  const issues: AuditIssue[] = [];

  function dfs(node: string): void {
    state.set(node, 1);
    stackNodes.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const edge of neighbors) {
      const nextState = state.get(edge.toFile) ?? 0;

      if (nextState === 0) {
        stackEdges.push(edge);
        dfs(edge.toFile);
        stackEdges.pop();
      } else if (nextState === 1) {
        const cycleStartIdx = stackNodes.indexOf(edge.toFile);
        if (cycleStartIdx !== -1) {
          const rawCycle = stackNodes.slice(cycleStartIdx);
          const canonical = canonicalizeCycleNodes(rawCycle);
          const cycleKey = canonical.join(' -> ');

          if (!seenCycles.has(cycleKey)) {
            seenCycles.add(cycleKey);
            const fullChain = [...canonical, canonical[0]].join(' -> ');

            // Record every directed hop in the cycle so HTML Dependency Graph highlights the loop
            for (let i = 0; i < canonical.length; i++) {
              const u = canonical[i];
              const v = canonical[(i + 1) % canonical.length];
              cyclePairs.add(`${u}=>${v}`);
            }

            issues.push({
              tier: 'ast',
              ruleId: 'circular-dependency',
              severity: 'critical',
              file: node,
              line: edge.line,
              column: edge.column,
              message: `Phát hiện vòng lặp phụ thuộc (Circular Dependency): ${fullChain}`,
              snippet: edge.snippet,
              suggestion: `Phá vỡ chu trình '${fullChain}' bằng cách tách phần dùng chung sang module độc lập (ví dụ types/shared helper), chuyển sang 'import type' nếu chỉ dùng kiểu TypeScript, hoặc đảo chiều phụ thuộc qua Dependency Injection.`,
              metadata: {
                cycle: [...canonical, canonical[0]],
                closingImportSpecifier: edge.specifier,
              },
            });
          }
        }
      }
    }

    stackNodes.pop();
    state.set(node, 2);
  }

  for (const file of knownFiles) {
    if ((state.get(file) ?? 0) === 0) {
      dfs(file);
    }
  }

  // Mark cycle edges as violated in the shared graph edge list for vibe-report.html
  if (edges && cyclePairs.size > 0) {
    for (const graphEdge of edges) {
      const resolvedDst = resolveToKnownSourceFile(graphEdge.to, knownFiles);
      if (resolvedDst && cyclePairs.has(`${graphEdge.from}=>${resolvedDst}`)) {
        graphEdge.violated = true;
      }
    }
  }

  return issues;
}
