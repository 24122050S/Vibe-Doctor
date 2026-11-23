import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmProvider } from '../src/ai/provider.js';
import {
  buildFunctionIndex,
  findTopCandidateFunctions,
} from '../src/ast/indexer.js';
import {
  AVAILABLE_PRESETS,
  handleMcpJsonRpcMessage,
  initProject,
  loadArchRules,
  loadProjectEnvFiles,
  parseDotEnvContent,
  runAudit,
  syncAgentRules,
} from '../src/index.js';
import { generateHtmlReport } from '../src/reporters/htmlReport.js';

const tempDirs: string[] = [];

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-doctor-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeProjectFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

const SAMPLE_ARCHRULES = `version: "1.0"
project_type: "nextjs-clean-arch"

layers:
  ui:
    path: "src/components/**"
    cannot_import: ["src/db/**", "src/services/backend/**"]
  services:
    path: "src/services/**"
    cannot_import: ["src/components/**"]
  db:
    path: "src/db/**"
    cannot_import: ["src/components/**", "src/services/**"]

thresholds:
  max_file_lines: 300
  max_function_lines: 50

dependencies:
  allowed_ui: ["lucide-react", "framer-motion", "@radix-ui/*"]
  allowed_validation: ["zod"]
  strict_mode: true

ai_eval:
  provider: "gemini"
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
`;

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup lock on Windows
    }
  }
});

describe('vibe-doctor — Tier 1 AST Engine & Performance', () => {
  it('scans a multi-layer Next.js repository in < 300ms and catches 100% of forbidden layer imports', async () => {
    const root = createTempProject();
    writeProjectFile(root, '.archrules.yaml', SAMPLE_ARCHRULES);
    writeProjectFile(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
      })
    );
    writeProjectFile(
      root,
      'package.json',
      JSON.stringify({
        name: 'demo-nextjs',
        dependencies: {
          react: '^19.0.0',
          next: '^15.0.0',
          'lucide-react': '^0.460.0',
          zod: '^3.24.0',
        },
      })
    );

    // Seed 14 clean files + 2 violating files to benchmark realistic scan speed
    writeProjectFile(
      root,
      'src/db/index.ts',
      `export const prisma = { order: { create: async (d: unknown) => d } };\n`
    );
    writeProjectFile(
      root,
      'src/services/backend/secretVault.ts',
      `export function getInternalSecret(): string { return 'secret'; }\n`
    );
    writeProjectFile(
      root,
      'src/services/orderService.ts',
      `import { prisma } from '@/db';\nexport async function createOrder(amount: number) { return prisma.order.create({ amount }); }\n`
    );

    for (let i = 1; i <= 12; i++) {
      writeProjectFile(
        root,
        `src/components/CleanWidget${i}.tsx`,
        `import { createOrder } from '@/services/orderService';\nimport { Check } from 'lucide-react';\nexport function CleanWidget${i}() { return { createOrder, Check }; }\n`
      );
    }

    // Violating UI file #1: imports '@/db' AND 'src/services/backend/secretVault'
    writeProjectFile(
      root,
      'src/components/Checkout.tsx',
      [
        `import React from 'react';`,
        `import { Dialog } from '@radix-ui/react-dialog';`,
        `import { prisma } from '@/db';`,
        `import { getInternalSecret } from '../services/backend/secretVault';`,
        ``,
        `export async function Checkout() {`,
        `  const secret = getInternalSecret();`,
        `  return prisma.order.create({ secret, Dialog });`,
        `}`,
      ].join('\n')
    );

    // Violating DB file #2: imports UI component
    writeProjectFile(
      root,
      'src/db/badSeed.ts',
      `import { CleanWidget1 } from '@/components/CleanWidget1';\nexport const ref = CleanWidget1;\n`
    );

    const report = await runAudit({ projectRoot: root, ai: false });

    expect(report.metrics.filesScanned).toBe(17);
    // Performance requirement: Tier 1 AST scanning < 300ms
    expect(report.metrics.astDurationMs).toBeLessThan(300);

    const boundaryIssues = report.issues.filter((i) => i.ruleId === 'layer-boundary');
    expect(boundaryIssues).toHaveLength(3);
    expect(report.passed).toBe(false);

    // Verify exact file and line detection for Checkout.tsx
    const checkoutDbIssue = boundaryIssues.find(
      (i) => i.file === 'src/components/Checkout.tsx' && i.line === 3
    );
    expect(checkoutDbIssue).toBeDefined();
    expect(checkoutDbIssue?.severity).toBe('critical');
    expect(checkoutDbIssue?.snippet).toContain(`import { prisma } from '@/db'`);

    // Verify Auto Fix-Prompt contains actionable instructions
    expect(report.fixPrompt).toContain('Gửi AI Agent:');
    expect(report.fixPrompt).toContain('Checkout.tsx');
    expect(report.fixPrompt).toContain(`import { prisma } from '@/db'`);
  });

  it('catches unapproved packages under strict_mode and file/function size violations', async () => {
    const root = createTempProject();
    writeProjectFile(
      root,
      '.archrules.yaml',
      SAMPLE_ARCHRULES.replace('max_file_lines: 300', 'max_file_lines: 20').replace(
        'max_function_lines: 50',
        'max_function_lines: 10'
      )
    );

    const bloatedBody = Array.from({ length: 14 }, (_, idx) => `  const step${idx} = ${idx};`).join(
      '\n'
    );
    const fileLines = [
      `import axios from 'axios';`,
      `import { Check } from 'lucide-react';`,
      `export function bloatedHandler() {`,
      bloatedBody,
      `  return { axios, Check, step0 };`,
      `}`,
      `// extra padding line 1`,
      `// extra padding line 2`,
      `// extra padding line 3`,
      `// extra padding line 4`,
    ].join('\n');

    writeProjectFile(root, 'src/services/heavyService.ts', fileLines);

    const report = await runAudit({ projectRoot: root, ai: false });

    const depIssue = report.issues.find((i) => i.ruleId === 'unapproved-dependency');
    const fileSizeIssue = report.issues.find((i) => i.ruleId === 'file-size');
    const fnSizeIssue = report.issues.find((i) => i.ruleId === 'function-size');

    expect(depIssue).toBeDefined();
    expect(depIssue?.message).toContain('axios');
    expect(fileSizeIssue).toBeDefined();
    expect(fnSizeIssue).toBeDefined();
    expect(fnSizeIssue?.message).toContain('bloatedHandler');
  });
});

