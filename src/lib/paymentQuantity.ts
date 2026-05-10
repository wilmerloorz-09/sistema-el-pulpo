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

/** Reparte targetTotal en partes proporcionales a weights; la última absorbe centavos residuales. */
export function distributeProportionalAmounts(weights: number[], targetTotal: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = roundMoney(weights.reduce((a, b) => a + b, 0));
  if (sumW <= 0.005) {
    const equal = roundMoney(targetTotal / n);
    let allocated = 0;
    return weights.map((_, i) => {
      if (i === n - 1) return roundMoney(targetTotal - allocated);
      allocated = roundMoney(allocated + equal);
      return equal;
    });
  }
  let allocated = 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push(roundMoney(targetTotal - allocated));
    } else {
      const share = roundMoney((weights[i] / sumW) * targetTotal);
      out.push(share);
      allocated = roundMoney(allocated + share);
    }
  }
  return out;
}
