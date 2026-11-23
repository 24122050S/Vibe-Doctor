import { Dialog } from '@radix-ui/react-dialog';
import { CreditCard } from 'lucide-react';
import { checkoutOrder } from '@/services/orderService';
import { formatVND } from '@/utils/currency';

export interface CheckoutProps {
  userId: string;
  items: Array<{ id: string; price: number; qty: number }>;
  paymentToken: string;
}

/**
 * Đã refactor theo Auto Fix-Prompt của Vibe Doctor:
 * - Gỡ bỏ import trái phép `@/db`, `@/services/backend/paymentGateway` và `axios`
 * - Xóa hàm trùng lặp `formatPrice`, tái sử dụng `formatVND` từ `@/utils/currency`
 * - Ủy quyền xử lý thanh toán & lưu DB cho `checkoutOrder` ở tầng `services`
 */
export async function Checkout(props: CheckoutProps) {
  const result = await checkoutOrder(props);
  const displayTotal = formatVND(result.grandTotal);

  if (!result.ok) {
    return { ok: false, uiIcon: CreditCard, modal: Dialog, displayTotal, error: result.error };
  }

  return { ok: true, uiIcon: CreditCard, modal: Dialog, orderId: result.orderId, displayTotal };
}
