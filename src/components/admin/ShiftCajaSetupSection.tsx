import { Banknote, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ShiftCajaSetupUserOption {
  user_id: string;
  full_name: string;
  username: string;
}

export interface SecondaryCajaRow {
  id: string;
  user_id: string;
  takeout_enabled?: boolean;
  express_enabled?: boolean;
  template_id?: string;
}

export interface CashRegisterTemplateOption {
  id: string;
  name: string;
}

export interface ShiftCajaSetupState {
  primaryCashierId: string;
  secondaryCajasEnabled: boolean;
  secondaryTemplateId: string;
  secondaryCajas: SecondaryCajaRow[];
}

interface Props {
  enabledUsers: ShiftCajaSetupUserOption[];
  templates: CashRegisterTemplateOption[];
  value: ShiftCajaSetupState;
  onChange: (next: ShiftCajaSetupState) => void;
  disabled?: boolean;
}

function nextSecondaryId() {
  return `sec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveSelectUserId(userId: string, options: ShiftCajaSetupUserOption[]) {
  if (!userId) return undefined;
  return options.some((user) => user.user_id === userId) ? userId : undefined;
}

export default function ShiftCajaSetupSection({
  enabledUsers,
  templates,
  value,
  onChange,
  disabled = false,
}: Props) {
  const assignedUserIds = new Set([
    value.primaryCashierId,
    ...value.secondaryCajas.map((row) => row.user_id).filter(Boolean),
  ]);

  const availableForPrimary = enabledUsers;
  const availableForSecondary = (excludeUserId?: string) =>
    enabledUsers.filter(
      (u) =>
        u.user_id &&
        u.user_id !== value.primaryCashierId &&
        (u.user_id === excludeUserId || !assignedUserIds.has(u.user_id)),
    );

  const addSecondaryCaja = () => {
    const candidate = availableForSecondary()[0];
    if (!candidate) return;
    onChange({
      ...value,
      secondaryCajas: [
        ...value.secondaryCajas,
        { id: nextSecondaryId(), user_id: candidate.user_id, takeout_enabled: false, express_enabled: false },
      ],
    });
  };

  const updateSecondaryUser = (rowId: string, userId: string) => {
    onChange({
      ...value,
      secondaryCajas: value.secondaryCajas.map((row) =>
        row.id === rowId ? { ...row, user_id: userId } : row,
      ),
    });
  };

  const updateSecondaryTemplate = (rowId: string, templateId: string | undefined) => {
    onChange({
      ...value,
      secondaryCajas: value.secondaryCajas.map((row) =>
        row.id === rowId ? { ...row, template_id: templateId } : row,
      ),
    });
  };

  const removeSecondary = (rowId: string) => {
    onChange({
      ...value,
      secondaryCajas: value.secondaryCajas.filter((row) => row.id !== rowId),
    });
  };

  const updateSecondaryFlag = (
    rowId: string,
    key: "takeout_enabled" | "express_enabled",
    checked: boolean,
  ) => {
    onChange({
      ...value,
      secondaryCajas: value.secondaryCajas.map((row) =>
        row.id === rowId ? { ...row, [key]: checked } : row,
      ),
    });
  };

  return (
    <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
          <Banknote className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-black text-foreground sm:text-base">Configuracion de caja</h4>
          <p className="text-xs text-muted-foreground">
            Caja principal obligatoria. Cajas secundarias opcionales con arqueo al abrir el turno.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5">
          <Label className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-800">
            Caja principal (obligatoria)
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Este cajero abrira su arqueo al entrar al modulo Caja.
          </p>
          <Select
            value={resolveSelectUserId(value.primaryCashierId, availableForPrimary)}
            onValueChange={(id) => onChange({ ...value, primaryCashierId: id })}
            disabled={disabled || enabledUsers.length === 0}
          >
            <SelectTrigger className="mt-2 h-11 rounded-2xl border-emerald-200 bg-white">
              <SelectValue placeholder="Selecciona cajero principal..." />
            </SelectTrigger>
            <SelectContent>
              {availableForPrimary.map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>
                  {u.full_name || u.username} (@{u.username})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {enabledUsers.length === 0 && (
            <p className="mt-2 text-xs font-medium text-emerald-900">
              Primero agrega usuarios al turno en la seccion &quot;Usuarios habilitados&quot; (mas abajo). Luego podras elegir el cajero principal.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <Checkbox
            checked={value.secondaryCajasEnabled}
            disabled={disabled || enabledUsers.length === 0}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                secondaryCajasEnabled: checked === true,
                secondaryCajas: checked === true ? value.secondaryCajas : [],
                secondaryTemplateId: checked === true ? value.secondaryTemplateId : "",
              })
            }
          />
          <span className="text-sm font-medium text-foreground">
            Habilitar cajas secundarias en este turno
          </span>
        </label>

        {value.secondaryCajasEnabled && (
          <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-3.5">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-900">
                Plantilla general para cajas secundarias
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Arqueo inicial compartido para todas las cajas secundarias del turno.
              </p>
              <Select
                value={value.secondaryTemplateId || undefined}
                onValueChange={(id) => onChange({ ...value, secondaryTemplateId: id })}
                disabled={disabled || templates.length === 0}
              >
                <SelectTrigger className="mt-2 h-11 rounded-2xl border-amber-200 bg-white">
                  <SelectValue placeholder="Selecciona plantilla general..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              {value.secondaryCajas.map((row) => {
                const secondaryOptions = availableForSecondary(row.user_id);
                const secondarySelectValue = resolveSelectUserId(row.user_id, secondaryOptions);

                return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-100 bg-white p-2.5"
                >
                  <div className="min-w-[200px] flex-1">
                    <Select
                      value={secondarySelectValue}
                      onValueChange={(id) => updateSecondaryUser(row.id, id)}
                      disabled={disabled || enabledUsers.length === 0}
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl">
                        <SelectValue placeholder="Cajero secundario..." />
                      </SelectTrigger>
                    <SelectContent>
                      {secondaryOptions.map((u) => (
                        <SelectItem key={u.user_id} value={u.user_id}>
                          {u.full_name || u.username} (@{u.username})
                        </SelectItem>
                      ))}
                    </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="min-w-[180px] flex-1">
                    <Select
                      value={row.template_id || value.secondaryTemplateId || undefined}
                      onValueChange={(val) => updateSecondaryTemplate(row.id, val === value.secondaryTemplateId ? undefined : val)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl">
                        <SelectValue placeholder="Plantilla..." />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
                    <Checkbox
                      checked={Boolean(row.takeout_enabled)}
                      disabled={disabled || !row.user_id}
                      onCheckedChange={(checked) =>
                        updateSecondaryFlag(row.id, "takeout_enabled", checked === true)
                      }
                    />
                    Para llevar
                  </label>
                  <label className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
                    <Checkbox
                      checked={Boolean(row.express_enabled)}
                      disabled={disabled || !row.user_id}
                      onCheckedChange={(checked) =>
                        updateSecondaryFlag(row.id, "express_enabled", checked === true)
                      }
                    />
                    Express
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    className="h-10 w-10 shrink-0 text-destructive"
                    onClick={() => removeSecondary(row.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              disabled={disabled || availableForSecondary().length === 0}
              className="w-full gap-2 rounded-2xl border-amber-300"
              onClick={addSecondaryCaja}
            >
              <Plus className="h-4 w-4" />
              Agregar caja secundaria
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
