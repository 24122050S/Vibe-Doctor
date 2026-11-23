import { prisma } from '@/db';
import { formatVND } from '@/utils/currency';

export async function listCatalogProducts() {
  const rows = await prisma.product.findMany();
  return rows.map((item) => ({
    ...item,
    displayPrice: formatVND(item.price),
  }));
}
