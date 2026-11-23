import path from 'node:path';
import { AuditIssue, FunctionSignatureEntry } from '../types.js';

export const SEMANTIC_DUPLICATE_SYSTEM_PROMPT = `You are a Principal Software Architect auditing a TypeScript/JavaScript codebase for semantic function duplication ("Vibe Coding Drift").
Given a NEW/MODIFIED function and up to 5 EXISTING functions from the project index, determine whether the new function duplicates the core intent/behavior of an existing utility or service function.

Strict Evaluation Criteria:
1. Mark "is_duplicate": true ONLY if an existing function already fulfills the same core purpose (similarity_score >= 0.80) and can be reused directly or with trivial parameter adaptation.
2. Ignore superficial naming differences (e.g., formatPrice vs formatVND, calcTax vs computeOrderTax) if the underlying domain behavior is the same.
3. If none of the candidates are semantically equivalent, set "is_duplicate": false, "similarity_score": 0, "existing_function": "", and "recommendation": "".
4. Respond strictly with valid JSON matching the requested schema. Write "recommendation" concisely in Vietnamese.`;

export function buildSemanticDuplicateUserPrompt(
  targetFn: FunctionSignatureEntry,
  candidates: FunctionSignatureEntry[]
): string {
  const candidateText = candidates
    .map(
      (c, idx) =>
        `Candidate #${idx + 1}:
- ID: ${c.id}
- Signature: ${c.signature}
- JSDoc: ${c.jsdoc ?? 'N/A'}
- Body Summary: ${c.summary}`
    )
    .join('\n\n');

  return `### NEW / MODIFIED FUNCTION
- ID: ${targetFn.id}
- File: ${targetFn.file} (line ${targetFn.line})
- Signature: ${targetFn.signature}
- JSDoc: ${targetFn.jsdoc ?? 'N/A'}
- Body Summary: ${targetFn.summary}

### EXISTING CANDIDATE FUNCTIONS IN CODEBASE
${candidateText}

Return JSON with exact keys:
{
  "is_duplicate": boolean,
  "similarity_score": number, // 0.0 to 1.0
  "existing_function": string, // exact ID e.g. "src/utils/currency.ts::formatVND" or ""
  "recommendation": string // concise Vietnamese instruction to refactor & reuse
}`;
}

export const PRD_COMPLIANCE_SYSTEM_PROMPT = `You are a Principal Product & Architecture Auditor checking whether newly written TypeScript/JavaScript functions violate explicit business rules and constraints defined in PRD.md.

Strict Evaluation Criteria:
1. Flag "has_violation": true ONLY when the code clearly contradicts, omits, or bypasses an explicit business constraint, validation rule, security policy, or domain invariant in PRD.md.
2. Do NOT hallucinate requirements that are not written in PRD.md. If a function is unrelated to PRD rules or complies with them, return "has_violation": false.
3. Respond strictly with valid JSON matching the requested schema. Write "explanation" and "recommendation" concisely in Vietnamese.`;

export function buildPrdComplianceUserPrompt(
  prdContent: string,
  changedFunctions: FunctionSignatureEntry[]
): string {
  const fnBlock = changedFunctions
    .map(
      (fn) =>
        `- ID: ${fn.id} (${fn.file}:${fn.line})
  Signature: ${fn.signature}
  Body Summary: ${fn.summary}`
    )
    .join('\n\n');

  return `### PRODUCT REQUIREMENTS DOCUMENT (PRD.md)
${prdContent.slice(0, 12000)}

### CHANGED / NEW FUNCTIONS TO AUDIT
${fnBlock}

Return JSON with exact keys:
{
  "violations": [
    {
      "function_id": string, // exact ID from list above
      "has_violation": boolean,
      "violated_rule": string, // short quote or section title from PRD.md
      "severity": "critical" | "warning",
      "explanation": string,
      "recommendation": string
    }
  ]
}`;
}

/**
 * Remediation Engine: Synthesizes all AST & AI issues into a ready-to-paste Fix Prompt
 * for AI Coding Agents (Cursor, Claude Code, Windsurf, Antigravity).
 */
export function generateFixPrompt(issues: AuditIssue[]): string {
  if (issues.length === 0) {
    return '';
  }

  const byFile = new Map<string, AuditIssue[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  // Sort issues inside each file by line number
  for (const list of byFile.values()) {
    list.sort((a, b) => a.line - b.line);
  }

  const summaryParts: string[] = [];
  const detailedBlocks: string[] = [];

  for (const [file, fileIssues] of byFile.entries()) {
    const shortName = path.posix.basename(file);
    const inlineDescriptions = fileIssues.map((iss) => {
      const snippetPart = iss.snippet ? ` (\`${iss.snippet}\`)` : '';
      return `[${iss.ruleId}] tại dòng ${iss.line}${snippetPart}`;
    });
    summaryParts.push(`Trong file \`${shortName}\` (\`${file}\`), phát hiện ${inlineDescriptions.join(' và ')}.`);

    const lines = fileIssues.map((iss, idx) => {
      const badge = iss.severity === 'critical' ? 'CRITICAL' : 'WARNING';
      const snippetLine = iss.snippet ? `\n     Code hiện tại: \`${iss.snippet}\`` : '';
      return `  ${idx + 1}. [${badge} | ${iss.ruleId} | Dòng ${iss.line}] ${iss.message}${snippetLine}\n     -> Cách sửa: ${iss.suggestion}`;
    });

    detailedBlocks.push(`File: \`${file}\`\n${lines.join('\n')}`);
  }

  return [
    `Gửi AI Agent: ${summaryParts.join(' ')}`,
    '',
    'Hãy thực hiện refactor các mục sau để tuân thủ kiến trúc dự án (.archrules.yaml):',
    detailedBlocks.join('\n\n'),
    '',
    'Ràng buộc bắt buộc: Không vi phạm ranh giới phân tầng (cannot_import), tái sử dụng các helper/service sẵn có thay vì viết hàm trùng lặp, không tự ý cài thêm thư viện ngoài danh sách trắng, và giữ nguyên logic nghiệp vụ hợp lệ. Sau khi sửa xong, hãy chạy `npx vibe-doctor audit` để kiểm tra lại.',
  ].join('\n');
}
