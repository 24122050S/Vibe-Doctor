/**
 * Định dạng số tiền sang chuỗi tiền tệ Việt Nam Đồng chuẩn (ví dụ: 1.850.000 ₫).
 */
export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(amount);
}

/**
 * Tính thuế GTGT (VAT 10%) cho đơn hàng.
 */
export function calculateVat(amount: number): number {
  return Math.round(amount * 0.1);
}
