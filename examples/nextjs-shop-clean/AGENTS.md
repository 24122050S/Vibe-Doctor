<!-- VIBE-DOCTOR:START -->
## 🩺 Vibe Doctor — Architecture & Code Governance Rules

> Auto-generated from `.archrules.yaml`. Do not edit inside this managed block; run `npx vibe-doctor sync-rules` after updating `.archrules.yaml`.

### 1. Layer Boundaries (`project_type: nextjs-clean-arch`)
- **Layer `app`** (`src/app/**`): **MUST NOT** import from `src/db/**`.
- **Layer `ui`** (`src/components/**`): **MUST NOT** import from `src/db/**`, `src/services/backend/**`.
- **Layer `services`** (`src/services/**`): **MUST NOT** import from `src/components/**`, `src/app/**`.
- **Layer `db`** (`src/db/**`): **MUST NOT** import from `src/components/**`, `src/services/**`, `src/app/**`.

### 2. Clean Code Size Thresholds
- **Max lines per file:** `300` lines. Split large modules into focused sub-modules.
- **Max lines per function:** `40` lines. Extract small, single-purpose helpers.

### 3. Dependency Policy
- **Strict Whitelist Mode:** `ENABLED (do NOT install or import unapproved third-party packages)`
- **Approved Packages:** `lucide-react`, `framer-motion`, `@radix-ui/*`, `zod`

### 4. Business Logic & PRD Alignment
- Always verify business rules, thresholds, and domain invariants against `PRD.md` before implementing or modifying service logic.

### 5. Existing Reusable Functions (Reuse — Do Not Duplicate)
Before writing a new helper or service function, reuse these existing exported functions:
- `src/app/checkout/page.tsx` -> `CheckoutPage(): unknown` — Đã refactor theo Auto Fix-Prompt: Tầng `app` gọi qua `productService` thay vì gọi thẳng `@
- `src/components/Checkout.tsx` -> `Checkout(props: CheckoutProps): unknown` — Đã refactor theo Auto Fix-Prompt của Vibe Doctor: - Gỡ bỏ import trái phép `@/db`, `@/serv
- `src/components/ProductCard.tsx` -> `ProductCardList(): unknown`
- `src/services/backend/paymentGateway.ts` -> `chargePaymentGateway(paymentToken: string, amountVnd: number): Promise<{ transactionId: string; approved: boolean }>`
- `src/services/orderService.ts` -> `qualifiesForFreeShipping(orderTotalVnd: number): boolean` — Đã tuân thủ PRD: Miễn phí vận chuyển cho đơn >= 500.000 VNĐ
- `src/services/orderService.ts` -> `applyVipDiscount(subtotal: number, requestedRate: number): number` — Đã tuân thủ PRD: Giới hạn chiết khấu VIP tối đa 30%
- `src/services/orderService.ts` -> `checkoutOrder(rawInput: unknown): unknown`
- `src/services/productService.ts` -> `listCatalogProducts(): unknown`
- `src/utils/currency.ts` -> `formatVND(amount: number): string` — Định dạng số tiền sang chuỗi tiền tệ Việt Nam Đồng chuẩn (ví dụ: 1.850.000 ₫).
- `src/utils/currency.ts` -> `calculateVat(amount: number): number` — Tính thuế GTGT (VAT 10%) cho đơn hàng.

### 6. Pre-Commit Self-Check
- After completing code edits, run `npx vibe-doctor audit` and resolve any `CRITICAL` or `WARNING` issues before committing.
<!-- VIBE-DOCTOR:END -->
