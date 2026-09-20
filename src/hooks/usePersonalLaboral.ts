import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  etiquetaTipoSueldo,
  fechaOperativaTurno,
  funcionesRealizadas,
  normalizeFechaLaboral,
  resolverSueldoPersonalDia,
  type PrecioEspecial,
  type PrecioSemanal,
  type SueldoPersona,
  type TipoSueldoDia,
} from "@/lib/personalLaboral";

export type PersonalReportFilters = {
  desde: string;
  hasta: string;
  /** Vacío = todas las sucursales. */
  sucursalIds: string[];
  /** Vacío = todas las personas. */
  personaIds: string[];
};

export type PrecioDiaPersonal = PrecioSemanal;
export type PrecioDiaPersonalGlobal = Omit<PrecioSemanal, "branch_id"> & { singleton: boolean };

export type PrecioFechaEspecialPersonal = PrecioEspecial & {
  id: string;
  nombre: string;
};

export type SueldoPersonalRow = {
  userId: string;
  fullName: string;
  username: string;
  alias: string | null;
  isActive: boolean;
  lunesViernes: number;
  sabado: number;
  domingo: number;
  diaEspecial: number;
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
  tipoPrecio: TipoSueldoDia;
  tipoPrecioLabel: string;
};

type PersonalReportData = {
  rows: PersonalReportRow[];
  /** Personas disponibles según fechas/sucursales (sin filtro de persona). */
  peopleOptions: { id: string; name: string }[];
  precios: PrecioDiaPersonal[];
  precioGlobal: PrecioDiaPersonalGlobal | null;
  especiales: PrecioFechaEspecialPersonal[];
};

const QUERY_KEY = ["reporte-personal-turnos"] as const;
const SUELDOS_QUERY_KEY = ["sueldos-personal"] as const;
const ESPECIALES_QUERY_KEY = ["precios-fecha-especial-personal"] as const;

function personName(profile: any) {
  const names = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
  return names || profile?.full_name || profile?.alias || profile?.username || "Usuario";
}

function mapEspecialRow(row: any): PrecioFechaEspecialPersonal {
  return {
    id: row.id,
    branch_id: row.branch_id ?? null,
    fecha: normalizeFechaLaboral(row.fecha),
    nombre: row.nombre ?? "",
    valor: Number(row.valor ?? 0),
  };
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

      if (filters.sucursalIds.length === 1 && filters.sucursalIds[0] === "__NONE__") {
        return {
          rows: [],
          peopleOptions: [],
          precios: [],
          precioGlobal: null,
          especiales: [],
        };
      }
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
        { data: sueldos, error: sueldosError },
      ] =
        await Promise.all([
          shiftsQuery,
          (supabase as any).from("precios_dia_personal").select("*"),
          (supabase as any).from("precios_dia_personal_global").select("*").limit(1),
          (supabase as any)
            .from("precios_fecha_especial_personal")
            .select("*")
            .gte("fecha", filters.desde)
            .lte("fecha", filters.hasta),
          (supabase as any)
            .from("sueldos_personal")
            .select("user_id,lunes_viernes,sabado,domingo,dia_especial"),
        ]);
      if (shiftsError) throw shiftsError;
      if (pricesError) throw pricesError;
      if (globalError) throw globalError;
      if (specialError) throw specialError;
      if (sueldosError) throw sueldosError;

      const shiftRows = shifts ?? [];
      const precioGlobal = globalRows?.[0] ?? null;
      const especialesNorm = (especiales ?? []).map(mapEspecialRow);
      const sueldoByUser = new Map<string, SueldoPersona>(
        (sueldos ?? []).map((row: any) => [
          row.user_id,
          {
            lunes_viernes: Number(row.lunes_viernes),
            sabado: Number(row.sabado),
            domingo: Number(row.domingo),
            dia_especial: Number(row.dia_especial ?? 0),
          },
        ]),
      );
      if (shiftRows.length === 0) {
        return {
          rows: [],
          peopleOptions: [],
          precios: precios ?? [],
          precioGlobal,
          especiales: especialesNorm,
        };
      }

      const shiftIds = shiftRows.map((shift: any) => shift.id);
      const { data: users, error: usersError } = await (supabase as any)
        .from("cash_shift_users")
        .select("id,shift_id,user_id,is_enabled,can_serve_tables,can_dispatch_orders,can_serve_plates,can_pack_orders,can_use_caja,is_supervisor,is_operativo,profiles(id,first_name,last_name,full_name,alias,username)")
        .in("shift_id", shiftIds)
        .eq("is_enabled", true);
      if (usersError) throw usersError;

      const shiftById = new Map(shiftRows.map((shift: any) => [shift.id, shift]));
      const weeklyByBranch = new Map((precios ?? []).map((price: PrecioDiaPersonal) => [price.branch_id, price]));
      const allRows = (users ?? [])
        .map((user: any): PersonalReportRow | null => {
          const shift: any = shiftById.get(user.shift_id);
          if (!shift) return null;
          const fecha = fechaOperativaTurno(shift.opened_at);
          const weekly =
            weeklyByBranch.get(shift.branch_id)
            ?? (precioGlobal ? { ...precioGlobal, branch_id: shift.branch_id } : undefined);
          const resolved = resolverSueldoPersonalDia(
            fecha,
            shift.branch_id,
            sueldoByUser.get(user.user_id) ?? null,
            weekly,
            especialesNorm,
          );
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
            tipoPrecioLabel: etiquetaTipoSueldo(resolved.tipo),
          };
        })
        .filter(Boolean) as PersonalReportRow[];

      const peopleMap = new Map<string, string>();
      for (const row of allRows) {
        if (!peopleMap.has(row.userId)) peopleMap.set(row.userId, row.personName);
      }
      const peopleOptions = Array.from(peopleMap, ([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const selectedPeople = new Set(filters.personaIds.filter((id) => id !== "__NONE__"));
      const nonePeople = filters.personaIds.length === 1 && filters.personaIds[0] === "__NONE__";
      const filterByPerson =
        !nonePeople
        && filters.personaIds.length > 0
        && !(
          peopleOptions.length > 0
          && peopleOptions.every((person) => selectedPeople.has(person.id))
        );

      const rows = nonePeople
        ? []
        : filterByPerson
          ? allRows.filter((row) => selectedPeople.has(row.userId))
          : allRows;

      rows.sort(
        (a, b) =>
          b.fecha.localeCompare(a.fecha)
          || a.branchName.localeCompare(b.branchName)
          || a.personName.localeCompare(b.personName),
      );

      return {
        rows,
        peopleOptions,
        precios: precios ?? [],
        precioGlobal,
        especiales: especialesNorm,
      };
    },
    enabled: Boolean(filters.desde && filters.hasta),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const mutation = useMutation({
    mutationFn: async ({ name, args }: { name: string; args: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc(name as any, args as any);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SUELDOS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ESPECIALES_QUERY_KEY });
    },
  });

  return {
    ...query,
    data: query.data ?? { rows: [], peopleOptions: [], precios: [], precioGlobal: null, especiales: [] },
    runRpc: (name: string, args: Record<string, unknown>) => mutation.mutateAsync({ name, args }),
    isMutating: mutation.isPending,
  };
}

