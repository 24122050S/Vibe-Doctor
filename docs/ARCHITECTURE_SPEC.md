# 🩺 Vibe Doctor — Engineering Architecture Specification (RFC)

## 1. Problem Statement

Modern AI-assisted development (**Vibe Coding** with Cursor, Claude Code, Windsurf, Antigravity) accelerates local feature implementation but introduces severe **Architecture Drift** due to bounded LLM context windows:
- **Layer Boundary Breaches:** UI components importing database clients (`@/db`) or restricted internal gateways directly.
- **Runtime Circular Dependencies:** Mutual imports (`serviceA -> serviceB -> serviceA`) breaking module bundlers and DI containers.
- **Semantic Duplication:** Re-implementing utilities (e.g., `formatPrice`) that already exist in shared modules (`src/utils/currency.ts::formatVND`).
- **Unapproved Dependencies & Hardcoded Secrets:** Hallucinating unvetted npm packages or embedding API keys / database credentials directly in source files.
- **Business Logic Drift:** Diverging from domain invariants documented in `PRD.md`.

---

## 2. Two-Tier Hybrid Funnel Architecture

`vibe-doctor` resolves the speed-vs-intelligence trade-off through a decoupled **Two-Tier Funnel**:

1. **Tier 1 — Deterministic Static AST Engine (`< 300ms`, `0` API Cost):**
   - Powered by `ts-morph` configured with `skipLoadingLibFiles` and `skipFileDependencyResolution`, paired with cached AST import extraction (`WeakMap`) and pre-compiled `picomatch` globs.
   - Enforces `layer-boundary`, `circular-dependency` (DFS with lazy neighbor expansion in `--staged` mode), `hardcoded-secret` (with automatic credential redaction), `file-size` / `function-size`, and `unapproved-dependency`.
2. **Tier 2 — Dynamic LLM Semantic & PRD Judge (`Gemini` / `Ollama` / `OpenAI`):**
   - Gated behind Tier 1 (only invoked when AST passes or `--semantic` is requested).
   - Uses `.vibe-cache.json` + Jaccard/token Top-5 pre-filtering, symmetric pair deduplication, and `max_ai_checks` quota caps to validate semantic duplication and `PRD.md` business rule compliance via Zod-enforced JSON schemas.
   - **Resilience Guarantee:** Network timeouts or missing API credentials gracefully degrade to Tier 1 AST-only reporting without crashing `git commit`.

---

## 3. Closed-Loop Remediation & Proactive Prevention

- **Proactive Guardrails (`vibe-doctor sync-rules`):** Compiles `.archrules.yaml` and public function signatures into `.cursor/rules/vibe-doctor.mdc`, `AGENTS.md`, `CLAUDE.md`, and `.windsurfrules` using non-destructive HTML markers (`<!-- VIBE-DOCTOR:START -->`).
- **Reactive Remediation (`Auto Fix-Prompt` & `vibe-doctor mcp`):** Synthesizes exact file/line/snippet instructions for AI Agents, or exposes `vibe_audit`, `vibe_search_functions`, and `vibe_sync_rules` directly over a zero-dependency **Model Context Protocol (MCP)** `stdio` server.
- **Controlled Escape Hatch:** Supports inline `// vibe-doctor-ignore-next-line` and `// vibe-ignore` annotations for intentional architectural exceptions.
