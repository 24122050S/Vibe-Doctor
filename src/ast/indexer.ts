import fs from 'node:fs';
import path from 'node:path';
import {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  JSDocableNode,
  MethodDeclaration,
  Node,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';
import { FunctionCacheIndex, FunctionSignatureEntry } from '../types.js';
import { walkProjectSourceFiles } from '../utils/git.js';
import { createFastAstProject, loadSourceFilesIntoProject } from './parser.js';

export const VIBE_CACHE_FILENAME = '.vibe-cache.json';

function extractJsDocText(node: Node): string | undefined {
  if (Node.isJSDocable(node)) {
    const docs = (node as JSDocableNode).getJsDocs();
    if (docs.length > 0) {
      return docs
        .map((d) => d.getCommentText() ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return undefined;
}

function summarizeBody(bodyText: string | undefined): string {
  if (!bodyText) return '';
  return bodyText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

function formatParams(
  fn: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression
): string {
  const params = fn.getParameters().map((p) => p.getText().replace(/\s+/g, ' ').trim());
  return `(${params.join(', ')})`;
}

function formatReturnType(
  fn: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression
): string {
  const returnTypeNode = fn.getReturnTypeNode();
  return returnTypeNode ? returnTypeNode.getText().trim() : 'unknown';
}

/**
 * Extracts all named functions, class methods, and top-level arrow/function expressions from a SourceFile.
 */
export function extractFunctionsFromSourceFile(
  relPosixPath: string,
  sourceFile: SourceFile
): FunctionSignatureEntry[] {
  const entries: FunctionSignatureEntry[] = [];

  // 1. Function Declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    const params = formatParams(fn);
    const returnType = formatReturnType(fn);
    entries.push({
      id: `${relPosixPath}::${name}`,
      name,
      file: relPosixPath,
      line: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
      exported: fn.isExported(),
      params,
      returnType,
      signature: `function ${name}${params}: ${returnType}`,
      jsdoc: extractJsDocText(fn),
      summary: summarizeBody(fn.getBody()?.getText()),
    });
  }

  // 2. Class Methods
  for (const cls of sourceFile.getClasses()) {
    const className = cls.getName() ?? 'AnonymousClass';
    for (const method of cls.getMethods()) {
      const methodName = `${className}.${method.getName()}`;
      const params = formatParams(method);
      const returnType = formatReturnType(method);
      entries.push({
        id: `${relPosixPath}::${methodName}`,
        name: methodName,
        file: relPosixPath,
        line: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        exported: cls.isExported(),
        params,
        returnType,
        signature: `${methodName}${params}: ${returnType}`,
        jsdoc: extractJsDocText(method),
        summary: summarizeBody(method.getBody()?.getText()),
      });
    }
  }

  // 3. Variable Statements with ArrowFunction / FunctionExpression
  for (const varStmt of sourceFile.getVariableStatements()) {
    const isExported = varStmt.isExported();
    const stmtJsDoc = extractJsDocText(varStmt);

    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;

      if (
        init.getKind() === SyntaxKind.ArrowFunction ||
        init.getKind() === SyntaxKind.FunctionExpression
      ) {
        const fn = init as ArrowFunction | FunctionExpression;
        const name = decl.getName();
        const params = formatParams(fn);
        const returnType = formatReturnType(fn);
        entries.push({
          id: `${relPosixPath}::${name}`,
          name,
          file: relPosixPath,
          line: decl.getStartLineNumber(),
          endLine: fn.getEndLineNumber(),
          exported: isExported,
          params,
          returnType,
          signature: `const ${name} = ${params}: ${returnType} => ...`,
          jsdoc: stmtJsDoc,
          summary: summarizeBody(fn.getBody()?.getText()),
        });
      }
    }
  }

  return entries;
}

/**
 * Builds the full codebase function signature index and optionally writes `.vibe-cache.json`.
 */
export function buildFunctionIndex(
  projectRoot: string,
  options: { persist?: boolean; existingSourceFiles?: Map<string, SourceFile> } = {}
): FunctionCacheIndex {
  const resolvedRoot = path.resolve(projectRoot);
  const allFiles = walkProjectSourceFiles(resolvedRoot);
  const project = createFastAstProject();

  const entries: FunctionSignatureEntry[] = [];
  for (const relFile of allFiles) {
    const existingSf = options.existingSourceFiles?.get(relFile);
    let sf = existingSf;
    if (!sf) {
      const loaded = loadSourceFilesIntoProject(project, resolvedRoot, [relFile]);
      sf = loaded.get(relFile);
    }
    if (sf) {
      entries.push(...extractFunctionsFromSourceFile(relFile, sf));
    }
  }

  const cacheIndex: FunctionCacheIndex = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    projectRoot: resolvedRoot,
    entries,
  };

  if (options.persist ?? true) {
    const cachePath = path.join(resolvedRoot, VIBE_CACHE_FILENAME);
    try {
      fs.writeFileSync(cachePath, JSON.stringify(cacheIndex, null, 2), 'utf-8');
    } catch {
      // Ignore write failures on read-only filesystems
    }
  }

  return cacheIndex;
}

/**
 * Loads `.vibe-cache.json` if present and fresh, otherwise builds it on the fly.
 */
export function loadOrBuildFunctionIndex(
  projectRoot: string,
  existingSourceFiles?: Map<string, SourceFile>
): FunctionCacheIndex {
  const resolvedRoot = path.resolve(projectRoot);
  const cachePath = path.join(resolvedRoot, VIBE_CACHE_FILENAME);

  if (fs.existsSync(cachePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as FunctionCacheIndex;
      if (raw && Array.isArray(raw.entries)) {
        return raw;
      }
    } catch {
      // Rebuild on corrupted cache
    }
  }

  return buildFunctionIndex(resolvedRoot, { persist: true, existingSourceFiles });
}

/**
 * Splits camelCase, PascalCase, snake_case, and symbols into lowercase semantic tokens.
 */
function tokenizeText(text: string): Set<string> {
  const expanded = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
  const rawTokens = expanded.split(/[^a-z0-9]+/);
  const stopWords = new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'export',
    'async',
    'await',
    'string',
    'number',
    'boolean',
    'any',
    'void',
    'unknown',
    'true',
    'false',
    'null',
    'undefined',
  ]);
  const tokens = new Set<string>();
  for (const tok of rawTokens) {
    if (tok.length >= 2 && !stopWords.has(tok)) {
      tokens.add(tok);
    }
  }
  return tokens;
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Fast lexical + structural pre-filter that selects the Top K candidate functions
 * from `.vibe-cache.json` most similar to `targetFn` (excluding `targetFn` itself).
 */
export function findTopCandidateFunctions(
  targetFn: FunctionSignatureEntry,
  allEntries: FunctionSignatureEntry[],
  topK = 5
): FunctionSignatureEntry[] {
  const targetNameTokens = tokenizeText(targetFn.name);
  const targetBodyTokens = tokenizeText(
    `${targetFn.name} ${targetFn.params} ${targetFn.jsdoc ?? ''} ${targetFn.summary}`
  );

  const scored: Array<{ entry: FunctionSignatureEntry; score: number }> = [];

  for (const candidate of allEntries) {
    // Do not compare a function against itself
    if (candidate.file === targetFn.file && candidate.name === targetFn.name && candidate.line === targetFn.line) {
      continue;
    }

    const candNameTokens = tokenizeText(candidate.name);
    const candBodyTokens = tokenizeText(
      `${candidate.name} ${candidate.params} ${candidate.jsdoc ?? ''} ${candidate.summary}`
    );

    const nameScore = jaccardOverlap(targetNameTokens, candNameTokens);
    const bodyScore = jaccardOverlap(targetBodyTokens, candBodyTokens);
    const sameParamArity =
      targetFn.params.split(',').filter(Boolean).length ===
      candidate.params.split(',').filter(Boolean).length
        ? 0.1
        : 0;

    const totalScore = nameScore * 0.5 + bodyScore * 0.4 + sameParamArity;
    if (totalScore > 0.05) {
      scored.push({ entry: candidate, score: totalScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.entry);
}
