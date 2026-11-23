import fs from 'node:fs';
import path from 'node:path';
import { Project, SourceFile, SyntaxKind, ts } from 'ts-morph';
import { toPosixPath } from '../utils/git.js';

export interface PathAliasMapping {
  prefix: string;
  wildcard: boolean;
  targets: string[];
}

export interface PathAliasConfig {
  baseUrl: string;
  mappings: PathAliasMapping[];
}

export interface ExtractedImport {
  specifier: string;
  line: number;
  column: number;
  snippet: string;
  isTypeOnly: boolean;
}

/**
 * Creates an ultra-fast ts-morph Project instance tuned for <300ms AST structural analysis
 * (skips lib.d.ts loading and full transitive module resolution).
 */
export function createFastAstProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
}

/**
 * Loads relative POSIX file paths into a ts-morph Project.
 */
export function loadSourceFilesIntoProject(
  project: Project,
  projectRoot: string,
  relPosixFiles: string[]
): Map<string, SourceFile> {
  const resolvedRoot = path.resolve(projectRoot);
  const map = new Map<string, SourceFile>();

  for (const relFile of relPosixFiles) {
    const absPath = path.join(resolvedRoot, relFile);
    if (!fs.existsSync(absPath)) {
      continue;
    }
    try {
      const sf = project.addSourceFileAtPath(absPath);
      map.set(relFile, sf);
    } catch {
      // Skip unreadable or binary files gracefully
    }
  }

  return map;
}

/**
 * Strips single-line and multi-line comments from JSONC (like tsconfig.json) without corrupting string literals.
 */
function stripJsonComments(input: string): string {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      result += ch;
      if (ch === '\\' && i + 1 < input.length) {
        result += next;
        i += 2;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      result += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  // Also strip trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Reads `tsconfig.json` or `jsconfig.json` to extract `baseUrl` and `paths` aliases,
 * plus sensible Next.js `@/*` fallback so alias imports resolve in <1ms.
 */
export function loadPathAliases(projectRoot: string): PathAliasConfig {
  const resolvedRoot = path.resolve(projectRoot);
  const mappings: PathAliasMapping[] = [];
  let baseUrl = '.';

  for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
    const fullPath = path.join(resolvedRoot, configFile);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(stripJsonComments(raw)) as {
        compilerOptions?: {
          baseUrl?: string;
          paths?: Record<string, string[]>;
        };
      };
      const compilerOptions = parsed.compilerOptions;
      if (compilerOptions?.baseUrl) {
        baseUrl = toPosixPath(compilerOptions.baseUrl);
      }
      if (compilerOptions?.paths) {
        for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
          if (!Array.isArray(targets) || targets.length === 0) continue;
          const isWildcard = pattern.endsWith('/*');
          const prefix = isWildcard ? pattern.slice(0, -1) : pattern; // e.g. '@/' or '@db'
          const normalizedTargets = targets.map((t) => {
            const cleanTarget = isWildcard && t.endsWith('/*') ? t.slice(0, -1) : t;
            return path.posix.normalize(path.posix.join(baseUrl, toPosixPath(cleanTarget)));
          });
          mappings.push({
            prefix,
            wildcard: isWildcard,
            targets: normalizedTargets,
          });
        }
      }
      break;
    } catch {
      // Ignore malformed tsconfig and use default conventions
    }
  }

  // Provide standard Next.js/Vite `@/*` and `~/*` fallback if not explicitly configured
  const hasAtAlias = mappings.some((m) => m.prefix === '@/' || m.prefix === '@');
  if (!hasAtAlias) {
    const hasSrcDir = fs.existsSync(path.join(resolvedRoot, 'src'));
    mappings.push({
      prefix: '@/',
      wildcard: true,
      targets: [hasSrcDir ? 'src/' : ''],
    });
  }

  const hasTildeAlias = mappings.some((m) => m.prefix === '~/');
  if (!hasTildeAlias) {
    const hasSrcDir = fs.existsSync(path.join(resolvedRoot, 'src'));
    mappings.push({
      prefix: '~/',
      wildcard: true,
      targets: [hasSrcDir ? 'src/' : ''],
    });
  }

  return { baseUrl, mappings };
}

