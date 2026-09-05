export interface ShiftCashierRow {
  id: string;
  user_id: string;
  template_id?: string;
  is_primary: boolean;
}

export interface ShiftCajaSetupState {
  cashiers: ShiftCashierRow[];
  auxiliary: {
    user_id: string;
    template_id?: string;
  } | null;
}

export const EMPTY_CAJA_SETUP: ShiftCajaSetupState = { cashiers: [], auxiliary: null };

export function getPrimaryCashierIdFromSetup(state: ShiftCajaSetupState): string {
  return state.cashiers.find((row) => row.is_primary && row.user_id)?.user_id ?? "";
}

export function getConfiguredCashierUserIds(state: ShiftCajaSetupState): string[] {
  return state.cashiers.map((row) => row.user_id).filter(Boolean);
}

export function getSecondaryCashierIdsFromSetup(state: ShiftCajaSetupState): string[] {
  return state.cashiers
    .filter((row) => row.user_id && !row.is_primary)
    .map((row) => row.user_id);
}

export function countConfiguredShiftCashiers(state: ShiftCajaSetupState): number {
  return getConfiguredCashierUserIds(state).length;
}

export function buildSecondaryCajaConfig(state: ShiftCajaSetupState) {
  return state.cashiers
    .filter((row) => row.user_id)
    .map((row) => ({
      user_id: row.user_id,
      takeout_enabled: false,
      express_enabled: false,
      template_id: row.template_id,
    }));
}

export function resolveSecondaryCajaTemplateId(state: ShiftCajaSetupState): string | null {
  const secondaryRow = state.cashiers.find((row) => row.user_id && !row.is_primary && row.template_id);
  if (secondaryRow?.template_id) return secondaryRow.template_id;
  const anyRow = state.cashiers.find((row) => row.user_id && row.template_id);
  return anyRow?.template_id ?? null;
}

export function buildCajaRpcPayload(state: ShiftCajaSetupState) {
  const secondaryCashierIds = getSecondaryCashierIdsFromSetup(state);
  const secondaryEnabled = secondaryCashierIds.length > 0;

  return {
    p_primary_cashier_id: getPrimaryCashierIdFromSetup(state) || null,
    p_secondary_cajas_enabled: secondaryEnabled,
    p_secondary_caja_template_id: secondaryEnabled ? resolveSecondaryCajaTemplateId(state) : null,
    p_secondary_cashier_ids: secondaryCashierIds,
    p_secondary_caja_config: buildSecondaryCajaConfig(state),
  };
}

export function buildAuxiliaryCajaRpcPayload(state: ShiftCajaSetupState) {
  return {
    p_auxiliary_cashier_id: state.auxiliary?.user_id || null,
    p_auxiliary_template_id: state.auxiliary?.template_id || null,
  };
}

export function cajaSetupSignature(state: ShiftCajaSetupState) {
  const cashiers = state.cashiers
    .filter((row) => row.user_id)
    .map((row) => ({
      user_id: row.user_id,
      template_id: row.template_id ?? null,
      is_primary: row.is_primary,
    }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id));

  return JSON.stringify({
    cashiers,
    auxiliary: state.auxiliary
      ? {
          user_id: state.auxiliary.user_id,
          template_id: state.auxiliary.template_id ?? null,
        }
      : null,
  });
}

export function buildCajaSetupIssues(
  state: ShiftCajaSetupState,
  enabledUserIds: string[],
) {
  const issues: string[] = [];
  const configuredIds = getConfiguredCashierUserIds(state);

  if (configuredIds.length < 1) {
    issues.push("Debe habilitar al menos un cajero en la configuración de caja.");
  }

  const primaryCount = state.cashiers.filter((row) => row.is_primary && row.user_id).length;
  if (primaryCount > 1) {
    issues.push("Solo puede haber un cajero principal en el turno.");
  }

  if (new Set(configuredIds).size !== configuredIds.length) {
    issues.push("No puede repetir el mismo cajero en la lista.");
  }

  if (state.auxiliary?.user_id) {
    if (!enabledUserIds.includes(state.auxiliary.user_id)) {
      issues.push("El responsable de la caja auxiliar debe estar habilitado en el turno.");
    } else if (configuredIds.includes(state.auxiliary.user_id)) {
      issues.push("El responsable de la caja auxiliar no puede ser cajero del turno.");
    }
  }

  if (state.auxiliary?.user_id && !state.auxiliary.template_id) {
    issues.push("Debe asignar una plantilla de arqueo a la caja auxiliar.");
  }

  for (const row of state.cashiers) {
    if (!row.user_id) continue;
    if (!enabledUserIds.includes(row.user_id)) {
      issues.push("Todos los cajeros deben estar habilitados en el turno.");
      break;
    }
    if (!row.template_id) {
      issues.push("Cada cajero debe tener una plantilla de arqueo asignada.");
      break;
    }
  }

  return issues;
}

export function formatCajaSetupSummary(
  labelFor: (userId: string) => string,
  setup: ShiftCajaSetupState,
) {
  const rows = setup.cashiers.filter((row) => row.user_id);
  const cashierLabels = rows
    .map((row) => {
      const suffix = row.is_primary ? " (principal)" : "";
      return `${labelFor(row.user_id)}${suffix}`;
    });
  const auxiliaryLabel = setup.auxiliary?.user_id
    ? `${labelFor(setup.auxiliary.user_id)} (caja auxiliar)`
    : null;
  const labels = [...cashierLabels, ...(auxiliaryLabel ? [auxiliaryLabel] : [])];

  return labels.length > 0 ? labels.join("; ") : "Sin cajas configuradas";
}

export function mapPersistedCajaSetup(params: {
  cajaUserIds: string[];
  primaryCashierId: string | null;
  fallbackTemplateId: string | null;
  templateByUserId: Map<string, string | null | undefined>;
  auxiliaryCashierId?: string | null;
  auxiliaryTemplateId?: string | null;
}): ShiftCajaSetupState {
  const primaryCashierId = params.primaryCashierId ?? "";

  return {
    cashiers: params.cajaUserIds.map((userId, index) => ({
      id: `persisted-${userId}-${index}`,
      user_id: userId,
      template_id:
        params.templateByUserId.get(userId)
        || params.fallbackTemplateId
        || undefined,
      is_primary: Boolean(primaryCashierId) && userId === primaryCashierId,
    })),
    auxiliary: params.auxiliaryCashierId
      ? {
          user_id: params.auxiliaryCashierId,
          template_id: params.auxiliaryTemplateId ?? undefined,
        }
      : null,
  };
}

export function removeCashierFromSetup(
  state: ShiftCajaSetupState,
  userId: string,
): ShiftCajaSetupState {
  return {
    cashiers: state.cashiers.filter((row) => row.user_id !== userId),
    auxiliary: state.auxiliary?.user_id === userId ? null : state.auxiliary,
  };
}

export function replaceCashierInSetup(
  state: ShiftCajaSetupState,
  outgoingUserId: string,
  incomingUserId: string,
): ShiftCajaSetupState {
  return {
    cashiers: state.cashiers.map((row) =>
      row.user_id === outgoingUserId ? { ...row, user_id: incomingUserId } : row,
    ),
    auxiliary: state.auxiliary,
  };
}
