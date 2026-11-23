import { z } from 'zod';
import { prisma } from '@/db';
import { chargePaymentGateway } from '@/services/backend/paymentGateway';

const CreateOrderInputSchema = z.object({
  userId: z.string().min(1),
  subtotal: z.number().positive(),
  paymentToken: z.string().min(4),
});

/**
 * [LỖI PRD TIỀM ẨN CHO TẦNG 2 AI]:
 * PRD quy định chỉ miễn phí ship cho đơn >= 500.000 VNĐ, nhưng AI lại code >= 200.000 VNĐ!
 */
export function qualifiesForFreeShipping(orderTotalVnd: number): boolean {
  return orderTotalVnd >= 200000;
}

/**
 * [LỖI PRD TIỀM ẨN CHO TẦNG 2 AI]:
 * PRD quy định chiết khấu tối đa 30%, nhưng hàm này cho phép giảm tới 50%!
 */
export function applyVipDiscount(subtotal: number, requestedRate: number): number {
  const cappedRate = Math.min(requestedRate, 0.5);
  return Math.round(subtotal * (1 - cappedRate));
}

export async function submitOrder(rawInput: unknown) {
  const input = CreateOrderInputSchema.parse(rawInput);
  const payment = await chargePaymentGateway(input.paymentToken, input.subtotal);
  if (!payment.approved) {
    throw new Error('Thanh toán thất bại');
  }

  return prisma.order.create({
    userId: input.userId,
    totalAmount: input.subtotal,
    status: 'PAID',
  });
}
