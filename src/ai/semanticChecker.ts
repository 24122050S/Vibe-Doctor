import { z } from 'zod';
import { findTopCandidateFunctions } from '../ast/indexer.js';
import { AiEvalConfig } from '../config/schema.js';
import { AuditIssue, FunctionSignatureEntry, SemanticDuplicateResult } from '../types.js';
import { logger } from '../utils/logger.js';
import {
  buildSemanticDuplicateUserPrompt,
  SEMANTIC_DUPLICATE_SYSTEM_PROMPT,
} from './prompts.js';
import { LlmProvider } from './provider.js';

export const SemanticDuplicateSchema = z.object({
  is_duplicate: z.boolean(),
  similarity_score: z.number().min(0).max(1),
  existing_function: z.string().default(''),
  recommendation: z.string().default(''),
});

/**
 * Evaluates newly added or modified functions against the codebase's existing function index
 * using Top-5 candidate pre-filtering + LLM Semantic Judge.
 * Never throws on network/API errors — gracefully falls back to partial/empty results.
 */
export async function checkSemanticDuplication(
  targetFunctions: FunctionSignatureEntry[],
  indexEntries: FunctionSignatureEntry[],
  provider: LlmProvider,
  aiConfig: AiEvalConfig
): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  const threshold = aiConfig.similarity_threshold;

  for (const targetFn of targetFunctions) {
    const candidates = findTopCandidateFunctions(targetFn, indexEntries, 5);
    if (candidates.length === 0) {
      continue;
    }

    try {
      const userPrompt = buildSemanticDuplicateUserPrompt(targetFn, candidates);
      const result: SemanticDuplicateResult = await provider.generateJson(
        SEMANTIC_DUPLICATE_SYSTEM_PROMPT,
        userPrompt,
        SemanticDuplicateSchema
      );

      if (result.is_duplicate && result.similarity_score >= threshold && result.existing_function) {
        const pct = Math.round(result.similarity_score * 100);
        issues.push({
          tier: 'ai',
          ruleId: 'semantic-duplicate',
          severity: 'warning',
          file: targetFn.file,
          line: targetFn.line,
          column: 1,
          message: `Phát hiện hàm trùng lặp ngữ nghĩa '${targetFn.name}' (độ tương đồng ${pct}% với '${result.existing_function}').`,
          snippet: targetFn.signature,
          suggestion:
            result.recommendation ||
            `Xóa hàm '${targetFn.name}' và tái sử dụng '${result.existing_function}'.`,
          metadata: {
            functionName: targetFn.name,
            existingFunction: result.existing_function,
            similarityScore: result.similarity_score,
          },
        });
      }
    } catch (err) {
      logger.warn(
        `Không thể kiểm tra trùng lặp ngữ nghĩa cho '${targetFn.id}' (${
          err instanceof Error ? err.message : String(err)
        }). Bỏ qua và tiếp tục với kết quả AST.`
      );
      break; // Avoid cascading timeouts across remaining functions if network/API is down
    }
  }

  return issues;
}
