import { FunctionSignatureEntry } from '../types.js';

function splitSearchTokens(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 2);
}

/**
 * Searches indexed codebase functions by keyword, function name, file path, or domain intent.
 * Used by the `vibe_search_functions` MCP tool so AI Agents discover reusable helpers before coding.
 */
export function searchIndexedFunctions(
  entries: FunctionSignatureEntry[],
  query?: string,
  limit = 12
): FunctionSignatureEntry[] {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const trimmedQuery = (query ?? '').trim();

  if (!trimmedQuery) {
    return [...entries]
      .sort((a, b) => Number(b.exported) - Number(a.exported) || a.id.localeCompare(b.id))
      .slice(0, safeLimit);
  }

  const lowerQuery = trimmedQuery.toLowerCase();
  const queryTokens = splitSearchTokens(trimmedQuery);

  const scored: Array<{ entry: FunctionSignatureEntry; score: number }> = [];

  for (const entry of entries) {
    let score = 0;
    const lowerName = entry.name.toLowerCase();
    const lowerFile = entry.file.toLowerCase();

    if (lowerName === lowerQuery) {
      score += 10;
    } else if (lowerName.includes(lowerQuery)) {
      score += 5;
    }

    if (lowerFile.includes(lowerQuery)) {
      score += 3;
    }

    if (queryTokens.length > 0) {
      const haystackTokens = new Set(
        splitSearchTokens(
          `${entry.name} ${entry.file} ${entry.params} ${entry.returnType} ${entry.jsdoc ?? ''} ${entry.summary}`
        )
      );
      const nameTokenSet = new Set(splitSearchTokens(entry.name));

      for (const qTok of queryTokens) {
        if (nameTokenSet.has(qTok)) {
          score += 3;
        } else if (haystackTokens.has(qTok)) {
          score += 1.2;
        } else {
          for (const hTok of haystackTokens) {
            if (hTok.includes(qTok) || qTok.includes(hTok)) {
              score += 0.5;
              break;
            }
          }
        }
      }
    }

    if (score > 0) {
      if (entry.exported) {
        score += 0.25;
      }
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return scored.slice(0, safeLimit).map((item) => item.entry);
}
