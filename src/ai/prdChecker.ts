import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AiEvalConfig } from '../config/schema.js';
import { AuditIssue, FunctionSignatureEntry } from '../types.js';
import { logger } from '../utils/logger.js';
import { buildPrdComplianceUserPrompt, PRD_COMPLIANCE_SYSTEM_PROMPT } from './prompts.js';
import { LlmProvider } from './provider.js';

export const PrdViolationsResponseSchema = z.object({
  violations: z
    .array(
      z.object({
        function_id: z.string(),
        has_violation: z.boolean(),
        violated_rule: z.string().default(''),
        severity: z.enum(['critical', 'warning']).default('warning'),
        explanation: z.string().default(''),
        recommendation: z.string().default(''),
      })
    )
    .default([]),
});

/**
 * Compares newly added/modified functions against business constraints in `PRD.md`.
 * Gracefully skips if `PRD.md` is missing or if the LLM API fails.
 */
export async function checkPrdCompliance(
  projectRoot: string,
  targetFunctions: FunctionSignatureEntry[],
  provider: LlmProvider,
  aiConfig: AiEvalConfig
): Promise<AuditIssue[]> {
  if (targetFunctions.length === 0) {
    return [];
  }

  const prdFullPath = path.isAbsolute(aiConfig.prd_path)
    ? aiConfig.prd_path
    : path.join(projectRoot, aiConfig.prd_path);

  if (!fs.existsSync(prdFullPath)) {
    logger.debug(`PRD file not found at ${prdFullPath}; skipping PRD compliance check.`);
    return [];
  }

  let prdContent: string;
  try {
    prdContent = fs.readFileSync(prdFullPath, 'utf-8').trim();
  } catch {
    return [];
  }

  if (!prdContent) {
    return [];
  }

  const fnById = new Map<string, FunctionSignatureEntry>();
  for (const fn of targetFunctions) {
    fnById.set(fn.id, fn);
  }

  // Batch up to 12 functions per LLM call to keep context focused and fast
  const batch = targetFunctions.slice(0, 12);

  try {
    const userPrompt = buildPrdComplianceUserPrompt(prdContent, batch);
    const response = await provider.generateJson(
      PRD_COMPLIANCE_SYSTEM_PROMPT,
      userPrompt,
      PrdViolationsResponseSchema
    );

    const issues: AuditIssue[] = [];
    for (const v of response.violations) {
      if (!v.has_violation) continue;
      const fn = fnById.get(v.function_id) ?? batch[0];
      issues.push({
        tier: 'ai',
        ruleId: 'prd-drift',
        severity: v.severity,
        file: fn.file,
        line: fn.line,
        column: 1,
        message: `Sai lệch ràng buộc nghiệp vụ PRD (${v.violated_rule || aiConfig.prd_path}): ${v.explanation}`,
        snippet: fn.signature,
        suggestion:
          v.recommendation ||
          `Điều chỉnh hàm '${fn.name}' để tuân thủ quy tắc '${v.violated_rule}' trong ${aiConfig.prd_path}.`,
        metadata: {
          functionId: fn.id,
          violatedRule: v.violated_rule,
          prdPath: aiConfig.prd_path,
        },
      });
    }
    return issues;
  } catch (err) {
    logger.warn(
      `Không thể đối chiếu PRD.md qua LLM (${
        err instanceof Error ? err.message : String(err)
      }). Tự động chuyển về chế độ AST-only.`
    );
    return [];
  }
}
