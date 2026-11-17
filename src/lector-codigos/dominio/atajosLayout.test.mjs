import assert from "node:assert/strict";
import {
  esChifle,
  esJugo,
  FILA_MARCAS_COCA,
  FILA_MARCAS_PEPSI,
  FILA_OTRAS,
  marcasConStock,
  normalizarNombreProducto,
  productosDeMarca,
  productosFila1,
} from "./atajosLayout.ts";

assert.equal(esChifle("Chifle"), true);
assert.equal(esJugo("Jugo de Mora"), true);
assert.equal(esJugo("Club Verde 550 cm3"), true);
assert.equal(esJugo("Cola Naranja 1 Litro"), false);

const naranja = FILA_MARCAS_PEPSI.find((m) => m.id === "naranja");
assert.ok(naranja);
assert.equal(naranja.match(normalizarNombreProducto("Cola Naranja 300 ml")), true);
assert.equal(naranja.match(normalizarNombreProducto("Jugo de Naranja")), false);

const productos = [
  { id: "1", productId: "p1", nombre: "Chifle", precio: 0.25, stock: 10 },
  { id: "2", productId: "p2", nombre: "Jugo de Mora", precio: 0.5, stock: 3 },
  { id: "3", productId: "p3", nombre: "Jugo de Limón", precio: 0.5, stock: 0 },
  { id: "4", productId: "p4", nombre: "Coca Cola 1 Litro", precio: 1.25, stock: 5 },
  { id: "5", productId: "p5", nombre: "Agua 600 ml", precio: 0.5, stock: 0 },
  { id: "6", productId: "p6", nombre: "Fuze Tea Limón", precio: 1, stock: 2 },
  { id: "7", productId: "p7", nombre: "Del Valle Mango", precio: 1, stock: 0 },
];

assert.deepEqual(
  productosFila1(productos).map((p) => p.nombre),
  ["Chifle", "Jugo de Mora"],
);

const coca = FILA_MARCAS_COCA.find((m) => m.id === "coca-cola");
assert.deepEqual(
  productosDeMarca(productos, coca).map((p) => p.nombre),
  ["Coca Cola 1 Litro"],
);

assert.deepEqual(
  marcasConStock(FILA_OTRAS, productos).map((m) => m.id),
  ["fuze-tea"],
);

console.log("atajosLayout.test.mjs OK");
