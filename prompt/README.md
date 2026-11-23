# 🩺 Vibe Doctor — AI Codebase Governance & Architecture Guardrail CLI
> **System Specification & Prompt Context for AI Coding Agents**

---

## 1. Tổng quan Dự án (Project Overview)

### 1.1. Bài toán (The Problem)
Khi lập trình bằng phong cách **Vibe Coding** (sử dụng Cursor, Claude Code, Windsurf, Lovable...), các mô hình AI thường giải quyết bài toán cục bộ trong cửa sổ ngữ cảnh ngắn hạn. Điều này dẫn đến hiện tượng **Architecture Drift (Trôi dạt kiến trúc)**:
* AI vi phạm ranh giới phân tầng (ví dụ: tầng UI gọi trực tiếp DB).
* AI tự đẻ ra các hàm trùng lặp logic với các helper/utility đã tồn tại trong dự án.
* AI ảo giác hoặc cài thêm các thư viện chưa được kiểm duyệt.
* AI viết code đi chệch khỏi các ràng buộc nghiệp vụ trong `PRD.md`.

### 1.2. Giải pháp (The Solution)
**`vibe-doctor`** là một công cụ dòng lệnh (CLI Tool) kiêm Git Pre-commit Hook hoạt động như một "Bác sĩ kiểm toán kiến trúc". Công cụ sử dụng kiến trúc phễu 2 tầng:
1. **Tầng 1 (Tĩnh - AST):** Quét cú pháp siêu tốc bằng AST (Abstract Syntax Tree) để bắt lỗi phân tầng, file phình to, import sai quy tắc (0ms API cost, <300ms execution).
2. **Tầng 2 (Động - LLM Alignment):** Trích xuất chữ ký hàm (Function Signatures) và đối chiếu với `PRD.md` bằng LLM (Gemini Flash / Ollama) để phát hiện trùng lặp ngữ nghĩa và sai lệch logic nghiệp vụ.
3. **Fix Prompt Generator:** Tự động tạo đoạn prompt khắc phục chuẩn xác để dev dán ngược lại vào AI Agent (Cursor/Claude) sửa code.

---

## 2. Kiến trúc Hệ thống (System Architecture)

```
                       [ git commit ]
                             │
                             ▼
                 ┌───────────────────────┐
                 │  vibe-doctor CLI Engine│
                 └───────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────┐
│ TẦNG 1: AST Scanner   │         │ TẦNG 2: LLM Alignment │
│  (ts-morph / Tree-sitter)       │  (Gemini / Ollama)    │
├───────────────────────┤         ├───────────────────────┤
│ • Layer Boundary      │         │ • Semantic Duplicate  │
│ • File Size Limits    │         │ • PRD Rule Drift      │
│ • Unapproved Packages │         │ • Business Logic Gap  │
└───────────┬───────────┘         └───────────┬───────────┘
            │                                 │
            └────────────────┬────────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │ Output & Remediation Engine │
              ├─────────────────────────────┤
              │ • Terminal Color Report     │
              │ • Auto Fix-Prompt Generator │
              │ • Block Commit if CRITICAL  │
              └─────────────────────────────┘
```

---

## 3. Cấu trúc Thư mục Dự án (Project Directory Structure)

```text
vibe-doctor/
├── bin/
│   └── vibe-doctor.js            # Executable CLI entry point
├── src/
│   ├── index.ts                  # Orchestrator & CLI argument parser
│   ├── config/
│   │   ├── schema.ts             # Zod schema cho .archrules.yaml
│   │   └── loader.ts             # Đọc & parse file cấu hình kiến trúc
│   ├── ast/
│   │   ├── parser.ts             # Khởi tạo ts-morph / tree-sitter context
│   │   ├── rules/
│   │   │   ├── layerBoundary.ts  # Kiểm tra import giữa các tầng (UI -> DB)
│   │   │   ├── fileSize.ts       # Bắt các file phình to (>300 LOC)
│   │   │   └── depsCheck.ts      # Đánh giá package.json với danh sách trắng
│   │   └── indexer.ts            # Lập chỉ mục các hàm hiện có trong codebase
│   ├── ai/
│   │   ├── provider.ts           # Adapter kết nối (Gemini, Ollama, OpenAI)
│   │   ├── prompts.ts            # System prompt cho LLM Judge & Fix Prompting
│   │   ├── semanticChecker.ts    # So sánh trùng lặp ngữ nghĩa hàm
│   │   └── prdChecker.ts         # Đối chiếu code thay đổi với PRD.md
│   ├── reporters/
│   │   ├── terminal.ts           # In báo cáo màu mè trên Console (Chalk/Ora)
│   │   └── htmlReport.ts         # Standalone HTML report viewer
│   └── utils/
│       ├── git.ts                # Lấy git diff & staged files
│       └── logger.ts             # System logger
├── templates/
│   └── .archrules.yaml           # File quy tắc mẫu
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Định dạng File Cấu hình (Configuration Specifications)

### 4.1. File `.archrules.yaml` (Đặt ở root của dự án target)

```yaml
version: "1.0"
project_type: "nextjs-clean-arch"

# 1. Quy định ranh giới giữa các tầng
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

# 2. Ngưỡng cảnh báo độ sạch code
thresholds:
  max_file_lines: 300
  max_function_lines: 50

