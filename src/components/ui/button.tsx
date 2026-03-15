import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.985]",
  {
    variants: {
      variant: {
        default: "border border-primary/70 bg-gradient-to-r from-primary via-orange-500 to-amber-400 text-primary-foreground shadow-[0_18px_36px_-22px_hsl(var(--primary)/0.95)] hover:-translate-y-0.5 hover:saturate-150 hover:brightness-105",
        destructive: "border border-destructive/60 bg-gradient-to-r from-destructive via-rose-500 to-pink-500 text-destructive-foreground shadow-[0_18px_36px_-22px_hsl(var(--destructive)/0.92)] hover:-translate-y-0.5 hover:brightness-105",
        outline: "border border-orange-200/90 bg-gradient-to-r from-white via-orange-50 to-amber-50 text-foreground shadow-[0_14px_28px_-24px_rgba(15,23,42,0.42)] backdrop-blur-sm hover:-translate-y-0.5 hover:border-orange-300 hover:from-orange-50 hover:to-amber-50",
        secondary: "border border-violet-200 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_16px_32px_-22px_rgba(139,92,246,0.82)] hover:-translate-y-0.5 hover:brightness-105",
        success: "border border-emerald-500/60 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 text-white shadow-[0_16px_32px_-22px_rgba(16,185,129,0.8)] hover:-translate-y-0.5 hover:brightness-105",
        info: "border border-sky-500/60 bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 text-white shadow-[0_16px_32px_-22px_rgba(14,165,233,0.8)] hover:-translate-y-0.5 hover:brightness-105",
        ghost: "text-foreground hover:bg-orange-100/90 hover:text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
