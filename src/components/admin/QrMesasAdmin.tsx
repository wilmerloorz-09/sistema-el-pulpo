import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, QrCode, RefreshCw, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { generateQrDataUrlWithLogo } from "@/lib/qrCodeWithLogo";
import {
  generarTokensQrMesasSucursal,
  listarTokensQrMesasSucursal,
  type TokenQrMesaGenerado,
  urlAutopedidoQr,
} from "@/services/autopedidosQrDb";

type TokenConImagen = TokenQrMesaGenerado & { qrDataUrl: string };

const LIMITE_MAX_MESAS = 100;

function isMissingSchemaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("schema cache") ||
    lower.includes("tokens_qr_mesas") ||
    lower.includes("generar_tokens_qr_mesas_sucursal") ||
    lower.includes("listar_tokens_qr_mesas_sucursal") ||
    lower.includes("could not find the table") ||
    lower.includes("could not find the function")
  );
}

function formatSchemaError(message: string): string {
  if (isMissingSchemaError(message)) {
    return (
      "Falta aplicar la migración SQL de autopedidos QR en Supabase " +
      "(archivo supabase/migrations/20260716000000_autopedidos_qr.sql). " +
      "Hasta que exista la tabla tokens_qr_mesas y la función generar_tokens_qr_mesas_sucursal, esta pantalla no puede operar."
    );
  }
  return message;
}