export function useDiasEspecialesPersonal() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ESPECIALES_QUERY_KEY,
    queryFn: async (): Promise<PrecioFechaEspecialPersonal[]> => {
      const { data, error } = await (supabase as any)
        .from("precios_fecha_especial_personal")
        .select("*")
        .order("fecha", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapEspecialRow);
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  return {
    ...query,
    data: query.data ?? [],
    invalidate: () => queryClient.invalidateQueries({ queryKey: ESPECIALES_QUERY_KEY }),
  };
}

export function useSueldosPersonal() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SUELDOS_QUERY_KEY,
    queryFn: async (): Promise<SueldoPersonalRow[]> => {
      const { data, error } = await supabase.rpc("list_sueldos_personal" as any);
      if (error) throw error;
      return ((data ?? []) as Array<{
        user_id: string;
        full_name: string | null;
        username: string | null;
        alias: string | null;
        is_active: boolean;
        lunes_viernes: number | null;
        sabado: number | null;
        domingo: number | null;
        dia_especial: number | null;
      }>).map((row) => ({
        userId: row.user_id,
        fullName: row.full_name || row.alias || row.username || "Usuario",
        username: row.username || "",
        alias: row.alias,
        isActive: Boolean(row.is_active),
        lunesViernes: Number(row.lunes_viernes ?? 0),
        sabado: Number(row.sabado ?? 0),
        domingo: Number(row.domingo ?? 0),
        diaEspecial: Number(row.dia_especial ?? 0),
      }));
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const mutation = useMutation({
    mutationFn: async (args: {
      userId: string;
      lunesViernes: number;
      sabado: number;
      domingo: number;
      diaEspecial: number;
    }) => {
      const { error } = await supabase.rpc("guardar_sueldo_personal" as any, {
        p_user_id: args.userId,
        p_lunes_viernes: args.lunesViernes,
        p_sabado: args.sabado,
        p_domingo: args.domingo,
        p_dia_especial: args.diaEspecial,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUELDOS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    ...query,
    data: query.data ?? [],
    saveSueldo: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
