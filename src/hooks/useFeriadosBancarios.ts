import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { fechaActualEcuador } from "@/lib/feriadosBancarios";

export interface FeriadoBancario {
  id: string;
  fecha: string;
  nombre: string;
  sucursal_id: string | null;
  activo: boolean;
  origen: "nacional" | "manual";
}

export function useFeriadosBancariosActivos(enabled = true) {
  const { activeBranchId } = useBranch();
  const year = Number(fechaActualEcuador().slice(0, 4));

  return useQuery({
    queryKey: ["feriados-bancarios-activos", activeBranchId ?? "_", year],
    queryFn: async () => {
      let query = (supabase as any)
        .from("feriados")
        .select("fecha")
        .eq("activo", true)
        .gte("fecha", `${year - 1}-01-01`)
        .lte("fecha", `${year + 1}-12-31`);

      if (activeBranchId) {
        query = query.or(`sucursal_id.is.null,sucursal_id.eq.${activeBranchId}`);
      } else {
        query = query.is("sucursal_id", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return Array.from(
        new Set(((data ?? []) as Array<{ fecha: string }>).map((row) => String(row.fecha).slice(0, 10))),
      );
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
