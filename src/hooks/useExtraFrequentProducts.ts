export {
  type FrequentProductContext,
  type FrequentProductRow,
  FREQUENT_PRODUCT_CONTEXTS,
  fetchFrequentProducts,
  getFrequentProductsQueryKey,
  useFrequentProducts,
} from "@/hooks/useFrequentProducts";

import {
  fetchFrequentProducts,
  getFrequentProductsQueryKey,
  useFrequentProducts,
} from "@/hooks/useFrequentProducts";

/** @deprecated Use fetchFrequentProducts(branchId, "EXTRA") */
export const fetchExtraFrequentProducts = (branchId: string) => fetchFrequentProducts(branchId, "EXTRA");

/** @deprecated Use getFrequentProductsQueryKey(branchId, "EXTRA") */
export const getExtraFrequentProductsQueryKey = (branchId: string | null | undefined) =>
  getFrequentProductsQueryKey(branchId, "EXTRA");

/** @deprecated Use useFrequentProducts(branchId, "EXTRA") */
export function useExtraFrequentProducts(branchId: string | null | undefined) {
  return useFrequentProducts(branchId, "EXTRA");
}

export type ExtraFrequentProductRow = import("@/hooks/useFrequentProducts").FrequentProductRow;
