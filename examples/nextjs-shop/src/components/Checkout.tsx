import axios from 'axios';
import { Dialog } from '@radix-ui/react-dialog';
import { CreditCard } from 'lucide-react';
import { prisma } from '@/db';
import { chargePaymentGateway } from '@/services/backend/paymentGateway';

/**
 * [LỖI TẦNG 2 AI - SEMANTIC DUPLICATE]:
 * Hàm formatPrice này trùng lặp ngữ nghĩa 95% với `src/utils/currency.ts::formatVND`!
 */
export function formatPrice(priceInVnd: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(priceInVnd);
}

/**
 * [LỖI TẦNG 1 AST]:
 * 1. Import trực tiếp `@/db` từ tầng `ui`
 * 2. Import trực tiếp `@/services/backend/paymentGateway` từ tầng `ui`
 * 3. Dùng thư viện `axios` chưa được phê duyệt trong `.archrules.yaml`
 * 4. Hàm phình to vượt quá ngưỡng `max_function_lines: 40`
 */
export async function Checkout(props: {
  userId: string;
  items: Array<{ id: string; price: number; qty: number }>;
  paymentToken: string;
}) {
  let rawSubtotal = 0;
  for (const item of props.items) {
    const lineAmount = item.price * item.qty;
    rawSubtotal += lineAmount;
  }

  const shippingFee = rawSubtotal >= 500000 ? 0 : 30000;
  const taxFee = Math.round(rawSubtotal * 0.1);
  const grandTotal = rawSubtotal + shippingFee + taxFee;
  const formattedTotal = formatPrice(grandTotal);

  // Lỗi Vibe Coding: gọi axios trực tiếp và chọc thẳng vào cổng thanh toán backend + DB ngay trên UI!
  await axios.post('/api/analytics-track', {
    userId: props.userId,
    grandTotal,
  });

  const gatewayRes = await chargePaymentGateway(props.paymentToken, grandTotal);
  if (!gatewayRes.approved) {
    return {
      ok: false,
      uiIcon: CreditCard,
      modal: Dialog,
      displayTotal: formattedTotal,
      error: 'Không thể thanh toán đơn hàng',
    };
  }

  const savedOrder = await prisma.order.create({
    userId: props.userId,
    totalAmount: grandTotal,
    status: 'PAID',
  });

  return {
    ok: true,
    uiIcon: CreditCard,
    modal: Dialog,
    orderId: savedOrder.id,
    displayTotal: formattedTotal,
  };
}
