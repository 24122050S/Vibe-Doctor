export async function chargePaymentGateway(
  paymentToken: string,
  amountVnd: number
): Promise<{ transactionId: string; approved: boolean }> {
  if (!paymentToken || amountVnd <= 0) {
    return { transactionId: '', approved: false };
  }
  return {
    transactionId: `txn_${Date.now()}`,
    approved: true,
  };
}
