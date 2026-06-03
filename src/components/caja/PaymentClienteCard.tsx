import { Plus, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import ClienteFormulario from "@/components/clientes/ClienteFormulario";
import { nombreCompletoCliente } from "@/lib/clientesValidacion";
import {
  usePaymentClienteSelection,
  type OrdenClienteVinculable,
} from "@/hooks/usePaymentClienteSelection";
import { useAuth } from "@/contexts/AuthContext";
import type { ClienteInsertPayload } from "@/services/clientesDb";

interface PaymentClienteCardProps {
  order: OrdenClienteVinculable | null;
  readOnly?: boolean;
  compact?: boolean;
  /** Si true, muestra «Requerido» en lugar de «Opcional» (p. ej. promociones). */
  clienteRequerido?: boolean;
  className?: string;
  selection: ReturnType<typeof usePaymentClienteSelection>;
}

export default function PaymentClienteCard({
  order,
  readOnly = false,
  compact = false,
  clienteRequerido = false,
  className,
  selection,
}: PaymentClienteCardProps) {
  const { user } = useAuth();
  const {
    selectedCliente,
    busqueda,
    setBusqueda,
    clientesFiltrados,
    seleccionarCliente,
    quitarCliente,
    mostrarAlta,
    idNuevoCliente,
    abrirNuevoCliente,
    cerrarNuevoCliente,
    guardarNuevoCliente,
    isGuardandoCliente,
  } = selection;

  return (
    <>
      <div
        className={cn(
          "flex min-h-[100px] flex-col justify-between rounded-2xl border border-teal-200 bg-teal-50/70 px-3 py-3 shadow-sm sm:px-4",
          compact && "min-h-[88px] py-2.5",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <UserRound className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800 sm:text-[11px]">
                Cliente
              </p>
              <p className="text-[10px] text-teal-700/80 sm:text-xs">
                {clienteRequerido ? "Requerido" : "Opcional"}
              </p>
            </div>
          </div>
          {!readOnly && !selectedCliente ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 rounded-lg border-teal-300 bg-white/90 px-2 text-[10px] font-semibold text-teal-900 hover:bg-teal-100"
              onClick={abrirNuevoCliente}
            >
              <Plus className="h-3 w-3" />
              Nuevo
            </Button>
          ) : null}
        </div>

        {selectedCliente ? (
          <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-teal-200/80 bg-white/90 px-2.5 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {nombreCompletoCliente(selectedCliente)}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">{selectedCliente.cedula}</p>
            </div>
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-destructive"
                title="Quitar cliente"
                onClick={quitarCliente}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        ) : readOnly ? (
          <p className="mt-2 text-xs italic text-muted-foreground">Sin cliente asignado</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Cédula o nombre..."
              className="h-9 rounded-xl border-teal-200 bg-white text-sm"
              disabled={!order}
            />
            {busqueda.trim() && clientesFiltrados.length > 0 ? (
              <ul className="max-h-28 overflow-y-auto rounded-xl border border-teal-200/80 bg-white text-xs shadow-sm">
                {clientesFiltrados.map((cliente) => (
                  <li key={cliente.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start px-2.5 py-2 text-left hover:bg-teal-50"
                      onClick={() => seleccionarCliente(cliente)}
                    >
                      <span className="font-semibold text-slate-900">{nombreCompletoCliente(cliente)}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{cliente.cedula}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : busqueda.trim() ? (
              <p className="text-[10px] text-muted-foreground">Sin coincidencias. Usa «Nuevo» para registrar.</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">Busca en el catálogo o crea uno nuevo.</p>
            )}
          </div>
        )}
      </div>

      <ClienteFormulario
        abierto={mostrarAlta}
        modo="crear"
        idNuevoCliente={idNuevoCliente ?? undefined}
        creadoPorId={user?.id ?? null}
        guardando={isGuardandoCliente}
        onCerrar={cerrarNuevoCliente}
        onGuardar={async (payload) => {
          if (payload.modo !== "crear") return;
          await guardarNuevoCliente({
            modo: "crear",
            id: payload.id,
            datos: payload.datos as ClienteInsertPayload,
          });
        }}
      />
    </>
  );
}
