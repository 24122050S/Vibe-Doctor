import { SourceFile } from 'ts-morph';
import { AuditIssue } from '../types.js';

const suppressedLinesCache = new WeakMap<SourceFile, Set<number>>();

const IGNORE_NEXT_LINE_REGEX = /\bvibe(?:-doctor)?-ignore-next-line\b/i;
const IGNORE_SAME_LINE_REGEX = /\bvibe(?:-doctor)?-ignore(?!-next-line)\b/i;

/**
 * Collects 1-based line numbers suppressed via `// vibe-doctor-ignore-next-line`
 * or `// vibe-ignore` comments in a SourceFile (cached per SourceFile).
 */
export function getSuppressedLines(sourceFile: SourceFile): Set<number> {
  const cached = suppressedLinesCache.get(sourceFile);
  if (cached) {
    return cached;
  }

  const ignored = new Set<number>();
  const lines = sourceFile.getFullText().split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx];
    if (!lineText.includes('vibe')) {
      continue;
    }
    const lineNumber = idx + 1;
    if (IGNORE_NEXT_LINE_REGEX.test(lineText)) {
      ignored.add(lineNumber + 1);
    } else if (IGNORE_SAME_LINE_REGEX.test(lineText)) {
      ignored.add(lineNumber);
    }
  }

  suppressedLinesCache.set(sourceFile, ignored);
  return ignored;
}

/**
 * Filters out issues whose target file & line were explicitly suppressed via inline comments.
 */
export function filterSuppressedIssues(
  issues: AuditIssue[],
  sourceFiles: Map<string, SourceFile>
): AuditIssue[] {
  if (issues.length === 0) {
    return issues;
  }

  return issues.filter((issue) => {
    const sf = sourceFiles.get(issue.file);
    if (!sf) return true;
    const suppressed = getSuppressedLines(sf);
    return !suppressed.has(issue.line);
  });
}
