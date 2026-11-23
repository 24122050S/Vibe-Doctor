export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueTier = 'ast' | 'ai';
export type IssueRuleId =
  | 'layer-boundary'
  | 'circular-dependency'
  | 'file-size'
  | 'function-size'
  | 'unapproved-dependency'
  | 'semantic-duplicate'
  | 'prd-drift';

export interface AuditIssue {
  tier: IssueTier;
  ruleId: IssueRuleId;
  severity: IssueSeverity;
  /** POSIX-normalized path relative to project root */
  file: string;
  line: number;
  column?: number;
  message: string;
  snippet?: string;
  suggestion: string;
  metadata?: Record<string, unknown>;
}

export interface DependencyEdge {
  from: string;
  to: string;
  specifier: string;
  line: number;
  fromLayer?: string;
  toLayer?: string;
  violated: boolean;
}

export interface FunctionSignatureEntry {
  /** Format: `src/utils/currency.ts::formatVND` */
  id: string;
  name: string;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
  params: string;
  returnType: string;
  signature: string;
  jsdoc?: string;
  summary: string;
}

export interface FunctionCacheIndex {
  version: string;
  generatedAt: string;
  projectRoot: string;
  entries: FunctionSignatureEntry[];
}

export interface SemanticDuplicateResult {
  is_duplicate: boolean;
  similarity_score: number;
  existing_function: string;
  recommendation: string;
}

export interface PrdComplianceResult {
  has_violation: boolean;
  violated_rule: string;
  severity: 'critical' | 'warning';
  explanation: string;
  recommendation: string;
}

export interface AuditMetrics {
  filesScanned: number;
  functionsIndexed: number;
  astDurationMs: number;
  aiDurationMs: number;
  totalDurationMs: number;
  tier2Executed: boolean;
  tier2SkippedReason?: string;
}

export interface AuditReport {
  projectRoot: string;
  configPath: string;
  usedDefaultConfig: boolean;
  timestamp: string;
  mode: 'staged' | 'full';
  issues: AuditIssue[];
  edges: DependencyEdge[];
  fixPrompt: string;
  metrics: AuditMetrics;
  passed: boolean;
}