/**
 * Resolves a module specifier to an internal project-relative POSIX path if it points inside the project,
 * or returns `null` if it is an external npm / Node.js builtin module.
 */
export function resolveSpecifierToProjectPath(
  projectRoot: string,
  fromRelPosix: string,
  specifier: string,
  aliasConfig: PathAliasConfig
): string | null {
  const trimmed = specifier.trim();
  if (!trimmed || trimmed.startsWith('node:')) {
    return null;
  }

  // 1. Relative imports: ./foo or ../bar
  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed === '.' || trimmed === '..') {
    const dir = path.posix.dirname(fromRelPosix);
    const joined = path.posix.normalize(path.posix.join(dir, trimmed));
    return joined.startsWith('..') ? null : joined;
  }

  // 2. Configured or conventional path aliases (e.g. '@/db', '@/utils/currency')
  for (const mapping of aliasConfig.mappings) {
    if (mapping.wildcard && trimmed.startsWith(mapping.prefix)) {
      const rest = trimmed.slice(mapping.prefix.length);
      const targetBase = mapping.targets[0] ?? '';
      const resolved = path.posix.normalize(
        targetBase ? path.posix.join(targetBase, rest) : rest
      );
      return resolved === '.' ? '' : resolved.replace(/^\.\//, '');
    }
    if (!mapping.wildcard && trimmed === mapping.prefix) {
      const targetBase = mapping.targets[0] ?? '';
      return targetBase.replace(/^\.\//, '');
    }
  }

  // 3. Direct baseUrl / root-relative internal imports like `src/db/client`
  if (trimmed.startsWith('src/')) {
    return path.posix.normalize(trimmed);
  }
  if (aliasConfig.baseUrl && aliasConfig.baseUrl !== '.') {
    const candidate = path.posix.normalize(path.posix.join(aliasConfig.baseUrl, trimmed));
    if (fs.existsSync(path.join(projectRoot, candidate)) || fs.existsSync(path.join(projectRoot, `${candidate}.ts`))) {
      return candidate;
    }
  }

  return null;
}

const moduleImportsCache = new WeakMap<SourceFile, ExtractedImport[]>();

/**
 * Extracts all static imports, re-exports, dynamic `import()`, and CommonJS `require()` from a SourceFile (cached per SourceFile).
 */
export function extractModuleImports(sourceFile: SourceFile): ExtractedImport[] {
  const cached = moduleImportsCache.get(sourceFile);
  if (cached) {
    return cached;
  }

  const results: ExtractedImport[] = [];

  // 1. Static import declarations: import { x } from 'y'
  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    const pos = sourceFile.getLineAndColumnAtPos(decl.getStart());
    results.push({
      specifier,
      line: pos.line,
      column: pos.column,
      snippet: decl.getText().split(/\r?\n/)[0].trim(),
      isTypeOnly: decl.isTypeOnly(),
    });
  }

  // 2. Re-export declarations: export { x } from 'y'
  for (const decl of sourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier) continue;
    const pos = sourceFile.getLineAndColumnAtPos(decl.getStart());
    results.push({
      specifier,
      line: pos.line,
      column: pos.column,
      snippet: decl.getText().split(/\r?\n/)[0].trim(),
      isTypeOnly: decl.isTypeOnly(),
    });
  }

  // 3. Dynamic import('y') and require('y') — fast-path skip if neither token exists in file text
  if (/\b(?:import|require)\s*\(/.test(sourceFile.getFullText())) {
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
      const expr = callExpr.getExpression();
      const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
      const isRequire = expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'require';

      if (!isDynamicImport && !isRequire) {
        continue;
      }

      const firstArg = callExpr.getArguments()[0];
      if (firstArg && firstArg.getKind() === SyntaxKind.StringLiteral) {
        const specifier = firstArg.getText().slice(1, -1);
        const pos = sourceFile.getLineAndColumnAtPos(callExpr.getStart());
        results.push({
          specifier,
          line: pos.line,
          column: pos.column,
          snippet: callExpr.getText().split(/\r?\n/)[0].trim(),
          isTypeOnly: false,
        });
      }
    }
  }

  moduleImportsCache.set(sourceFile, results);
  return results;
}
