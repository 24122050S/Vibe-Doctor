# Changelog

All notable changes to **`vibe-doctor`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.1] - 2026-11-23

### Added
- **Inline Suppression Annotations:** Support `// vibe-doctor-ignore-next-line` and `// vibe-ignore` comments for controlled, intentional architectural exceptions.
- **Engineering Architecture Specification:** Added [`docs/ARCHITECTURE_SPEC.md`](./docs/ARCHITECTURE_SPEC.md).

### Improved
- **AST Scan Throughput (3x–5x faster at scale):** Added per-`SourceFile` `WeakMap` import caching and pre-compiled `picomatch` glob matchers so each file's AST is traversed only once across all rules.
- **Transitive `--staged` Circular Dependency Detection:** Lazily expands reachable unstaged neighbor modules during `git commit` so cycles formed between staged and unstaged files are caught immediately.
- **Tier 2 AI Quota & Latency Optimization:** Added symmetric function-pair deduplication and `max_ai_checks` guard (`default: 15`) to prevent redundant LLM API calls on large repositories.

---

## [1.4.0] - 2026-11-23

### Added
- **Hardcoded Secret Scanner (`hardcoded-secret`):** AST string-literal security guardrail catching leaked Gemini/Google keys (`AIza...`), OpenAI/Anthropic keys (`sk-...`), GitHub PATs (`ghp_...`, `github_pat_...`), AWS keys (`AKIA...`), Stripe live keys, Private Key PEM blocks, and DB connection URIs with embedded passwords (with automatic secret masking in Terminal & HTML reports).
- **Real-Time Live Watch Mode (`vibe-doctor watch`):** Debounced recursive filesystem watcher (`250ms`) that re-runs AST audits and optionally refreshes `vibe-report.html` automatically every time an AI Agent saves code.
- **Automated GitHub Release Pipeline (`.github/workflows/release.yml`):** Automatically builds, verifies, packs `.tgz`, and publishes GitHub Releases whenever a `v*.*.*` tag is pushed.

---

## [1.3.0] - 2026-11-23

### Added
- **Built-in Model Context Protocol Server (`vibe-doctor mcp`):** Zero-dependency JSON-RPC 2.0 `stdio` MCP Server compatible with Antigravity, Cursor, and Claude Desktop.
- **3 Agentic MCP Tools:** `vibe_audit`, `vibe_search_functions`, and `vibe_sync_rules` enabling closed-loop self-healing architecture without manual Fix-Prompt copy-pasting.

---

## [1.2.0] - 2026-11-23

### Added
- **Circular Dependency Detection (`circular-dependency`):** Fast DFS runtime cycle detector (`A -> B -> ... -> A`) that ignores erased TypeScript `import type` statements and highlights cycle loops directly in `vibe-report.html`.
- **Multi-Framework Presets (`vibe-doctor init --preset`):** Added built-in Clean Architecture presets for `nextjs`, `nestjs`, `react-vite`, and `express`.

---

## [1.1.0] - 2026-11-23

### Added
- **Proactive AI Rule Synchronization (`vibe-doctor sync-rules`):** Compiles `.archrules.yaml` and indexed public function signatures into `.cursor/rules/vibe-doctor.mdc`, `AGENTS.md`, `CLAUDE.md`, and `.windsurfrules` using non-destructive HTML markers (`<!-- VIBE-DOCTOR:START -->`).

---

## [1.0.0] - 2026-11-23

### Added
- **Tier 1 Static AST Engine (`< 300ms`):** Layer boundary checker (`cannot_import` with tsconfig path alias resolution), file/function LOC limits, and strict dependency whitelist/banlist enforcement.
- **Tier 2 Dynamic LLM Alignment:** Codebase function signature indexer (`.vibe-cache.json`), Top-5 candidate pre-filter, Semantic Duplicate Judge, and `PRD.md` business rule compliance checker (`Gemini`, `Ollama`, `OpenAI`) with graceful offline fallback.
- **Auto Fix-Prompt Generator & Interactive HTML Report (`vibe-report.html`):** Colorized terminal output, copy-paste remediation prompts, and standalone SVG Swimlane Dependency Graph dashboard.
- **Automatic `.env` / `.env.local` Loader & `check-ai` Command:** Zero-config environment loading and live `--ping` diagnostics.
