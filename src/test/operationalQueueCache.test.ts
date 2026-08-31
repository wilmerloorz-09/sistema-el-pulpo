import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dispatchServirQueueBundle", () => ({
  fetchDispatchServirQueueBundle: vi.fn(),
}));

import { fetchDispatchServirQueueBundle } from "@/lib/dispatchServirQueueBundle";
import {
  OPERATIONAL_QUEUE_CACHE_TTL_MS,
  fetchOperationalQueue,
  invalidateOperationalQueueCache,
} from "@/lib/operationalQueue";

const fetchBundle = vi.mocked(fetchDispatchServirQueueBundle);

function bundle(orderId = "order-1") {
  return {
    orders: [{ id: orderId }],
    items: [],
    modifiers: [],
    order_payment_flags: [],
    tables: [],
    splits: [],
    profiles: [],
    packer_user_ids: [],
    has_plate_servers: false,
  };
}

describe("operationalQueue cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T00:00:00.000Z"));
    fetchBundle.mockReset();
    invalidateOperationalQueueCache();
  });

  afterEach(() => {
    invalidateOperationalQueueCache();
    vi.useRealTimers();
  });

  it("deduplica llamadas concurrentes por branch, turno y módulo", async () => {
    let resolveBundle!: (value: ReturnType<typeof bundle>) => void;
    fetchBundle.mockReturnValue(new Promise((resolve) => {
      resolveBundle = resolve;
    }));

    const first = fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    const second = fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    resolveBundle(bundle());
    await Promise.all([first, second]);

    expect(fetchBundle).toHaveBeenCalledTimes(1);
  });

  it("cache separado por módulo", async () => {
    fetchBundle.mockResolvedValue(bundle());

    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    await fetchOperationalQueue("branch-a", "shift-a", "packing");

    expect(fetchBundle).toHaveBeenCalledTimes(2);
  });

  it("respeta TTL antes de reutilizar cache", async () => {
    fetchBundle.mockResolvedValue(bundle());

    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    vi.advanceTimersByTime(OPERATIONAL_QUEUE_CACHE_TTL_MS - 1);
    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    expect(fetchBundle).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    expect(fetchBundle).toHaveBeenCalledTimes(2);
  });

  it("usa get_dispatch_servir_queue_bundle (no la RPC nueva)", async () => {
    fetchBundle.mockResolvedValue(bundle());

    await fetchOperationalQueue("branch-a", "shift-a", "servir", { runRepair: true });

    expect(fetchBundle).toHaveBeenCalledWith("branch-a", "shift-a", { force: false });
  });

  it("no cachea cola vacía transitoria", async () => {
    fetchBundle.mockResolvedValue({
      orders: [],
      items: [],
      modifiers: [],
      order_payment_flags: [],
      tables: [],
      splits: [],
      profiles: [],
      packer_user_ids: [],
      has_plate_servers: false,
    });

    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");

    expect(fetchBundle).toHaveBeenCalledTimes(2);
  });
});
