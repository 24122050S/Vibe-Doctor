import { z } from 'zod';
import { prisma } from '@/db';
import { chargePaymentGateway } from '@/services/backend/paymentGateway';
import { calculateVat } from '@/utils/currency';

const CheckoutOrderInputSchema = z.object({
  userId: z.string().min(1),
  items: z.array(z.object({ id: z.string(), price: z.number().positive(), qty: z.number().int().positive() })),
  paymentToken: z.string().min(4),
});

/** Đã tuân thủ PRD: Miễn phí vận chuyển cho đơn >= 500.000 VNĐ */
export function qualifiesForFreeShipping(orderTotalVnd: number): boolean {
  return orderTotalVnd >= 500000;
}

/** Đã tuân thủ PRD: Giới hạn chiết khấu VIP tối đa 30% */
export function applyVipDiscount(subtotal: number, requestedRate: number): number {
  const cappedRate = Math.min(Math.max(requestedRate, 0), 0.3);
  return Math.round(subtotal * (1 - cappedRate));
}

export async function checkoutOrder(rawInput: unknown) {
  const input = CheckoutOrderInputSchema.parse(rawInput);
  const rawSubtotal = input.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shippingFee = qualifiesForFreeShipping(rawSubtotal) ? 0 : 30000;
  const grandTotal = rawSubtotal + shippingFee + calculateVat(rawSubtotal);

  const payment = await chargePaymentGateway(input.paymentToken, grandTotal);
  if (!payment.approved) {
    return { ok: false as const, grandTotal, error: 'Không thể thanh toán đơn hàng' };
  }

  const savedOrder = await prisma.order.create({
    userId: input.userId,
    totalAmount: grandTotal,
    status: 'PAID',
  });

  return { ok: true as const, orderId: savedOrder.id, grandTotal };
}
