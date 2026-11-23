import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import picomatch from 'picomatch';
import { checkPrdCompliance } from './ai/prdChecker.js';
import { generateFixPrompt } from './ai/prompts.js';
import { checkProviderAvailability, createLlmProvider, LlmProvider } from './ai/provider.js';
import { checkSemanticDuplication } from './ai/semanticChecker.js';
import { extractFunctionsFromSourceFile, loadOrBuildFunctionIndex } from './ast/indexer.js';
import { createFastAstProject, loadPathAliases, loadSourceFilesIntoProject } from './ast/parser.js';
import { checkCircularDependencies } from './ast/rules/circularDeps.js';
import { checkDependencies } from './ast/rules/depsCheck.js';
import { checkFileAndFunctionSizes } from './ast/rules/fileSize.js';
import { checkLayerBoundaries } from './ast/rules/layerBoundary.js';
import { buildCliProgram } from './cli.js';
import { loadArchRules } from './config/loader.js';
import { AuditIssue, AuditReport, FunctionSignatureEntry } from './types.js';
import { loadProjectEnvFiles } from './utils/env.js';
import { collectTargetFiles, getStagedChangedLinesMap } from './utils/git.js';
import { logger } from './utils/logger.js';

export * from './types.js';
export * from './config/schema.js';
export * from './config/loader.js';
export * from './config/presets.js';
export { initProject, type InitProjectResult } from './utils/init.js';
export { loadProjectEnvFiles, parseDotEnvContent } from './utils/env.js';
export {
  syncAgentRules,
  upsertMarkedMarkdownFile,
  type AgentRuleTarget,
  type SyncRulesOptions,
  type SyncRulesResult,
} from './reporters/ruleSync.js';

export interface RunAuditOptions {
  projectRoot?: string;
  configPath?: string;
  staged?: boolean;
  semantic?: boolean;
  ai?: boolean;
  strict?: boolean;
  customProvider?: LlmProvider;
}

function collectTargetFunctionsForAi(
  mode: 'staged' | 'full',
  projectRoot: string,
  sourceFiles: ReturnType<typeof loadSourceFilesIntoProject>
): FunctionSignatureEntry[] {
  const changedLinesMap = mode === 'staged' ? getStagedChangedLinesMap(projectRoot) : null;
  const targetFunctions: FunctionSignatureEntry[] = [];

  for (const [relFile, sf] of sourceFiles.entries()) {
    const fileFns = extractFunctionsFromSourceFile(relFile, sf);
    if (changedLinesMap && changedLinesMap.has(relFile)) {
      const changedSet = changedLinesMap.get(relFile)!;
      for (const fn of fileFns) {
        for (let line = fn.line; line <= fn.endLine; line++) {
          if (changedSet.has(line)) {
            targetFunctions.push(fn);
            break;
          }
        }
      }
    } else {
      targetFunctions.push(...fileFns);
    }
  }
  return targetFunctions;
}

async function executeTier2Alignment(params: {
  projectRoot: string;
  mode: 'staged' | 'full';
  filesCount: number;
  hasAstCritical: boolean;
  sourceFiles: ReturnType<typeof loadSourceFilesIntoProject>;
  config: ReturnType<typeof loadArchRules>['config'];
  options: RunAuditOptions;
}): Promise<{
  issues: AuditIssue[];
  aiDurationMs: number;
  tier2Executed: boolean;
  tier2SkippedReason?: string;
  functionsIndexed: number;
}> {
  const { projectRoot, mode, filesCount, hasAstCritical, sourceFiles, config, options } = params;
  const aiEnabled =
    (options.ai ?? true) &&
    (config.ai_eval.check_semantic_duplication || config.ai_eval.check_prd_compliance);

  if (!aiEnabled) {
    return { issues: [], aiDurationMs: 0, tier2Executed: false, tier2SkippedReason: '--no-ai or disabled in config', functionsIndexed: 0 };
  }
  if (filesCount === 0) {
    return { issues: [], aiDurationMs: 0, tier2Executed: false, tier2SkippedReason: 'no target files', functionsIndexed: 0 };
  }
  if (hasAstCritical && !options.semantic) {
    return { issues: [], aiDurationMs: 0, tier2Executed: false, tier2SkippedReason: 'AST critical errors present (pass --semantic to force)', functionsIndexed: 0 };
  }

  const availability = options.customProvider
    ? { available: true }
    : checkProviderAvailability(config.ai_eval);
  if (!availability.available) {
    return { issues: [], aiDurationMs: 0, tier2Executed: false, tier2SkippedReason: availability.reason ?? 'AI provider unavailable', functionsIndexed: 0 };
  }

  const aiStart = performance.now();
  const aiIssues: AuditIssue[] = [];
  let functionsIndexed = 0;

  try {
    const provider = options.customProvider ?? createLlmProvider(config.ai_eval);
    const cacheIndex = loadOrBuildFunctionIndex(projectRoot, sourceFiles);
    functionsIndexed = cacheIndex.entries.length;
    const targetFunctions = collectTargetFunctionsForAi(mode, projectRoot, sourceFiles);

    if (config.ai_eval.check_semantic_duplication && targetFunctions.length > 0) {
      aiIssues.push(
        ...(await checkSemanticDuplication(targetFunctions, cacheIndex.entries, provider, config.ai_eval))
      );
    }
    if (config.ai_eval.check_prd_compliance && targetFunctions.length > 0) {
      aiIssues.push(
        ...(await checkPrdCompliance(projectRoot, targetFunctions, provider, config.ai_eval))
      );
    }
    return { issues: aiIssues, aiDurationMs: performance.now() - aiStart, tier2Executed: true, functionsIndexed };
  } catch (err) {
    const reason = `Fallback AST-only (${err instanceof Error ? err.message : String(err)})`;
    logger.warn(`Tier 2 AI check skipped due to error: ${reason}`);
    return { issues: aiIssues, aiDurationMs: performance.now() - aiStart, tier2Executed: false, tier2SkippedReason: reason, functionsIndexed };
  }
}

