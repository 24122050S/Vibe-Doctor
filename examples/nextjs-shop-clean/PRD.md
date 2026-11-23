# 📋 PRD — Hệ thống Giỏ hàng & Thanh toán (Next.js Shop)

## 1. Quy tắc Vận chuyển (Shipping Rules)
- **Miễn phí vận chuyển (Free Shipping):** Chỉ áp dụng cho các đơn hàng có tổng thanh toán sau chiết khấu **từ 500.000 VNĐ trở lên** (`>= 500000`).
- Đơn hàng dưới 500.000 VNĐ áp dụng phí vận chuyển cố định **30.000 VNĐ**.

## 2. Quy tắc Khuyến mãi & Chiết khấu (Discount Rules)
- **Giới hạn chiết khấu tối đa:** Mọi mã giảm giá hoặc ưu đãi hạng thành viên VIP **không bao giờ được giảm quá 30%** tổng giá trị đơn hàng (`discountRate <= 0.30`).

## 3. Quy tắc Kiến trúc & Bảo mật (Security & Architecture)
- Tầng giao diện (`src/components/**`, `src/app/**`) tuyệt đối không truy cập trực tiếp Database (`src/db/**`) hoặc cổng thanh toán nội bộ (`src/services/backend/**`).
- Không lưu trữ hoặc ghi log mã bảo mật thẻ `cvv` dưới dạng văn bản thuần.
