import assert from "node:assert/strict";
import { consolidarItemsLector, selectionsParaQuitar } from "./consolidarItems.ts";

const items = [
  {
    id: "a1",
    descripcion: "Chifle",
    cantidad: 1,
    precio: 0.25,
    total: 0.25,
    id_producto: "chifle",
    creado_en: "2026-11-14T10:00:00Z",
  },
  {
    id: "a2",
    descripcion: "Agua",
    cantidad: 1,
    precio: 0.5,
    total: 0.5,
    id_producto: "agua",
    creado_en: "2026-11-14T10:01:00Z",
  },
  {
    id: "a3",
    descripcion: "Chifle",
    cantidad: 1,
    precio: 0.25,
    total: 0.25,
    id_producto: "chifle",
    creado_en: "2026-11-14T10:02:00Z",
  },
  {
    id: "a4",
    descripcion: "Chifle",
    cantidad: 1,
    precio: 0.25,
    total: 0.25,
    id_producto: "chifle",
    creado_en: "2026-11-14T10:03:00Z",
  },
];

const consolidados = consolidarItemsLector(items);
assert.deepEqual(
  consolidados.map((c) => ({ producto: c.id_producto, cantidad: c.cantidad })),
  [
    { producto: "chifle", cantidad: 3 },
    { producto: "agua", cantidad: 1 },
  ],
);

const chifle = consolidados[0];
assert.deepEqual(selectionsParaQuitar(chifle, 1), [
  { order_item_id: "a4", quantity_cancelled: 1 },
]);
assert.deepEqual(selectionsParaQuitar(chifle, 3), [
  { order_item_id: "a4", quantity_cancelled: 1 },
  { order_item_id: "a3", quantity_cancelled: 1 },
  { order_item_id: "a1", quantity_cancelled: 1 },
]);

console.log("consolidarItems.test.mjs OK");
