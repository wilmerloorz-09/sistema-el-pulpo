import test from "node:test";
import assert from "node:assert/strict";

function normalizarCodigo(codigo) {
  return String(codigo ?? "").trim().replace(/[\r\n\t]/g, "");
}

function esCodigoBarrasValido(codigo) {
  const c = normalizarCodigo(codigo);
  return c.length >= 4 && c.length <= 80;
}

function etiquetaTipoOrden(tipo) {
  const t = String(tipo ?? "").toUpperCase();
  if (t === "DINE_IN" || t === "TABLE" || t === "EXTRA") return "mesa";
  if (t === "TAKEOUT" || t === "EXPRESS") return "llevar";
  return "otro";
}

test("normaliza códigos HID con saltos", () => {
  assert.equal(normalizarCodigo("7861000100014\r\n"), "7861000100014");
});

test("valida longitud mínima de código", () => {
  assert.equal(esCodigoBarrasValido("12"), false);
  assert.equal(esCodigoBarrasValido("7861000100014"), true);
});

test("clasifica tipos de orden del POS", () => {
  assert.equal(etiquetaTipoOrden("DINE_IN"), "mesa");
  assert.equal(etiquetaTipoOrden("TAKEOUT"), "llevar");
});
