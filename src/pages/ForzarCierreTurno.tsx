import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, PowerOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type OpenShiftRow = {
  id: string;
  opened_at: string;
  shift_number: number | null;
  shift_code: string | null;
  caja_status: string | null;
  status: string;
};

type ForceCloseResult = {
  drafts_deleted: number;
  paid_closed: number;
  ops_closed: number;
  openings_closed: number;
};

const CONFIRM_WORD = "FORZAR";

const ForzarCierreTurno = () => {
  const { activeBranch, activeBranchId } = useBranch();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const shiftQuery = useQuery({
    queryKey: ["force-close-current-shift", activeBranchId],
    enabled: Boolean(activeBranchId),
    queryFn: async (): Promise<OpenShiftRow | null> => {
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id, opened_at, shift_number, shift_code, caja_status, status")
        .eq("branch_id", activeBranchId!)
        .eq("status", "OPEN")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as OpenShiftRow | null) ?? null;
    },
    staleTime: 10_000,
  });

  const openShift = shiftQuery.data ?? null;

  const openedAtLabel = useMemo(() => {
    if (!openShift?.opened_at) return null;
    try {
      return new Date(openShift.opened_at).toLocaleString("es-EC", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return openShift.opened_at;
    }
  }, [openShift?.opened_at]);

  const forceCloseMutation = useMutation({
    mutationFn: async (): Promise<ForceCloseResult> => {
      if (!activeBranchId || !openShift?.id) {
        throw new Error("No hay turno abierto para forzar el cierre.");
      }

      const { data, error } = await supabase.rpc("force_close_cash_shift" as any, {
        p_shift_id: openShift.id,
        p_branch_id: activeBranchId,
        p_notes: "Cierre forzado desde Administracion",
      } as any);

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        drafts_deleted: Number(row?.drafts_deleted ?? 0),
        paid_closed: Number(row?.paid_closed ?? 0),
        ops_closed: Number(row?.ops_closed ?? 0),
        openings_closed: Number(row?.openings_closed ?? 0),
      };
    },
    onSuccess: async (result) => {
      setConfirmOpen(false);
      setConfirmText("");
      toast.success(
        `Turno forzado cerrado. Borradores: ${result.drafts_deleted}, operativas→PAID: ${result.ops_closed}, cajas: ${result.openings_closed}.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["force-close-current-shift"] }),
        qc.invalidateQueries({ queryKey: ["shift-admin-current-shift"] }),
        qc.invalidateQueries({ queryKey: ["branch-shift-gate"] }),
        qc.invalidateQueries({ queryKey: ["tables-with-status"], exact: false }),
        qc.invalidateQueries({ queryKey: ["current-shift"] }),
        qc.invalidateQueries({ queryKey: ["open-cash-shift"], exact: false }),
        qc.invalidateQueries({ queryKey: ["open-cash-shift-id"], exact: false }),
      ]);
    },
    onError: (err: any) => {
      toast.error(err?.message || "No se pudo forzar el cierre del turno.");
    },
  });

  const canConfirm =
    confirmText.trim().toUpperCase() === CONFIRM_WORD && !forceCloseMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-2.5 sm:p-4">
      <div className="rounded-[28px] border border-red-200/80 bg-gradient-to-br from-red-50 via-white to-orange-50 p-5 shadow-[0_22px_55px_-42px_rgba(239,68,68,0.45)] sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-700">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="font-display text-xl font-black text-red-950 sm:text-2xl">
              Forzar cierre de turno
            </h1>
            <p className="text-sm text-red-900/80">
              Cierra el turno abierto de la sucursal activa aunque haya caja abierta u ordenes
              pendientes. Usa esta opcion solo en emergencias.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-red-100 bg-white/80 p-4 text-sm">
          <div className="font-semibold text-foreground">
            Sucursal: {activeBranch?.name ?? "—"}
          </div>
          {shiftQuery.isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando turno abierto...
            </div>
          ) : shiftQuery.isError ? (
            <p className="mt-3 text-destructive">
              {(shiftQuery.error as Error)?.message || "No se pudo consultar el turno."}
            </p>
          ) : !openShift ? (
            <p className="mt-3 text-muted-foreground">
              No hay turno OPEN en esta sucursal. Nada que forzar.
            </p>
          ) : (
            <div className="mt-3 space-y-1 text-muted-foreground">
              <p>
                Turno:{" "}
                <span className="font-semibold text-foreground">
                  {openShift.shift_code || openShift.shift_number || openShift.id.slice(0, 8)}
                </span>
              </p>
              <p>
                Abierto:{" "}
                <span className="font-semibold text-foreground">{openedAtLabel ?? "—"}</span>
              </p>
              <p>
                Estado caja:{" "}
                <span className="font-semibold text-foreground">
                  {openShift.caja_status || "—"}
                </span>
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-3 text-xs text-amber-950 sm:text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Al forzar: se eliminan borradores, se cierran ordenes operativas como pagadas, se
            cierran cajas abiertas del turno, se cierra el turno y se desactivan las mesas.
          </div>
        </div>

        <div className="mt-5">
          <Button
            type="button"
            variant="destructive"
            className="h-12 w-full gap-2 rounded-2xl font-semibold"
            disabled={!openShift || forceCloseMutation.isPending || shiftQuery.isLoading}
            onClick={() => {
              setConfirmText("");
              setConfirmOpen(true);
            }}
          >
            {forceCloseMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <PowerOff className="h-5 w-5" />
            )}
            Forzar cierre de turno
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (forceCloseMutation.isPending) return;
          setConfirmOpen(open);
          if (!open) setConfirmText("");
        }}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar cierre forzado</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left">
              <span className="block">
                Esta accion no se puede deshacer. Escribe{" "}
                <span className="font-bold text-foreground">{CONFIRM_WORD}</span> para continuar.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="force-close-confirm">Confirmacion</Label>
            <Input
              id="force-close-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              className="rounded-xl"
              disabled={forceCloseMutation.isPending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={forceCloseMutation.isPending}
              className="rounded-xl"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canConfirm}
              className="rounded-xl bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                if (!canConfirm) return;
                forceCloseMutation.mutate();
              }}
            >
              {forceCloseMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirmar cierre forzado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ForzarCierreTurno;
