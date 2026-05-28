import { Banknote, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ShiftCajaSetupState, ShiftCashierRow } from "@/lib/shiftCajaSetupModel";

export type { ShiftCajaSetupState, ShiftCashierRow };

export interface ShiftCajaSetupUserOption {
  user_id: string;
  full_name: string;
  username: string;
}

export interface CashRegisterTemplateOption {
  id: string;
  name: string;
}

interface Props {
  enabledUsers: ShiftCajaSetupUserOption[];
  templates: CashRegisterTemplateOption[];
  value: ShiftCajaSetupState;
  onChange: (next: ShiftCajaSetupState) => void;
  disabled?: boolean;
}

function nextCashierRowId() {
  return `caja-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
  const assignedUserIds = new Set(value.cashiers.map((row) => row.user_id).filter(Boolean));

  const availableForNewRow = (currentUserId?: string) =>
    enabledUsers.filter(
      (user) =>
        user.user_id &&
        (user.user_id === currentUserId || !assignedUserIds.has(user.user_id)),
    );

  const defaultTemplateId = templates[0]?.id;

  const addCashier = () => {
    const candidate = availableForNewRow()[0];
    if (!candidate) return;
    onChange({
      cashiers: [
        ...value.cashiers,
        {
          id: nextCashierRowId(),
          user_id: candidate.user_id,
          template_id: defaultTemplateId,
          is_primary: value.cashiers.length === 0,
        },
      ],
    });
  };

  const updateCashier = (rowId: string, patch: Partial<ShiftCashierRow>) => {
    onChange({
      cashiers: value.cashiers.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    });
  };

  const setPrimary = (rowId: string, checked: boolean) => {
    onChange({
      cashiers: value.cashiers.map((row) => {
        if (row.id === rowId) {
          return { ...row, is_primary: checked };
        }
        return checked ? { ...row, is_primary: false } : row;
      }),
    });
  };

  const removeCashier = (rowId: string) => {
    onChange({
      cashiers: value.cashiers.filter((row) => row.id !== rowId),
    });
  };

  return (
    <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
          <Banknote className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-black text-foreground sm:text-base">Cajeros del turno</h4>
          <p className="text-xs text-muted-foreground">
            Agrega cada cajero con su plantilla. Marca uno como principal (opcional). Arqueo al abrir turno.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3.5">
        {enabledUsers.length === 0 ? (
          <p className="text-xs font-medium text-emerald-900">
            Primero agrega usuarios en &quot;Usuarios habilitados&quot; (mas abajo).
          </p>
        ) : null}

        <div className="space-y-2">
          {value.cashiers.map((row) => {
            const userOptions = availableForNewRow(row.user_id);
            const userSelectValue = resolveSelectUserId(row.user_id, userOptions);

            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-emerald-100 bg-white p-2.5"
              >
                <div className="min-w-[200px] flex-1">
                  <Select
                    value={userSelectValue}
                    onValueChange={(id) => updateCashier(row.id, { user_id: id })}
                    disabled={disabled || enabledUsers.length === 0}
                  >
                    <SelectTrigger className="h-10 w-full rounded-xl">
                      <SelectValue placeholder="Cajero..." />
                    </SelectTrigger>
                    <SelectContent>
                      {userOptions.map((user) => (
                        <SelectItem key={user.user_id} value={user.user_id}>
                          {user.full_name || user.username} (@{user.username})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[180px] flex-1">
                  <Select
                    value={row.template_id || undefined}
                    onValueChange={(templateId) => updateCashier(row.id, { template_id: templateId })}
                    disabled={disabled || templates.length === 0}
                  >
                    <SelectTrigger className="h-10 w-full rounded-xl">
                      <SelectValue placeholder="Plantilla..." />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
                  <Checkbox
                    checked={row.is_primary}
                    disabled={disabled || !row.user_id}
                    onCheckedChange={(checked) => setPrimary(row.id, checked === true)}
                  />
                  Principal
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  className="h-10 w-10 shrink-0 text-destructive"
                  onClick={() => removeCashier(row.id)}
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
          disabled={disabled || availableForNewRow().length === 0}
          className="w-full gap-2 rounded-2xl border-emerald-300"
          onClick={addCashier}
        >
          <Plus className="h-4 w-4" />
          Agregar cajero
        </Button>
      </div>
    </section>
  );
}
