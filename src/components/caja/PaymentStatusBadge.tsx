import { Badge } from "@/components/ui/badge";
import type { CompletedPaymentStatus } from "@/hooks/useCaja";

interface Props {
  status: CompletedPaymentStatus;
}

const statusMap: Record<CompletedPaymentStatus, { label: string; className: string }> = {
  APPLIED: { label: "Aplicado", className: "bg-green-100 text-green-700 border-green-300" },
  PARTIAL: { label: "Parcial", className: "bg-amber-100 text-amber-700 border-amber-300" },
  REVERSED: { label: "Reversado", className: "bg-red-100 text-red-700 border-red-300" },
  VOIDED: { label: "Anulado", className: "bg-gray-100 text-gray-700 border-gray-300" },
};

export default function PaymentStatusBadge({ status }: Props) {
  const normalizedStatus = (status?.toString() || "").toUpperCase() as CompletedPaymentStatus;
  const config = statusMap[normalizedStatus] || { label: status, className: "bg-gray-100 text-gray-500" };
  return <Badge className={config.className}>{config.label}</Badge>;
}
