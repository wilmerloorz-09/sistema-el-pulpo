import type { TrayItemType } from "@/hooks/useTrayOrder";
import { cn } from "@/lib/utils";

const CONFIG: Record<TrayItemType, { label: string; className: string }> = {
  A: {
    label: "Sin envase",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  B: {
    label: "Con envase",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  C: {
    label: "A granel",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

export function TrayItemChip({ type, size = "sm" }: { type: TrayItemType; size?: "xs" | "sm" }) {
  const config = CONFIG[type];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-semibold",
        size === "xs" ? "text-[10px]" : "text-xs",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
