import fs from 'node:fs';
import path from 'node:path';

export interface LoadedEnvSummary {
  loadedFiles: string[];
  injectedKeys: string[];
}

/**
 * Parses standard `.env` file content (`KEY=VALUE`, `export KEY="VALUE"`, comments `# ...`).
 */
export function parseDotEnvContent(content: string): Record<string, string> {
  const clean = content.replace(/^\uFEFF/, '');
  const result: Record<string, string> = {};

  for (const rawLine of clean.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let rawVal = withoutExport.slice(eqIndex + 1).trim();

    if (
      (rawVal.startsWith('"') && rawVal.endsWith('"') && rawVal.length >= 2) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'") && rawVal.length >= 2)
    ) {
      const quote = rawVal[0];
      rawVal = rawVal.slice(1, -1);
      if (quote === '"') {
        rawVal = rawVal.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
      }
    } else {
      // Strip unquoted inline comments (`KEY=abc # comment`)
      const hashIdx = rawVal.indexOf(' #');
      if (hashIdx !== -1) {
        rawVal = rawVal.slice(0, hashIdx).trim();
      }
    }

    result[key] = rawVal;
  }

  return result;
}

/**
 * Automatically loads `.env.local` and `.env` from `projectRoot` (and `cwd` as fallback)
 * without overwriting environment variables already set in `process.env`.
 */
export function loadProjectEnvFiles(
  projectRoot: string,
  cwd: string = process.cwd(),
  targetEnv: NodeJS.ProcessEnv = process.env
): LoadedEnvSummary {
  const resolvedProject = path.resolve(projectRoot);
  const resolvedCwd = path.resolve(cwd);

  const candidateDirs =
    resolvedProject === resolvedCwd ? [resolvedProject] : [resolvedProject, resolvedCwd];

  const candidateFiles: string[] = [];
  for (const dir of candidateDirs) {
    candidateFiles.push(path.join(dir, '.env.local'));
    candidateFiles.push(path.join(dir, '.env'));
  }

  const loadedFiles: string[] = [];
  const injectedKeys: string[] = [];

  for (const filePath of candidateFiles) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseDotEnvContent(raw);
      loadedFiles.push(filePath);

      for (const [key, val] of Object.entries(parsed)) {
        if (targetEnv[key] === undefined || targetEnv[key] === '') {
          targetEnv[key] = val;
          injectedKeys.push(key);
        }
      }
    } catch {
      // Ignore unreadable env files gracefully
    }
  }

  return { loadedFiles, injectedKeys };
}
