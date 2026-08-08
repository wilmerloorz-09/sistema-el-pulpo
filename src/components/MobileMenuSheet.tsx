import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import SidebarNav from "./SidebarNav";
import { useTheme } from "@/hooks/useTheme";

interface MobileMenuSheetProps {
  onOpenAccount: () => void;
}

export function MobileMenuSheet({ onOpenAccount }: MobileMenuSheetProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const location = useLocation();
  const { isDark, toggle } = useTheme();
  
  const handleOpenAccount = () => {
    setMobileMenuOpen(false);
    onOpenAccount();
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.changedTouches[0].screenX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // No cerrar por swipe si el usuario está eligiendo sucursal en el Select portaleado.
    if (document.querySelector("[data-radix-select-content][data-state='open']")) {
      setTouchStartX(null);
      return;
    }

    if (touchStartX !== null) {
      const touchEndX = e.changedTouches[0].screenX;
      if (touchStartX - touchEndX > 50) {
        setMobileMenuOpen(false);
      }
    }
    setTouchStartX(null);
  };

  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 text-foreground md:hidden rounded-full hover:bg-muted mr-1 h-10 w-10">
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent 
        side="left" 
        className="z-[60] w-[248px] p-0 flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border border-r"
        overlayClassName="z-[60]"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onInteractOutside={(event) => {
          // El Select de sucursal se porta a body; no cerrar el sheet al usarlo.
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-radix-select-content], [data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-radix-select-content], [data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
        onFocusOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-radix-select-content], [data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
      >
        <SheetTitle className="sr-only">Menu principal</SheetTitle>
        <SidebarNav 
          isDark={isDark} 
          onToggleTheme={toggle} 
          onOpenAccount={handleOpenAccount} 
          onClose={() => setMobileMenuOpen(false)}
          className="flex h-full w-full border-none md:flex" 
        />
      </SheetContent>
    </Sheet>
  );
}
