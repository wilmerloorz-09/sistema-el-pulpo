import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Loader2, Printer, QrCode, RefreshCw, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import {
  generarTokensQrMesasSucursal,
  type TokenQrMesaGenerado,
  urlAutopedidoQr,
} from "@/services/autopedidosQrDb";

type TokenConImagen = TokenQrMesaGenerado & { qrDataUrl: string };

async function enrichTokensWithQr(tokens: TokenQrMesaGenerado[]): Promise<TokenConImagen[]> {
  return Promise.all(
    tokens.map(async (token) => {
      const url = urlAutopedidoQr(token.token_seguro);
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 280,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      return { ...token, qrDataUrl };
    }),
  );
}

const QrMesasAdmin = () => {
  const qc = useQueryClient();
  const { activeBranch, activeBranchId } = useBranch();
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineOk, setInlineOk] = useState<string | null>(null);

  const existingQuery = useQuery({
    queryKey: ["tokens-qr-mesas", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      if (!activeBranchId) return [];

      const [{ data: tokens, error: tokensError }, { data: mesas, error: mesasError }] = await Promise.all([
        supabase
          .from("tokens_qr_mesas" as any)
          .select("id, mesa_id, token_seguro, activo")
          .eq("sucursal_id", activeBranchId)
          .eq("activo", true),
        supabase
          .from("restaurant_tables")
          .select("id, name, visual_order")
          .eq("branch_id", activeBranchId),
      ]);

      if (tokensError) throw tokensError;
      if (mesasError) throw mesasError;

      const mesaById = new Map((mesas ?? []).map((m) => [m.id, m]));
      const mapped: TokenQrMesaGenerado[] = ((tokens as any[]) ?? []).map((row) => {
        const mesa = mesaById.get(row.mesa_id);
        return {
          token_id: row.id,
          mesa_id: row.mesa_id,
          mesa_nombre: mesa?.name ?? "Mesa",
          mesa_visual_order: Number(mesa?.visual_order ?? 0),
          token_seguro: row.token_seguro,
          creado: false,
        };
      });

      mapped.sort((a, b) => a.mesa_visual_order - b.mesa_visual_order);
      return enrichTokensWithQr(mapped);
    },
  });

  const displayTokens = existingQuery.data ?? [];

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa.");
      const generated = await generarTokensQrMesasSucursal(activeBranchId, 20);
      return enrichTokensWithQr(generated);
    },
    onSuccess: async () => {
      setInlineError(null);
      setInlineOk("Códigos QR generados/actualizados. Los tokens ya impresos se conservan.");
      await qc.invalidateQueries({ queryKey: ["tokens-qr-mesas", activeBranchId] });
    },
    onError: (err: Error) => {
      setInlineOk(null);
      setInlineError(err.message || "No se pudieron generar los códigos QR.");
    },
  });

  const printTitle = useMemo(
    () => `Códigos QR — ${activeBranch?.name ?? "Sucursal"}`,
    [activeBranch?.name],
  );

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground">
        Selecciona una sucursal para generar códigos QR de mesas.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-orange-200 bg-gradient-to-br from-white via-orange-50/65 to-amber-50/75 p-5 shadow-sm print:hidden">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-white text-primary shadow-sm">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-black text-foreground">Autopedidos QR en mesa</h3>
              <p className="text-sm text-muted-foreground">
                Genera o actualiza tokens para hasta 20 mesas de{" "}
                <span className="font-semibold text-foreground">{activeBranch?.name}</span>.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="h-11 min-w-[11rem] rounded-2xl px-4 font-bold"
            >
              {generateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Generar Códigos QR
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
              disabled={displayTokens.length === 0}
              className="h-11 rounded-2xl px-4 font-bold"
            >
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
          </div>
        </div>

        {inlineError ? (
          <p role="alert" className="mb-3 text-sm font-medium text-destructive">
            {inlineError}
          </p>
        ) : null}
        {inlineOk ? (
          <p role="status" className="mb-3 text-sm font-medium text-emerald-700">
            {inlineOk}
          </p>
        ) : null}

        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-900">
          <div className="flex items-start gap-2">
            <TableProperties className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              URL de cada mesa: <code className="rounded bg-white/80 px-1">/qr-pedido/:token_seguro</code>.
              Los tokens existentes se conservan al regenerar para no invalidar QR ya impresos.
            </p>
          </div>
        </div>
      </div>

      {existingQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 print:hidden">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : existingQuery.isError ? (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive print:hidden"
        >
          {(existingQuery.error as Error)?.message || "No se pudieron cargar los códigos QR."}
        </p>
      ) : displayTokens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-6 text-center text-sm text-muted-foreground print:hidden">
          Aún no hay códigos. Pulsa <strong>Generar Códigos QR</strong>.
        </div>
      ) : (
        <div className="print-qr-root space-y-3">
          <h2 className="hidden print:block text-center text-xl font-black">{printTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 print:grid-cols-2">
            {displayTokens.map((token) => (
              <article
                key={token.token_id}
                className="flex flex-col items-center rounded-2xl border border-orange-200 bg-white p-4 text-center shadow-sm print:break-inside-avoid"
              >
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Mesa {token.mesa_visual_order || "—"}
                </p>
                <p className="mb-3 font-display text-lg font-black text-foreground">{token.mesa_nombre}</p>
                <img
                  src={token.qrDataUrl}
                  alt={`QR ${token.mesa_nombre}`}
                  className="h-40 w-40 rounded-xl border border-orange-100 bg-white object-contain"
                />
                <p className="mt-3 max-w-full truncate text-[10px] text-muted-foreground print:hidden">
                  {urlAutopedidoQr(token.token_seguro)}
                </p>
                <p className="mt-1 text-xs font-semibold text-foreground">Escanea para pedir</p>
              </article>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-qr-root, .print-qr-root * { visibility: visible !important; }
          .print-qr-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 12px;
          }
        }
      `}</style>
    </div>
  );
};

export default QrMesasAdmin;
