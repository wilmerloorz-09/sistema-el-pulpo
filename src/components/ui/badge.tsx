import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-gradient-to-r from-primary via-orange-500 to-orange-400 text-primary-foreground hover:brightness-[1.03]",
        secondary: "border-slate-200 bg-white/90 text-secondary-foreground hover:border-slate-300",
        destructive: "border-destructive/20 bg-gradient-to-r from-destructive via-red-500 to-rose-500 text-destructive-foreground hover:brightness-[1.03]",
        outline: "border-orange-200 bg-orange-50/90 text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
