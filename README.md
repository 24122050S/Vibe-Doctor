# 🩺 Vibe Doctor

> **AI Codebase Governance & Architecture Guardrail CLI** — Ngăn chặn hiện tượng *Architecture Drift* khi lập trình với AI Coding Agents (Cursor, Claude Code, Windsurf, Antigravity).

---

## 🚀 Tính năng Cốt lõi

`vibe-doctor` vận hành theo kiến trúc phễu kiểm toán **2 tầng** kết hợp **Remediation Engine**:

1. **⚡ Tầng 1 — Static AST Guardrail (`< 300ms`, `0` API cost):**
   * **Layer Boundary (`layer-boundary`):** Phát hiện tức thì các lệnh `import` / `export` / `require()` xuyên tầng trái phép (ví dụ: tầng `ui` gọi thẳng `src/db/**` hoặc `src/services/backend/**`), hỗ trợ đầy đủ TypeScript path aliases (`@/*`, `~/*`) và relative paths.
   * **Clean Code Thresholds (`file-size`, `function-size`):** Cảnh báo các file và hàm bị phình to vượt ngưỡng cho phép.
   * **Dependency Whitelist (`unapproved-dependency`):** Ngăn AI tự ý cài đặt hoặc import các thư viện ngoài danh sách kiểm duyệt (`strict_mode: true`).
2. **🧠 Tầng 2 — Dynamic LLM Alignment (`Gemini` / `Ollama` / `OpenAI`):**
   * **Function Signature Indexer (`.vibe-cache.json`):** Tự động lập chỉ mục chữ ký hàm + JSDoc + tóm tắt thân hàm trên toàn codebase, lọc nhanh Top-5 ứng viên gần nhất trước khi gọi LLM.
   * **Semantic Duplicate Judge (`semantic-duplicate`):** Phát hiện các hàm viết mới bị trùng lặp ngữ nghĩa với utility/service sẵn có (ví dụ: viết thêm `formatPrice` trong khi dự án đã có `src/utils/currency.ts::formatVND`).
   * **PRD Rule Drift (`prd-drift`):** Đối chiếu logic hàm thay đổi với các ràng buộc nghiệp vụ trong `PRD.md`.
   * **Graceful Fallback:** Tự động chạy Tầng 2 chỉ khi Tầng 1 đạt yêu cầu (hoặc khi bật cờ `--semantic`), và tự động chuyển mượt mà về chế độ AST-only nếu mất mạng hoặc thiếu API key mà không làm crash tiến trình `git commit`.
3. **🤖 Auto Fix-Prompt Generator & Interactive HTML Graph:**
   * Đóng gói toàn bộ vi phạm thành một đoạn **Prompt khắc phục chuẩn xác** để copy-paste thẳng vào Cursor / Claude / Antigravity sửa lỗi ngay lập tức.
   * Xuất báo cáo đồ thị phụ thuộc trực quan `vibe-report.html` (SVG Swimlane Dependency Graph) làm nổi bật các đường nối vi phạm kiến trúc.

---

## 📦 Cài đặt & Khởi chạy Nhanh

```bash
# Cài đặt dependencies & build dự án
npm install
npm run build

# Khởi tạo file .archrules.yaml và cài đặt Git pre-commit hook cho một dự án
npx vibe-doctor init

# Quét toàn bộ dự án hiện tại
npx vibe-doctor audit

# Chỉ quét các file đang staged (tự động chạy trong Git pre-commit hook)
npx vibe-doctor audit --staged

# Lập chỉ mục chữ ký hàm vào .vibe-cache.json
npx vibe-doctor index

# Xuất báo cáo đồ thị phụ thuộc trực quan ra vibe-report.html
npx vibe-doctor report
```

---

## ⚙️ Cấu hình `.archrules.yaml`

Đặt file `.archrules.yaml` tại thư mục gốc của dự án cần bảo vệ (hoặc sinh tự động bằng `npx vibe-doctor init`):

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

