import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import picomatch from 'picomatch';
import { SourceFile } from 'ts-morph';
import {
  ArchRulesConfig,
  getAllowedDependencyPatterns,
  getBannedDependencyPatterns,
} from '../../config/schema.js';
import { AuditIssue } from '../../types.js';
import {
  extractModuleImports,
  PathAliasConfig,
  resolveSpecifierToProjectPath,
} from '../parser.js';

const BUILTIN_SET = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

const IMPLICIT_FRAMEWORK_PACKAGES_BY_PROJECT_TYPE: Record<string, string[]> = {
  'nextjs-clean-arch': ['react', 'react-dom', 'next', 'next/*'],
  nextjs: ['react', 'react-dom', 'next', 'next/*'],
};

/**
 * Extracts canonical npm package name from a raw module specifier.
 * Examples:
 * - `@radix-ui/react-dialog/dist` -> `@radix-ui/react-dialog`
 * - `lucide-react/icons` -> `lucide-react`
 */
export function extractPackageName(specifier: string): string | null {
  const trimmed = specifier.trim();
  if (
    !trimmed ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    BUILTIN_SET.has(trimmed)
  ) {
    return null;
  }

  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return `${parts[0]}/${parts[1]}`;
  }

  const base = trimmed.split('/')[0];
  if (BUILTIN_SET.has(base)) {
    return null;
  }
  return base;
}

function matchesPackagePatterns(specifier: string, pkgName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === pkgName || pattern === specifier) {
      return true;
    }
    const matcher = picomatch(pattern);
    if (matcher(pkgName) || matcher(specifier)) {
      return true;
    }
  }
  return false;
}

function checkPackageJsonDependencies(
  projectRoot: string,
  strictMode: boolean,
  bannedPatterns: string[],
  allowedPatterns: string[]
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return issues;

  try {
    const rawPkg = fs.readFileSync(pkgJsonPath, 'utf-8');
    const parsedPkg = JSON.parse(rawPkg) as { dependencies?: Record<string, string> };
    const deps = parsedPkg.dependencies ?? {};
    const lines = rawPkg.split(/\r?\n/);

    for (const pkgName of Object.keys(deps)) {
      if (pkgName.startsWith('@types/')) continue;
      const isBanned =
        bannedPatterns.length > 0 && matchesPackagePatterns(pkgName, pkgName, bannedPatterns);
      const isUnapproved =
        strictMode && !matchesPackagePatterns(pkgName, pkgName, allowedPatterns);

      if (isBanned || isUnapproved) {
        const lineIdx = lines.findIndex((l) => l.includes(`"${pkgName}"`));
        const lineNum = lineIdx >= 0 ? lineIdx + 1 : 1;
        issues.push({
          tier: 'ast',
          ruleId: 'unapproved-dependency',
          severity: isBanned ? 'critical' : 'warning',
          file: 'package.json',
          line: lineNum,
          column: 1,
          message: isBanned
            ? `package.json chứa dependency bị cấm: '${pkgName}'.`
            : `package.json chứa dependency '${pkgName}' chưa có trong danh sách trắng .archrules.yaml.`,
          snippet: lines[lineIdx]?.trim(),
          suggestion: `Gỡ cài đặt 'npm uninstall ${pkgName}' hoặc bổ sung '${pkgName}' vào mục dependencies trong .archrules.yaml nếu thực sự cần thiết.`,
          metadata: { packageName: pkgName, reason: isBanned ? 'banned' : 'unapproved-package-json' },
        });
      }
    }
  } catch {
    // Ignore invalid package.json
  }
  return issues;
}

/**
 * Checks imported third-party packages and `package.json` dependencies against `.archrules.yaml` whitelist/banlist.
 */
export function checkDependencies(
  projectRoot: string,
  sourceFiles: Map<string, SourceFile>,
  config: ArchRulesConfig,
  aliasConfig: PathAliasConfig,
  options: { checkPackageJson?: boolean } = {}
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const strictMode = config.dependencies.strict_mode;
  const bannedPatterns = getBannedDependencyPatterns(config.dependencies);
  const configuredAllowed = getAllowedDependencyPatterns(config.dependencies);
  const implicitFramework = IMPLICIT_FRAMEWORK_PACKAGES_BY_PROJECT_TYPE[config.project_type] ?? [];
  const allowedPatterns = Array.from(new Set([...configuredAllowed, ...implicitFramework]));

  if (!strictMode && bannedPatterns.length === 0) return issues;

  for (const [relPosixPath, sourceFile] of sourceFiles.entries()) {
    for (const imp of extractModuleImports(sourceFile)) {
      if (imp.isTypeOnly) continue;
      if (resolveSpecifierToProjectPath(projectRoot, relPosixPath, imp.specifier, aliasConfig) !== null) {
        continue;
      }
      const pkgName = extractPackageName(imp.specifier);
      if (!pkgName) continue;

      if (bannedPatterns.length > 0 && matchesPackagePatterns(imp.specifier, pkgName, bannedPatterns)) {
        issues.push({
          tier: 'ast',
          ruleId: 'unapproved-dependency',
          severity: 'critical',
          file: relPosixPath,
          line: imp.line,
          column: imp.column,
          message: `Sử dụng thư viện bị cấm '${pkgName}' (import '${imp.specifier}').`,
          snippet: imp.snippet,
          suggestion: `Gỡ bỏ '${pkgName}' khỏi '${relPosixPath}' và sử dụng các thư viện được phê duyệt trong .archrules.yaml.`,
          metadata: { packageName: pkgName, specifier: imp.specifier, reason: 'banned' },
        });
        continue;
      }

      if (strictMode && !matchesPackagePatterns(imp.specifier, pkgName, allowedPatterns)) {
        issues.push({
          tier: 'ast',
          ruleId: 'unapproved-dependency',
          severity: 'critical',
          file: relPosixPath,
          line: imp.line,
          column: imp.column,
          message: `Thư viện '${pkgName}' chưa được phê duyệt trong danh sách trắng .archrules.yaml (strict_mode: true).`,
          snippet: imp.snippet,
          suggestion: `Thay thế '${pkgName}' bằng thư viện đã duyệt (${configuredAllowed.join(', ') || 'xem .archrules.yaml'}) hoặc bổ sung vào .archrules.yaml.`,
          metadata: { packageName: pkgName, specifier: imp.specifier, reason: 'unapproved' },
        });
      }
    }
  }

  if (options.checkPackageJson ?? true) {
    issues.push(
      ...checkPackageJsonDependencies(projectRoot, strictMode, bannedPatterns, allowedPatterns)
    );
  }

  return issues;
}
