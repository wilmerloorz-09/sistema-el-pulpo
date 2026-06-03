import { useQuery } from "@tanstack/react-query";
import { usuarioPuedeRegistrarPromociones } from "@/services/prediccionesClientesDb";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

export function usePromocionesGate() {
  const shiftGate = useBranchShiftGate();

  return useQuery({
    queryKey: ["promociones-gate", shiftGate.data?.shiftId, shiftGate.data?.userEnabled],
    queryFn: async () => {
      if (!shiftGate.data?.shiftOpen || !shiftGate.data?.userEnabled) {
        return { puedeRegistrar: false };
      }
      const puedeRegistrar = await usuarioPuedeRegistrarPromociones();
      return { puedeRegistrar };
    },
    enabled: Boolean(shiftGate.data?.shiftOpen),
    staleTime: 10_000,
  });
}
