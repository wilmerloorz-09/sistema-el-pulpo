import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MetricTone = "sky" | "violet" | "emerald" | "amber" | "rose" | "slate";

const toneStyles: Record<
  MetricTone,
  {
    container: string;
    title: string;
    value: string;
    description: string;
    iconWrap: string;
    icon: string;
    badge: string;
    orb: string;
  }
> = {
  sky: {
    container: "border-sky-300 bg-gradient-to-br from-sky-100 via-white to-sky-200 shadow-sky-200/70",
    title: "text-sky-800",
    value: "text-sky-950",
    description: "text-sky-800/80",
    iconWrap: "border-sky-300 bg-white/90",
    icon: "text-sky-700",
    badge: "bg-sky-100 text-sky-700",
    orb: "bg-sky-300/30",
  },
  violet: {
    container: "border-violet-300 bg-gradient-to-br from-violet-100 via-white to-fuchsia-100 shadow-violet-200/70",
    title: "text-violet-800",
    value: "text-violet-950",
    description: "text-violet-800/80",
    iconWrap: "border-violet-300 bg-white/90",
    icon: "text-violet-700",
    badge: "bg-violet-100 text-violet-700",
    orb: "bg-violet-300/25",
  },
  emerald: {
    container: "border-emerald-300 bg-gradient-to-br from-emerald-100 via-white to-lime-100 shadow-emerald-200/70",
    title: "text-emerald-800",
    value: "text-emerald-950",
    description: "text-emerald-800/80",
    iconWrap: "border-emerald-300 bg-white/90",
    icon: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
    orb: "bg-emerald-300/25",
  },
  amber: {
    container: "border-amber-300 bg-gradient-to-br from-amber-100 via-white to-orange-100 shadow-amber-200/70",
    title: "text-amber-800",
    value: "text-amber-950",
    description: "text-amber-800/80",
    iconWrap: "border-amber-300 bg-white/90",
    icon: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
    orb: "bg-amber-300/25",
  },
  rose: {
    container: "border-rose-300 bg-gradient-to-br from-rose-100 via-white to-pink-100 shadow-rose-200/70",
    title: "text-rose-800",
    value: "text-rose-950",
    description: "text-rose-800/80",
    iconWrap: "border-rose-300 bg-white/90",
    icon: "text-rose-700",
    badge: "bg-rose-100 text-rose-700",
    orb: "bg-rose-300/25",
  },
  slate: {
    container: "border-slate-300 bg-gradient-to-br from-slate-100 via-white to-slate-200 shadow-slate-200/70",
    title: "text-slate-800",
    value: "text-slate-950",
    description: "text-slate-700/80",
    iconWrap: "border-slate-300 bg-white/90",
    icon: "text-slate-700",
    badge: "bg-slate-200 text-slate-700",
    orb: "bg-slate-300/25",
  },
};

interface MetricCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  badge?: string;
  className?: string;
}

export function MetricCard({
  title,
  value,
  description,
  icon,
  tone = "slate",
  badge,
  className,
}: MetricCardProps) {
  const style = toneStyles[tone];

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border px-4 py-3 shadow-md", style.container, className)}>
      <div className={cn("pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full", style.orb)} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("text-[10px] font-bold uppercase tracking-[0.22em]", style.title)}>{title}</p>
            {badge ? (
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", style.badge)}>{badge}</span>
            ) : null}
          </div>
          <p className={cn("mt-1 font-display text-2xl font-black", style.value)}>{value}</p>
          {description ? <p className={cn("mt-1 text-[11px] font-medium", style.description)}>{description}</p> : null}
        </div>

        {icon ? (
          <div className={cn("rounded-2xl border p-2.5 shadow-sm", style.iconWrap, style.icon)}>
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  );
}
