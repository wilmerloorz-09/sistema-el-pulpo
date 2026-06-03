import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Gift, Loader2, Plus, Trash2 } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useCampanasPromocionales } from "@/hooks/useCampanasPromocionales";
import CampanaCrearModal from "@/components/campanas/CampanaCrearModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ORIGEN_CAMPANAS = "campanas";

const Campanas = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isGlobalAdmin, permissions } = useBranch();
  const puedeGestionar = isGlobalAdmin || canManage(permissions, "admin_global");

  const { campanas, isLoading, crearCampana, eliminarCampana, isGuardando, isEliminando } =
    useCampanasPromocionales();

  const [modalCrear, setModalCrear] = useState(false);
  const [eliminarId, setEliminarId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname === "/campanas" && params.get("origin") !== ORIGEN_CAMPANAS) {
      params.set("origin", ORIGEN_CAMPANAS);
      navigate({ pathname: "/campanas", search: params.toString() }, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const campanasOrdenadas = useMemo(
    () => [...campanas].sort((a, b) => (a.creado_el < b.creado_el ? -1 : 1)),
    [campanas],
  );

  if (!puedeGestionar) {
    return (
      <div className="px-4 py-16 text-center text-sm text-destructive">
        Solo administradores generales pueden gestionar campañas.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="surface-glow mb-4 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-fuchsia-200 bg-white/90 text-fuchsia-600 shadow-sm">
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-black text-foreground sm:text-2xl">Campañas</h1>
            <p className="text-sm text-muted-foreground">
              {campanasOrdenadas.length} campaña{campanasOrdenadas.length !== 1 ? "s" : ""} · toca una tarjeta para
              gestionar ofertas
            </p>
          </div>
        </div>
      </div>

      <div className="px-2.5 sm:px-4">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {campanasOrdenadas.map((campana, index) => (
            <motion.button
              key={campana.id}
              type="button"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => navigate(`/campanas/${campana.id}?origin=${ORIGEN_CAMPANAS}`)}
              className="relative flex min-h-[142px] flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-fuchsia-300/50 bg-gradient-to-br from-fuchsia-50 via-white to-violet-100 p-3 text-center shadow-sm transition hover:border-fuchsia-400 sm:min-h-[188px] sm:rounded-[28px] sm:p-5"
            >
              <span className="absolute right-2 top-2 rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold uppercase text-fuchsia-800">
                {campana.activa ? "Activa" : "Inactiva"}
              </span>
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border-2 border-fuchsia-200 bg-gradient-to-br from-fuchsia-600 to-violet-500 text-white shadow-sm sm:h-16 sm:w-16">
                <Gift className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              <p className="line-clamp-2 px-1 text-sm font-bold text-fuchsia-950">{campana.titulo}</p>
              <p className="text-[10px] text-muted-foreground">
                {campana.cartelera_ofertas.length} oferta{campana.cartelera_ofertas.length !== 1 ? "s" : ""}
              </p>
              <button
                type="button"
                className="absolute bottom-2 right-2 rounded-full p-1.5 text-slate-400 hover:bg-destructive/10 hover:text-destructive"
                title="Eliminar campaña"
                onClick={(e) => {
                  e.stopPropagation();
                  setEliminarId(campana.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </motion.button>
          ))}

          <motion.button
            type="button"
            key="nueva-campana"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: campanasOrdenadas.length * 0.03 }}
            onClick={() => setModalCrear(true)}
            disabled={isGuardando}
            className={cn(
              "flex min-h-[142px] flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-fuchsia-300/60 bg-gradient-to-br from-fuchsia-50/80 via-white to-violet-50 p-3 transition hover:border-fuchsia-400 sm:min-h-[188px] sm:rounded-[28px] sm:p-5",
              isGuardando && "cursor-wait opacity-70",
            )}
          >
            {isGuardando ? (
              <Loader2 className="h-8 w-8 animate-spin text-fuchsia-600" />
            ) : (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border-2 border-fuchsia-200 bg-gradient-to-br from-fuchsia-600 to-violet-500 text-white sm:h-16 sm:w-16">
                  <Plus className="h-8 w-8" />
                </div>
                <span className="text-xs font-semibold text-fuchsia-800">Nueva campaña</span>
              </>
            )}
          </motion.button>
        </div>
      </div>

      <CampanaCrearModal
        abierto={modalCrear}
        guardando={isGuardando}
        onCerrar={() => !isGuardando && setModalCrear(false)}
        onGuardar={async (datos) => {
          await crearCampana(datos);
          setModalCrear(false);
        }}
      />

      <AlertDialog open={Boolean(eliminarId)} onOpenChange={(o) => !o && setEliminarId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar campaña?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán también sus ofertas configuradas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEliminando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={isEliminando}
              onClick={(e) => {
                e.preventDefault();
                if (eliminarId) void eliminarCampana(eliminarId).then(() => setEliminarId(null));
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Campanas;
