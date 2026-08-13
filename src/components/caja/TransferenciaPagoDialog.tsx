import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Camera,
  CheckCircle2,
  CopyCheck,
  Loader2,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import type { Banco } from "@/hooks/useBancosActivos";
import type { TransferenciaPagoDatos } from "@/lib/transferenciaPago";
import {
  formatTransferenciaMontoInput,
  parseTransferenciaMontoInput,
} from "@/lib/transferenciaPago";
import {
  existeTransferenciaDuplicada,
  MENSAJE_TRANSFERENCIA_DUPLICADA,
} from "@/lib/transferenciaDuplicada";
import {
  analizarComprobanteTransferencia,
  buscarBancoDetectado,
  type AnalisisComprobanteTransferencia,
} from "@/services/analisisComprobanteTransferencia";
import { useCuentasBancariasDestinoActivas } from "@/hooks/useCuentasBancariasDestino";
import { useFeriadosBancariosActivos } from "@/hooks/useFeriadosBancarios";
import {
  validarComprobanteContraCuentas,
  type ResultadoValidacionComprobante,
} from "@/lib/validacionComprobanteTransferencia";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bancos: Banco[];
  netChargeTotal: number;
  readOnly?: boolean;
  initialDatos?: TransferenciaPagoDatos | null;
  onConfirm: (datos: TransferenciaPagoDatos) => void;
}

