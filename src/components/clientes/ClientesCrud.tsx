import { useCallback, useMemo, useState } from "react";
import { Loader2, Mail, MapPin, Phone, Plus, Search, Trash2, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { canOperate } from "@/lib/permissions";
import { useBranch } from "@/contexts/BranchContext";
import { useClientes, type Cliente } from "@/hooks/useClientes";
import ClienteFormulario from "@/components/clientes/ClienteFormulario";
import { nombreCompletoCliente } from "@/lib/clientesValidacion";
import { etiquetaSexoCliente } from "@/types/cliente";
import type { ClienteInsertPayload, ClienteUpdatePayload } from "@/services/clientesDb";

type FiltroContacto = "todos" | "con_correo" | "sin_correo" | "con_direccion";

const ClientesCrud = () => {
  const { user } = useAuth();
  const { permissions } = useBranch();
  const shiftGateQuery = useBranchShiftGate();

  const [busqueda, setBusqueda] = useState("");
  const [filtroContacto, setFiltroContacto] = useState<FiltroContacto>("todos");
  const [mostrarFormularioAlta, setMostrarFormularioAlta] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<Cliente | null>(null);
  const [idNuevoCliente, setIdNuevoCliente] = useState<string | null>(null);
  const [clienteAEliminar, setClienteAEliminar] = useState<Cliente | null>(null);

  const puedeOperar =
    canOperate(permissions, "mesas")
    && Boolean(shiftGateQuery.data?.shiftOpen)
    && Boolean(shiftGateQuery.data?.canServeTables);

  const {
    clientes,
    isLoading,
    crearCliente,
    actualizarCliente,
    eliminarCliente,
    isGuardando,
    isEliminando,
    nuevoIdCliente,
    refetch,
  } = useClientes();

  const totalClientes = clientes.length;
  const conCorreo = clientes.filter((c) => Boolean(c.correo?.trim())).length;
  const conDireccion = clientes.filter((c) => Boolean(c.direccion?.trim())).length;
  const sinCorreo = totalClientes - conCorreo;

  const clientesFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return clientes.filter((c) => {
      const nombre = nombreCompletoCliente(c).toLowerCase();
      const coincideBusqueda =
        !termino
        || c.cedula.includes(termino)
        || nombre.includes(termino)
        || (c.correo ?? "").toLowerCase().includes(termino)
        || c.celular.includes(termino)
        || (c.direccion ?? "").toLowerCase().includes(termino);

      const coincideContacto =
        filtroContacto === "todos"
        || (filtroContacto === "con_correo" && Boolean(c.correo?.trim()))
        || (filtroContacto === "sin_correo" && !c.correo?.trim())
        || (filtroContacto === "con_direccion" && Boolean(c.direccion?.trim()));

      return coincideBusqueda && coincideContacto;
    });
  }, [busqueda, clientes, filtroContacto]);

  const abrirCrear = useCallback(() => {
    if (!puedeOperar) return;
    setClienteEditando(null);
    setIdNuevoCliente(nuevoIdCliente());
    setMostrarFormularioAlta(true);
  }, [puedeOperar, nuevoIdCliente]);

  const cerrarFormularioAlta = useCallback(() => {
    if (isGuardando) return;
    setMostrarFormularioAlta(false);
    setIdNuevoCliente(null);
  }, [isGuardando]);

  const cerrarFormularioEdicion = useCallback(() => {
    if (isGuardando) return;
    setClienteEditando(null);
  }, [isGuardando]);

  const handleGuardar = useCallback(
    async (payload: {
      modo: "crear" | "editar";
      id: string;
      datos: ClienteInsertPayload | ClienteUpdatePayload;
    }) => {
      if (payload.modo === "crear") {
        await crearCliente(payload.datos as ClienteInsertPayload);
        setMostrarFormularioAlta(false);
        setIdNuevoCliente(null);
      } else {
        await actualizarCliente({
          id: payload.id,
          payload: payload.datos as ClienteUpdatePayload,
        });
        setClienteEditando(null);
      }
    },
    [actualizarCliente, crearCliente],
  );

  const confirmarEliminar = useCallback(async () => {
    if (!clienteAEliminar || isEliminando) return;
    await eliminarCliente(clienteAEliminar.id);
    setClienteAEliminar(null);
    if (clienteEditando?.id === clienteAEliminar.id) {
      setClienteEditando(null);
    }
  }, [clienteAEliminar, clienteEditando?.id, eliminarCliente, isEliminando]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-slate-900">{totalClientes}</span>
            <Users className="mb-1 h-4 w-4 text-slate-400" />
          </div>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Con correo</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-sky-700">{conCorreo}</span>
            <Mail className="mb-1 h-4 w-4 text-sky-500" />
          </div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Sin correo</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-amber-700">{sinCorreo}</span>
            <UserRound className="mb-1 h-4 w-4 text-amber-500" />
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Con dirección</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-black text-emerald-700">{conDireccion}</span>
            <MapPin className="mb-1 h-4 w-4 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Filtros + Agregar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Buscar cédula, apellidos, celular..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-9 rounded-xl border-slate-200 pl-9 text-sm"
            />
          </div>
          <Select value={filtroContacto} onValueChange={(v) => setFiltroContacto(v as FiltroContacto)}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-slate-200 text-xs">
              <SelectValue placeholder="Contacto" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="con_correo">Con correo</SelectItem>
              <SelectItem value="sin_correo">Sin correo</SelectItem>
              <SelectItem value="con_direccion">Con dirección</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {puedeOperar ? (
          <Button
            size="sm"
            onClick={abrirCrear}
            className="h-9 gap-1.5 rounded-xl font-display text-xs"
            disabled={mostrarFormularioAlta}
          >
            <Plus className="h-4 w-4" />
            Agregar cliente
          </Button>
        ) : (
          <span className="rounded-full border border-border bg-white/85 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm">
            Solo consulta
          </span>
        )}
      </div>

      <ClienteFormulario
        abierto={mostrarFormularioAlta}
        modo="crear"
        idNuevoCliente={idNuevoCliente ?? undefined}
        creadoPorId={user?.id ?? null}
        guardando={isGuardando}
        onCerrar={cerrarFormularioAlta}
        onGuardar={handleGuardar}
      />

      {/* Tabla */}
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_15px_45px_-30px_rgba(15,23,42,0.25)]">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="hidden items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 sm:flex sm:px-6">
              <div className="w-10 shrink-0" />
              <div className="w-56 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:w-72">
                Cliente
              </div>
              <div className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Cédula / Sexo
              </div>
              <div className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Celular
              </div>
              <div className="min-w-[140px] flex-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Correo
              </div>
              <div className="w-36 shrink-0 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Acción
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {clientesFiltrados.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Users className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">Sin resultados</p>
                  <p className="text-xs">Ajusta los filtros o agrega un cliente</p>
                  {totalClientes === 0 && puedeOperar ? (
                    <Button type="button" variant="outline" size="sm" className="mt-4 rounded-xl" onClick={abrirCrear}>
                      <Plus className="mr-2 h-4 w-4" />
                      Agregar cliente
                    </Button>
                  ) : null}
                </div>
              ) : (
                clientesFiltrados.map((cliente, idx) => {
                  const nombre = nombreCompletoCliente(cliente);
                  const inicial = (cliente.nombres.charAt(0) || "?").toUpperCase();

                  return (
                    <div
                      key={cliente.id}
                      className={cn("transition-colors", idx % 2 === 0 ? "bg-white" : "bg-slate-50/40")}
                    >
                      <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                        <div className="flex w-10 shrink-0 items-center justify-center">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">
                            {inicial}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="flex w-56 shrink-0 min-w-0 flex-col justify-center rounded-lg text-left outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30 lg:w-72"
                          onClick={() => puedeOperar && setClienteEditando(cliente)}
                          disabled={!puedeOperar}
                          title={puedeOperar ? "Editar cliente" : nombre}
                        >
                          <p className="truncate text-sm font-semibold text-slate-900">{nombre}</p>
                          {cliente.direccion ? (
                            <p className="truncate text-[11px] text-muted-foreground">{cliente.direccion}</p>
                          ) : (
                            <p className="text-[11px] italic text-muted-foreground">Sin dirección</p>
                          )}
                        </button>

                        <div className="hidden w-36 shrink-0 sm:block">
                          <p className="font-mono text-xs font-semibold text-slate-700">{cliente.cedula}</p>
                          <p className="text-[10px] text-muted-foreground">{etiquetaSexoCliente(cliente.sexo)}</p>
                        </div>

                        <div className="hidden w-28 shrink-0 items-center gap-1 text-xs text-slate-600 sm:flex">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          {cliente.celular}
                        </div>

                        <div className="hidden min-w-[140px] flex-1 truncate text-xs text-slate-600 sm:block">
                          {cliente.correo ?? <span className="italic text-slate-400">—</span>}
                        </div>

                        <div className="flex w-36 shrink-0 items-center justify-end gap-1">
                          {puedeOperar ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                onClick={() => setClienteEditando(cliente)}
                              >
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-slate-400 hover:text-destructive"
                                title="Eliminar cliente"
                                onClick={() => setClienteAEliminar(cliente)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-400">Solo lectura</span>
                          )}
                        </div>
                      </div>

                      {/* Móvil: datos extra bajo la fila */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-5 pb-3 text-xs text-slate-600 sm:hidden">
                        <span className="font-mono font-semibold">{cliente.cedula}</span>
                        <span className="text-muted-foreground">{etiquetaSexoCliente(cliente.sexo)}</span>
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {cliente.celular}
                        </span>
                        {cliente.correo ? <span className="truncate">{cliente.correo}</span> : null}
                      </div>

                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <ClienteFormulario
        abierto={Boolean(clienteEditando)}
        modo="editar"
        clienteInicial={clienteEditando}
        guardando={isGuardando}
        onCerrar={cerrarFormularioEdicion}
        onGuardar={handleGuardar}
      />

      <AlertDialog
        open={Boolean(clienteAEliminar)}
        onOpenChange={(open) => !open && !isEliminando && setClienteAEliminar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              {clienteAEliminar
                ? `Se eliminará a ${nombreCompletoCliente(clienteAEliminar)} (cédula ${clienteAEliminar.cedula}). Esta acción no se puede deshacer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEliminando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isEliminando}
              onClick={(e) => {
                e.preventDefault();
                void confirmarEliminar();
              }}
            >
              {isEliminando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClientesCrud;
