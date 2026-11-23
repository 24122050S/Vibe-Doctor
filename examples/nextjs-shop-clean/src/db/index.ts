export interface OrderRecord {
  id: string;
  userId: string;
  totalAmount: number;
  status: 'PENDING' | 'PAID';
}

export const prisma = {
  product: {
    findMany: async () => [
      { id: 'sku-01', name: 'Bàn phím cơ Vibe 75%', price: 1850000 },
      { id: 'sku-02', name: 'Chuột không dây Pro', price: 950000 },
    ],
  },
  order: {
    create: async (data: Omit<OrderRecord, 'id'>): Promise<OrderRecord> => ({
      id: 'ord_9981',
      ...data,
    }),
  },
};
