import path from 'node:path';
import picomatch from 'picomatch';
import { SourceFile } from 'ts-morph';
import { ArchRulesConfig } from '../../config/schema.js';
import { AuditIssue, DependencyEdge } from '../../types.js';
import {
  extractModuleImports,
  PathAliasConfig,
  resolveSpecifierToProjectPath,
} from '../parser.js';

interface CompiledLayer {
  name: string;
  pathPatterns: string[];
  isMember: (posixRelPath: string) => boolean;
  cannotImportPatterns: string[];
  isForbiddenTarget: (targetPosixPath: string) => string | null;
}

const STRIP_EXT_REGEX = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

/**
 * Matches an internal resolved POSIX path (which may be a file like `src/db/client.ts`,
 * an extensionless module like `src/db/client`, or a directory index like `src/db`)
 * against an architectural glob pattern (such as `src/db/**`).
 */
export function matchesArchPattern(targetPosixPath: string, pattern: string): boolean {
  const cleanTarget = targetPosixPath.replace(/^\.\//, '').replace(/\/+$/, '');
  const cleanPattern = pattern.replace(/^\.\//, '').trim();
  const strippedTarget = cleanTarget.replace(STRIP_EXT_REGEX, '');

  // Handle directory-tree globs like `src/db/**` when someone imports `@/db` -> `src/db`
  if (cleanPattern.endsWith('/**')) {
    const baseDir = cleanPattern.slice(0, -3);
    if (
      cleanTarget === baseDir ||
      strippedTarget === baseDir ||
      cleanTarget.startsWith(`${baseDir}/`) ||
      strippedTarget.startsWith(`${baseDir}/`)
    ) {
      return true;
    }
  }

  const isMatch = picomatch(cleanPattern, { dot: true });
  return (
    isMatch(cleanTarget) ||
    isMatch(strippedTarget) ||
    isMatch(`${cleanTarget}/index.ts`) ||
    isMatch(`${strippedTarget}/index.ts`)
  );
}

function compileLayers(config: ArchRulesConfig): CompiledLayer[] {
  const compiled: CompiledLayer[] = [];

  for (const [layerName, rule] of Object.entries(config.layers)) {
    const pathPatterns = Array.isArray(rule.path) ? rule.path : [rule.path];
    const cannotImportPatterns = rule.cannot_import ?? [];

    compiled.push({
      name: layerName,
      pathPatterns,
      isMember: (posixRelPath: string) =>
        pathPatterns.some((p) => matchesArchPattern(posixRelPath, p)),
      cannotImportPatterns,
      isForbiddenTarget: (targetPosixPath: string) => {
        for (const forbidden of cannotImportPatterns) {
          if (matchesArchPattern(targetPosixPath, forbidden)) {
            return forbidden;
          }
        }
        return null;
      },
    });
  }

  return compiled;
}

function findOwningLayer(layers: CompiledLayer[], posixRelPath: string): CompiledLayer | undefined {
  return layers.find((layer) => layer.isMember(posixRelPath));
}

function buildRemediationSuggestion(
  fromLayer: string,
  toLayer: string | undefined,
  specifier: string,
  matchedForbiddenPattern: string
): string {
  if (fromLayer === 'ui' && (toLayer === 'db' || matchedForbiddenPattern.includes('db'))) {
    return `Tách truy vấn dữ liệu khỏi tầng UI ('${specifier}'). Hãy chuyển logic DB sang tầng Service/API (ví dụ 'src/services/') và gọi qua hàm service hoặc API route.`;
  }
  if (toLayer) {
    return ` Xóa import '${specifier}' khỏi tầng '${fromLayer}' (không được phép phụ thuộc trực tiếp vào tầng '${toLayer}' theo quy tắc '${matchedForbiddenPattern}'). Sử dụng interface/service trung gian phù hợp.`;
  }
  return `Xóa hoặc tái cấu trúc import '${specifier}' vì vi phạm quy tắc cannot_import ('${matchedForbiddenPattern}') của tầng '${fromLayer}'.`;
}

export interface LayerBoundaryCheckResult {
  issues: AuditIssue[];
  edges: DependencyEdge[];
}

/**
 * Evaluates all internal imports across `sourceFiles` against `.archrules.yaml` layer boundaries.
 */
export function checkLayerBoundaries(
  projectRoot: string,
  sourceFiles: Map<string, SourceFile>,
  config: ArchRulesConfig,
  aliasConfig: PathAliasConfig
): LayerBoundaryCheckResult {
  const issues: AuditIssue[] = [];
  const edges: DependencyEdge[] = [];
  const compiledLayers = compileLayers(config);

  for (const [fromRelPosix, sourceFile] of sourceFiles.entries()) {
    const sourceLayer = findOwningLayer(compiledLayers, fromRelPosix);
    const extractedImports = extractModuleImports(sourceFile);

    for (const imp of extractedImports) {
      const resolvedTarget = resolveSpecifierToProjectPath(
        projectRoot,
        fromRelPosix,
        imp.specifier,
        aliasConfig
      );

      if (!resolvedTarget) {
        continue; // External package; handled by depsCheck
      }

      const targetLayer = findOwningLayer(compiledLayers, resolvedTarget);
      let violated = false;

      if (sourceLayer) {
        const matchedForbidden = sourceLayer.isForbiddenTarget(resolvedTarget);
        if (matchedForbidden) {
          violated = true;
          const targetDesc = targetLayer ? `tầng '${targetLayer.name}' (${resolvedTarget})` : `'${resolvedTarget}'`;
          issues.push({
            tier: 'ast',
            ruleId: 'layer-boundary',
            severity: 'critical',
            file: fromRelPosix,
            line: imp.line,
            column: imp.column,
            message: `Vi phạm ranh giới kiến trúc: tầng '${sourceLayer.name}' (${path.posix.basename(fromRelPosix)}) import trực tiếp ${targetDesc} qua '${imp.specifier}'.`,
            snippet: imp.snippet,
            suggestion: buildRemediationSuggestion(
              sourceLayer.name,
              targetLayer?.name,
              imp.specifier,
              matchedForbidden
            ).trim(),
            metadata: {
              fromLayer: sourceLayer.name,
              toLayer: targetLayer?.name ?? null,
              importedSpecifier: imp.specifier,
              resolvedTarget,
              forbiddenPattern: matchedForbidden,
            },
          });
        }
      }

      edges.push({
        from: fromRelPosix,
        to: resolvedTarget,
        specifier: imp.specifier,
        line: imp.line,
        fromLayer: sourceLayer?.name,
        toLayer: targetLayer?.name,
        violated,
      });
    }
  }

  return { issues, edges };
}
