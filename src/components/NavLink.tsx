import { NavLink as RouterNavLink, NavLinkProps, useLocation } from "react-router-dom";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
  forceActive?: boolean;
  suppressActive?: boolean;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, forceActive = false, suppressActive = false, to, ...props }, ref) => {
    const location = useLocation();

    return (
      <RouterNavLink
        ref={ref}
        to={to}
        className={({ isActive, isPending }) =>
          cn(
            className,
            ((isActive && !suppressActive) || forceActive) && activeClassName,
            isPending && location.pathname !== String(to) && pendingClassName,
          )
        }
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
