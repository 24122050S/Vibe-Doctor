import { ShoppingBag } from 'lucide-react';
import { formatVND } from '@/utils/currency';
import { listCatalogProducts } from '@/services/productService';

export async function ProductCardList() {
  const items = await listCatalogProducts();
  return items.map((p) => ({
    icon: ShoppingBag,
    title: p.name,
    formatted: formatVND(p.price),
  }));
}