/**
 * Core two-tier Vibe Doctor audit engine (Tier 1 AST + Tier 2 LLM Alignment).
 */
export async function runAudit(options: RunAuditOptions = {}): Promise<AuditReport> {
  const totalStart = performance.now();
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

  // Automatically load `.env.local` and `.env` from target project and working directory
  loadProjectEnvFiles(projectRoot);

  const { config, configPath, usedDefaultConfig } = loadArchRules(projectRoot, {
    configPath: options.configPath,
    allowDefaultFallback: !options.configPath,
  });

  const astStart = performance.now();
  const collected = collectTargetFiles(projectRoot, { staged: options.staged });
  const ignoreMatcher =
    config.ignore.length > 0 ? picomatch(config.ignore, { dot: true }) : () => false;
  const files = collected.files.filter((f) => !ignoreMatcher(f));

  const project = createFastAstProject();
  const aliasConfig = loadPathAliases(projectRoot);
  const sourceFiles = loadSourceFilesIntoProject(project, projectRoot, files);

  const { issues: layerIssues, edges } = checkLayerBoundaries(projectRoot, sourceFiles, config, aliasConfig);
  const circularIssues = config.thresholds.detect_circular_dependencies
    ? checkCircularDependencies(projectRoot, sourceFiles, aliasConfig, edges)
    : [];
  const sizeIssues = checkFileAndFunctionSizes(sourceFiles, config);
  const checkPkgJson =
    collected.mode === 'full' || collected.allStagedFiles.some((f) => f === 'package.json');
  const depIssues = checkDependencies(projectRoot, sourceFiles, config, aliasConfig, {
    checkPackageJson: checkPkgJson,
  });

  const astIssues: AuditIssue[] = [...layerIssues, ...circularIssues, ...sizeIssues, ...depIssues];
  const astDurationMs = performance.now() - astStart;
  const hasAstCritical = astIssues.some((i) => i.severity === 'critical');

  const tier2 = await executeTier2Alignment({
    projectRoot,
    mode: collected.mode,
    filesCount: files.length,
    hasAstCritical,
    sourceFiles,
    config,
    options,
  });

  const allIssues = [...astIssues, ...tier2.issues];
  const hasCritical = allIssues.some((i) => i.severity === 'critical');
  const hasWarning = allIssues.some((i) => i.severity === 'warning');

  return {
    projectRoot,
    configPath,
    usedDefaultConfig,
    timestamp: new Date().toISOString(),
    mode: collected.mode,
    issues: allIssues,
    edges,
    fixPrompt: generateFixPrompt(allIssues),
    metrics: {
      filesScanned: sourceFiles.size,
      functionsIndexed: tier2.functionsIndexed,
      astDurationMs,
      aiDurationMs: tier2.aiDurationMs,
      totalDurationMs: performance.now() - totalStart,
      tier2Executed: tier2.tier2Executed,
      tier2SkippedReason: tier2.tier2SkippedReason,
    },
    passed: options.strict ? !hasCritical && !hasWarning : !hasCritical,
  };
}

export function createProgram(): Command {
  return buildCliProgram(runAudit);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  runCli(process.argv).catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
