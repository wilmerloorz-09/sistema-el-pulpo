import { Moon, SunMedium } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  isDark: boolean;
  onToggle: () => void;
  label?: string;
  className?: string;
  iconClassName?: string;
}

const ThemeToggle = ({ isDark, onToggle, label, className, iconClassName }: ThemeToggleProps) => {
  const title = isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  const Icon = isDark ? SunMedium : Moon;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={title}
      title={title}
      className={cn("inline-flex items-center justify-center transition-colors", className)}
    >
      <Icon className={cn("h-5 w-5", iconClassName)} />
      {label ? <span>{label}</span> : null}
    </button>
  );
};

export default ThemeToggle;