describe('vibe-doctor — Tier 2 Function Indexer, Semantic AI Judge & Resilience', () => {
  it('indexes codebase functions, detects semantic duplicates & PRD drift via LLM, and gates Tier 2 properly', async () => {
    const root = createTempProject();
    writeProjectFile(root, '.archrules.yaml', SAMPLE_ARCHRULES);
    writeProjectFile(
      root,
      'PRD.md',
      `# Checkout Rules\n- Đơn hàng miễn phí vận chuyển chỉ áp dụng cho giá trị >= 500,000 VND.\n`
    );

    writeProjectFile(
      root,
      'src/utils/currency.ts',
      `/** Định dạng tiền tệ VNĐ chuẩn */\nexport function formatVND(amount: number): string {\n  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);\n}\n`
    );

    writeProjectFile(
      root,
      'src/services/pricingService.ts',
      `export function formatPrice(priceVnd: number): string {\n  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(priceVnd);\n}\n\nexport function isFreeShipping(orderTotal: number): boolean {\n  return orderTotal >= 100000;\n}\n`
    );

    const cache = buildFunctionIndex(root, { persist: true });
    expect(cache.entries.length).toBe(3);

    const formatPriceEntry = cache.entries.find((e) => e.name === 'formatPrice')!;
    const candidates = findTopCandidateFunctions(formatPriceEntry, cache.entries, 5);
    expect(candidates[0]?.id).toBe('src/utils/currency.ts::formatVND');

    const mockProvider: LlmProvider = {
      name: 'mock-gemini',
      async generateJson<T>(
        _sys: string,
        userPrompt: string,
        schema: z.ZodType<T, z.ZodTypeDef, unknown>
      ): Promise<T> {
        if (userPrompt.includes('EXISTING CANDIDATE FUNCTIONS')) {
          if (userPrompt.includes('formatPrice')) {
            return schema.parse({
              is_duplicate: true,
              similarity_score: 0.94,
              existing_function: 'src/utils/currency.ts::formatVND',
              recommendation: 'Xóa hàm formatPrice và tái sử dụng formatVND từ src/utils/currency.ts.',
            });
          }
          return schema.parse({
            is_duplicate: false,
            similarity_score: 0.1,
            existing_function: '',
            recommendation: '',
          });
        }

        // PRD compliance check
        return schema.parse({
          violations: [
            {
              function_id: 'src/services/pricingService.ts::isFreeShipping',
              has_violation: true,
              violated_rule: 'Miễn phí vận chuyển chỉ áp dụng cho giá trị >= 500,000 VND',
              severity: 'critical',
              explanation: 'Hàm isFreeShipping đang kiểm tra >= 100000 thay vì >= 500000 theo PRD.md.',
              recommendation: 'Sửa điều kiện thành orderTotal >= 500_000.',
            },
          ],
        });
      },
    };

    const report = await runAudit({
      projectRoot: root,
      customProvider: mockProvider,
    });

    expect(report.metrics.tier2Executed).toBe(true);
    const dupIssue = report.issues.find((i) => i.ruleId === 'semantic-duplicate');
    const prdIssue = report.issues.find((i) => i.ruleId === 'prd-drift');

    expect(dupIssue).toBeDefined();
    expect(dupIssue?.suggestion).toContain('formatVND');
    expect(prdIssue).toBeDefined();
    expect(prdIssue?.severity).toBe('critical');
    expect(report.passed).toBe(false);
  });

  it('gracefully falls back to AST-only reporting without crashing when LLM API fails', async () => {
    const root = createTempProject();
    writeProjectFile(root, '.archrules.yaml', SAMPLE_ARCHRULES);
    writeProjectFile(
      root,
      'src/utils/math.ts',
      `export function sumValues(a: number, b: number): number { return a + b; }\n`
    );
    writeProjectFile(
      root,
      'src/services/calc.ts',
      `export function addValues(x: number, y: number): number { return x + y; }\n`
    );

    const brokenProvider: LlmProvider = {
      name: 'failing-provider',
      async generateJson(): Promise<never> {
        throw new Error('503 Service Unavailable — Network offline');
      },
    };

    const report = await runAudit({
      projectRoot: root,
      customProvider: brokenProvider,
    });

    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
  });
});

