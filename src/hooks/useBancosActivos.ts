import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "@/services/DatabaseService";

export interface Banco {
  id: string;
  nombre: string;
  activo: boolean;
  orden_visual: number;
}

export function useBancosActivos(enabled = true) {
  return useQuery({
    queryKey: ["bancos-activos"],
    queryFn: async () => {
      const rows = await dbSelect<Banco>("bancos", {
        select: "id, nombre, activo, orden_visual",
        filters: [{ column: "activo", op: "eq", value: true }],
        orderBy: { column: "orden_visual" },
      });
      return rows ?? [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
