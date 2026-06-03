import { useCallback, useEffect, useMemo, useState } from "react";
import type { PayableOrderCliente } from "@/hooks/useCaja";
import { useClientes } from "@/hooks/useClientes";
import type { Cliente } from "@/types/cliente";
import { nombreCompletoCliente } from "@/lib/clientesValidacion";
import type { ClienteInsertPayload } from "@/services/clientesDb";

/** Orden con cliente opcional (cobro, promociones, etc.). */
export type OrdenClienteVinculable = {
  id: string;
  cliente?: PayableOrderCliente | null;
};

export function usePaymentClienteSelection(order: OrdenClienteVinculable | null, open: boolean) {
  const { clientes, crearCliente, nuevoIdCliente, isGuardando } = useClientes();
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [idNuevoCliente, setIdNuevoCliente] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedCliente(null);
      setBusqueda("");
      setMostrarAlta(false);
      setIdNuevoCliente(null);
      return;
    }
    setSelectedCliente(order?.cliente ?? null);
    setBusqueda("");
    setMostrarAlta(false);
    setIdNuevoCliente(null);
  }, [open, order?.id, order?.cliente]);

  const clientesFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    const lista = !termino
      ? clientes
      : clientes.filter((c) => {
          const nombre = nombreCompletoCliente(c).toLowerCase();
          return (
            c.cedula.includes(termino)
            || nombre.includes(termino)
            || (c.correo ?? "").toLowerCase().includes(termino)
          );
        });
    return lista.slice(0, 8);
  }, [busqueda, clientes]);

  const seleccionarCliente = useCallback((cliente: Cliente) => {
    setSelectedCliente(cliente);
    setBusqueda("");
  }, []);

  const quitarCliente = useCallback(() => {
    setSelectedCliente(null);
    setBusqueda("");
  }, []);

  const abrirNuevoCliente = useCallback(() => {
    setIdNuevoCliente(nuevoIdCliente());
    setMostrarAlta(true);
  }, [nuevoIdCliente]);

  const cerrarNuevoCliente = useCallback(() => {
    if (isGuardando) return;
    setMostrarAlta(false);
    setIdNuevoCliente(null);
  }, [isGuardando]);

  const guardarNuevoCliente = useCallback(
    async (payload: { modo: "crear" | "editar"; id: string; datos: ClienteInsertPayload }) => {
      const creado = await crearCliente(payload.datos);
      setSelectedCliente(creado);
      setMostrarAlta(false);
      setIdNuevoCliente(null);
      setBusqueda("");
    },
    [crearCliente],
  );

  return {
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
    isGuardandoCliente: isGuardando,
  };
}
