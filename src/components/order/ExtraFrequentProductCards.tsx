import FrequentProductCards from "@/components/order/FrequentProductCards";
import type { MenuNode } from "@/hooks/useMenuTree";

interface Props {
  onSelectProduct: (node: MenuNode) => void;
  disabled?: boolean;
}

/** @deprecated Use FrequentProductCards with context="EXTRA" */
export default function ExtraFrequentProductCards({ onSelectProduct, disabled }: Props) {
  return <FrequentProductCards context="EXTRA" onSelectProduct={onSelectProduct} disabled={disabled} />;
}
