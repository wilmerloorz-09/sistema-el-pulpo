export const TRANSFER_PROOF_PENDING_PREFIX = "TRANSFER_PROOF_PENDING:";
export const TRANSFER_PROOF_PENDING_ON = `${TRANSFER_PROOF_PENDING_PREFIX}1`;
export const TRANSFER_PROOF_PENDING_OFF = `${TRANSFER_PROOF_PENDING_PREFIX}0`;

export function setTransferProofPendingMarker(
  existingNotes: string | null | undefined,
  pending: boolean,
): string {
  const marker = pending ? TRANSFER_PROOF_PENDING_ON : TRANSFER_PROOF_PENDING_OFF;
  const cleaned = String(existingNotes ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(TRANSFER_PROOF_PENDING_PREFIX));

  return [...cleaned, marker].join("|");
}
