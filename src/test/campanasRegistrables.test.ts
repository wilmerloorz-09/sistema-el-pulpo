import { describe, expect, it } from "vitest";
import {
  campanaTieneOfertasRegistrables,
  ofertaDisponibleParaRegistro,
} from "@/lib/campanasValidacion";

describe("ofertaDisponibleParaRegistro", () => {
  const ahora = new Date("2026-07-09T18:00:00.000Z").getTime();

  it("rechaza ofertas cerradas o vencidas", () => {
    expect(
      ofertaDisponibleParaRegistro(
        { resultado: "GANADA", bloqueo_at: "2026-12-31T23:59:59.999Z", inicio_at: "2026-01-01T00:00:00.000Z" },
        ahora,
      ),
    ).toBe(false);

    expect(
      ofertaDisponibleParaRegistro(
        { resultado: "PENDIENTE", bloqueo_at: "2026-07-01T23:59:59.999Z", inicio_at: "2026-01-01T00:00:00.000Z" },
        ahora,
      ),
    ).toBe(false);
  });

  it("acepta ofertas pendientes dentro de vigencia", () => {
    expect(
      ofertaDisponibleParaRegistro(
        { resultado: "PENDIENTE", bloqueo_at: "2026-12-31T23:59:59.999Z", inicio_at: "2026-07-01T00:00:00.000Z" },
        ahora,
      ),
    ).toBe(true);
  });

  it("requiere campaña activa con al menos una oferta registrable", () => {
    expect(
      campanaTieneOfertasRegistrables(
        {
          activa: true,
          cartelera_ofertas: [
            {
              id_oferta: "o1",
              descripcion: "Final",
              bloqueo_at: "2026-07-01T23:59:59.999Z",
              cuota: 1,
              inicio_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        ahora,
      ),
    ).toBe(false);

    expect(
      campanaTieneOfertasRegistrables(
        {
          activa: true,
          cartelera_ofertas: [
            {
              id_oferta: "o2",
              descripcion: "Siguiente partido",
              bloqueo_at: "2026-12-31T23:59:59.999Z",
              cuota: 1,
              inicio_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
        ahora,
      ),
    ).toBe(true);
  });
});
