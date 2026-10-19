import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function parseLibras(raw: string): number {
  const normalized = String(raw ?? "").trim().replace(",", ".");
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

function formatLb(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

type StockRow = {
  ambito: string;
  sucursal_id: string | null;
  sucursal_nombre: string;
  cantidad_libras: number;
};

type EntregaRow = {
  id: string;
  peso_entrega_lb: number;
  entregado_por_nombre: string | null;
  notas: string | null;
  estado: string;
  creado_en: string;
};

export default function GestionPescadoAdmin() {
  const { branches, activeBranchId, permissions, isGlobalAdmin } = useBranch();
  const qc = useQueryClient();

  const canOperateFull =
    isGlobalAdmin
    || canOperate(permissions, "gestion_pescado")
    || canOperate(permissions, "bodega_general")
    || canManage(permissions, "admin_global");

  const canDevolver =
    canOperateFull
    || canManage(permissions, "admin_sucursal")
    || canView(permissions, "gestion_pescado");

  const [pesoEntrega, setPesoEntrega] = useState("");
  const [notasEntrega, setNotasEntrega] = useState("");
  const [entregaRecepcionId, setEntregaRecepcionId] = useState("");
  const [pesoRecepcion, setPesoRecepcion] = useState("");
  const [notasRecepcion, setNotasRecepcion] = useState("");
  const [envioSucursalId, setEnvioSucursalId] = useState("");
  const [envioCantidad, setEnvioCantidad] = useState("");
  const [envioNotas, setEnvioNotas] = useState("");
  const [devolSucursalId, setDevolSucursalId] = useState(activeBranchId ?? "");
  const [devolCantidad, setDevolCantidad] = useState("");
  const [devolNotas, setDevolNotas] = useState("");

  const stockQuery = useQuery({
    queryKey: ["pescado-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("listar_stock_pescado" as any);
      if (error) throw error;
      return ((data as StockRow[]) ?? []).map((r) => ({
        ...r,
        cantidad_libras: Number(r.cantidad_libras ?? 0),
      }));
    },
  });

  const entregasQuery = useQuery({
    queryKey: ["pescado-entregas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pescado_entregas" as any)
        .select("id, peso_entrega_lb, entregado_por_nombre, notas, estado, creado_en")
        .order("creado_en", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data as unknown as EntregaRow[]) ?? []);
    },
    enabled: canOperateFull,
  });

  const movimientosQuery = useQuery({
    queryKey: ["pescado-movimientos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pescado_movimientos" as any)
        .select("id, tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva, registrado_por_nombre, notas, creado_en")
        .order("creado_en", { ascending: false })
        .limit(80);
      if (error) throw error;
      return ((data as unknown as any[]) ?? []);
    },
  });

  const enviosQuery = useQuery({
    queryKey: ["pescado-envios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pescado_envios" as any)
        .select("id, sucursal_destino_id, cantidad_lb, enviado_por_nombre, notas, creado_en")
        .order("creado_en", { ascending: false })
        .limit(40);
      if (error) throw error;
      return ((data as unknown as any[]) ?? []);
    },
  });

  const devolucionesQuery = useQuery({
    queryKey: ["pescado-devoluciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pescado_devoluciones" as any)
        .select("id, sucursal_id, cash_shift_id, cantidad_lb, registrado_por_nombre, notas, creado_en")
        .order("creado_en", { ascending: false })
        .limit(40);
      if (error) throw error;
      return ((data as unknown as any[]) ?? []);
    },
  });

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pescado-stock"] }),
      qc.invalidateQueries({ queryKey: ["pescado-entregas"] }),
      qc.invalidateQueries({ queryKey: ["pescado-movimientos"] }),
      qc.invalidateQueries({ queryKey: ["pescado-envios"] }),
      qc.invalidateQueries({ queryKey: ["pescado-devoluciones"] }),
    ]);
  };

  const entregaMut = useMutation({
    mutationFn: async () => {
      const peso = parseLibras(pesoEntrega);
      if (!peso) throw new Error("Ingresa el peso de entrega en libras");
      const { error } = await supabase.rpc("registrar_entrega_pescado" as any, {
        p_peso_entrega_lb: peso,
        p_notas: notasEntrega.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Entrega registrada. Pendiente de recepción.");
      setPesoEntrega("");
      setNotasEntrega("");
      await invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo registrar la entrega"),
  });

  const pendientes = useMemo(
    () => (entregasQuery.data ?? []).filter((e) => e.estado === "PENDIENTE_RECEPCION"),
    [entregasQuery.data],
  );

  const recepcionMut = useMutation({
    mutationFn: async () => {
      if (!entregaRecepcionId) throw new Error("Selecciona la entrega a recibir");
      const peso = parseLibras(pesoRecepcion);
      if (!peso) throw new Error("Ingresa el peso de recepción en libras");
      const { error } = await supabase.rpc("registrar_recepcion_pescado" as any, {
        p_entrega_id: entregaRecepcionId,
        p_peso_recepcion_lb: peso,
        p_notas: notasRecepcion.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Recepción confirmada. Stock central actualizado.");
      setEntregaRecepcionId("");
      setPesoRecepcion("");
      setNotasRecepcion("");
      await invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo registrar la recepción"),
  });

  const envioMut = useMutation({
    mutationFn: async () => {
      if (!envioSucursalId) throw new Error("Selecciona la sucursal destino");
      const qty = parseLibras(envioCantidad);
      if (!qty) throw new Error("Ingresa la cantidad en libras");
      const { error } = await supabase.rpc("enviar_pescado_sucursal" as any, {
        p_sucursal_destino_id: envioSucursalId,
        p_cantidad_lb: qty,
        p_notas: envioNotas.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Envío registrado.");
      setEnvioCantidad("");
      setEnvioNotas("");
      await invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo enviar"),
  });

  const devolMut = useMutation({
    mutationFn: async () => {
      const sucursal = devolSucursalId || activeBranchId;
      if (!sucursal) throw new Error("Selecciona la sucursal");
      const qty = parseLibras(devolCantidad);
      if (!qty) throw new Error("Ingresa la cantidad en libras");
      const { error } = await supabase.rpc("devolver_pescado_a_central" as any, {
        p_sucursal_id: sucursal,
        p_cantidad_lb: qty,
        p_cash_shift_id: null,
        p_notas: devolNotas.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Devolución registrada. Stock central actualizado.");
      setDevolCantidad("");
      setDevolNotas("");
      await invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo devolver"),
  });

  const branchName = (id: string | null | undefined) =>
    branches.find((b) => b.id === id)?.name ?? id ?? "—";

  const stockCentral = (stockQuery.data ?? []).find((r) => r.ambito === "CENTRAL");
  const stocksSucursal = (stockQuery.data ?? []).filter((r) => r.ambito === "SUCURSAL");

  return (
    <div className="space-y-6">
      <Card className="rounded-[24px] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Stock central</p>
            <p className="mt-1 font-display text-3xl font-black text-sky-950">
              {stockQuery.isLoading ? "…" : formatLb(stockCentral?.cantidad_libras)}{" "}
              <span className="text-base font-semibold text-sky-700">lb</span>
            </p>
          </div>
          <Badge variant="outline" className="border-sky-200 bg-white text-sky-800">
            Separado de nevera / bodega productos
          </Badge>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Stock por sucursal</h2>
        {stockQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : stocksSucursal.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay stock en sucursales.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stocksSucursal.map((row) => (
              <Card key={row.sucursal_id ?? row.sucursal_nombre} className="rounded-2xl border p-3">
                <p className="text-sm font-semibold">{row.sucursal_nombre}</p>
                <p className="mt-1 text-lg font-bold text-sky-800">{formatLb(row.cantidad_libras)} lb</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {canOperateFull && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-[24px] border p-4 space-y-3">
            <h3 className="font-display text-base font-bold">1. Registrar entrega</h3>
            <p className="text-xs text-muted-foreground">
              Quien entrega el pescado cocinado registra el peso en libras.
            </p>
            <div className="space-y-2">
              <Label>Peso entrega (lb)</Label>
              <Input
                inputMode="decimal"
                value={pesoEntrega}
                onChange={(e) => setPesoEntrega(e.target.value)}
                placeholder="Ej. 25.5"
              />
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea value={notasEntrega} onChange={(e) => setNotasEntrega(e.target.value)} rows={2} />
            </div>
            <Button
              className="rounded-2xl"
              disabled={entregaMut.isPending}
              onClick={() => entregaMut.mutate()}
            >
              {entregaMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Registrar entrega
            </Button>
          </Card>

          <Card className="rounded-[24px] border p-4 space-y-3">
            <h3 className="font-display text-base font-bold">2. Registrar recepción</h3>
            <p className="text-xs text-muted-foreground">
              Quien recibe vuelve a pesar. El stock entra con este peso; la diferencia queda como merma.
            </p>
            <div className="space-y-2">
              <Label>Entrega pendiente</Label>
              <Select value={entregaRecepcionId} onValueChange={setEntregaRecepcionId}>
                <SelectTrigger className="rounded-2xl">
                  <SelectValue placeholder="Selecciona entrega…" />
                </SelectTrigger>
                <SelectContent>
                  {pendientes.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {formatLb(e.peso_entrega_lb)} lb · {e.entregado_por_nombre ?? "—"} ·{" "}
                      {new Date(e.creado_en).toLocaleString("es-EC")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Peso recepción (lb)</Label>
              <Input
                inputMode="decimal"
                value={pesoRecepcion}
                onChange={(e) => setPesoRecepcion(e.target.value)}
                placeholder="Ej. 24.8"
              />
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea value={notasRecepcion} onChange={(e) => setNotasRecepcion(e.target.value)} rows={2} />
            </div>
            <Button
              className="rounded-2xl"
              disabled={recepcionMut.isPending || pendientes.length === 0}
              onClick={() => recepcionMut.mutate()}
            >
              {recepcionMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar recepción
            </Button>
          </Card>
        </section>
      )}

      {canOperateFull && (
        <Card className="rounded-[24px] border p-4 space-y-3">
          <h3 className="font-display text-base font-bold">3. Enviar a sucursal</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Sucursal</Label>
              <Select value={envioSucursalId} onValueChange={setEnvioSucursalId}>
                <SelectTrigger className="rounded-2xl">
                  <SelectValue placeholder="Destino…" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cantidad (lb)</Label>
              <Input
                inputMode="decimal"
                value={envioCantidad}
                onChange={(e) => setEnvioCantidad(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={envioNotas} onChange={(e) => setEnvioNotas(e.target.value)} />
            </div>
          </div>
          <Button className="rounded-2xl" disabled={envioMut.isPending} onClick={() => envioMut.mutate()}>
            {envioMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enviar
          </Button>
        </Card>
      )}

      {canDevolver && (
        <Card className="rounded-[24px] border p-4 space-y-3">
          <h3 className="font-display text-base font-bold">4. Devolver sobrante a central</h3>
          <p className="text-xs text-muted-foreground">
            Al cerrar turno, registra lo que sobra en la sucursal para reingresarlo a bodega pescado.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Sucursal</Label>
              <Select
                value={devolSucursalId || activeBranchId || ""}
                onValueChange={setDevolSucursalId}
                disabled={!canOperateFull && Boolean(activeBranchId)}
              >
                <SelectTrigger className="rounded-2xl">
                  <SelectValue placeholder="Sucursal…" />
                </SelectTrigger>
                <SelectContent>
                  {(canOperateFull ? branches : branches.filter((b) => b.id === activeBranchId)).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cantidad (lb)</Label>
              <Input
                inputMode="decimal"
                value={devolCantidad}
                onChange={(e) => setDevolCantidad(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={devolNotas} onChange={(e) => setDevolNotas(e.target.value)} />
            </div>
          </div>
          <Button className="rounded-2xl" disabled={devolMut.isPending} onClick={() => devolMut.mutate()}>
            {devolMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Devolver a central
          </Button>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Entregas recientes</h2>
        {!canOperateFull ? (
          <p className="text-sm text-muted-foreground">Solo operadores de bodega/pescado ven entregas.</p>
        ) : entregasQuery.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Entrega lb</th>
                  <th className="px-3 py-2">Quién</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(entregasQuery.data ?? []).map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2">{new Date(e.creado_en).toLocaleString("es-EC")}</td>
                    <td className="px-3 py-2 font-semibold">{formatLb(e.peso_entrega_lb)}</td>
                    <td className="px-3 py-2">{e.entregado_por_nombre ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          e.estado === "PENDIENTE_RECEPCION"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800",
                        )}
                      >
                        {e.estado === "PENDIENTE_RECEPCION" ? "Pendiente recepción" : "Recibido"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Envíos</h2>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Sucursal</th>
                <th className="px-3 py-2">lb</th>
                <th className="px-3 py-2">Quién</th>
              </tr>
            </thead>
            <tbody>
              {(enviosQuery.data ?? []).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-2">{new Date(e.creado_en).toLocaleString("es-EC")}</td>
                  <td className="px-3 py-2">{branchName(e.sucursal_destino_id)}</td>
                  <td className="px-3 py-2 font-semibold">{formatLb(e.cantidad_lb)}</td>
                  <td className="px-3 py-2">{e.enviado_por_nombre ?? "—"}</td>
                </tr>
              ))}
              {(enviosQuery.data ?? []).length === 0 && (
                <tr><td className="px-3 py-4 text-muted-foreground" colSpan={4}>Sin envíos aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Devoluciones</h2>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Sucursal</th>
                <th className="px-3 py-2">lb</th>
                <th className="px-3 py-2">Quién</th>
              </tr>
            </thead>
            <tbody>
              {(devolucionesQuery.data ?? []).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-2">{new Date(e.creado_en).toLocaleString("es-EC")}</td>
                  <td className="px-3 py-2">{branchName(e.sucursal_id)}</td>
                  <td className="px-3 py-2 font-semibold">{formatLb(e.cantidad_lb)}</td>
                  <td className="px-3 py-2">{e.registrado_por_nombre ?? "—"}</td>
                </tr>
              ))}
              {(devolucionesQuery.data ?? []).length === 0 && (
                <tr><td className="px-3 py-4 text-muted-foreground" colSpan={4}>Sin devoluciones aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Historial / mermas</h2>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Ámbito</th>
                <th className="px-3 py-2">lb</th>
                <th className="px-3 py-2">Antes → Nueva</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(movimientosQuery.data ?? []).map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{new Date(m.creado_en).toLocaleString("es-EC")}</td>
                  <td className="px-3 py-2 font-medium">{m.tipo_movimiento}</td>
                  <td className="px-3 py-2">{m.ambito}</td>
                  <td className="px-3 py-2">{formatLb(m.cantidad_lb)}</td>
                  <td className="px-3 py-2">
                    {formatLb(m.cantidad_anterior)} → {formatLb(m.cantidad_nueva)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{m.notas ?? "—"}</td>
                </tr>
              ))}
              {(movimientosQuery.data ?? []).length === 0 && (
                <tr><td className="px-3 py-4 text-muted-foreground" colSpan={6}>Sin movimientos aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
