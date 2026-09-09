import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  esErrorTransferenciaDuplicada,
  existeTransferenciaDuplicada,
  MENSAJE_TRANSFERENCIA_DUPLICADA,
  mensajeErrorPago,
} from "@/lib/transferenciaDuplicada";

describe("transferenciaDuplicada", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("detecta error de unicidad", () => {
    expect(esErrorTransferenciaDuplicada({ code: "23505", message: "duplicate" })).toBe(true);
    expect(
      esErrorTransferenciaDuplicada({ message: "transferencia duplicada: 123" }),
    ).toBe(true);
    expect(
      esErrorTransferenciaDuplicada({ message: "idx_payments_transferencia_unica" }),
    ).toBe(true);
    expect(mensajeErrorPago({ code: "23505" })).toBe(MENSAJE_TRANSFERENCIA_DUPLICADA);
  });

  it("usa RPC y retorna true/false", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await expect(existeTransferenciaDuplicada("banco", "21841694")).resolves.toBe(true);

    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    await expect(existeTransferenciaDuplicada("banco", "21841694")).resolves.toBe(false);
  });

  it("si la RPC falla retorna null en vez de lanzar", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    await expect(existeTransferenciaDuplicada("banco", "21841694")).resolves.toBeNull();
  });
});
