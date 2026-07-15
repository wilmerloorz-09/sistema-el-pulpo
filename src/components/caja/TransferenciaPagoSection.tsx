import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera } from "lucide-react";
import type { Banco } from "@/hooks/useBancosActivos";
import type { TransferenciaPagoDatos } from "@/lib/transferenciaPago";
import { formatTransferenciaMontoInput } from "@/lib/transferenciaPago";
import TransferenciaPagoDialog from "@/components/caja/TransferenciaPagoDialog";

interface Props {
  transferDatos: TransferenciaPagoDatos | null;
  onTransferDatosChange: (datos: TransferenciaPagoDatos | null) => void;
  netChargeTotal: number;
  bancos: Banco[];
  readOnly?: boolean;
  className?: string;
}

export default function TransferenciaPagoSection({
  transferDatos,
  onTransferDatosChange,
  netChargeTotal,
  bancos,
  readOnly = false,
  className,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const displayValue = transferDatos?.monto
    ? formatTransferenciaMontoInput(transferDatos.monto)
    : "";
  const tieneFoto = Boolean(transferDatos?.fotoArchivo);

  return (
    <>
      <div
        className={
          className
          ?? "flex min-h-[100px] min-w-0 flex-col justify-center gap-2 rounded-2xl border border-violet-200 bg-violet-50/60 px-2.5 py-2.5 shadow-sm xl:max-w-[9.25rem]"
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || bancos.length === 0}
          onClick={() => setDialogOpen(true)}
          className="h-9 rounded-xl border-violet-300 bg-white font-semibold text-violet-800 hover:bg-violet-100"
        >
          Transferencia
          {tieneFoto ? <Camera className="ml-1.5 h-3.5 w-3.5" aria-label="Con foto" /> : null}
        </Button>
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={displayValue}
          readOnly
          disabled
          className="h-10 rounded-xl border-violet-200 bg-white/80 px-2 text-base font-semibold tabular-nums text-slate-700"
        />
      </div>

      <TransferenciaPagoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        bancos={bancos}
        netChargeTotal={netChargeTotal}
        readOnly={readOnly}
        initialDatos={transferDatos}
        onConfirm={onTransferDatosChange}
      />
    </>
  );
}
