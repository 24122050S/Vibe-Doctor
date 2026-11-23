import { prisma } from '@/db';
import { Checkout } from '@/components/Checkout';
import { ProductCardList } from '@/components/ProductCard';

/**
 * [LỖI TẦNG 1 AST]:
 * Tầng `app` (`src/app/**`) cũng import trực tiếp `@/db` thay vì đi qua `src/services/**`!
 */
export default async function CheckoutPage() {
  const products = await prisma.product.findMany();
  const cards = await ProductCardList();

  return Checkout({
    userId: 'usr_demo_01',
    items: products.map((p) => ({ id: p.id, price: p.price, qty: 1 })),
    paymentToken: 'tok_visa_demo',
  }).then((res) => ({ cards, checkoutResult: res }));
}
