import { ArrowRightLeft, Banknote, Coins, Plus, Trash2 } from "lucide-react";
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
import { getUserAlias } from "@/lib/userDisplay";

export type { ShiftCajaSetupState, ShiftCashierRow };

export interface ShiftCajaSetupUserOption {
  user_id: string;
  full_name: string;
  username: string;
  alias: string;
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
  replaceEligibleUserIds?: ReadonlySet<string>;
  onReplaceCashier?: (userId: string) => void;
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
  replaceEligibleUserIds,
  onReplaceCashier,
}: Props) {
  const assignedUserIds = new Set(
    [...value.cashiers.map((row) => row.user_id), value.auxiliary?.user_id].filter(Boolean),
  );

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
      auxiliary: value.auxiliary,
    });
  };

  const updateCashier = (rowId: string, patch: Partial<ShiftCashierRow>) => {
    onChange({
      cashiers: value.cashiers.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      auxiliary: value.auxiliary,
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
      auxiliary: value.auxiliary,
    });
  };

  const removeCashier = (rowId: string) => {
    onChange({
      cashiers: value.cashiers.filter((row) => row.id !== rowId),
      auxiliary: value.auxiliary,
    });
  };

  const auxiliaryUserOptions = enabledUsers.filter(
    (user) =>
      user.user_id === value.auxiliary?.user_id
      || !value.cashiers.some((row) => row.user_id === user.user_id),
  );

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

        {templates.length === 0 && enabledUsers.length > 0 ? (
          <p className="text-xs font-medium text-red-600">
            No hay plantillas de caja activas para esta sucursal. Crea una plantilla de arqueo en el módulo Caja antes de asignar cajeros.
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
                          {getUserAlias(user)}
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
                      <SelectValue placeholder={templates.length === 0 ? "Sin plantillas..." : "Plantilla..."} />
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

                {row.user_id &&
                replaceEligibleUserIds?.has(row.user_id) &&
                onReplaceCashier ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    className="h-10 shrink-0 gap-1.5 rounded-xl border-amber-300 text-amber-900 hover:bg-amber-50"
                    onClick={() => onReplaceCashier(row.user_id)}
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                    Reemplazar
                  </Button>
                ) : null}

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

      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/50 p-3.5">
        <div className="mb-3 flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white text-sky-700">
            <Coins className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-black text-sky-950">Caja auxiliar de cambio (opcional)</p>
            <p className="text-xs text-sky-800/80">
              Si la configuras, se abre automáticamente. Su responsable no podrá cobrar ni estar asignado como cajero.
            </p>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Select
            value={value.auxiliary?.user_id || undefined}
            onValueChange={(userId) =>
              onChange({
                cashiers: value.cashiers,
                auxiliary: {
                  user_id: userId,
                  template_id: value.auxiliary?.template_id ?? defaultTemplateId,
                },
              })
            }
            disabled={disabled || auxiliaryUserOptions.length === 0}
          >
            <SelectTrigger className="h-10 w-full rounded-xl bg-white">
              <SelectValue placeholder="Responsable de caja auxiliar..." />
            </SelectTrigger>
            <SelectContent>
              {auxiliaryUserOptions.map((user) => (
                <SelectItem key={user.user_id} value={user.user_id}>
                  {getUserAlias(user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={value.auxiliary?.template_id || undefined}
            onValueChange={(templateId) =>
              onChange({
                cashiers: value.cashiers,
                auxiliary: value.auxiliary
                  ? { ...value.auxiliary, template_id: templateId }
                  : { user_id: "", template_id: templateId },
              })
            }
            disabled={disabled || templates.length === 0}
          >
            <SelectTrigger className="h-10 w-full rounded-xl bg-white">
              <SelectValue placeholder={templates.length === 0 ? "Sin plantillas..." : "Plantilla de apertura..."} />
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
      </div>
    </section>
  );
}
