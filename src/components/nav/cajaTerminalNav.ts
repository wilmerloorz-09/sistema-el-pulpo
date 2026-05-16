import type { BranchShiftGate } from "@/hooks/useBranchShiftGate";
import { TAB_SESSION_ID } from "@/hooks/useBranchShiftGate";

export function computeCajaAbrirTerminalState(sg: BranchShiftGate | undefined) {
  const maxCap = Math.max(1, Math.min(10, Number(sg?.maxCajaSessions ?? 1)));
  const globalUsed = Math.max(0, Number(sg?.globalCajaSessionsUsed ?? 0));
  const userSlots = (sg?.cajaSessionSlots ?? []).filter((s) => Boolean(String(s).trim()));
  const tabRegistered = userSlots.includes(TAB_SESSION_ID);
  const userMaxSlots = sg?.canDoubleSession ? Math.min(maxCap, 2) : 1;

  let abrirDisabledReason: string | undefined;
  if (!sg?.shiftOpen) abrirDisabledReason = "No hay turno abierto.";
  else if (!sg?.userEnabled) abrirDisabledReason = "No estas habilitado en el turno.";
  else if (!sg?.canUseCaja) abrirDisabledReason = "Sin permiso de Caja.";
  else if (sg?.cajaStatus === "OPEN") abrirDisabledReason = "Tu caja ya esta abierta en este turno.";

  const canOpenAbrirCaja = !abrirDisabledReason;

  const abrirNavLabel = sg?.cajaStatus === "CLOSED" ? "Reabrir mi caja..." : "Abrir mi caja...";

  return { canOpenAbrirCaja, abrirDisabledReason, maxCap, globalUsed, tabRegistered, userSlots, userMaxSlots, abrirNavLabel };
}
