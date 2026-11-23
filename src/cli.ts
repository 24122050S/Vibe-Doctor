import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Command } from 'commander';
import ora from 'ora';
import { z } from 'zod';
import { checkProviderAvailability, createLlmProvider } from './ai/provider.js';
import { buildFunctionIndex, VIBE_CACHE_FILENAME } from './ast/indexer.js';
import {
  registerMcpCommand,
  registerSyncRulesCommand,
  registerWatchCommand,
} from './cliExtraCommands.js';
import { ConfigLoadError, loadArchRules } from './config/loader.js';
import { AVAILABLE_PRESETS } from './config/presets.js';
import type { runAudit as RunAuditFn } from './index.js';
import { generateHtmlReport } from './reporters/htmlReport.js';
import { renderTerminalReport } from './reporters/terminal.js';
import { loadProjectEnvFiles } from './utils/env.js';
import { initProject } from './utils/init.js';
import { logger } from './utils/logger.js';

function registerCheckAiCommand(program: Command): void {
  program
    .command('check-ai')
    .description('Kiểm tra cấu hình .env / API Key và test kết nối tới LLM Tầng 2 (Gemini / Ollama / OpenAI)')
    .argument('[dir]', 'Thư mục gốc dự án', '.')
    .option('-c, --config <path>', 'Đường dẫn tới file .archrules.yaml')
    .option('--ping', 'Gửi thử một truy vấn JSON nhỏ tới LLM để xác nhận kết nối thật', false)
    .action(async (dir: string, opts: { config?: string; ping?: boolean }) => {
      const projectRoot = path.resolve(dir);
      const envSummary = loadProjectEnvFiles(projectRoot);
      const { config } = loadArchRules(projectRoot, { configPath: opts.config });
      const { provider, model } = config.ai_eval;

      if (envSummary.loadedFiles.length > 0) {
        logger.success(`Đã tự động đọc file môi trường: ${envSummary.loadedFiles.join(', ')}`);
      } else {
        logger.info('Không tìm thấy file .env hoặc .env.local (đang dùng biến môi trường hệ thống).');
      }

      const availability = checkProviderAvailability(config.ai_eval);
      if (!availability.available) {
        logger.warn(`Tầng 2 (${provider} / ${model}) chưa sẵn sàng: ${availability.reason}`);
        logger.info('Sao chép `.env.example` thành `.env` (hoặc `.env.local`) và điền API Key để bật Tầng 2.');
        process.exitCode = 1;
        return;
      }

      logger.success(`Cấu hình xác thực hợp lệ cho provider '${provider}' (model: '${model}').`);

      if (opts.ping) {
        const spinner = ora(`Đang gửi ping kiểm tra kết nối tới ${provider} (${model})...`).start();
        try {
          const llm = createLlmProvider(config.ai_eval);
          const pingSchema = z.object({ status: z.string() });
          const res = await llm.generateJson(
            'Return JSON {"status":"ok"}',
            'Respond strictly with {"status":"ok"}',
            pingSchema
          );
          spinner.succeed(`Kết nối ${provider} (${model}) thành công! Phản hồi: ${JSON.stringify(res)}`);
        } catch (err) {
          spinner.fail(`Kết nối ${provider} thất bại: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      }
    });
}

function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Khởi tạo file .archrules.yaml theo preset và cài đặt Git pre-commit hook')
    .argument('[dir]', 'Thư mục gốc dự án', '.')
    .option(
      '-p, --preset <name>',
      `Preset kiến trúc (${AVAILABLE_PRESETS.join(' | ')})`,
      'nextjs'
    )
    .option('-f, --force', 'Ghi đè file .archrules.yaml nếu đã tồn tại', false)
    .option('--no-hook', 'Không cài đặt Git pre-commit hook')
    .action((dir: string, opts: { preset?: string; force?: boolean; hook?: boolean }) => {
      try {
        const res = initProject(dir, {
          preset: opts.preset,
          force: opts.force,
          installHook: opts.hook,
        });
        logger.success(
          res.createdArchRules
            ? `Đã khởi tạo cấu hình kiến trúc (preset: ${res.preset}): ${res.archRulesPath}`
            : `File ${res.archRulesPath} đã tồn tại (dùng --force để ghi đè).`
        );
        if (res.installedHook && res.hookPath) logger.success(`Đã cài đặt Git hook: ${res.hookPath}`);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

export function buildCliProgram(runAuditFn: typeof RunAuditFn): Command {
  const program = new Command()
    .name('vibe-doctor')
    .description('🩺 AI Codebase Governance & Architecture Guardrail CLI')
    .version('1.4.0');

  program
    .command('audit', { isDefault: true })
    .description('Quét kiến trúc Tầng 1 (AST) + Tầng 2 (LLM Alignment) và sinh Auto Fix-Prompt')
    .argument('[dir]', 'Thư mục gốc của dự án cần kiểm toán', '.')
    .option('-s, --staged', 'Chỉ quét các file trong git diff --staged', false)
    .option('--semantic', 'Bắt buộc chạy Tầng 2 (LLM) ngay cả khi AST có lỗi', false)
    .option('--no-ai', 'Chỉ chạy Tầng 1 (AST), bỏ qua mọi kết nối LLM')
    .option('-c, --config <path>', 'Đường dẫn tùy chỉnh tới file .archrules.yaml')
    .option('--strict', 'Chặn commit (exit 1) cả khi có cảnh báo WARNING', false)
    .option('--json', 'Xuất kết quả dạng JSON thuần ra stdout', false)
    .option('--html [output]', 'Đồng thời xuất báo cáo đồ thị HTML')
    .action(async (dir: string, opts: Record<string, unknown>) => {
      if (opts.json) logger.setLevel('silent');
      const spinner = !opts.json ? ora('Đang kiểm toán kiến trúc codebase...').start() : null;
      try {
        const report = await runAuditFn({
          projectRoot: dir,
          configPath: opts.config as string | undefined,
          staged: Boolean(opts.staged),
          semantic: Boolean(opts.semantic),
          ai: opts.ai as boolean | undefined,
          strict: Boolean(opts.strict),
        });
        spinner?.stop();
        if (opts.html) {
          const saved = generateHtmlReport(report, typeof opts.html === 'string' ? opts.html : undefined);
          if (!opts.json) logger.success(`Đã xuất báo cáo HTML tại: ${saved}`);
        }
        if (opts.json) console.log(JSON.stringify(report, null, 2));
        else renderTerminalReport(report);
        if (!report.passed) process.exitCode = 1;
      } catch (err) {
        spinner?.fail('Kiểm toán thất bại');
        logger.error(err instanceof ConfigLoadError ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  registerInitCommand(program);

  program
    .command('index')
    .description(`Lập chỉ mục chữ ký hàm vào ${VIBE_CACHE_FILENAME}`)
    .argument('[dir]', 'Thư mục gốc dự án', '.')
    .action((dir: string) => {
      const start = performance.now();
      const cache = buildFunctionIndex(dir, { persist: true });
      logger.success(
        `Đã lập chỉ mục ${cache.entries.length} hàm vào ${path.join(cache.projectRoot, VIBE_CACHE_FILENAME)} trong ${(
          performance.now() - start
        ).toFixed(1)}ms.`
      );
    });

  program
    .command('report')
    .description('Tạo báo cáo trực quan vibe-report.html kèm biểu đồ Dependency Graph')
    .argument('[dir]', 'Thư mục gốc dự án', '.')
    .option('-o, --output <path>', 'Đường dẫn xuất file HTML')
    .option('-c, --config <path>', 'Đường dẫn tới file .archrules.yaml')
    .option('--semantic', 'Chạy thêm kiểm toán ngữ nghĩa Tầng 2 (LLM)', false)
    .option('--no-ai', 'Chỉ quét AST Tầng 1')
    .action(async (dir: string, opts: Record<string, unknown>) => {
      const spinner = ora('Đang phân tích phụ thuộc và dựng đồ thị HTML...').start();
      try {
        const report = await runAuditFn({
          projectRoot: dir,
          configPath: opts.config as string | undefined,
          semantic: Boolean(opts.semantic),
          ai: opts.ai as boolean | undefined,
        });
        spinner.succeed(`Đã tạo báo cáo kiến trúc tại: ${generateHtmlReport(report, opts.output as string | undefined)}`);
      } catch (err) {
        spinner.fail('Không thể tạo báo cáo HTML');
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  registerCheckAiCommand(program);
  registerSyncRulesCommand(program);
  registerWatchCommand(program, runAuditFn);
  registerMcpCommand(program, runAuditFn);

  return program;
}
