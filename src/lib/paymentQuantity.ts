export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computePendingQuantity(totalOrdered: number, totalPaid: number): number {
  return Math.max(0, totalOrdered - totalPaid);
}

export function computePendingActiveQuantity(totalOrdered: number, totalPaid: number, totalCancelled: number): number {
  return Math.max(0, totalOrdered - totalPaid - totalCancelled);
}

export function computeLineAmount(quantity: number, unitPrice: number): number {
  return roundMoney(quantity * unitPrice);
}

export function computeLineTotalWithContainer(
  quantity: number,
  unitPrice: number,
  containerCost = 0,
): number {
  if (quantity <= 0) return 0;
  return roundMoney(computeLineAmount(quantity, unitPrice) + Math.max(0, containerCost));
}
