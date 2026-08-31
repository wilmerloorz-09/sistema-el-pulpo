import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/integrations/supabase/client";
import {
  OPERATIONAL_QUEUE_CACHE_TTL_MS,
  fetchOperationalQueue,
  invalidateOperationalQueueCache,
} from "@/lib/operationalQueue";

const rpc = vi.mocked((supabase as any).rpc);

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
    rpc.mockReset();
    invalidateOperationalQueueCache();
  });

  afterEach(() => {
    invalidateOperationalQueueCache();
    vi.useRealTimers();
  });

  it("deduplica llamadas concurrentes por branch, turno y módulo", async () => {
    let resolveRpc!: (value: unknown) => void;
    rpc.mockReturnValue(new Promise((resolve) => {
      resolveRpc = resolve;
    }));

    const first = fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    const second = fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    resolveRpc({ data: bundle(), error: null });

    await Promise.all([first, second]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("cache separado por módulo", async () => {
    rpc.mockResolvedValue({ data: bundle(), error: null });

    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    await fetchOperationalQueue("branch-a", "shift-a", "packing");

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("respeta TTL antes de reutilizar cache", async () => {
    rpc.mockResolvedValue({ data: bundle(), error: null });

    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    vi.advanceTimersByTime(OPERATIONAL_QUEUE_CACHE_TTL_MS - 1);
    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("pasa p_run_repair al RPC cuando se solicita", async () => {
    rpc.mockResolvedValue({ data: bundle(), error: null });

    await fetchOperationalQueue("branch-a", "shift-a", "servir", { runRepair: true });

    expect(rpc).toHaveBeenCalledWith("get_operational_queue", {
      p_branch_id: "branch-a",
      p_shift_id: "shift-a",
      p_module: "servir",
      p_run_repair: true,
    });
  });

  it("envía null explícito si el turno viene vacío", async () => {
    rpc.mockResolvedValue({ data: bundle(), error: null });

    await fetchOperationalQueue("branch-a", "", "dispatch");

    expect(rpc).toHaveBeenCalledWith("get_operational_queue", {
      p_branch_id: "branch-a",
      p_shift_id: null,
      p_module: "dispatch",
      p_run_repair: false,
    });
  });

  it("no cachea cola vacía transitoria", async () => {
    rpc.mockResolvedValue({
      data: {
        orders: [],
        items: [],
        modifiers: [],
        order_payment_flags: [],
        tables: [],
        splits: [],
        profiles: [],
        packer_user_ids: [],
        has_plate_servers: false,
      },
      error: null,
    });

    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    await fetchOperationalQueue("branch-a", "shift-a", "dispatch");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
