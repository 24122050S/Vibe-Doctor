import { Checkout } from '@/components/Checkout';
import { ProductCardList } from '@/components/ProductCard';
import { listCatalogProducts } from '@/services/productService';

/**
 * Đã refactor theo Auto Fix-Prompt: Tầng `app` gọi qua `productService` thay vì gọi thẳng `@/db`.
 */
export default async function CheckoutPage() {
  const products = await listCatalogProducts();
  const cards = await ProductCardList();

  const checkoutResult = await Checkout({
    userId: 'usr_demo_01',
    items: products.map((p) => ({ id: p.id, price: p.price, qty: 1 })),
    paymentToken: 'tok_visa_demo',
  });

  return { cards, checkoutResult };
}
