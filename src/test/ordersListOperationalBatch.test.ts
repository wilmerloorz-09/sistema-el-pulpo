import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_OPERATIONAL_MAPS,
  buildOperationalMapsFromSnapshotRows,
  createOperationalMapsBatchCoordinator,
  type OperationalMapsBatchParticipant,
} from "@/lib/orderOperational";
import { OPERATIONAL_ORDER_LIST_KEYS, qk } from "@/lib/queryKeys";

const PARTICIPANTS = [
  "SENT_TO_KITCHEN",
  "DRAFT",
  "KITCHEN_DISPATCHED",
  "PENDING_CANCELLATION",
  "CANCELLED",
  "PAID",
] as const;

function participant(
  batchKey: string,
  participantId: string,
  participantCount = PARTICIPANTS.length,
): OperationalMapsBatchParticipant {
  return { batchKey, participantId, participantCount };
}

describe("coordinador operativo de OrdersList", () => {
  it("ejecuta una sola carga con la unión única de las seis pestañas", async () => {
    const fetchOperationalMapsForOrders = vi.fn().mockResolvedValue(EMPTY_OPERATIONAL_MAPS);
    const coordinator = createOperationalMapsBatchCoordinator(fetchOperationalMapsForOrders);
    const batchKey = JSON.stringify(["orders-list", "branch-a", "shift-a"]);

    const pending = PARTICIPANTS.map((id, index) =>
      coordinator.fetch([`order-${index}`, "shared"], participant(batchKey, id)),
    );

    await Promise.all(pending);

    expect(fetchOperationalMapsForOrders).toHaveBeenCalledTimes(1);
    expect(fetchOperationalMapsForOrders).toHaveBeenCalledWith([
      "order-0",
      "shared",
      "order-1",
      "order-2",
      "order-3",
      "order-4",
      "order-5",
    ]);
  });

  it("deduplica IDs compartidos entre SENT y PAID", async () => {
    const fetchOperationalMapsForOrders = vi.fn().mockResolvedValue(EMPTY_OPERATIONAL_MAPS);
    const coordinator = createOperationalMapsBatchCoordinator(fetchOperationalMapsForOrders);
    const batchKey = JSON.stringify(["orders-list", "branch-a", "shift-a"]);

    const sent = coordinator.fetch(["same-order", "sent-only"], participant(batchKey, "SENT_TO_KITCHEN", 2));
    const paid = coordinator.fetch(["same-order", "paid-only"], participant(batchKey, "PAID", 2));

    await Promise.all([sent, paid]);

    expect(fetchOperationalMapsForOrders).toHaveBeenCalledTimes(1);
    expect(fetchOperationalMapsForOrders).toHaveBeenCalledWith([
      "same-order",
      "sent-only",
      "paid-only",
    ]);
  });

  it("finaliza cuando algunas pestañas están vacías", async () => {
    const fetchOperationalMapsForOrders = vi.fn().mockResolvedValue(EMPTY_OPERATIONAL_MAPS);
    const coordinator = createOperationalMapsBatchCoordinator(fetchOperationalMapsForOrders);
    const batchKey = JSON.stringify(["orders-list", "branch-a", "shift-a"]);

    const sent = coordinator.fetch(["sent-order"], participant(batchKey, "SENT_TO_KITCHEN"));
    const paid = coordinator.fetch(["paid-order"], participant(batchKey, "PAID"));
    for (const id of PARTICIPANTS.filter((id) => id !== "SENT_TO_KITCHEN" && id !== "PAID")) {
      coordinator.complete(participant(batchKey, id));
    }

    await Promise.all([sent, paid]);

    expect(fetchOperationalMapsForOrders).toHaveBeenCalledTimes(1);
    expect(fetchOperationalMapsForOrders).toHaveBeenCalledWith(["sent-order", "paid-order"]);
  });

  it("no bloquea las pestañas restantes si una participante termina con error", async () => {
    const fetchOperationalMapsForOrders = vi.fn().mockResolvedValue(EMPTY_OPERATIONAL_MAPS);
    const coordinator = createOperationalMapsBatchCoordinator(fetchOperationalMapsForOrders);
    const batchKey = JSON.stringify(["orders-list", "branch-a", "shift-a"]);

    const sent = coordinator.fetch(["sent-order"], participant(batchKey, "SENT_TO_KITCHEN", 2));
    coordinator.complete(participant(batchKey, "PAID", 2));

    await expect(sent).resolves.toBe(EMPTY_OPERATIONAL_MAPS);
    expect(fetchOperationalMapsForOrders).toHaveBeenCalledWith(["sent-order"]);
  });

  it("no reutiliza mapas entre sucursales o turnos y crea un batch nuevo en refetch", async () => {
    const fetchOperationalMapsForOrders = vi.fn().mockResolvedValue(EMPTY_OPERATIONAL_MAPS);
    const coordinator = createOperationalMapsBatchCoordinator(fetchOperationalMapsForOrders);

    await coordinator.fetch(["branch-a-order"], participant(JSON.stringify(["orders-list", "branch-a", "shift-a"]), "SENT", 1));
    await coordinator.fetch(["branch-b-order"], participant(JSON.stringify(["orders-list", "branch-b", "shift-a"]), "SENT", 1));
    await coordinator.fetch(["next-shift-order"], participant(JSON.stringify(["orders-list", "branch-a", "shift-b"]), "SENT", 1));
    await coordinator.fetch(["refetch-order"], participant(JSON.stringify(["orders-list", "branch-a", "shift-a"]), "SENT", 1));

    expect(fetchOperationalMapsForOrders).toHaveBeenCalledTimes(4);
    expect(fetchOperationalMapsForOrders.mock.calls.map(([ids]) => ids)).toEqual([
      ["branch-a-order"],
      ["branch-b-order"],
      ["next-shift-order"],
      ["refetch-order"],
    ]);
  });

  it("mantiene los mapas paid, ready, dispatched y cancelled compartidos", () => {
    const maps = buildOperationalMapsFromSnapshotRows([{
      order_id: "order-1",
      order_item_id: "item-1",
      description_snapshot: "Producto",
      item_status: "SENT",
      unit_price: 10,
      quantity_ordered: 5,
      quantity_paid: 2,
      quantity_ready_total: 3,
      quantity_ready_available: 2,
      quantity_dispatched_total: 1,
      quantity_dispatched_available: 1,
      quantity_cancelled_pending: 1,
      quantity_cancelled_ready: 0,
      quantity_cancelled_dispatched: 0,
      quantity_cancelled_total: 1,
      quantity_pending_prepare: 1,
    }]);

    expect(maps.paidMap["item-1"]).toBe(2);
    expect(maps.readyMap["item-1"]).toBe(3);
    expect(maps.dispatchedTotalMap["item-1"]).toBe(1);
    expect(maps.cancelledTotalMap["item-1"]).toBe(1);
  });

  it("mantiene orders-list en el conjunto de invalidaciones operativas", () => {
    expect(OPERATIONAL_ORDER_LIST_KEYS).toContainEqual(qk.ordersList);
  });
});
