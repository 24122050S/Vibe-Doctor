import path from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { buildFunctionIndex } from './ast/indexer.js';
import { loadArchRules } from './config/loader.js';
import type { runAudit as RunAuditFn } from './index.js';
import { startMcpStdioServer } from './mcp/server.js';
import { generateHtmlReport } from './reporters/htmlReport.js';
import {
  AgentRuleTarget,
  DEFAULT_RULE_TARGETS,
  syncAgentRules,
} from './reporters/ruleSync.js';
import { renderTerminalReport } from './reporters/terminal.js';
import { logger } from './utils/logger.js';
import { startProjectWatcher } from './utils/watcher.js';

export function registerSyncRulesCommand(program: Command): void {
  program
    .command('sync-rules')
    .description(
      'Tự động sinh rule kiến trúc chủ động (.cursor/rules, AGENTS.md, CLAUDE.md) từ .archrules.yaml'
    )
    .argument('[dir]', 'Thư mục gốc dự án', '.')
    .option('-c, --config <path>', 'Đường dẫn tùy chỉnh tới file .archrules.yaml')
    .option(
      '-t, --targets <targets>',
      'Danh sách đích phân tách bằng dấu phẩy (cursor,agents,claude,windsurf)',
      DEFAULT_RULE_TARGETS.join(',')
    )
    .option('--no-index', 'Không đính kèm danh sách hàm hiện có vào file rule')
    .action((dir: string, opts: { config?: string; targets?: string; index?: boolean }) => {
      try {
        const projectRoot = path.resolve(dir);
        const { config } = loadArchRules(projectRoot, { configPath: opts.config });
        const validSet = new Set<AgentRuleTarget>(['cursor', 'agents', 'claude', 'windsurf']);
        const parsedTargets = (opts.targets ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase() as AgentRuleTarget)
          .filter((t) => validSet.has(t));

        const targets = parsedTargets.length > 0 ? parsedTargets : DEFAULT_RULE_TARGETS;
        const exportedFunctions =
          opts.index !== false
            ? buildFunctionIndex(projectRoot, { persist: true }).entries
            : [];

        const res = syncAgentRules(projectRoot, config, { targets, exportedFunctions });
        for (const item of res.files) {
          const verb = item.action === 'created' ? 'Đã tạo mới' : 'Đã cập nhật';
          logger.success(`[${item.target}] ${verb}: ${item.filePath}`);
        }
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

export function registerMcpCommand(program: Command, runAuditFn: typeof RunAuditFn): void {
  program
    .command('mcp')
    .description(
      'Khởi chạy MCP Server (stdio JSON-RPC 2.0) tích hợp trực tiếp vào Antigravity / Cursor / Claude'
    )
    .argument('[dir]', 'Thư mục gốc dự án mặc định', '.')
    .action(async (dir: string) => {
      await startMcpStdioServer({
        defaultProjectRoot: path.resolve(dir),
        serverVersion: '1.4.0',
        runAuditFn,
      });
    });
}

export function registerWatchCommand(program: Command, runAuditFn: typeof RunAuditFn): void {
  program
    .command('watch')
    .description('Giám sát thư mục dự án theo thời gian thực — tự động quét AST mỗi khi lưu file')
    .argument('[dir]', 'Thư mục gốc dự án', '.')
    .option('-c, --config <path>', 'Đường dẫn tới file .archrules.yaml')
    .option('--semantic', 'Chạy thêm kiểm toán ngữ nghĩa Tầng 2 (LLM)', false)
    .option('--strict', 'Cảnh báo nghiêm ngặt cả mức WARNING', false)
    .option('--html [output]', 'Tự động cập nhật file vibe-report.html sau mỗi lần lưu file')
    .action(async (dir: string, opts: Record<string, unknown>) => {
      const projectRoot = path.resolve(dir);

      const executePass = async (changedFiles?: string[]) => {
        console.clear();
        console.log(
          chalk.bgCyan.black.bold(' 👀 VIBE DOCTOR LIVE WATCH ') +
            ' ' +
            chalk.cyan(`Đang giám sát: ${projectRoot}`) +
            chalk.gray(' (Nhấn Ctrl+C để dừng)')
        );
        if (changedFiles && changedFiles.length > 0) {
          console.log(chalk.gray(`  ↻ Thay đổi vừa lưu: ${changedFiles.slice(0, 4).join(', ')}`));
        }
        try {
          const report = await runAuditFn({
            projectRoot,
            configPath: opts.config as string | undefined,
            semantic: Boolean(opts.semantic),
            ai: Boolean(opts.semantic),
            strict: Boolean(opts.strict),
          });
          renderTerminalReport(report);
          if (opts.html) {
            const outPath = typeof opts.html === 'string' ? opts.html : undefined;
            const saved = generateHtmlReport(report, outPath);
            logger.info(`Đã cập nhật live HTML report: ${saved}`);
          }
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
        }
      };

      await executePass();
      const handle = startProjectWatcher(projectRoot, {
        debounceMs: 250,
        onChange: executePass,
      });

      await new Promise<void>((resolve) => {
        process.once('SIGINT', () => {
          handle.close();
          resolve();
        });
        process.once('SIGTERM', () => {
          handle.close();
          resolve();
        });
      });
    });
}
