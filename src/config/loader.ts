import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ArchRulesConfig, ArchRulesSchema } from './schema.js';

export const DEFAULT_CONFIG_FILENAMES = ['.archrules.yaml', '.archrules.yml'] as const;

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

export interface LoadedConfigResult {
  config: ArchRulesConfig;
  configPath: string;
  usedDefaultConfig: boolean;
}

/**
 * Sensible built-in Next.js Clean Architecture defaults when `.archrules.yaml` is absent.
 */
export function createDefaultArchRules(): ArchRulesConfig {
  return ArchRulesSchema.parse({
    version: '1.0',
    project_type: 'nextjs-clean-arch',
    layers: {
      ui: {
        path: ['src/components/**', 'components/**'],
        cannot_import: ['src/db/**', 'db/**', 'src/services/backend/**'],
      },
      app: {
        path: ['src/app/**', 'app/**', 'src/pages/**', 'pages/**'],
        cannot_import: ['src/db/**', 'db/**'],
      },
      services: {
        path: ['src/services/**', 'services/**'],
        cannot_import: ['src/components/**', 'components/**', 'src/app/**', 'app/**'],
      },
      db: {
        path: ['src/db/**', 'db/**'],
        cannot_import: ['src/components/**', 'components/**', 'src/services/**', 'services/**'],
      },
    },
    thresholds: {
      max_file_lines: 300,
      max_function_lines: 50,
    },
    dependencies: {
      strict_mode: false,
      allowed_ui: ['lucide-react', 'framer-motion', '@radix-ui/*'],
      allowed_validation: ['zod'],
    },
    ai_eval: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      check_semantic_duplication: true,
      check_prd_compliance: true,
      prd_path: 'PRD.md',
    },
  });
}

/**
 * Loads and validates `.archrules.yaml` from the project directory or an explicit path.
 */
export function loadArchRules(
  projectRoot: string,
  options: { configPath?: string; allowDefaultFallback?: boolean } = {}
): LoadedConfigResult {
  const resolvedRoot = path.resolve(projectRoot);
  const allowFallback = options.allowDefaultFallback ?? true;

  let candidatePath: string | undefined;

  if (options.configPath) {
    candidatePath = path.isAbsolute(options.configPath)
      ? options.configPath
      : path.resolve(resolvedRoot, options.configPath);
    if (!fs.existsSync(candidatePath)) {
      throw new ConfigLoadError(`Configuration file not found at explicit path: ${candidatePath}`);
    }
  } else {
    for (const filename of DEFAULT_CONFIG_FILENAMES) {
      const fullPath = path.join(resolvedRoot, filename);
      if (fs.existsSync(fullPath)) {
        candidatePath = fullPath;
        break;
      }
    }
  }

  if (!candidatePath) {
    if (!allowFallback) {
      throw new ConfigLoadError(
        `No .archrules.yaml found in ${resolvedRoot}. Run "npx vibe-doctor init" to create one.`
      );
    }
    return {
      config: createDefaultArchRules(),
      configPath: path.join(resolvedRoot, '.archrules.yaml'),
      usedDefaultConfig: true,
    };
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(candidatePath, 'utf-8');
  } catch (err) {
    throw new ConfigLoadError(
      `Failed to read configuration file ${candidatePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawContent);
  } catch (err) {
    throw new ConfigLoadError(
      `Invalid YAML syntax in ${candidatePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const validation = ArchRulesSchema.safeParse(parsedYaml ?? {});
  if (!validation.success) {
    const details = validation.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new ConfigLoadError(`Invalid .archrules.yaml configuration in ${candidatePath}:\n${details}`);
  }

  return {
    config: validation.data,
    configPath: candidatePath,
    usedDefaultConfig: false,
  };
}
