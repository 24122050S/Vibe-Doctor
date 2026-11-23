import { z } from 'zod';

export const LayerRuleSchema = z.object({
  path: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  cannot_import: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export const ThresholdsSchema = z
  .object({
    max_file_lines: z.number().int().positive().default(300),
    max_function_lines: z.number().int().positive().default(50),
    detect_circular_dependencies: z.boolean().default(true),
    detect_hardcoded_secrets: z.boolean().default(true),
  })
  .default({
    max_file_lines: 300,
    max_function_lines: 50,
    detect_circular_dependencies: true,
    detect_hardcoded_secrets: true,
  });

export const DependenciesConfigSchema = z
  .object({
    strict_mode: z.boolean().default(false),
    allowed_ui: z.array(z.string()).optional(),
    allowed_validation: z.array(z.string()).optional(),
    allowed_core: z.array(z.string()).optional(),
    allowed: z.array(z.string()).optional(),
    banned: z.array(z.string()).optional(),
  })
  .catchall(z.union([z.array(z.string()), z.boolean()]))
  .default({
    strict_mode: false,
  });

export const AiEvalConfigSchema = z
  .object({
    provider: z.enum(['gemini', 'ollama', 'openai']).default('gemini'),
    model: z.string().min(1).default('gemini-2.5-flash'),
    base_url: z.string().url().optional(),
    api_key_env: z.string().optional(),
    check_semantic_duplication: z.boolean().default(true),
    check_prd_compliance: z.boolean().default(true),
    prd_path: z.string().default('PRD.md'),
    similarity_threshold: z.number().min(0).max(1).default(0.8),
    max_ai_checks: z.number().int().positive().default(15),
    timeout_ms: z.number().int().positive().default(15000),
  })
  .default({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    check_semantic_duplication: true,
    check_prd_compliance: true,
    prd_path: 'PRD.md',
    similarity_threshold: 0.8,
    max_ai_checks: 15,
    timeout_ms: 15000,
  });

export const ArchRulesSchema = z.object({
  version: z.string().default('1.0'),
  project_type: z.string().default('nextjs-clean-arch'),
  ignore: z.array(z.string()).default([]),
  layers: z.record(z.string(), LayerRuleSchema).default({}),
  thresholds: ThresholdsSchema,
  dependencies: DependenciesConfigSchema,
  ai_eval: AiEvalConfigSchema,
});

export type LayerRule = z.infer<typeof LayerRuleSchema>;
export type ThresholdsConfig = z.infer<typeof ThresholdsSchema>;
export type DependenciesConfig = z.infer<typeof DependenciesConfigSchema>;
export type AiEvalConfig = z.infer<typeof AiEvalConfigSchema>;
export type ArchRulesConfig = z.infer<typeof ArchRulesSchema>;

/**
 * Collects all `allowed*` package pattern lists from `dependencies` config.
 */
export function getAllowedDependencyPatterns(deps: DependenciesConfig): string[] {
  const patterns = new Set<string>();
  for (const [key, value] of Object.entries(deps)) {
    if (key.startsWith('allowed') && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          patterns.add(item.trim());
        }
      }
    }
  }
  return Array.from(patterns);
}

/**
 * Collects explicitly banned package patterns from `dependencies.banned`.
 */
export function getBannedDependencyPatterns(deps: DependenciesConfig): string[] {
  if (!Array.isArray(deps.banned)) {
    return [];
  }
  return deps.banned.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