async function enrichTokensWithQr(tokens: TokenQrMesaGenerado[]): Promise<TokenConImagen[]> {
  return Promise.all(
    tokens.map(async (token) => {
      const url = urlAutopedidoQr(token.token_seguro);
      const qrDataUrl = await generateQrDataUrlWithLogo(url, {
        width: 280,
        margin: 1,
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
  const [cantidadMesas, setCantidadMesas] = useState(20);

  const branchTablesQuery = useQuery({
    queryKey: ["admin-qr-mesas-capacidad", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      if (!activeBranchId) return { referenceCount: 20, generatedCount: 0 };

      const [{ data: branch, error: branchError }, { count, error: countError }] = await Promise.all([
        supabase
          .from("branches")
          .select("reference_table_count")
          .eq("id", activeBranchId)
          .single(),
        supabase
          .from("restaurant_tables")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", activeBranchId),
      ]);

      if (branchError) throw branchError;
      if (countError) throw countError;

      const referenceCount = Math.max(1, Number(branch?.reference_table_count ?? 20));
      const generatedCount = Number(count ?? 0);
      return { referenceCount, generatedCount };
    },
  });

  useEffect(() => {
    if (!branchTablesQuery.data) return;
    const suggested = Math.min(
      LIMITE_MAX_MESAS,
      Math.max(
        1,
        branchTablesQuery.data.generatedCount || branchTablesQuery.data.referenceCount || 20,
      ),
    );
    setCantidadMesas(suggested);
  }, [branchTablesQuery.data]);

  const existingQuery = useQuery({
    queryKey: ["tokens-qr-mesas", activeBranchId],
    enabled: !!activeBranchId,
    retry: false,
    queryFn: async () => {
      if (!activeBranchId) return [];
      try {
        const rows = await listarTokensQrMesasSucursal(activeBranchId);
        const mapped: TokenQrMesaGenerado[] = rows.map((row) => ({
          token_id: row.token_id,
          mesa_id: row.mesa_id,
          mesa_nombre: row.mesa_nombre,
          mesa_visual_order: row.mesa_visual_order,
          token_seguro: row.token_seguro,
          creado: false,
        }));
        mapped.sort((a, b) => a.mesa_visual_order - b.mesa_visual_order);
        return enrichTokensWithQr(mapped);
      } catch (err) {
        throw new Error(formatSchemaError(err instanceof Error ? err.message : String(err)));
      }
    },
  });

  const sharedGroupHint = useMemo(() => {
    const name = activeBranch?.name ?? "";
    if (/el pulpo 1/i.test(name) && /(mañana|manana|tarde)/i.test(name)) {
      return "Esta sucursal comparte QR con El Pulpo 1 (Mañana y Tarde): al escanear se usa el turno abierto más reciente.";
    }
    return null;
  }, [activeBranch?.name]);

  const displayTokens = existingQuery.data ?? [];
  const limiteNormalizado = Math.max(1, Math.min(LIMITE_MAX_MESAS, Math.trunc(cantidadMesas || 1)));

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa.");
      if (limiteNormalizado < 1) throw new Error("Indica al menos 1 mesa.");

      // Asegura que existan filas de mesas físicas antes de generar tokens.
      const { error: ensureError } = await supabase.rpc("ensure_branch_table_capacity", {
        p_branch_id: activeBranchId,
        p_requested_count: limiteNormalizado,
      });
      if (ensureError) throw new Error(ensureError.message);

      try {
        return await generarTokensQrMesasSucursal(activeBranchId, limiteNormalizado);
      } catch (err) {
        throw new Error(formatSchemaError(err instanceof Error ? err.message : String(err)));
      }
    },
    onSuccess: async (generated) => {
      setInlineError(null);
      const creados = generated.filter((t) => t.creado).length;
      const reutilizados = generated.length - creados;
      setInlineOk(
        sharedGroupHint
          ? `Listo: ${generated.length} QR (Mañana/Tarde compartidos). ${creados} nuevos, ${reutilizados} reutilizados. Imprime las ${generated.length} mesas.`
          : creados > 0
            ? `Listo: ${generated.length} mesas con QR (${creados} tokens nuevos). Imprime y coloca en las mesas.`
            : `Listo: ${generated.length} códigos QR listos. Puedes reimprimir.`,
      );

      const sorted = [...generated].sort(
        (a, b) => a.mesa_visual_order - b.mesa_visual_order || a.mesa_nombre.localeCompare(b.mesa_nombre, "es"),
      );
      const enriched = await enrichTokensWithQr(sorted);
      qc.setQueryData(["tokens-qr-mesas", activeBranchId], enriched);

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tokens-qr-mesas", activeBranchId] }),
        qc.invalidateQueries({ queryKey: ["admin-qr-mesas-capacidad", activeBranchId] }),
        qc.invalidateQueries({ queryKey: ["tables-with-status"] }),
      ]);
    },
    onError: (err: Error) => {
      setInlineOk(null);
      setInlineError(formatSchemaError(err.message || "No se pudieron generar los códigos QR."));
    },
  });

  const printTitle = useMemo(
    () =>
      sharedGroupHint
        ? `Códigos QR — El Pulpo 1 (Mañana / Tarde)`
        : `Códigos QR — ${activeBranch?.name ?? "Sucursal"}`,
    [activeBranch?.name, sharedGroupHint],
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
                Genera o actualiza tokens para{" "}
                <span className="font-semibold text-foreground">{activeBranch?.name}</span>.
              </p>
              {sharedGroupHint ? (
                <p className="mt-1 text-xs font-medium text-emerald-700">{sharedGroupHint}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="cantidad-mesas-qr" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cantidad de mesas
            </Label>
            <NumericInput
              id="cantidad-mesas-qr"
              mode="integer"
              min={1}
              max={LIMITE_MAX_MESAS}
              value={cantidadMesas}
              onValueChange={setCantidadMesas}
              showStepButtons
              className="h-11 w-36 rounded-2xl text-center text-lg font-black"
            />
            <p className="text-xs text-muted-foreground">
              Máximo {LIMITE_MAX_MESAS}. Sugerido:{" "}
              {branchTablesQuery.data?.generatedCount ||
                branchTablesQuery.data?.referenceCount ||
                "—"}{" "}
              mesas en sucursal.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pb-6">
            <Button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || limiteNormalizado < 1}
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
          {formatSchemaError((existingQuery.error as Error)?.message || "No se pudieron cargar los códigos QR.")}
        </p>
      ) : displayTokens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-6 text-center text-sm text-muted-foreground print:hidden">
          Aún no hay códigos. Elige la cantidad de mesas y pulsa <strong>Generar Códigos QR</strong>.
        </div>
      ) : (
        <div className="print-qr-root space-y-3">
          <div className="flex items-center justify-between gap-2 print:hidden">
            <p className="text-sm font-semibold text-foreground">
              {displayTokens.length} código(s) QR
            </p>
          </div>
          <h2 className="hidden print:block text-center text-xl font-black">{printTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 print:grid-cols-2">
            {displayTokens.map((token) => (
              <article
                key={`${token.mesa_id}-${token.token_id}-${token.mesa_visual_order}`}
                className="flex flex-col items-center rounded-2xl border border-orange-200 bg-white p-4 text-center shadow-sm print:break-inside-avoid"
              >
                <p className="mb-3 font-display text-lg font-black text-foreground">
                  {token.mesa_nombre?.trim() || `Mesa ${token.mesa_visual_order || "—"}`}
                </p>
                <img
                  src={token.qrDataUrl}
                  alt={`QR ${token.mesa_nombre}`}
                  className="h-40 w-40 rounded-xl border border-orange-100 bg-white object-contain"
                />
                <p className="mt-3 text-xs font-semibold text-foreground">Escanea para pedir</p>
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
