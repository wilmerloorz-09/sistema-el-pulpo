import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { bloquearTeclaNoEntera, soloDigitosCantidad } from "@/lib/inventarioProductos";

export interface CierreCajaConteoFila {
  key: string;
  value: number;
  isBill: boolean;
  qtySystem: number;
  qtyCounted: number;
}

interface CierreCajaConteoTablaProps {
  filas: CierreCajaConteoFila[];
  /** Sin esta prop la columna Contado es de solo lectura. */
  edicion?: {
    borrador: Record<string, string>;
    onChange: (key: string, valor: string) => void;
  };
}

const SECCIONES = [
  {
    key: "coin",
    title: "Monedas",
    headerClass: "bg-gradient-to-r from-slate-300 via-slate-100 to-slate-300 text-slate-700",
    rowClass: "bg-slate-100/80",
    isBill: false,
  },
  {
    key: "bill",
    title: "Billetes",
    headerClass: "bg-emerald-200 text-emerald-900",
    rowClass: "bg-emerald-50",
    isBill: true,
  },
];

export default function CierreCajaConteoTabla({ filas, edicion }: CierreCajaConteoTablaProps) {
  const totalSistema = filas.reduce((sum, fila) => sum + fila.value * fila.qtySystem, 0);
  const totalContado = filas.reduce((sum, fila) => sum + fila.value * fila.qtyCounted, 0);
  const diferencia = Math.round((totalContado - totalSistema) * 100) / 100;

  const secciones = SECCIONES
    .map((seccion) => ({ ...seccion, filas: filas.filter((fila) => fila.isBill === seccion.isBill) }))
    .filter((seccion) => seccion.filas.length > 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40 text-[10px] font-bold uppercase text-muted-foreground">
            <th className="px-1.5 py-1 text-right">Valor</th>
            <th className="px-1 py-1 text-right">Cant.</th>
            <th className="px-1 py-1 text-center">Contado</th>
            <th className="px-1 py-1 text-right">Subt.</th>
            <th className="px-1.5 py-1 text-right">Subt. cont.</th>
          </tr>
        </thead>
        {secciones.map((seccion) => (
          <tbody key={seccion.key}>
            <tr className={seccion.headerClass}>
              <td className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" colSpan={5}>
                {seccion.title}
              </td>
            </tr>
            {seccion.filas.map((fila) => {
              const difiere = fila.qtyCounted !== fila.qtySystem;
              return (
                <tr key={fila.key} className={cn("border-b border-white/70", seccion.rowClass)}>
                  <td className="px-1.5 py-0.5 text-right tabular-nums">${fila.value.toFixed(2)}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums">{fila.qtySystem}</td>
                  <td className="px-1 py-0.5">
                    {edicion ? (
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={edicion.borrador[fila.key] ?? ""}
                        placeholder={String(fila.qtySystem)}
                        onKeyDown={bloquearTeclaNoEntera}
                        onChange={(e) => edicion.onChange(fila.key, soloDigitosCantidad(e.target.value))}
                        className={cn(
                          "mx-auto h-7 w-12 rounded-md bg-white px-1.5 py-0 text-right tabular-nums",
                          difiere && "border-amber-400 bg-amber-50 font-semibold",
                        )}
                      />
                    ) : (
                      <div
                        className={cn(
                          "mx-auto w-12 py-1 text-center tabular-nums",
                          difiere && "font-semibold text-amber-700",
                        )}
                      >
                        {fila.qtyCounted}
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-0.5 text-right tabular-nums">${(fila.value * fila.qtySystem).toFixed(2)}</td>
                  <td
                    className={cn(
                      "px-1.5 py-0.5 text-right tabular-nums",
                      difiere && "font-semibold text-amber-700",
                    )}
                  >
                    ${(fila.value * fila.qtyCounted).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t border-border/70 bg-muted/30 font-bold">
            <td className="px-1.5 py-1" colSpan={3}>Total</td>
            <td className="px-1 py-1 text-right tabular-nums">${totalSistema.toFixed(2)}</td>
            <td className="px-1.5 py-1 text-right tabular-nums">${totalContado.toFixed(2)}</td>
          </tr>
          <tr
            className={cn(
              "font-bold",
              diferencia === 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
            )}
          >
            <td className="px-1.5 py-1" colSpan={3}>Diferencia</td>
            <td className="px-1.5 py-1 text-right tabular-nums" colSpan={2}>
              {diferencia > 0 ? "+" : ""}${diferencia.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
