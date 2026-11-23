import { Node, SourceFile, SyntaxKind } from 'ts-morph';
import { AuditIssue } from '../../types.js';

interface SecretPatternRule {
  label: string;
  regex: RegExp;
}

const KNOWN_SECRET_PATTERNS: readonly SecretPatternRule[] = [
  { label: 'Google / Gemini API Key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'OpenAI / Anthropic API Key', regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'GitHub Personal Access Token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { label: 'GitHub Fine-Grained Token', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { label: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Slack API Token', regex: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/ },
  { label: 'Stripe Live Secret Key', regex: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  { label: 'Private Key PEM Block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    label: 'Database Connection URI with Credentials',
    regex: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/<>{}]+:[^@\s/<>{}]{4,}@[^/\s]+/i,
  },
];

const SENSITIVE_IDENTIFIER_REGEX =
  /^(?:api[_-]?key|secret[_-]?key|jwt[_-]?secret|private[_-]?key|client[_-]?secret|db[_-]?password|auth[_-]?secret)$/i;

const SAFE_PLACEHOLDER_REGEX =
  /(?:your[_-]|example|placeholder|dummy|mock|sample|test|changeme|todo|xxxx|<[^>]+>|\*{3,})/i;

/**
 * Redacts the middle portion of a secret string so logs and HTML reports never leak sensitive credentials.
 */
export function maskSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 10) {
    return '***REDACTED***';
  }
  return `${trimmed.slice(0, 6)}****...****${trimmed.slice(-3)}`;
}

function detectSecretKind(literalValue: string, parentNode: Node | undefined): string | null {
  if (!literalValue || literalValue.length < 12) {
    return null;
  }

  for (const rule of KNOWN_SECRET_PATTERNS) {
    if (rule.regex.test(literalValue)) {
      return rule.label;
    }
  }

  if (parentNode && (Node.isVariableDeclaration(parentNode) || Node.isPropertyAssignment(parentNode))) {
    const varName = parentNode.getName();
    if (
      SENSITIVE_IDENTIFIER_REGEX.test(varName) &&
      literalValue.length >= 16 &&
      !/\s/.test(literalValue) &&
      !SAFE_PLACEHOLDER_REGEX.test(literalValue)
    ) {
      return `Hardcoded '${varName}' credential`;
    }
  }

  return null;
}

const FAST_PREFILTER_REGEX =
  /(?:AIza|sk-|rk_live_|gh[pousr]_|github_pat_|AKIA|xox[baprs]-|PRIVATE KEY|:\/\/|secret|api[_-]?key|password)/i;

/**
 * Scans AST string & template literals for hardcoded API keys, tokens, private keys, and DB credentials.
 * Ignores `process.env.*` references and obvious test/example placeholders.
 */
export function checkHardcodedSecrets(sourceFiles: Map<string, SourceFile>): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const [relPosixPath, sourceFile] of sourceFiles.entries()) {
    // Fast lexical pre-screen skips expensive AST node wrapping on clean files
    if (!FAST_PREFILTER_REGEX.test(sourceFile.getFullText())) {
      continue;
    }

    const stringNodes = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ];

    const reportedLines = new Set<number>();

    for (const strNode of stringNodes) {
      const value = strNode.getLiteralText();
      const parent = strNode.getParent();

      // Skip import/export module specifiers
      if (
        parent &&
        (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent))
      ) {
        continue;
      }

      const secretLabel = detectSecretKind(value, parent);
      if (!secretLabel) continue;

      const pos = sourceFile.getLineAndColumnAtPos(strNode.getStart());
      if (reportedLines.has(pos.line)) continue;
      reportedLines.add(pos.line);

      const masked = maskSecretValue(value);
      issues.push({
        tier: 'ast',
        ruleId: 'hardcoded-secret',
        severity: 'critical',
        file: relPosixPath,
        line: pos.line,
        column: pos.column,
        message: `Phát hiện khóa bí mật lộ thiên trong code (${secretLabel}): ${masked}`,
        snippet: masked,
        suggestion: `Xóa ngay giá trị khóa bí mật khỏi '${relPosixPath}:${pos.line}', chuyển vào file '.env' / '.env.local' và đọc qua 'process.env.<TEN_BIEN>'.`,
        metadata: {
          secretType: secretLabel,
          maskedPreview: masked,
        },
      });
    }
  }

  return issues;
}
