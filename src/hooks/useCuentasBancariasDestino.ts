import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import type { CuentaBancariaDestino } from "@/lib/validacionComprobanteTransferencia";

export function useCuentasBancariasDestinoActivas(enabled = true) {
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["cuentas-bancarias-destino-activas", activeBranchId],
    queryFn: async () => {
      let query = supabase
        .from("cuentas_bancarias_destino" as never)
        .select(
          "id, banco_id, numero_cuenta, numero_cuenta_normalizado, tipo_cuenta, titular, identificacion_titular, alias, sucursal_id, activa",
        )
        .eq("activa", true)
        .order("alias", { ascending: true, nullsFirst: false });

      if (activeBranchId) {
        query = query.or(`sucursal_id.is.null,sucursal_id.eq.${activeBranchId}`);
      } else {
        query = query.is("sucursal_id", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CuentaBancariaDestino[];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
