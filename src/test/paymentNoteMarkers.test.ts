import { describe, expect, it } from "vitest";
import { setTransferProofPendingMarker } from "@/lib/paymentNoteMarkers";

describe("setTransferProofPendingMarker", () => {
  it("agrega marcador pendiente cuando no hay notas", () => {
    expect(setTransferProofPendingMarker(null, true)).toBe("TRANSFER_PROOF_PENDING:1");
  });

  it("reemplaza pendiente por confirmado sin dejar ambos marcadores", () => {
    expect(
      setTransferProofPendingMarker("GROUP:abc|TRANSFER_PROOF_PENDING:1", false),
    ).toBe("GROUP:abc|TRANSFER_PROOF_PENDING:0");
  });

  it("limpia marcadores contradictorios anteriores", () => {
    expect(
      setTransferProofPendingMarker("ITEMS_ANCHOR:1|TRANSFER_PROOF_PENDING:1|TRANSFER_PROOF_PENDING:0", false),
    ).toBe("ITEMS_ANCHOR:1|TRANSFER_PROOF_PENDING:0");
  });
});
