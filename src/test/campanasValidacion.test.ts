import { describe, expect, it } from "vitest";
import {
  campanaFormularioEsValido,
  validarCampanaDatosBasicos,
  validarCampanaFormulario,
} from "@/lib/campanasValidacion";
import { CAMPANA_FORMULARIO_VACIO } from "@/types/campanaPromocional";
import { nuevaOfertaCartelera } from "@/lib/campanasValidacion";

describe("campanasValidacion", () => {
  it("valida datos básicos sin exigir cartelera", () => {
    const errores = validarCampanaDatosBasicos({
      titulo: "Promo verano",
      consumo_minimo: "10",
      porcentaje_descuento: "5",
      descuento_maximo: "20",
      dias_vigencia_descuento: "7",
    });
    expect(campanaFormularioEsValido(errores)).toBe(true);
  });

  it("rechaza campaña sin ofertas", () => {
    const errores = validarCampanaFormulario({
      ...CAMPANA_FORMULARIO_VACIO,
      titulo: "Promo verano",
      consumo_minimo: "10",
      porcentaje_descuento: "5",
      descuento_maximo: "20",
      dias_vigencia_descuento: "7",
    });
    expect(errores.cartelera).toBeTruthy();
    expect(campanaFormularioEsValido(errores)).toBe(false);
  });

  it("acepta campaña con cartelera válida", () => {
    const oferta = nuevaOfertaCartelera();
    oferta.descripcion = "Oferta A";
    oferta.bloqueo_at = new Date(Date.now() + 86400000).toISOString();
    oferta.cuota = 1.5;
    const errores = validarCampanaFormulario({
      ...CAMPANA_FORMULARIO_VACIO,
      titulo: "Promo verano",
      consumo_minimo: "10",
      porcentaje_descuento: "5",
      descuento_maximo: "20",
      dias_vigencia_descuento: "7",
      cartelera_ofertas: [oferta],
    });
    expect(campanaFormularioEsValido(errores)).toBe(true);
  });
});