export default function TransferenciaPagoDialog({
  open,
  onOpenChange,
  bancos,
  netChargeTotal,
  readOnly = false,
  initialDatos,
  onConfirm,
}: Props) {
  const { data: cuentasDestino = [], error: cuentasDestinoError } =
    useCuentasBancariasDestinoActivas(open);
  const { data: feriados = [] } = useFeriadosBancariosActivos(open);
  const [bancoId, setBancoId] = useState("");
  const [numeroTransferencia, setNumeroTransferencia] = useState("");
  const [montoInput, setMontoInput] = useState("");
  const [validando, setValidando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [fotoArchivo, setFotoArchivo] = useState<File | Blob | null>(null);
  const [fotoVistaPreviaUrl, setFotoVistaPreviaUrl] = useState<string | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState(false);
  const [analizandoFoto, setAnalizandoFoto] = useState(false);
  const [lecturaMensaje, setLecturaMensaje] = useState<string | null>(null);
  const [lecturaExitosa, setLecturaExitosa] = useState(false);
  const [analisisIa, setAnalisisIa] =
    useState<AnalisisComprobanteTransferencia | null>(null);
  const [motivoAceptacion, setMotivoAceptacion] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);
  const analisisRequestRef = useRef(0);

  const revokeLocalPreview = () => {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
      localPreviewRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      setFotoAmpliada(false);
      return;
    }
    setErrorMensaje(null);
    setAnalizandoFoto(false);
    setLecturaMensaje(null);
    setLecturaExitosa(false);
    setAnalisisIa(initialDatos?.analisisIa ?? null);
    setMotivoAceptacion(initialDatos?.motivoAceptacion ?? "");
    setFotoAmpliada(false);
    setBancoId(initialDatos?.bancoId ?? bancos[0]?.id ?? "");
    setNumeroTransferencia(initialDatos?.numeroTransferencia ?? "");
    setMontoInput(
      initialDatos?.monto
        ? formatTransferenciaMontoInput(initialDatos.monto)
        : "",
    );
    revokeLocalPreview();
    setFotoArchivo(initialDatos?.fotoArchivo ?? null);
    setFotoVistaPreviaUrl(initialDatos?.fotoVistaPreviaUrl ?? null);
  }, [open, initialDatos?.bancoId, initialDatos?.numeroTransferencia, initialDatos?.monto, initialDatos?.fotoArchivo, initialDatos?.fotoVistaPreviaUrl, initialDatos?.analisisIa, initialDatos?.motivoAceptacion, bancos]);

  useEffect(() => () => revokeLocalPreview(), []);

  const handleExacto = () => {
    const current = parseTransferenciaMontoInput(montoInput);
    const isExact = Math.abs(current - netChargeTotal) < 0.005;
    if (isExact) {
      setMontoInput("");
      return;
    }
    setMontoInput(netChargeTotal.toFixed(2));
  };

  const analizarFoto = async (imagen: File | Blob) => {
    const requestId = analisisRequestRef.current + 1;
    analisisRequestRef.current = requestId;
    setAnalizandoFoto(true);
    setLecturaMensaje("Leyendo número, valor y banco...");
    setLecturaExitosa(false);

    try {
      const montoActual = parseTransferenciaMontoInput(montoInput);
      const resultado = await analizarComprobanteTransferencia(
        imagen,
        bancos,
        montoActual > 0 ? montoActual : netChargeTotal,
      );
      if (analisisRequestRef.current !== requestId) return;

      setAnalisisIa(resultado);
      setMotivoAceptacion("");
      const bancoDetectado = buscarBancoDetectado(resultado.bancoOrigen, bancos);
      if (resultado.numeroTransferencia) {
        setNumeroTransferencia(resultado.numeroTransferencia);
      }
      if (resultado.monto) {
        setMontoInput(formatTransferenciaMontoInput(resultado.monto));
      }
      if (bancoDetectado) {
        setBancoId(bancoDetectado.id);
      }

      const camposLeidos = [
        resultado.numeroTransferencia ? "número" : null,
        resultado.monto ? "valor" : null,
        bancoDetectado ? "banco" : null,
        resultado.cuentaDestino ? "cuenta destino" : null,
        resultado.titularDestino ? "titular" : null,
        resultado.fechaTransferencia ? "fecha" : null,
      ].filter(Boolean);
      const hayDatos = camposLeidos.length > 0;
      setLecturaExitosa(hayDatos);
      if (hayDatos) {
        const necesitaRevision = resultado.confianza < 0.75;
        setLecturaMensaje(
          `IA completó ${camposLeidos.join(", ")}. ${
            necesitaRevision
              ? "La lectura tiene baja confianza; revisa los datos."
              : "Revisa los datos antes de aceptar."
          }`,
        );
      } else {
        setLecturaMensaje(
          resultado.observaciones
          || "La IA no encontró datos legibles. Puedes ingresarlos manualmente.",
        );
      }
    } catch (error) {
      if (analisisRequestRef.current !== requestId) return;
      setAnalisisIa({
        numeroTransferencia: null,
        monto: null,
        bancoOrigen: null,
        bancoDestino: null,
        titularDestino: null,
        cuentaDestino: null,
        fechaTransferencia: null,
        confianza: 0,
        observaciones:
          error instanceof Error && error.message
            ? error.message
            : "No se pudo leer la foto.",
      });
      setMotivoAceptacion("");
      setLecturaExitosa(false);
      setLecturaMensaje(
        error instanceof Error && error.message
          ? error.message
          : "No se pudo leer la foto. Ingresa los datos manualmente.",
      );
    } finally {
      if (analisisRequestRef.current === requestId) setAnalizandoFoto(false);
    }
  };

  const handleFotoSeleccionada = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMensaje("Selecciona una imagen del comprobante.");
      return;
    }
    revokeLocalPreview();
    const previewUrl = URL.createObjectURL(file);
    localPreviewRef.current = previewUrl;
    setFotoArchivo(file);
    setFotoVistaPreviaUrl(previewUrl);
    setErrorMensaje(null);
    setAnalisisIa(null);
    setMotivoAceptacion("");
    void analizarFoto(file);
  };

  const handleQuitarFoto = () => {
    analisisRequestRef.current += 1;
    revokeLocalPreview();
    setFotoArchivo(null);
    setFotoVistaPreviaUrl(null);
    setFotoAmpliada(false);
    setAnalizandoFoto(false);
    setLecturaMensaje(null);
    setLecturaExitosa(false);
    setAnalisisIa(null);
    setMotivoAceptacion("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirm = async () => {
    const monto = parseTransferenciaMontoInput(montoInput);
    if (!bancoId) return;
    if (!numeroTransferencia.trim()) return;
    if (monto <= 0) return;
    if (analizandoFoto) {
      setErrorMensaje("Espera a que termine la lectura del comprobante.");
      return;
    }
    if (requiereMotivo && motivoAceptacion.trim().length < 5) {
      setErrorMensaje("Escribe el motivo por el que aceptas el comprobante con novedades.");
      return;
    }

    setValidando(true);
    setErrorMensaje(null);
    try {
      const duplicada = await existeTransferenciaDuplicada(bancoId, numeroTransferencia);
      if (duplicada) {
        setErrorMensaje(MENSAJE_TRANSFERENCIA_DUPLICADA);
        return;
      }

      // El padre conserva la URL; no revocar al confirmar.
      localPreviewRef.current = null;
      onConfirm({
        bancoId,
        numeroTransferencia: numeroTransferencia.trim(),
        monto,
        fotoArchivo: fotoArchivo ?? null,
        fotoVistaPreviaUrl: fotoVistaPreviaUrl ?? null,
        analisisIa,
        validacionComprobante,
        motivoAceptacion: requiereMotivo ? motivoAceptacion.trim() : null,
      });
      onOpenChange(false);
    } catch {
      setErrorMensaje("No se pudo validar el numero de transferencia. Intenta de nuevo.");
    } finally {
      setValidando(false);
    }
  };

  const montoActual = parseTransferenciaMontoInput(montoInput);
  const isExact = Math.abs(montoActual - netChargeTotal) < 0.005;
  const validacionComprobante: ResultadoValidacionComprobante | null = analisisIa
    ? validarComprobanteContraCuentas({
        analisis: analisisIa,
        cuentas: cuentasDestino,
        bancos,
        bancoOrigenId: bancoId,
        montoEsperado: montoActual,
        feriados,
      })
    : null;
  const requiereMotivo = Boolean(
    fotoArchivo
    && validacionComprobante
    && validacionComprobante.estado !== "VALIDADO",
  );
  const motivoValido = !requiereMotivo || motivoAceptacion.trim().length >= 5;

  const handleNumeroChange = (value: string) => {
    setErrorMensaje(null);
    setNumeroTransferencia(value);
  };

  const mostrandoAmpliada = fotoAmpliada && Boolean(fotoVistaPreviaUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-md",
          // Modo normal: altura acotada al safe area y pie fijo para que Cancelar/Aceptar
          // no queden detrás de la barra del sistema en móvil/tablet.
          !mostrandoAmpliada
            && "flex max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem)] flex-col gap-3 overflow-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:max-h-[90vh] sm:p-6 sm:pb-6",
          // Modo ampliado: el mismo diálogo ocupa toda la pantalla (móvil primero).
          mostrandoAmpliada
            && "flex h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] flex-col gap-0 overflow-hidden rounded-none border-0 bg-zinc-950 p-0 sm:max-h-[100dvh] sm:max-w-[100vw] sm:rounded-none sm:p-0 [&>button]:hidden",
        )}
        onEscapeKeyDown={(e) => {
          if (mostrandoAmpliada) {
            e.preventDefault();
            setFotoAmpliada(false);
          }
        }}
        onPointerDownOutside={(e) => {
          if (mostrandoAmpliada) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (mostrandoAmpliada) e.preventDefault();
        }}
      >
        {mostrandoAmpliada ? (
          <>
            <DialogTitle className="sr-only">Comprobante ampliado</DialogTitle>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
              <p className="text-sm font-semibold text-white">
                Lee el número y escríbelo abajo
              </p>
              <button
                type="button"
                onClick={() => setFotoAmpliada(false)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white transition-colors hover:bg-white/20"
                aria-label="Cerrar ampliación"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Foto grande; se encoge cuando aparece el teclado y sigue visible */}
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-black">
              <img
                src={fotoVistaPreviaUrl ?? undefined}
                alt="Comprobante ampliado"
                className="mx-auto block h-full w-full object-contain"
              />
            </div>

            {/* Dock inferior: input siempre accesible */}
            <div className="shrink-0 border-t border-white/15 bg-zinc-900 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
              <Label htmlFor="transfer-numero-ampliado" className="text-white">
                Número de transferencia
              </Label>
              <Input
                id="transfer-numero-ampliado"
                value={numeroTransferencia}
                onChange={(e) => handleNumeroChange(e.target.value)}
                disabled={readOnly}
                placeholder="Escribe el número del comprobante"
                autoComplete="off"
                className="mt-1.5 h-12 border-white/20 bg-white font-mono text-base text-foreground"
              />
              <Button
                type="button"
                className="mt-3 h-12 w-full text-base font-semibold"
                onClick={() => setFotoAmpliada(false)}
              >
                Listo
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>Registrar transferencia</DialogTitle>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-1">
              {errorMensaje ? (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
                >
                  {errorMensaje}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="transfer-banco">Banco de origen</Label>
                <Select
                  value={bancoId}
                  onValueChange={(value) => {
                    setErrorMensaje(null);
                    setBancoId(value);
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger id="transfer-banco">
                    <SelectValue placeholder="Selecciona un banco" />
                  </SelectTrigger>
                  <SelectContent>
                    {bancos.map((banco) => (
                      <SelectItem key={banco.id} value={banco.id}>
                        {banco.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transfer-numero">Número de transferencia</Label>
                <Input
                  id="transfer-numero"
                  value={numeroTransferencia}
                  onChange={(e) => handleNumeroChange(e.target.value)}
                  disabled={readOnly}
                  placeholder="Referencia o comprobante"
                  className="h-11 font-mono text-base"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="transfer-monto">Valor</Label>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={handleExacto}
                    className="flex shrink-0 items-center gap-0.5 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase text-violet-700 shadow-sm transition-colors hover:bg-violet-100 disabled:opacity-50"
                    title={isExact ? "Limpiar monto" : "Usar monto total"}
                  >
                    <CopyCheck className="h-3 w-3" />
                    {isExact ? "Limpiar" : "Exacto"}
                  </button>
                </div>
                <Input
                  id="transfer-monto"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={montoInput}
                  onChange={(e) => setMontoInput(sanitizeDecimalInput(e.target.value))}
                  disabled={readOnly}
                  className="text-base font-semibold tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label>Comprobante (opcional)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={readOnly || analizandoFoto}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-11 gap-2 rounded-xl border-violet-300 bg-white font-semibold text-violet-800 hover:bg-violet-100"
                  >
                    <Camera className="h-4 w-4" />
                    {fotoArchivo ? "Cambiar foto" : "Tomar foto"}
                  </Button>
                  {fotoArchivo ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={readOnly || analizandoFoto}
                      onClick={() => void analizarFoto(fotoArchivo)}
                      className="h-11 gap-1.5 rounded-xl border-violet-300 bg-violet-50 font-semibold text-violet-800 hover:bg-violet-100"
                    >
                      {analizandoFoto ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {analizandoFoto ? "Leyendo..." : "Leer con IA"}
                    </Button>
                  ) : null}
                  {fotoArchivo ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={readOnly || analizandoFoto}
                      onClick={handleQuitarFoto}
                      className="h-11 gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Quitar
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  disabled={readOnly}
                  onChange={(e) => {
                    handleFotoSeleccionada(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {lecturaMensaje ? (
                  <div
                    role={lecturaExitosa ? "status" : "alert"}
                    className={cn(
                      "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium",
                      analizandoFoto
                        ? "border-violet-200 bg-violet-50 text-violet-800"
                        : lecturaExitosa
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-900",
                    )}
                  >
                    {analizandoFoto ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : lecturaExitosa ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{lecturaMensaje}</span>
                  </div>
                ) : null}
                {cuentasDestinoError ? (
                  <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900">
                    No se pudieron cargar las cuentas autorizadas. El comprobante quedará como no verificable.
                  </div>
                ) : null}
                {validacionComprobante ? (
                  <div
                    className={cn(
                      "space-y-2 rounded-xl border px-3 py-3 text-xs",
                      validacionComprobante.estado === "VALIDADO"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                        : validacionComprobante.estado === "CON_NOVEDADES"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-amber-300 bg-amber-50 text-amber-950",
                    )}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      {validacionComprobante.estado === "VALIDADO" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {validacionComprobante.estado === "VALIDADO"
                        ? "Comprobante validado"
                        : validacionComprobante.estado === "CON_NOVEDADES"
                          ? "La IA detectó novedades"
                          : "Comprobante no verificable completamente"}
                    </div>
                    {validacionComprobante.novedades.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-5">
                        {validacionComprobante.novedades.map((novedad) => (
                          <li key={novedad}>{novedad}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Banco, titular, cuenta destino, fecha y valor coinciden.</p>
                    )}
                    {validacionComprobante.estado !== "VALIDADO" ? (
                      <div className="space-y-1.5 pt-1">
                        <Label htmlFor="transfer-motivo-novedad" className="text-current">
                          Motivo para aceptar con novedades
                        </Label>
                        <Textarea
                          id="transfer-motivo-novedad"
                          value={motivoAceptacion}
                          onChange={(event) => {
                            setErrorMensaje(null);
                            setMotivoAceptacion(event.target.value);
                          }}
                          disabled={readOnly}
                          placeholder="Ej. Verifiqué manualmente el comprobante con el cliente"
                          className="min-h-20 bg-white text-foreground"
                        />
                        {motivoAceptacion.trim().length < 5 ? (
                          <p className="font-medium text-amber-800" role="status">
                            Escribe al menos 5 caracteres para habilitar &quot;Aceptar con novedades&quot;
                            {motivoAceptacion.trim().length > 0
                              ? ` (faltan ${5 - motivoAceptacion.trim().length}).`
                              : "."}
                          </p>
                        ) : (
                          <p className="opacity-80">
                            La decisión, las novedades y tu usuario quedarán registrados para auditoría.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {fotoVistaPreviaUrl ? (
                  <button
                    type="button"
                    onClick={() => setFotoAmpliada(true)}
                    className="group relative w-full overflow-hidden rounded-xl border border-violet-200 bg-violet-50/40 text-left transition-colors hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    aria-label="Ampliar foto del comprobante"
                  >
                    <img
                      src={fotoVistaPreviaUrl}
                      alt="Vista previa del comprobante"
                      className="max-h-40 w-full object-contain"
                    />
                    <span className="pointer-events-none absolute bottom-2 right-2 inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-violet-300 bg-white/95 px-2 text-xs font-semibold text-violet-800 shadow-sm">
                      <ZoomIn className="h-3.5 w-3.5" />
                      Ampliar
                    </span>
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    La foto se guardará al confirmar el cobro en caja.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="footer-safe-bottom shrink-0 flex-row justify-end gap-2 space-x-0 border-t border-border/60 pt-3 sm:gap-2 sm:pb-0">
              <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                disabled={
                  validando
                  || analizandoFoto
                  || readOnly
                  || !bancoId
                  || !numeroTransferencia.trim()
                  || parseTransferenciaMontoInput(montoInput) <= 0
                  || !motivoValido
                }
                onClick={() => void handleConfirm()}
              >
                {validando
                  ? "Validando..."
                  : requiereMotivo
                    ? "Aceptar con novedades"
                    : "Aceptar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
