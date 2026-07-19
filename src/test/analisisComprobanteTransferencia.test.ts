import { describe, expect, it } from "vitest";
import { buscarBancoDetectado } from "@/services/analisisComprobanteTransferencia";
import type { Banco } from "@/hooks/useBancosActivos";

const bancos: Banco[] = [
  { id: "pichincha", nombre: "Banco Pichincha", activo: true, orden_visual: 1, mascara_cuenta_destino: "XXXXXX####" },
  { id: "guayaquil", nombre: "Banco de Guayaquil", activo: true, orden_visual: 2, mascara_cuenta_destino: "##XXXXX##" },
];

describe("buscarBancoDetectado", () => {
  it("normaliza mayusculas, tildes y espacios", () => {
    expect(buscarBancoDetectado("BANCO PICHINCHA", bancos)?.id).toBe("pichincha");
    expect(buscarBancoDetectado("Banco de Guayaquil S.A.", bancos)?.id).toBe("guayaquil");
  });

  it("no asigna un banco cuando la IA no devuelve coincidencia", () => {
    expect(buscarBancoDetectado("Banco desconocido", bancos)).toBeNull();
    expect(buscarBancoDetectado(null, bancos)).toBeNull();
  });
});
