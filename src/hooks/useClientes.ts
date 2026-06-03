import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actualizarCliente,
  crearCliente,
  eliminarCliente,
  listarClientes,
  nuevoIdCliente,
  type ClienteInsertPayload,
  type ClienteUpdatePayload,
} from "@/services/clientesDb";
import type { Cliente } from "@/types/cliente";
import { useAuth } from "@/contexts/AuthContext";

export const CLIENTES_QUERY_KEY = "clientes-catalogo";

function mensajeErrorCliente(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (msg.includes("uq_clientes_cedula") || msg.includes("clientes_cedula")) {
    return "Ya existe un cliente con esa cédula.";
  }
  if (msg.includes("clientes_cedula_formato_chk")) {
    return "La cédula debe tener 10 dígitos numéricos.";
  }
  if (msg.includes("clientes_celular_formato_chk")) {
    return "El celular debe tener 10 dígitos numéricos.";
  }
  if (msg.includes("clientes_sexo_chk")) {
    return "Seleccione un sexo válido (masculino o femenino).";
  }
  if (msg.includes("foreign key") || msg.includes("violates foreign key")) {
    return "No se puede eliminar: el cliente está vinculado a otros registros.";
  }
  if (msg.includes("usuario_en_turno_operativo_abierto") || msg.includes("row-level security")) {
    return "Debes tener un turno operativo abierto para gestionar clientes.";
  }
  return msg || "No se pudo completar la operación.";
}

/** Catálogo completo; el filtrado en pantalla es en cliente (mismo patrón que Usuarios). */
export function useClientes() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const catalogoQuery = useQuery({
    queryKey: [CLIENTES_QUERY_KEY],
    queryFn: () => listarClientes(),
    staleTime: 8_000,
    refetchOnWindowFocus: true,
  });

  const crearMutation = useMutation({
    mutationFn: async (payload: ClienteInsertPayload) => {
      if (!user?.id) throw new Error("Sesión no válida.");
      return crearCliente(payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CLIENTES_QUERY_KEY] });
      toast.success("Cliente registrado.");
    },
    onError: (error) => {
      toast.error(mensajeErrorCliente(error));
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: ClienteUpdatePayload }) =>
      actualizarCliente(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CLIENTES_QUERY_KEY] });
      toast.success("Cliente actualizado.");
    },
    onError: (error) => {
      toast.error(mensajeErrorCliente(error));
    },
  });

  const eliminarMutation = useMutation({
    mutationFn: async (id: string) => eliminarCliente(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CLIENTES_QUERY_KEY] });
      toast.success("Cliente eliminado.");
    },
    onError: (error) => {
      toast.error(mensajeErrorCliente(error));
    },
  });

  return {
    clientes: catalogoQuery.data ?? [],
    isLoading: catalogoQuery.isLoading,
    isFetching: catalogoQuery.isFetching,
    error: catalogoQuery.error,
    refetch: catalogoQuery.refetch,
    crearCliente: crearMutation.mutateAsync,
    actualizarCliente: actualizarMutation.mutateAsync,
    eliminarCliente: eliminarMutation.mutateAsync,
    isGuardando: crearMutation.isPending || actualizarMutation.isPending,
    isEliminando: eliminarMutation.isPending,
    nuevoIdCliente,
  };
}

export type { Cliente };
