import type { CompletedPaymentStatus } from "@/hooks/useCaja";

interface Props {
  status: CompletedPaymentStatus;
}

const statusMap: Record<CompletedPaymentStatus, { label: string; className: string }> = {
  APPLIED: { label: "Pagado", className: "bg-green-600 text-white" },
  PARTIAL: { label: "Parcial", className: "bg-amber-500 text-white" },
  REVERSED: { label: "Reversado", className: "bg-orange-500 text-white" },
  VOIDED: { label: "Anulado", className: "bg-red-600 text-white" },
};

export default function PaymentStatusBadge({ status }: Props) {
  const normalizedStatus = (status?.toString() || "").toUpperCase() as CompletedPaymentStatus;
  const config = statusMap[normalizedStatus] || { label: status, className: "bg-gray-500 text-white" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