# 3. Danh sách thư viện được phép dùng
dependencies:
  allowed_ui: ["lucide-react", "framer-motion", "@radix-ui/*"]
  allowed_validation: ["zod"]
  strict_mode: true

# 4. LLM Configuration
ai_eval:
  provider: "gemini" # gemini | ollama | openai
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
```

---

## 5. Kế hoạch Triển khai Kỹ thuật (Technical Implementation Plan)

### Phase 1: Core AST Engine & CLI Wrapper (Tuần 1)
- **Công nghệ:** Node.js, TypeScript, `commander` (CLI), `ts-morph` (TypeScript AST parsing), `chalk` / `ora`.
- **Nhiệm vụ:**
  1. Viết `utils/git.ts` sử dụng `simple-git` hoặc `execSync` để lọc ra danh sách các file nằm trong `git diff --staged`.
  2. Xây dựng parser AST bằng `ts-morph` để duyệt danh sách `ImportDeclaration`.
  3. Đánh giá import paths với cấu hình `cannot_import` trong `.archrules.yaml`.
  4. Trả về kết quả kiểm toán Tầng 1 kèm vị trí file, dòng vi phạm nếu phát hiện tầng UI import trực tiếp DB module.

### Phase 2: Function Indexer & Semantic AI Judge (Tuần 2)
- **Công nghệ:** `@google/genai` (Google Gen AI SDK), `Pydantic`-like Structured Output (JSON Schema).
- **Nhiệm vụ:**
  1. Dùng AST quét toàn bộ codebase để thu thập danh sách tên hàm + JSDoc/TypeScript Signature + tóm tắt logic thành một Index File siêu nhẹ (`.vibe-cache.json`).
  2. Khi có hàm mới được tạo ra ở commit mới, gọi Gemini API với Prompt ép kiểu JSON:
     - Input: Hàm mới + Top 5 hàm có chữ ký gần giống nhất trong cache.
     - Output Expected Schema:
       ```json
       {
         "is_duplicate": true,
         "similarity_score": 0.92,
         "existing_function": "src/utils/currency.ts::formatVND",
         "recommendation": "Xóa hàm mới và tái sử dụng formatVND"
       }
       ```
  3. Trích xuất các mục điều kiện chính trong `PRD.md`, dùng LLM đối chiếu hàm mới xem có vi phạm điều kiện logic kinh doanh hay không.

### Phase 3: Remediation Engine (Fix Prompt Generator) & Packaging (Tuần 3)
- **Công nghệ:** Handlebars / Template strings, `husky` pre-commit integration, `npx` publish pipeline.
- **Nhiệm vụ:**
  1. Xây dựng engine tự động ghép các lỗi phát hiện được thành 1 đoạn **Prompt khắc phục** dạng:
     > *"Gửi AI Agent: Trong file `Checkout.tsx`, phát hiện lỗi ranh giới tầng tại dòng 14 (`import { prisma } from '@/db'`) và hàm trùng lặp `formatPrice` ở dòng 45. Hãy chuyển logic DB sang `orderService.ts` và dùng hàm `formatVND` từ `@/utils/currency`."*
  2. Hỗ trợ lệnh `npx vibe-doctor init` để tự động tạo `.archrules.yaml` và cài đặt `husky` pre-commit hook.
  3. Viết `npx vibe-doctor report` tạo file `vibe-report.html` với biểu đồ sơ đồ phụ thuộc (Dependency Graph) hiển thị trực quan các đường nối lỗi.

---

## 6. Prompt Hướng dẫn dành cho AI Agent trong Antigravity

Dán đoạn bên dưới vào Antigravity khi bạn bắt đầu bắt tay vào viết code:

```text
You are acting as a Senior Principal Engineer building the `vibe-doctor` CLI tool based on the specification above.

Please adhere strictly to the following implementation guidelines:
1. Tech Stack: TypeScript, Node.js (ESNext), ts-morph for AST processing, @google/genai for Gemini integration, Commander.js for CLI parsing, and Zod for schema validation.
2. Code Structure: Modular Clean Architecture. Keep AST logic completely decoupled from LLM/AI Provider logic.
3. Performance First: Ensure Tầng 1 (AST scanning) executes in under 300ms without making any API calls. Only invoke LLM (Tầng 2) if AST validation passes or if semantic flag is explicitly enabled.
4. Error Resilience: If network or LLM API fails, gracefully fallback to AST-only reporting without crashing the Git commit process.

Let's begin by setting up the project repository layout, package.json, and the core AST Layer Boundary Rule Checker in `src/ast/rules/layerBoundary.ts`.
```

---

## 7. Tiêu chí Đánh giá Hoàn thành (Definition of Done)

* [ ] Chạy lệnh `npx vibe-doctor audit` trong bất kỳ repo Next.js nào và quét xong AST trong < 500ms.
* [ ] Phát hiện chính xác 100% lỗi Import cấm được quy định trong `.archrules.yaml`.
* [ ] Gọi Gemini Flash API thành công để phát hiện hàm viết trùng ngữ nghĩa và xuất kết quả JSON sạch.
* [ ] Sinh ra được đoạn `Fix Prompt` chính xác, dán lại vào Cursor/Claude chạy thành công ngay lập tức.
* [ ] Có file `README.md` ấn tượng kèm ảnh demo GIF và link repo công khai trên GitHub.