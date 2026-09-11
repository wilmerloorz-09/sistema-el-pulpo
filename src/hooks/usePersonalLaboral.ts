import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fechaOperativaTurno, funcionesRealizadas, resolverPrecioDia, type PrecioEspecial, type PrecioSemanal } from "@/lib/personalLaboral";

export type PersonalReportFilters = {
  desde: string;
  hasta: string;
  /** Vacío = todas las sucursales. */
  sucursalIds: string[];
  personaId: string;
};

export type PrecioDiaPersonal = PrecioSemanal;
export type PrecioDiaPersonalGlobal = Omit<PrecioSemanal, "branch_id"> & { singleton: boolean };

export type PrecioFechaEspecialPersonal = PrecioEspecial & {
  id: string;
  nombre: string;
};

export type PersonalReportRow = {
  rowId: string;
  shiftId: string;
  shiftCode: string;
  shiftStatus: string;
  fecha: string;
  branchId: string;
  branchName: string;
  userId: string;
  personName: string;
  funciones: string[];
  valor: number | null;
  tipoPrecio: "ESPECIAL" | "SABADO" | "DOMINGO" | "LUNES_VIERNES" | "SIN_CONFIGURAR";
};

type PersonalReportData = {
  rows: PersonalReportRow[];
  precios: PrecioDiaPersonal[];
  precioGlobal: PrecioDiaPersonalGlobal | null;
  especiales: PrecioFechaEspecialPersonal[];
};

const QUERY_KEY = ["reporte-personal-turnos"] as const;

function personName(profile: any) {
  const names = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
  return names || profile?.full_name || profile?.alias || profile?.username || "Usuario";
}

export function usePersonalLaboral(filters: PersonalReportFilters) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...QUERY_KEY, filters],
    queryFn: async (): Promise<PersonalReportData> => {
      const fromIso = `${filters.desde}T05:00:00.000Z`;
      const until = new Date(`${filters.hasta}T05:00:00.000Z`);
      until.setUTCDate(until.getUTCDate() + 1);

      let shiftsQuery = (supabase as any)
        .from("cash_shifts")
        .select("id,branch_id,opened_at,status,shift_code,shift_number,branches(name)")
        .gte("opened_at", fromIso)
        .lt("opened_at", until.toISOString())
        .order("opened_at", { ascending: false });
      if (filters.sucursalIds.length === 1) {
        shiftsQuery = shiftsQuery.eq("branch_id", filters.sucursalIds[0]);
      } else if (filters.sucursalIds.length > 1) {
        shiftsQuery = shiftsQuery.in("branch_id", filters.sucursalIds);
      }

      const [
        { data: shifts, error: shiftsError },
        { data: precios, error: pricesError },
        { data: globalRows, error: globalError },
        { data: especiales, error: specialError },
      ] =
        await Promise.all([
          shiftsQuery,
          (supabase as any).from("precios_dia_personal").select("*"),
          (supabase as any).from("precios_dia_personal_global").select("*").limit(1),
          (supabase as any).from("precios_fecha_especial_personal").select("*").gte("fecha", filters.desde).lte("fecha", filters.hasta),
        ]);
      if (shiftsError) throw shiftsError;
      if (pricesError) throw pricesError;
      if (globalError) throw globalError;
      if (specialError) throw specialError;

      const shiftRows = shifts ?? [];
      const precioGlobal = globalRows?.[0] ?? null;
      if (shiftRows.length === 0) return { rows: [], precios: precios ?? [], precioGlobal, especiales: especiales ?? [] };

      const shiftIds = shiftRows.map((shift: any) => shift.id);
      const { data: users, error: usersError } = await (supabase as any)
        .from("cash_shift_users")
        .select("id,shift_id,user_id,is_enabled,can_serve_tables,can_dispatch_orders,can_serve_plates,can_pack_orders,can_use_caja,is_supervisor,profiles(id,first_name,last_name,full_name,alias,username)")
        .in("shift_id", shiftIds);
      if (usersError) throw usersError;

      const shiftById = new Map(shiftRows.map((shift: any) => [shift.id, shift]));
      const weeklyByBranch = new Map((precios ?? []).map((price: PrecioDiaPersonal) => [price.branch_id, price]));
      const rows = (users ?? [])
        .filter((user: any) => !filters.personaId || user.user_id === filters.personaId)
        .map((user: any): PersonalReportRow | null => {
          const shift: any = shiftById.get(user.shift_id);
          if (!shift) return null;
          const fecha = fechaOperativaTurno(shift.opened_at);
          const weekly =
            weeklyByBranch.get(shift.branch_id)
            ?? (precioGlobal ? { ...precioGlobal, branch_id: shift.branch_id } : undefined);
          const resolved = resolverPrecioDia(fecha, shift.branch_id, weekly, especiales ?? []);
          const branch = Array.isArray(shift.branches) ? shift.branches[0] : shift.branches;
          return {
            rowId: user.id,
            shiftId: shift.id,
            shiftCode: shift.shift_code || String(shift.shift_number ?? shift.id.slice(0, 8)),
            shiftStatus: shift.status,
            fecha,
            branchId: shift.branch_id,
            branchName: branch?.name ?? "Sucursal",
            userId: user.user_id,
            personName: personName(Array.isArray(user.profiles) ? user.profiles[0] : user.profiles),
            funciones: funcionesRealizadas(user),
            valor: resolved.valor,
            tipoPrecio: resolved.tipo,
          };
        })
        .filter(Boolean) as PersonalReportRow[];
      rows.sort(
        (a, b) =>
          b.fecha.localeCompare(a.fecha)
          || a.branchName.localeCompare(b.branchName)
          || a.personName.localeCompare(b.personName),
      );

      return { rows, precios: precios ?? [], precioGlobal, especiales: especiales ?? [] };
    },
    enabled: Boolean(filters.desde && filters.hasta),
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: async ({ name, args }: { name: string; args: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc(name as any, args as any);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    ...query,
    data: query.data ?? { rows: [], precios: [], precioGlobal: null, especiales: [] },
    runRpc: (name: string, args: Record<string, unknown>) => mutation.mutateAsync({ name, args }),
    isMutating: mutation.isPending,
  };
}
