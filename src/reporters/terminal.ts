import chalk from 'chalk';
import { AuditIssue, AuditReport } from '../types.js';

function formatSeverityBadge(severity: AuditIssue['severity']): string {
  switch (severity) {
    case 'critical':
      return chalk.bgRed.white.bold(' CRITICAL ');
    case 'warning':
      return chalk.bgYellow.black.bold(' WARNING  ');
    default:
      return chalk.bgBlue.white.bold('   INFO   ');
  }
}

function formatTierTag(tier: AuditIssue['tier']): string {
  return tier === 'ast' ? chalk.cyan('[Tầng 1: AST]') : chalk.magenta('[Tầng 2: AI ]');
}

/**
 * Renders a rich colorized terminal report with execution timings, grouped violations,
 * and a copy-paste-ready Fix Prompt box.
 */
export function renderTerminalReport(report: AuditReport): void {
  const divider = chalk.gray('─'.repeat(76));

  console.log('');
  console.log(divider);
  console.log(
    `${chalk.bold.cyan('🩺 VIBE DOCTOR')} ${chalk.gray('— AI Codebase Governance & Architecture Guardrail')}`
  );
  console.log(divider);

  const modeLabel =
    report.mode === 'staged' ? chalk.yellow('Git Staged Files') : chalk.blue('Full Project Scan');
  const astColor = report.metrics.astDurationMs < 300 ? chalk.green.bold : chalk.yellow.bold;
  const configLabel = report.usedDefaultConfig
    ? chalk.gray('Built-in Defaults (chạy `vibe-doctor init` để tạo .archrules.yaml)')
    : chalk.white(report.configPath);

  console.log(`  ${chalk.gray('Chế độ quét:')}   ${modeLabel} (${report.metrics.filesScanned} files)`);
  console.log(`  ${chalk.gray('Cấu hình:')}      ${configLabel}`);
  console.log(
    `  ${chalk.gray('Hiệu năng:')}     AST ${astColor(`${report.metrics.astDurationMs.toFixed(1)}ms`)} | AI ${
      report.metrics.tier2Executed
        ? chalk.magenta(`${report.metrics.aiDurationMs.toFixed(0)}ms`)
        : chalk.gray(`Skipped (${report.metrics.tier2SkippedReason ?? 'disabled'})`)
    } | Tổng ${chalk.white(`${report.metrics.totalDurationMs.toFixed(1)}ms`)}`
  );
  console.log(divider);

  if (report.issues.length === 0) {
    console.log('');
    console.log(
      `  ${chalk.bgGreen.black.bold(' PASSED ')} ${chalk.green.bold(
        'Kiến trúc sạch sẽ! Không phát hiện vi phạm ranh giới tầng hoặc trôi dạt kiến trúc.'
      )}`
    );
    console.log('');
    return;
  }

  const criticalCount = report.issues.filter((i) => i.severity === 'critical').length;
  const warningCount = report.issues.filter((i) => i.severity === 'warning').length;

  console.log('');
  for (const issue of report.issues) {
    console.log(
      `  ${formatSeverityBadge(issue.severity)} ${formatTierTag(issue.tier)} ${chalk.bold.underline(
        `${issue.file}:${issue.line}`
      )} ${chalk.gray(`(${issue.ruleId})`)}`
    );
    console.log(`     ${chalk.white(issue.message)}`);
    if (issue.snippet) {
      console.log(`     ${chalk.gray('Code:')} ${chalk.red(issue.snippet)}`);
    }
    console.log(`     ${chalk.green('💡 Gợi ý:')} ${chalk.cyan(issue.suggestion)}`);
    console.log('');
  }

  console.log(divider);
  console.log(
    `  ${chalk.bold('Tổng kết:')} ${
      criticalCount > 0 ? chalk.red.bold(`${criticalCount} lỗi CRITICAL`) : chalk.green('0 lỗi CRITICAL')
    }, ${warningCount > 0 ? chalk.yellow.bold(`${warningCount} cảnh báo WARNING`) : chalk.gray('0 WARNING')}`
  );

  if (report.fixPrompt) {
    console.log('');
    console.log(chalk.bgMagenta.white.bold(' 🤖 AUTO FIX-PROMPT (Copy & dán vào Cursor / Claude / Antigravity) '));
    console.log(chalk.magenta('┌' + '─'.repeat(74) + '┐'));
    for (const line of report.fixPrompt.split('\n')) {
      console.log(`${chalk.magenta('│')} ${chalk.white(line)}`);
    }
    console.log(chalk.magenta('└' + '─'.repeat(74) + '┘'));
  }

  console.log('');
  if (!report.passed) {
    console.log(
      chalk.bgRed.white.bold(' ✖ COMMIT BLOCKED ') +
        ' ' +
        chalk.red('Vui lòng khắc phục các lỗi kiến trúc bên trên trước khi commit.')
    );
  } else {
    console.log(
      chalk.bgYellow.black.bold(' ⚠ PASSED WITH WARNINGS ') +
        ' ' +
        chalk.yellow('Không có lỗi CRITICAL chặn commit, nhưng nên xử lý các cảnh báo sớm.')
    );
  }
  console.log('');
}
