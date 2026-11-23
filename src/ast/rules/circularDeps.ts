import fs from 'node:fs';
import path from 'node:path';
import { Project, SourceFile } from 'ts-morph';
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

function resolveToKnownOrDiskFile(
  projectRoot: string,
  resolvedPath: string,
  knownFiles: Set<string>,
  allowDiskLookup: boolean
): string | null {
  const clean = resolvedPath.replace(/^\.\//, '').replace(/\/+$/, '');
  if (knownFiles.has(clean)) return clean;

  for (const ext of CANDIDATE_EXTENSIONS) {
    const withExt = `${clean}${ext}`;
    if (knownFiles.has(withExt)) return withExt;
  }

  for (const ext of CANDIDATE_EXTENSIONS) {
    const indexCandidate = `${clean}/index${ext}`;
    if (knownFiles.has(indexCandidate)) return indexCandidate;
  }

  if (!allowDiskLookup) return null;

  if (fs.existsSync(path.join(projectRoot, clean)) && fs.statSync(path.join(projectRoot, clean)).isFile()) {
    return clean;
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const withExt = `${clean}${ext}`;
    if (fs.existsSync(path.join(projectRoot, withExt))) return withExt;
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const indexCandidate = `${clean}/index${ext}`;
    if (fs.existsSync(path.join(projectRoot, indexCandidate))) return indexCandidate;
  }

  return null;
}

/**
 * Lazily expands `workingFiles` along outgoing imports from `seedFiles` on disk
 * so `--staged` pre-commit audits detect cycles involving unstaged neighbor modules!
 */
function expandReachableSourceFiles(
  projectRoot: string,
  project: Project,
  seedFiles: Map<string, SourceFile>,
  aliasConfig: PathAliasConfig
): Map<string, SourceFile> {
  const working = new Map<string, SourceFile>(seedFiles);
  const known = new Set<string>(working.keys());
  const queue: string[] = Array.from(seedFiles.keys());

  while (queue.length > 0) {
    const currentFile = queue.shift()!;
    const sf = working.get(currentFile);
    if (!sf) continue;

    for (const imp of extractModuleImports(sf)) {
      if (imp.isTypeOnly) continue;
      const rawResolved = resolveSpecifierToProjectPath(projectRoot, currentFile, imp.specifier, aliasConfig);
      if (!rawResolved) continue;

      const targetRel = resolveToKnownOrDiskFile(projectRoot, rawResolved, known, true);
      if (!targetRel || working.has(targetRel)) continue;

      try {
        const addedSf = project.addSourceFileAtPath(path.join(projectRoot, targetRel));
        working.set(targetRel, addedSf);
        known.add(targetRel);
        queue.push(targetRel);
      } catch {
        // Ignore unreadable neighbor files
      }
    }
  }

  return working;
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
      const rawResolved = resolveSpecifierToProjectPath(projectRoot, fromFile, imp.specifier, aliasConfig);
      if (!rawResolved) continue;

      const targetFile = resolveToKnownOrDiskFile(projectRoot, rawResolved, knownFiles, false);
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

export interface CircularCheckOptions {
  project?: Project;
  expandUnstagedNeighbors?: boolean;
}

/**
 * Detects runtime circular dependencies (`A -> B -> ... -> A`) using DFS.
 */
export function checkCircularDependencies(
  projectRoot: string,
  sourceFiles: Map<string, SourceFile>,
  aliasConfig: PathAliasConfig,
  edges?: DependencyEdge[],
  options: CircularCheckOptions = {}
): AuditIssue[] {
  const stagedSeeds = new Set<string>(sourceFiles.keys());
  const graphFiles =
    options.expandUnstagedNeighbors && options.project
      ? expandReachableSourceFiles(projectRoot, options.project, sourceFiles, aliasConfig)
      : sourceFiles;

  const knownFiles = new Set<string>(graphFiles.keys());
  const adjacency = buildRuntimeAdjacencyGraph(projectRoot, graphFiles, knownFiles, aliasConfig);

  const state = new Map<string, 0 | 1 | 2>();
  const stackNodes: string[] = [];
  const seenCycles = new Set<string>();
  const cyclePairs = new Set<string>();
  const issues: AuditIssue[] = [];

  function dfs(node: string): void {
    state.set(node, 1);
    stackNodes.push(node);

    for (const edge of adjacency.get(node) ?? []) {
      const nextState = state.get(edge.toFile) ?? 0;
      if (nextState === 0) {
        dfs(edge.toFile);
      } else if (nextState === 1) {
        const cycleStartIdx = stackNodes.indexOf(edge.toFile);
        if (cycleStartIdx === -1) continue;

        const rawCycle = stackNodes.slice(cycleStartIdx);
        if (options.expandUnstagedNeighbors && !rawCycle.some((f) => stagedSeeds.has(f))) {
          continue;
        }

        const canonical = canonicalizeCycleNodes(rawCycle);
        const cycleKey = canonical.join(' -> ');
        if (seenCycles.has(cycleKey)) continue;
        seenCycles.add(cycleKey);

        const fullChain = [...canonical, canonical[0]].join(' -> ');
        for (let i = 0; i < canonical.length; i++) {
          cyclePairs.add(`${canonical[i]}=>${canonical[(i + 1) % canonical.length]}`);
        }

        // Report on a staged node in the cycle when running in --staged mode
        const reportFile = stagedSeeds.has(node)
          ? node
          : rawCycle.find((f) => stagedSeeds.has(f)) ?? node;
        const reportEdge =
          reportFile === node
            ? edge
            : (adjacency.get(reportFile) ?? []).find((e) => rawCycle.includes(e.toFile)) ?? edge;

        issues.push({
          tier: 'ast',
          ruleId: 'circular-dependency',
          severity: 'critical',
          file: reportFile,
          line: reportEdge.line,
          column: reportEdge.column,
          message: `Phát hiện vòng lặp phụ thuộc (Circular Dependency): ${fullChain}`,
          snippet: reportEdge.snippet,
          suggestion: `Phá vỡ chu trình '${fullChain}' bằng cách tách phần dùng chung sang module độc lập (ví dụ types/shared helper), chuyển sang 'import type' nếu chỉ dùng kiểu TypeScript, hoặc đảo chiều phụ thuộc.`,
          metadata: { cycle: [...canonical, canonical[0]], closingImportSpecifier: reportEdge.specifier },
        });
      }
    }

    stackNodes.pop();
    state.set(node, 2);
  }

  for (const file of knownFiles) {
    if ((state.get(file) ?? 0) === 0) dfs(file);
  }

  if (edges && cyclePairs.size > 0) {
    for (const graphEdge of edges) {
      const resolvedDst = resolveToKnownOrDiskFile(projectRoot, graphEdge.to, knownFiles, false);
      if (resolvedDst && cyclePairs.has(`${graphEdge.from}=>${resolvedDst}`)) {
        graphEdge.violated = true;
      }
    }
  }

  return issues;
}