# 4. LLM Configuration (Tầng 2)
ai_eval:
  provider: "gemini" # gemini | ollama | openai
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
```

### Biến môi trường cho Tầng 2 (LLM)
`vibe-doctor` **tự động đọc file `.env.local` và `.env`** trong thư mục dự án (ưu tiên biến môi trường hệ thống > `.env.local` > `.env`). Bạn chỉ cần sao chép file `.env.example` thành `.env` (hoặc `.env.local`) và điền key:

```bash
cp .env.example .env
# Kiểm tra cấu hình & gửi ping test kết nối LLM:
npx vibe-doctor check-ai --ping
```

* **Google Gemini (`provider: "gemini"`):** `GEMINI_API_KEY="your-api-key"`
* **Ollama Local (`provider: "ollama"`):** Mặc định kết nối `http://localhost:11434` (tùy chỉnh qua `OLLAMA_HOST` hoặc `ai_eval.base_url`).
* **OpenAI / Compatible (`provider: "openai"`):** `OPENAI_API_KEY="your-api-key"`

---

## 🛠️ Tham chiếu Lệnh CLI

| Lệnh | Mô tả | Cờ tùy chọn nổi bật |
| :--- | :--- | :--- |
| `vibe-doctor audit [dir]` | Kiểm toán kiến trúc 2 tầng và sinh Auto Fix-Prompt | `--staged`, `--semantic`, `--no-ai`, `--strict`, `--json`, `--html [file]`, `-c <path>` |
| `vibe-doctor init [dir]` | Tạo `.archrules.yaml` mẫu & gắn Git `pre-commit` hook | `--force`, `--no-hook` |
| `vibe-doctor index [dir]` | Quét AST lập chỉ mục hàm vào `.vibe-cache.json` | — |
| `vibe-doctor report [dir]` | Tạo dashboard `vibe-report.html` kèm Dependency Graph | `-o <output>`, `--semantic`, `--no-ai`, `-c <path>` |
| `vibe-doctor check-ai [dir]` | Kiểm tra `.env` / API Key & ping thử kết nối LLM Tầng 2 | `--ping`, `-c <path>` |

---

## 📂 Cấu trúc Mã nguồn

```text
vibe-doctor/
├── bin/
│   └── vibe-doctor.js            # Executable CLI entry point
├── src/
│   ├── index.ts                  # Orchestrator & Commander CLI
│   ├── types.ts                  # Clean domain interfaces
│   ├── config/
│   │   ├── schema.ts             # Zod schema cho .archrules.yaml
│   │   └── loader.ts             # Parser YAML & cấu hình mặc định Next.js
│   ├── ast/
│   │   ├── parser.ts             # Fast ts-morph context & path alias resolver
│   │   ├── rules/
│   │   │   ├── layerBoundary.ts  # Kiểm tra ranh giới import giữa các tầng
│   │   │   ├── fileSize.ts       # Kiểm tra kích thước file & hàm
│   │   │   └── depsCheck.ts      # Kiểm tra whitelist/banlist thư viện
│   │   └── indexer.ts            # Lập chỉ mục chữ ký hàm & lọc Top-5 ứng viên
│   ├── ai/
│   │   ├── provider.ts           # Adapter đa nền tảng (Gemini, Ollama, OpenAI)
│   │   ├── prompts.ts            # System Prompts & Auto Fix-Prompt Generator
│   │   ├── semanticChecker.ts    # Phát hiện hàm trùng lặp ngữ nghĩa
│   │   └── prdChecker.ts         # Đối chiếu logic nghiệp vụ với PRD.md
│   ├── reporters/
│   │   ├── terminal.ts           # Báo cáo màu trên Console
│   │   └── htmlReport.ts         # Standalone SVG Dependency Graph HTML viewer
│   └── utils/
│       ├── git.ts                # Trích xuất git diff & staged files
│       └── logger.ts             # System logger
├── templates/
│   └── .archrules.yaml           # Cấu hình mẫu cho vibe-doctor init
└── tests/
    └── vibe-doctor.test.ts       # Bộ kiểm thử tích hợp & benchmark hiệu năng
```

---

## 🧪 Chạy Kiểm thử (Tests)

```bash
npm test
```
