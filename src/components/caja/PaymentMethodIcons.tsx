import { Banknote, CreditCard, Landmark, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPaymentMethodVisualKind } from "@/lib/paymentMethods";

type Props = {
  methodNames: string[];
  className?: string;
  iconClassName?: string;
};

function MethodIcon({ name, className }: { name: string; className?: string }) {
  const kind = getPaymentMethodVisualKind(name);
  const Icon =
    kind === "cash"
      ? Banknote
      : kind === "transfer"
        ? Landmark
        : kind === "card"
          ? CreditCard
          : Wallet;

  const tone =
    kind === "cash"
      ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/40"
      : kind === "transfer"
        ? "bg-sky-500 text-white shadow-sm shadow-sky-500/40"
        : kind === "card"
          ? "bg-violet-500 text-white shadow-sm shadow-violet-500/40"
          : "bg-slate-500 text-white shadow-sm shadow-slate-500/30";

  return (
    <span
      title={name}
      aria-label={`Método de pago: ${name}`}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        tone,
        className,
      )}
    >
      <Icon className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.25} />
    </span>
  );
}

/** Iconos del/los metodos de pago (p. ej. al lado de la etiqueta Pagado). */
export default function PaymentMethodIcons({ methodNames, className, iconClassName }: Props) {
  const unique = Array.from(
    new Set(
      methodNames
        .map((name) => String(name ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (unique.length === 0) return null;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {unique.map((name) => (
        <MethodIcon key={name} name={name} className={iconClassName} />
      ))}
    </span>
  );
}
