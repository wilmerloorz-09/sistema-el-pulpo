import { dbSelect } from "@/services/DatabaseService";

/** Turno operativo abierto de la sucursal (el mas reciente por opened_at). */
export async function getOpenCashShiftIdForBranch(branchId: string): Promise<string | null> {
  const rows = await dbSelect<{ id: string }>("cash_shifts", {
    select: "id",
    branchId,
    filters: [{ column: "status", op: "eq", value: "OPEN" }],
    orderBy: { column: "opened_at", ascending: false },
  });
  return rows[0]?.id ?? null;
}
