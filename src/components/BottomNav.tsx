import { UserRound, CreditCard, History, Camera } from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import ThemeToggle from "@/components/nav/ThemeToggle";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BottomNavProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenAccount: () => void;
}

function getInitials(name?: string | null) {
  const clean = String(name ?? "").trim();
  if (!clean) return null;

  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

const BottomNav = ({ isDark, onToggleTheme, onOpenAccount }: BottomNavProps) => {
  const { visibleItems } = useVisibleNavItems();
  const { profile } = useAuth();
  const initials = getInitials(profile?.full_name);
  const accountLabel = profile?.full_name || profile?.username || "Cuenta";
  const location = useLocation();
  const fromMesas = location.pathname === "/ordenes" && new URLSearchParams(location.search).get("from") === "mesas";

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 overflow-hidden border-t border-orange-200/80 bg-white shadow-[0_-18px_35px_-28px_rgba(15,23,42,0.4)] safe-bottom dark:border-border dark:bg-card md:hidden">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-2 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleItems.map((item) => {
          const isCaja = item.to === "/caja";

          if (isCaja) {
            const isCajaActive = location.pathname.startsWith("/caja");
            return (
              <DropdownMenu key="caja-menu">
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "group flex min-w-[4.65rem] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-[18px] border border-transparent px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-all outline-none",
                      isCajaActive ? item.tone.active : item.tone.idle,
                      isCajaActive && "border-white/20 bg-gradient-to-b text-white shadow-[0_16px_34px_-24px_rgba(249,115,22,0.92)] [&>span:first-child]:bg-white/15 [&>span:first-child]:text-white"
                    )}
                  >
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl transition-transform group-hover:scale-105", isCajaActive ? "" : item.tone.iconIdle)}>
                      {item.icon}
                    </span>
                    <span className="max-w-[4.5rem] truncate text-center leading-none">{item.label}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" sideOffset={16} className="w-52 z-[100] rounded-[20px] p-2 mb-2 bg-white/95 backdrop-blur-md shadow-xl border-orange-200 dark:bg-card/95 dark:border-border">
                  <DropdownMenuItem asChild className="p-0 mb-1 rounded-xl focus:bg-orange-50 focus:text-orange-950 dark:focus:bg-primary/20">
                    <Link to="/caja?tab=pending" className="flex items-center gap-3 w-full p-2.5 font-semibold cursor-pointer">
                      <div className="flex bg-orange-100 text-orange-600 p-2 rounded-[12px] dark:bg-primary/20 dark:text-primary shadow-sm"><CreditCard className="h-4 w-4" /></div>
                      <span className="text-sm">Por cobrar</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="p-0 mb-1 rounded-xl focus:bg-violet-50 focus:text-violet-950 dark:focus:bg-violet-500/20">
                    <Link to="/caja?tab=completed" className="flex items-center gap-3 w-full p-2.5 font-semibold cursor-pointer">
                      <div className="flex bg-violet-100 text-violet-600 p-2 rounded-[12px] dark:bg-violet-500/20 dark:text-violet-400 shadow-sm"><History className="h-4 w-4" /></div>
                      <span className="text-sm">Pagos del turno</span>
                    </Link>
                  </DropdownMenuItem>

                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              forceActive={
                (item.to === "/mesas" && (location.pathname === "/mesas" || fromMesas))
                || (item.to === "/ordenes" && location.pathname === "/ordenes" && !fromMesas)
              }
              suppressActive={item.to === "/ordenes" && fromMesas}
              className={cn(
                "group flex min-w-[4.65rem] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-[18px] border border-transparent px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-all",
                item.tone.idle,
              )}
              activeClassName={cn(
                "border-white/20 bg-gradient-to-b text-white shadow-[0_16px_34px_-24px_rgba(249,115,22,0.92)] [&>span:first-child]:bg-white/15 [&>span:first-child]:text-white",
                item.tone.active,
              )}
            >
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl transition-transform group-hover:scale-105", item.tone.iconIdle)}>
                {item.icon}
              </span>
              <span className="max-w-[4.5rem] truncate text-center leading-none">{item.label}</span>
            </NavLink>
          );
        })}

        <ThemeToggle
          isDark={isDark}
          onToggle={onToggleTheme}
          label="Tema"
          className="group flex min-w-[4.65rem] shrink-0 flex-col items-center justify-center gap-1 rounded-[18px] border border-transparent px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-all hover:border-orange-200 hover:bg-orange-50/90 hover:text-primary dark:hover:border-border dark:hover:bg-muted"
          iconClassName="h-5 w-5"
        />

        <button
          type="button"
          onClick={onOpenAccount}
          className="group flex min-w-[4.65rem] shrink-0 flex-col items-center justify-center gap-1 rounded-[18px] border border-transparent px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-all hover:border-orange-200 hover:bg-orange-50/90 hover:text-primary dark:hover:border-border dark:hover:bg-muted"
          aria-label="Mi cuenta"
        >
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl bg-muted text-foreground transition-transform group-hover:scale-105">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.full_name}
                className="h-full w-full object-cover"
              />
            ) : initials? (
              <span className="text-xs font-black tracking-wide">{initials}</span>
            ) : (
              <UserRound className="h-5 w-5" />
            )}
          </span>
          <span className="max-w-[4.5rem] truncate text-center leading-none">{accountLabel}</span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNav;
