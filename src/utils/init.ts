import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitRepository } from './git.js';

export interface InitProjectResult {
  archRulesPath: string;
  createdArchRules: boolean;
  hookPath?: string;
  installedHook: boolean;
}

/**
 * Scaffolds `.archrules.yaml` and installs Git pre-commit guardrail hook (Husky or `.git/hooks/pre-commit`).
 */
export function initProject(
  projectRoot: string,
  options: { force?: boolean; installHook?: boolean } = {}
): InitProjectResult {
  const resolvedRoot = path.resolve(projectRoot);
  const targetArchRules = path.join(resolvedRoot, '.archrules.yaml');
  let createdArchRules = false;

  if (!fs.existsSync(targetArchRules) || options.force) {
    const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
    const templateCandidates = [
      path.resolve(currentFileDir, '../../templates/.archrules.yaml'),
      path.resolve(currentFileDir, '../templates/.archrules.yaml'),
    ];
    const templatePath = templateCandidates.find((p) => fs.existsSync(p));
    if (!templatePath) {
      throw new Error('Could not locate templates/.archrules.yaml');
    }
    fs.copyFileSync(templatePath, targetArchRules);
    createdArchRules = true;
  }

  let hookPath: string | undefined;
  let installedHook = false;
  const hookCommand = 'npx --no-install vibe-doctor audit --staged';

  if (options.installHook ?? true) {
    const huskyDir = path.join(resolvedRoot, '.husky');
    const gitHooksDir = path.join(resolvedRoot, '.git', 'hooks');

    if (fs.existsSync(huskyDir)) {
      hookPath = path.join(huskyDir, 'pre-commit');
    } else if (isGitRepository(resolvedRoot) && fs.existsSync(path.join(resolvedRoot, '.git'))) {
      fs.mkdirSync(gitHooksDir, { recursive: true });
      hookPath = path.join(gitHooksDir, 'pre-commit');
    }

    if (hookPath) {
      if (fs.existsSync(hookPath)) {
        const existing = fs.readFileSync(hookPath, 'utf-8');
        if (!existing.includes('vibe-doctor')) {
          fs.writeFileSync(hookPath, `${existing.trimEnd()}\n${hookCommand}\n`, 'utf-8');
          installedHook = true;
        }
      } else {
        const hookScript = `#!/usr/bin/env sh\n# Vibe Doctor Architecture Guardrail\n${hookCommand}\n`;
        fs.writeFileSync(hookPath, hookScript, 'utf-8');
        try {
          fs.chmodSync(hookPath, 0o755);
        } catch {
          // Ignore chmod on Windows
        }
        installedHook = true;
      }
    }
  }

  return { archRulesPath: targetArchRules, createdArchRules, hookPath, installedHook };
}
