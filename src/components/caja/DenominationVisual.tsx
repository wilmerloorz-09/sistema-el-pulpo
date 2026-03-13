import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface DenominationVisualProps {
  label: string;
  imageUrl?: string | null;
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
}

export default function DenominationVisual({
  label,
  imageUrl,
  className,
  imageClassName,
  iconClassName,
}: DenominationVisualProps) {
  const normalizedUrl = imageUrl?.trim() || "";

  return (
    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white", className)}>
      {normalizedUrl ? (
        <img src={normalizedUrl} alt={label} className={cn("h-full w-full object-contain bg-white", imageClassName)} />
      ) : (
        <Coins className={cn("h-5 w-5 text-muted-foreground", iconClassName)} />
      )}
    </div>
  );
}
