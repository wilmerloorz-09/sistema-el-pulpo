import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ClientWinningOffer = {
  prediccion_id: string;
  campana_id: string;
  porcentaje_descuento: number;
  descuento_maximo: number;
  consumo_minimo: number;
};

export function useClientWinningOffer(clienteId: string | null | undefined) {
  return useQuery({
    queryKey: ["client-winning-offer", clienteId],
    queryFn: async (): Promise<ClientWinningOffer | null> => {
      if (!clienteId) return null;

      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("predicciones_clientes")
        .select(`
          id,
          campana_id,
          campanas_promocionales!inner (
            porcentaje_descuento,
            descuento_maximo,
            consumo_minimo,
            activa
          )
        `)
        .eq("cliente_id", clienteId)
        .eq("estado_prediccion", "GANADA")
        .is("cupon_usado_el", null)
        .or(`fecha_caducidad_cupon.gte.${now},fecha_caducidad_cupon.is.null`)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching client winning offer:", error);
        return null;
      }

      if (!data) return null;

      const campana = Array.isArray(data.campanas_promocionales)
        ? data.campanas_promocionales[0]
        : data.campanas_promocionales;

      // @ts-ignore (campana could be an object from PostgREST)
      if (!campana || campana.activa === false) return null;

      return {
        prediccion_id: data.id,
        campana_id: data.campana_id,
        // @ts-ignore
        porcentaje_descuento: Number(campana.porcentaje_descuento || 0),
        // @ts-ignore
        descuento_maximo: Number(campana.descuento_maximo || 0),
        // @ts-ignore
        consumo_minimo: Number(campana.consumo_minimo || 0),
      };
    },
    enabled: Boolean(clienteId),
    staleTime: 10_000,
  });
}
