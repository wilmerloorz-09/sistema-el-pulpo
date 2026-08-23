import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/integrations/supabase/client";
import {
  DISPATCH_SERVIR_QUEUE_BUNDLE_CACHE_TTL_MS,
  fetchDispatchServirQueueBundle,
  invalidateDispatchServirQueueBundleCache,
} from "@/lib/dispatchServirQueueBundle";

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

function emptyBundle() {
  return {
    orders: [],
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

describe("dispatchServirQueueBundle cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    rpc.mockReset();
    invalidateDispatchServirQueueBundleCache();
  });

  afterEach(() => {
    invalidateDispatchServirQueueBundleCache();
    vi.useRealTimers();
  });

  it("deduplica dos llamadas concurrentes del mismo branch y turno", async () => {
    let resolveRpc!: (value: unknown) => void;
    rpc.mockReturnValueOnce(new Promise((resolve) => {
      resolveRpc = resolve;
    }));

    const first = fetchDispatchServirQueueBundle("branch-a", "shift-a");
    const second = fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(1);
    resolveRpc({ data: bundle(), error: null });

    await expect(Promise.all([first, second])).resolves.toEqual([bundle(), bundle()]);
  });

  it("reutiliza una respuesta con órdenes durante el TTL (25s)", async () => {
    rpc.mockResolvedValueOnce({ data: bundle(), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    vi.setSystemTime(new Date(Date.now() + DISPATCH_SERVIR_QUEUE_BUNDLE_CACHE_TTL_MS - 1));
    await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("consulta de nuevo la RPC cuando el TTL del bundle expira", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("cached"), error: null })
      .mockResolvedValueOnce({ data: bundle("fresh"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    vi.setSystemTime(new Date(Date.now() + DISPATCH_SERVIR_QUEUE_BUNDLE_CACHE_TTL_MS + 1));
    const fresh = await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fresh.orders).toEqual([{ id: "fresh" }]);
  });

  it("no cachea una respuesta vacía como verdad reutilizable", async () => {
    rpc
      .mockResolvedValueOnce({ data: emptyBundle(), error: null })
      .mockResolvedValueOnce({ data: bundle("fresh-order"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    const fresh = await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fresh.orders).toEqual([{ id: "fresh-order" }]);
  });

  it("retry force después de una cola vacía siempre consulta RPC", async () => {
    rpc
      .mockResolvedValueOnce({ data: emptyBundle(), error: null })
      .mockResolvedValueOnce({ data: bundle("repaired-order"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    const retried = await fetchDispatchServirQueueBundle("branch-a", "shift-a", { force: true });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(retried.orders).toEqual([{ id: "repaired-order" }]);
  });

  it("force siempre consulta la RPC e ignora cache e inflight previos", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("cached"), error: null })
      .mockResolvedValueOnce({ data: bundle("forced"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    const forced = await fetchDispatchServirQueueBundle("branch-a", "shift-a", { force: true });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(forced.orders).toEqual([{ id: "forced" }]);
  });

  it("limpia inflight después de un error", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: new Error("RPC falló") })
      .mockResolvedValueOnce({ data: bundle(), error: null });

    await expect(fetchDispatchServirQueueBundle("branch-a", "shift-a")).rejects.toThrow("RPC falló");
    await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("conserva cache válido anterior si una renovación falla", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("cached"), error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("RPC falló") });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    vi.setSystemTime(new Date(Date.now() + DISPATCH_SERVIR_QUEUE_BUNDLE_CACHE_TTL_MS + 1));
    await expect(fetchDispatchServirQueueBundle("branch-a", "shift-a")).rejects.toThrow("RPC falló");

    vi.setSystemTime(new Date("2026-08-17T00:00:01.000Z"));
    const cached = await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(cached.orders).toEqual([{ id: "cached" }]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("no comparte cache entre branches", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("branch-a-order"), error: null })
      .mockResolvedValueOnce({ data: bundle("branch-b-order"), error: null });

    const first = await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    const second = await fetchDispatchServirQueueBundle("branch-b", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(first.orders).toEqual([{ id: "branch-a-order" }]);
    expect(second.orders).toEqual([{ id: "branch-b-order" }]);
  });

  it("no comparte cache entre turnos", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("shift-a-order"), error: null })
      .mockResolvedValueOnce({ data: bundle("shift-b-order"), error: null });

    const first = await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    const second = await fetchDispatchServirQueueBundle("branch-a", "shift-b");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(first.orders).toEqual([{ id: "shift-a-order" }]);
    expect(second.orders).toEqual([{ id: "shift-b-order" }]);
  });

  it("invalidate elimina cache y la siguiente lectura obtiene información nueva", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("old"), error: null })
      .mockResolvedValueOnce({ data: bundle("new"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    invalidateDispatchServirQueueBundleCache("branch-a", "shift-a");
    const refreshed = await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(refreshed.orders).toEqual([{ id: "new" }]);
  });

  it("invalidate dirigido no elimina cache de otro branch", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("branch-a-order"), error: null })
      .mockResolvedValueOnce({ data: bundle("branch-b-order"), error: null })
      .mockResolvedValueOnce({ data: bundle("branch-a-refreshed"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    await fetchDispatchServirQueueBundle("branch-b", "shift-a");
    invalidateDispatchServirQueueBundleCache("branch-a");

    const branchB = await fetchDispatchServirQueueBundle("branch-b", "shift-a");
    const branchA = await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(branchB.orders).toEqual([{ id: "branch-b-order" }]);
    expect(branchA.orders).toEqual([{ id: "branch-a-refreshed" }]);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("force no convierte una respuesta vacía en cache utilizable", async () => {
    rpc
      .mockResolvedValueOnce({ data: bundle("cached"), error: null })
      .mockResolvedValueOnce({ data: emptyBundle(), error: null })
      .mockResolvedValueOnce({ data: bundle("after-empty"), error: null });

    await fetchDispatchServirQueueBundle("branch-a", "shift-a");
    await fetchDispatchServirQueueBundle("branch-a", "shift-a", { force: true });
    const next = await fetchDispatchServirQueueBundle("branch-a", "shift-a");

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(next.orders).toEqual([{ id: "after-empty" }]);
  });
});
