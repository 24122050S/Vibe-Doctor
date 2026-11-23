import { Node, SourceFile, SyntaxKind } from 'ts-morph';
import { ArchRulesConfig } from '../../config/schema.js';
import { AuditIssue } from '../../types.js';

function resolveFunctionDisplayName(node: Node): string {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    return node.getName() ?? '<anonymous>';
  }

  const parent = node.getParent();
  if (parent && Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }
  if (parent && Node.isPropertyAssignment(parent)) {
    return parent.getName();
  }
  return '<anonymous>';
}

/**
 * Checks file LOC (`max_file_lines`) and individual function LOC (`max_function_lines`).
 */
export function checkFileAndFunctionSizes(
  sourceFiles: Map<string, SourceFile>,
  config: ArchRulesConfig
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const { max_file_lines, max_function_lines } = config.thresholds;

  for (const [relPosixPath, sourceFile] of sourceFiles.entries()) {
    const totalLines = sourceFile.getEndLineNumber();
    if (totalLines > max_file_lines) {
      issues.push({
        tier: 'ast',
        ruleId: 'file-size',
        severity: 'warning',
        file: relPosixPath,
        line: 1,
        column: 1,
        message: `File vượt ngưỡng độ dài cho phép: ${totalLines} dòng (tối đa ${max_file_lines} dòng).`,
        suggestion: `Tách '${relPosixPath}' thành các module/sub-component hoặc custom hook nhỏ hơn (< ${max_file_lines} dòng) theo nguyên lý Single Responsibility.`,
        metadata: {
          actualLines: totalLines,
          maxAllowedLines: max_file_lines,
        },
      });
    }

    // Mathematical fast-path: a file with <= max_function_lines cannot contain a function > max_function_lines
    if (totalLines <= max_function_lines) {
      continue;
    }

    const functionNodes = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ];

    for (const fnNode of functionNodes) {
      const startLine = fnNode.getStartLineNumber();
      const endLine = fnNode.getEndLineNumber();
      const lineCount = endLine - startLine + 1;

      if (lineCount > max_function_lines) {
        const fnName = resolveFunctionDisplayName(fnNode);
        issues.push({
          tier: 'ast',
          ruleId: 'function-size',
          severity: 'warning',
          file: relPosixPath,
          line: startLine,
          column: 1,
          message: `Hàm '${fnName}' quá dài: ${lineCount} dòng (tối đa ${max_function_lines} dòng).`,
          snippet: fnNode.getText().split(/\r?\n/)[0].trim().slice(0, 100),
          suggestion: `Chia nhỏ hàm '${fnName}' tại '${relPosixPath}:${startLine}' thành các helper function nhỏ, rõ nghĩa (< ${max_function_lines} dòng).`,
          metadata: {
            functionName: fnName,
            actualLines: lineCount,
            maxAllowedLines: max_function_lines,
          },
        });
      }
    }
  }

  return issues;
}