describe('vibe-doctor — Init, Git Staged Mode & HTML Dependency Graph Report', () => {
  it('initializes .archrules.yaml + git hook, audits git staged files, and generates vibe-report.html', async () => {
    const root = createTempProject();
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Dev'], { cwd: root, stdio: 'ignore' });

    const initRes = initProject(root);
    expect(initRes.createdArchRules).toBe(true);
    expect(initRes.installedHook).toBe(true);
    expect(fs.existsSync(path.join(root, '.archrules.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.git', 'hooks', 'pre-commit'))).toBe(true);

    // Create an unstaged violating file and a staged violating file
    writeProjectFile(root, 'src/db/client.ts', `export const db = {};\n`);
    writeProjectFile(
      root,
      'src/components/StagedBadCard.tsx',
      `import { db } from '@/db/client';\nexport const StagedBadCard = () => db;\n`
    );
    writeProjectFile(
      root,
      'src/components/UnstagedBadCard.tsx',
      `import { db } from '@/db/client';\nexport const UnstagedBadCard = () => db;\n`
    );

    // Stage ONLY StagedBadCard.tsx
    execFileSync('git', ['add', 'src/components/StagedBadCard.tsx'], {
      cwd: root,
      stdio: 'ignore',
    });

    const stagedReport = await runAudit({
      projectRoot: root,
      staged: true,
      ai: false,
    });

    expect(stagedReport.mode).toBe('staged');
    expect(stagedReport.metrics.filesScanned).toBe(1);
    expect(stagedReport.issues).toHaveLength(1);
    expect(stagedReport.issues[0].file).toBe('src/components/StagedBadCard.tsx');

    const htmlPath = generateHtmlReport(stagedReport);
    expect(fs.existsSync(htmlPath)).toBe(true);
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    expect(htmlContent).toContain('<svg');
    expect(htmlContent).toContain('StagedBadCard.tsx');
    expect(htmlContent).toContain('violated-edge');
  });

  it('parses and loads .env.local and .env with proper precedence without overwriting existing env vars', () => {
    const parsed = parseDotEnvContent(
      [
        '# Sample comment',
        'GEMINI_API_KEY="key_from_dotenv"',
        "export OLLAMA_HOST='http://127.0.0.1:11434'",
        'INLINE_KEY=hello_world # trailing comment',
      ].join('\n')
    );

    expect(parsed.GEMINI_API_KEY).toBe('key_from_dotenv');
    expect(parsed.OLLAMA_HOST).toBe('http://127.0.0.1:11434');
    expect(parsed.INLINE_KEY).toBe('hello_world');

    const root = createTempProject();
    writeProjectFile(root, '.env.local', 'GEMINI_API_KEY=local_priority_key\nLOCAL_ONLY=1\n');
    writeProjectFile(root, '.env', 'GEMINI_API_KEY=base_env_key\nBASE_ONLY=2\nSHELL_SET=from_file\n');

    const mockEnv: NodeJS.ProcessEnv = { SHELL_SET: 'already_in_shell' };
    const summary = loadProjectEnvFiles(root, root, mockEnv);

    expect(summary.loadedFiles).toHaveLength(2);
    expect(mockEnv.GEMINI_API_KEY).toBe('local_priority_key');
    expect(mockEnv.LOCAL_ONLY).toBe('1');
    expect(mockEnv.BASE_ONLY).toBe('2');
    expect(mockEnv.SHELL_SET).toBe('already_in_shell');
  });

  it('syncs .archrules.yaml and exported functions into .cursor/rules, AGENTS.md, and CLAUDE.md non-destructively', () => {
    const root = createTempProject();
    writeProjectFile(root, '.archrules.yaml', SAMPLE_ARCHRULES);
    writeProjectFile(
      root,
      'src/utils/currency.ts',
      `/** Định dạng tiền tệ VNĐ */\nexport function formatVND(amount: number): string { return String(amount); }\n`
    );
    // Seed existing custom user notes in CLAUDE.md to verify non-destructive marker upsert
    writeProjectFile(root, 'CLAUDE.md', '# Custom Team Notes\nAlways write tests in Vitest.\n');

    const { config } = loadArchRules(root);
    const cache = buildFunctionIndex(root, { persist: false });
    const res = syncAgentRules(root, config, {
      targets: ['cursor', 'agents', 'claude', 'windsurf'],
      exportedFunctions: cache.entries,
    });

    expect(res.files).toHaveLength(4);

    const cursorRule = fs.readFileSync(
      path.join(root, '.cursor', 'rules', 'vibe-doctor.mdc'),
      'utf-8'
    );
    expect(cursorRule).toContain('alwaysApply: true');
    expect(cursorRule).toContain('Layer `ui`');
    expect(cursorRule).toContain('formatVND(amount: number): string');

    const claudeMd = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('# Custom Team Notes');
    expect(claudeMd).toContain('Always write tests in Vitest.');
    expect(claudeMd).toContain('<!-- VIBE-DOCTOR:START -->');
    expect(claudeMd).toContain('src/db/**');

    // Re-running syncAgentRules updates in-place without duplicating blocks
    const secondRes = syncAgentRules(root, config, {
      targets: ['claude'],
      exportedFunctions: cache.entries,
    });
    expect(secondRes.files[0].action).toBe('updated');
    const claudeMdAfter = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    expect(claudeMdAfter.match(/<!-- VIBE-DOCTOR:START -->/g)?.length).toBe(1);
  });

  it('detects runtime circular dependencies (A -> B -> C -> A) while ignoring TypeScript import type cycles', async () => {
    const root = createTempProject();
    writeProjectFile(root, '.archrules.yaml', SAMPLE_ARCHRULES);

    // 3-node runtime cycle: orderService -> userService -> loyaltyService -> orderService
    writeProjectFile(
      root,
      'src/services/orderService.ts',
      `import { getUser } from './userService';\nexport const createOrder = () => getUser();\n`
    );
    writeProjectFile(
      root,
      'src/services/userService.ts',
      `import { calcPoints } from './loyaltyService';\nexport const getUser = () => calcPoints();\n`
    );
    writeProjectFile(
      root,
      'src/services/loyaltyService.ts',
      `import { createOrder } from './orderService';\nexport const calcPoints = () => createOrder;\n`
    );

    // Type-only mutual reference (MUST NOT be flagged as runtime circular dependency)
    writeProjectFile(
      root,
      'src/services/typeA.ts',
      `import type { TypeB } from './typeB';\nexport interface TypeA { b?: TypeB; }\n`
    );
    writeProjectFile(
      root,
      'src/services/typeB.ts',
      `import type { TypeA } from './typeA';\nexport interface TypeB { a?: TypeA; }\n`
    );

    const report = await runAudit({ projectRoot: root, ai: false });
    const cycleIssues = report.issues.filter((i) => i.ruleId === 'circular-dependency');

    // Deduplicated to exactly 1 canonical cycle issue, and typeA <-> typeB is ignored
    expect(cycleIssues).toHaveLength(1);
    expect(cycleIssues[0].severity).toBe('critical');
    expect(cycleIssues[0].message).toContain('src/services/loyaltyService.ts');
    expect(cycleIssues[0].message).toContain('src/services/orderService.ts');
    expect(cycleIssues[0].message).toContain('src/services/userService.ts');
    expect(report.edges.filter((e) => e.violated).length).toBe(3);
  });

  it('scaffolds valid .archrules.yaml for all multi-framework presets (nextjs, nestjs, react-vite, express)', () => {
    for (const preset of AVAILABLE_PRESETS) {
      const root = createTempProject();
      const res = initProject(root, { preset, installHook: false });
      expect(res.createdArchRules).toBe(true);
      expect(res.preset).toBe(preset);

      const loaded = loadArchRules(root, { allowDefaultFallback: false });
      expect(loaded.usedDefaultConfig).toBe(false);
      expect(Object.keys(loaded.config.layers).length).toBeGreaterThanOrEqual(3);
      expect(loaded.config.thresholds.detect_circular_dependencies).toBe(true);
    }

    const badRoot = createTempProject();
    expect(() => initProject(badRoot, { preset: 'unknown-framework' })).toThrow(/Preset không hợp lệ/);
  });

  it('serves MCP JSON-RPC 2.0 protocol (initialize, tools/list, vibe_search_functions, vibe_audit, vibe_sync_rules)', async () => {
    const root = createTempProject();
    writeProjectFile(root, '.archrules.yaml', SAMPLE_ARCHRULES);
    writeProjectFile(
      root,
      'src/utils/currency.ts',
      `/** Định dạng tiền tệ VNĐ chuẩn */\nexport function formatVND(amount: number): string { return String(amount); }\n`
    );
    writeProjectFile(root, 'src/db/index.ts', `export const prisma = {};\n`);
    writeProjectFile(
      root,
      'src/components/BadCheckout.tsx',
      `import { prisma } from '@/db';\nexport const BadCheckout = () => prisma;\n`
    );

    const ctx = { defaultProjectRoot: root, serverVersion: '1.3.0', runAuditFn: runAudit };

    // 1. initialize handshake
    const initResp = await handleMcpJsonRpcMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      ctx
    );
    expect(initResp?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'vibe-doctor', version: '1.3.0' },
    });

    // 2. notifications/initialized returns null
    const notifResp = await handleMcpJsonRpcMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ctx
    );
    expect(notifResp).toBeNull();

    // 3. tools/list exposes all 3 Vibe Doctor tools
    const listResp = await handleMcpJsonRpcMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ctx
    );
    const tools = (listResp?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'vibe_audit',
      'vibe_search_functions',
      'vibe_sync_rules',
    ]);

    // 4. tools/call -> vibe_search_functions finds formatVND
    const searchResp = await handleMcpJsonRpcMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'vibe_search_functions',
          arguments: { query: 'format currency VND', refreshIndex: true },
        },
      },
      ctx
    );
    const searchJson = JSON.parse(
      (searchResp?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { matches: Array<{ id: string }> };
    expect(searchJson.matches[0]?.id).toBe('src/utils/currency.ts::formatVND');

    // 5. tools/call -> vibe_audit catches BadCheckout.tsx layer boundary violation
    const auditResp = await handleMcpJsonRpcMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'vibe_audit', arguments: {} },
      },
      ctx
    );
    const auditJson = JSON.parse(
      (auditResp?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { passed: boolean; summary: { critical: number }; fixPrompt: string };
    expect(auditJson.passed).toBe(false);
    expect(auditJson.summary.critical).toBe(1);
    expect(auditJson.fixPrompt).toContain('BadCheckout.tsx');

    // 6. tools/call -> vibe_sync_rules generates cursor rule
    const syncResp = await handleMcpJsonRpcMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'vibe_sync_rules', arguments: { targets: ['cursor'] } },
      },
      ctx
    );
    expect((syncResp?.result as { isError?: boolean }).isError).toBe(false);
    expect(fs.existsSync(path.join(root, '.cursor', 'rules', 'vibe-doctor.mdc'))).toBe(true);
  });
});
