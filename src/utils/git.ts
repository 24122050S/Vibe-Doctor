import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  '.vercel',
  '.husky',
]);

/**
 * Converts any OS path to forward-slash POSIX relative path.
 */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Returns POSIX path of `targetPath` relative to `projectRoot`.
 */
export function toRelativePosix(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath);
  return toPosixPath(rel);
}

/**
 * Checks whether `cwd` is inside a valid Git working tree.
 */
export function isGitRepository(cwd: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/**
 * Returns POSIX relative paths of staged (added, copied, modified, renamed) files.
 */
export function getStagedFiles(cwd: string): string[] {
  if (!isGitRepository(cwd)) {
    return [];
  }
  try {
    const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\r?\n/)
      .map((line) => toPosixPath(line.trim()))
      .filter((relPath) => relPath.length > 0 && fs.existsSync(path.join(cwd, relPath)));
  } catch {
    return [];
  }
}

/**
 * Returns raw unified diff of staged changes (with 0 context lines for fast line range parsing).
 */
export function getStagedDiff(cwd: string): string {
  if (!isGitRepository(cwd)) {
    return '';
  }
  try {
    return execFileSync('git', ['diff', '--cached', '--unified=0'], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/**
 * Parses `git diff --cached --unified=0` to map each staged file (POSIX relative path)
 * to the set of added/modified line numbers in the new version of the file.
 */
export function getStagedChangedLinesMap(cwd: string): Map<string, Set<number>> {
  const diff = getStagedDiff(cwd);
  const map = new Map<string, Set<number>>();
  if (!diff) {
    return map;
  }

  let currentFile: string | null = null;
  const lines = diff.split(/\r?\n/);

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = toPosixPath(line.slice(6).trim());
      if (!map.has(currentFile)) {
        map.set(currentFile, new Set<number>());
      }
      continue;
    }

    if (currentFile && line.startsWith('@@')) {
      // Format: @@ -oldStart[,oldCount] +newStart[,newCount] @@
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (match) {
        const start = Number.parseInt(match[1], 10);
        const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
        const set = map.get(currentFile)!;
        for (let i = 0; i < count; i++) {
          set.add(start + i);
        }
      }
    }
  }

  return map;
}

/**
 * Recursively collects all source code files in `projectRoot`, skipping ignored build/vendor directories.
 * Returns POSIX relative paths.
 */
export function walkProjectSourceFiles(projectRoot: string): string[] {
  const resolvedRoot = path.resolve(projectRoot);
  const results: string[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.archrules.yaml') {
        if (IGNORED_DIRS.has(entry.name) || entry.isDirectory()) {
          continue;
        }
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        walk(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          results.push(toRelativePosix(resolvedRoot, path.join(currentDir, entry.name)));
        }
      }
    }
  }

  walk(resolvedRoot);
  results.sort();
  return results;
}

/**
 * Resolves the target source files to scan based on `--staged` or full project scan.
 */
export function collectTargetFiles(
  projectRoot: string,
  options: { staged?: boolean } = {}
): { files: string[]; allStagedFiles: string[]; mode: 'staged' | 'full' } {
  if (options.staged) {
    const staged = getStagedFiles(projectRoot);
    const codeFiles = staged.filter((f) => CODE_EXTENSIONS.has(path.extname(f).toLowerCase()));
    return {
      files: codeFiles,
      allStagedFiles: staged,
      mode: 'staged',
    };
  }

  return {
    files: walkProjectSourceFiles(projectRoot),
    allStagedFiles: [],
    mode: 'full',
  };
}
