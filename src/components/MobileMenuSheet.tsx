import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import SidebarNav from "./SidebarNav";
import { useTheme } from "@/hooks/useTheme";

export function MobileMenuSheet() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { isDark, toggle } = useTheme();
  
  // No necesitamos el Account Dialog logica completa aqui, 
  // pero mockeamos el handleOpenAccount si se necesita.
  const handleOpenAccount = () => {
    setMobileMenuOpen(false);
    // Para no duplicar el Dialog de Mi Cuenta, asumiremos que BottomNav 
    // sigue presente en AppLayout y tiene su boton...
    // Idealmente pasariamos esto como prop, pero por ahora solo cerramos.
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 text-foreground md:hidden rounded-full hover:bg-muted mr-1 h-10 w-10">
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[248px] p-0 flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border border-r">
        <SheetTitle className="sr-only">Menu principal</SheetTitle>
        <SidebarNav 
          isDark={isDark} 
          onToggleTheme={toggle} 
          onOpenAccount={handleOpenAccount} 
          className="flex h-full w-full border-none md:flex" 
        />
      </SheetContent>
    </Sheet>
  );
}
