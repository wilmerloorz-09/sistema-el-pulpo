import assert from "node:assert/strict";
import { filterPayableOrdersWhenPackerPresent } from "./cajaPayableWhenPacker.ts";

const orders = [
  { id: "1", order_type: "DINE_IN" },
  { id: "2", order_type: "TAKEOUT" },
  { id: "3", order_type: "EXPRESS" },
  { id: "4", order_type: "EXTRA" },
];

assert.deepEqual(
  filterPayableOrdersWhenPackerPresent(orders, false).map((o) => o.id),
  ["1", "2", "3", "4"],
);

assert.deepEqual(
  filterPayableOrdersWhenPackerPresent(orders, true).map((o) => o.id),
  ["2", "3"],
);

console.log("cajaPayableWhenPacker.test.mjs OK");
