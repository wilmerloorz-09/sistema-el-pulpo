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
    if (touchStartX !== null) {
      const touchEndX = e.changedTouches[0].screenX;
      if (touchStartX - touchEndX > 50) { // Si se desliza a la izquierda más de 50px
        setMobileMenuOpen(false);
      }
    }
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
        className="w-[248px] p-0 flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border border-r"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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
