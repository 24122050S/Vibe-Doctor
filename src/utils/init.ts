import fs from 'node:fs';
import path from 'node:path';
import {
  ArchPresetName,
  AVAILABLE_PRESETS,
  getArchRulesPresetYaml,
  isValidPresetName,
} from '../config/presets.js';
import { isGitRepository } from './git.js';

export interface InitProjectResult {
  archRulesPath: string;
  createdArchRules: boolean;
  preset: ArchPresetName;
  hookPath?: string;
  installedHook: boolean;
}

/**
 * Scaffolds `.archrules.yaml` from the selected framework preset and installs Git pre-commit hook.
 */
export function initProject(
  projectRoot: string,
  options: { force?: boolean; installHook?: boolean; preset?: string } = {}
): InitProjectResult {
  const resolvedRoot = path.resolve(projectRoot);
  const presetInput = (options.preset ?? 'nextjs').trim().toLowerCase();

  if (!isValidPresetName(presetInput)) {
    throw new Error(
      `Preset không hợp lệ: '${options.preset}'. Các preset hỗ trợ: ${AVAILABLE_PRESETS.join(', ')}`
    );
  }

  const targetArchRules = path.join(resolvedRoot, '.archrules.yaml');
  let createdArchRules = false;

  if (!fs.existsSync(targetArchRules) || options.force) {
    fs.mkdirSync(resolvedRoot, { recursive: true });
    fs.writeFileSync(targetArchRules, getArchRulesPresetYaml(presetInput), 'utf-8');
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

  return {
    archRulesPath: targetArchRules,
    createdArchRules,
    preset: presetInput,
    hookPath,
    installedHook,
  };
}
