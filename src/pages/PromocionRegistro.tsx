import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Gift, Loader2, Trophy, CheckCircle, AlertCircle, Sparkles, Smartphone, User, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normalizarCedulaCelular, normalizarSoloLetras } from "@/lib/clientesValidacion";

interface CampanaActiva {
  id: string;
  titulo: string;
  cartelera_ofertas: any[];
  consumo_minimo: number;
  porcentaje_descuento: number;
  descuento_maximo: number;
}

interface ValidacionTokenResult {
  valido: boolean;
  mensaje: string;
  consumo_minimo: number | null;
  monto_orden: number | null;
  id_orden: string | null;
  id_cliente: string | null;
  cedula_cliente: string | null;
  nombre_cliente: string | null;
}

function ofertaDisponible(oferta: any): boolean {
  if (oferta.resultado === "GANADA" || oferta.resultado === "PERDIDA") {
    return false;
  }
  if (!oferta.bloqueo_at) {
    return false;
  }
  const ahora = Date.now();
  const bloqueoTime = new Date(oferta.bloqueo_at).getTime();
  if (ahora > bloqueoTime) {
    return false;
  }
  if (oferta.inicio_at) {
    const inicioTime = new Date(oferta.inicio_at).getTime();
    if (ahora < inicioTime) {
      return false;
    }
  }
  return true;
}

export default function PromocionRegistro() {
  const [searchParams] = useSearchParams();
  const [tokenInput, setTokenInput] = useState(searchParams.get("t") || "");
  
  // Statuses
  const [isValidatingToken, setIsValidatingToken] = useState(false);
  const [isAutoValidating, setIsAutoValidating] = useState(false);
  const [tokenValidatedData, setTokenValidatedData] = useState<ValidacionTokenResult | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Form Fields
  const [cedula, setCedula] = useState("");
  const [celular, setCelular] = useState("");
  const [nombres, setNombres] = useState("");
  const [apellidos, setApellidos] = useState("");

  // Campaign & Predictions selection
  const [campanas, setCampanas] = useState<CampanaActiva[]>([]);
  const [isLoadingCampanas, setIsLoadingCampanas] = useState(false);
  const [selectedCampana, setSelectedCampana] = useState<CampanaActiva | null>(null);
  const [selectedOfertaId, setSelectedOfertaId] = useState<string | null>(null);

  // Submit and General
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{
    tituloCampana: string;
    descripcionPrediccion: string;
    nombreCliente: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load campaigns on mount
  useEffect(() => {
    async function loadCampanas() {
      setIsLoadingCampanas(true);
      try {
        const { data, error } = await supabase.rpc("listar_campanas_activas");
        if (error) throw error;
        if (data) {
          setCampanas(data as CampanaActiva[]);
          if (data.length > 0) {
            setSelectedCampana(data[0] as CampanaActiva);
          }
        }
      } catch (err: any) {
        console.error("Error al cargar campañas:", err);
      } finally {
        setIsLoadingCampanas(false);
      }
    }
    loadCampanas();
  }, []);

  // Auto-validate token if present in URL
  useEffect(() => {
    const t = searchParams.get("t");
    if (t) {
      setIsAutoValidating(true);
      handleValidarToken(t).finally(() => {
        setIsAutoValidating(false);
      });
    }
  }, [searchParams]);

  // Automatically search client when cédula reaches 10 digits
  useEffect(() => {
    if (cedula.length === 10) {
      async function buscarCliente() {
        try {
          const { data, error } = await supabase
            .from("clientes")
            .select("celular, nombres, apellidos")
            .eq("cedula", cedula)
            .maybeSingle();
          
          if (error) throw error;
          
          if (data) {
            setCelular(data.celular || "");
            setNombres(data.nombres || "");
            setApellidos(data.apellidos || "");
          }
        } catch (err) {
          console.error("Error al buscar cliente por cédula:", err);
        }
      }
      buscarCliente();
    }
  }, [cedula]);

  // Clean inputs
  const handleCedulaChange = (val: string) => {
    setCedula(normalizarCedulaCelular(val));
  };

  const handleCelularChange = (val: string) => {
    setCelular(normalizarCedulaCelular(val));
  };

  const handleNombresChange = (val: string) => {
    setNombres(normalizarSoloLetras(val).toUpperCase());
  };

  const handleApellidosChange = (val: string) => {
    setApellidos(normalizarSoloLetras(val).toUpperCase());
  };

  const handleValidarToken = async (tokenToValidate: string) => {
    const tokenClean = tokenToValidate.trim().toUpperCase();
    if (!tokenClean) {
      setTokenError("Por favor ingresa un token.");
      return;
    }

    setIsValidatingToken(true);
    setTokenError(null);
    setTokenValidatedData(null);

    try {
      const { data, error } = await supabase.rpc("validar_token_promocion_cliente", {
        p_token_promocion: tokenClean
      });

      if (error) throw error;

      if (data) {
        const result = data as any;
        if (result.valido) {
          const clientObj = result.cliente_datos;
          const mappedData: ValidacionTokenResult = {
            valido: true,
            mensaje: result.mensaje || "Token válido.",
            consumo_minimo: result.consumo_minimo || null,
            monto_orden: result.orden_total || null,
            id_orden: result.orden_id || null,
            id_cliente: result.cliente_id || null,
            cedula_cliente: clientObj?.cedula || null,
            nombre_cliente: clientObj ? `${clientObj.nombres} ${clientObj.apellidos}`.trim() : null
          };
          setTokenValidatedData(mappedData);
          
          if (clientObj) {
            setCedula(clientObj.cedula || "");
            setCelular(clientObj.celular || "");
            setNombres(clientObj.nombres || "");
            setApellidos(clientObj.apellidos || "");
          }
        } else {
          setTokenError(result.mensaje || "El código ingresado no es válido o ya fue utilizado.");
        }
      } else {
        setTokenError("Código no válido.");
      }
    } catch (err: any) {
      console.error("Error al validar token:", err);
      setTokenError("Ocurrió un error al validar el código. Inténtalo de nuevo.");
    } finally {
      setIsValidatingToken(false);
    }
  };

  // Filter available offers for selected campaign
  const ofertasVisibles = useMemo(() => {
    if (!selectedCampana) return [];
    return (selectedCampana.cartelera_ofertas ?? []).filter(ofertaDisponible);
  }, [selectedCampana]);

  // Form validations
  const isFormValid = useMemo(() => {
    if (!tokenValidatedData?.valido) return false;
    if (cedula.length !== 10) return false;
    if (celular.length !== 10) return false;
    if (!nombres.trim() || !apellidos.trim()) return false;
    if (!selectedCampana) return false;
    if (!selectedOfertaId) return false;
    return true;
  }, [tokenValidatedData, cedula, celular, nombres, apellidos, selectedCampana, selectedOfertaId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !tokenValidatedData) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const tokenClean = tokenInput.trim().toUpperCase();

    try {
      const { data, error } = await supabase.rpc("validar_token_promocion_cliente", {
        p_token_promocion: tokenClean,
        p_campana_id: selectedCampana!.id,
        p_cliente_cedula: cedula,
        p_cliente_sexo: "M",
        p_cliente_nombres: nombres.trim(),
        p_cliente_apellidos: apellidos.trim(),
        p_cliente_celular: celular,
        p_oferta_seleccionada_id: selectedOfertaId!,
        p_registrar_prediccion: true
      });

      if (error) throw error;

      if (data) {
        const result = data as any;
        if (result.valido) {
          const selectedOferta = selectedCampana!.cartelera_ofertas.find(
            (o) => o.id_oferta === selectedOfertaId
          );
          setSuccessData({
            tituloCampana: selectedCampana!.titulo,
            descripcionPrediccion: selectedOferta?.descripcion || "Predicción",
            nombreCliente: `${nombres.trim()} ${apellidos.trim()}`
          });
        } else {
          setSubmitError(result.mensaje || "No se pudo registrar la predicción.");
        }
      } else {
        setSubmitError("No se recibió respuesta del servidor.");
      }
    } catch (err: any) {
      console.error("Error al registrar predicción:", err);
      setSubmitError("Ocurrió un error inesperado al guardar la predicción. Por favor, vuelve a intentarlo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 font-sans text-slate-100 flex flex-col justify-between">
      {/* Decorative blurred spots for rich premium aesthetics */}
      <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl pointer-events-none" />
      <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-cyan-600/15 blur-3xl pointer-events-none" />
      <div className="absolute left-1/3 bottom-0 h-96 w-96 rounded-full bg-rose-600/10 blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative w-full max-w-lg mx-auto px-6 pt-8 pb-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-br from-amber-400 to-amber-600 p-2 rounded-xl shadow-lg shadow-amber-500/20">
            <Trophy className="h-6 w-6 text-slate-950 animate-pulse" />
          </div>
          <div>
            <h1 className="font-extrabold tracking-tight text-xl bg-clip-text text-transparent bg-gradient-to-r from-amber-300 via-amber-200 to-amber-400">
              EL PULPO
            </h1>
            <p className="text-[10px] text-amber-300/80 font-bold uppercase tracking-widest">
              Promo Mundialista
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2.5 py-1 text-xs font-semibold text-violet-300 border border-violet-500/30">
            <Sparkles className="h-3 w-3 text-violet-400" /> Público
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative flex-1 w-full max-w-lg mx-auto px-4 py-2 flex flex-col justify-center z-10">
        
        {successData ? (
          /* SUCCESS STATE */
          <div className="rounded-3xl border border-emerald-500/30 bg-slate-950/80 p-8 text-center shadow-2xl backdrop-blur-xl animate-fade-in">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/10">
              <CheckCircle className="h-10 w-10" />
            </div>
            
            <h2 className="text-2xl font-black text-emerald-400">¡Registro Exitoso!</h2>
            <p className="mt-2 text-sm text-slate-400">
              Tu participación en la campaña ha quedado guardada de forma segura.
            </p>

            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-left space-y-3">
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-500">Comensal</p>
                <p className="font-semibold text-slate-200">{successData.nombreCliente}</p>
              </div>
              <div className="border-t border-slate-800/60 pt-3">
                <p className="text-[10px] uppercase font-bold text-slate-500">Campaña</p>
                <p className="font-semibold text-slate-200">{successData.tituloCampana}</p>
              </div>
              <div className="border-t border-slate-800/60 pt-3">
                <p className="text-[10px] uppercase font-bold text-slate-500">Predicción Registrada</p>
                <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  {successData.descripcionPrediccion}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-3">
              <p className="text-xs text-slate-400">
                Si tu predicción resulta correcta, recibirás automáticamente el descuento correspondiente en tu próxima orden con nosotros.
              </p>
              <Button
                type="button"
                onClick={() => {
                  setSuccessData(null);
                  setTokenValidatedData(null);
                  setTokenInput("");
                  setCedula("");
                  setCelular("");
                  setNombres("");
                  setApellidos("");
                  setSelectedOfertaId(null);
                }}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-bold h-11"
              >
                Registrar otro ticket
              </Button>
            </div>
          </div>
        ) : isAutoValidating ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-8 text-center shadow-2xl backdrop-blur-xl flex flex-col items-center justify-center min-h-[260px] animate-pulse">
            <Loader2 className="h-10 w-10 animate-spin text-amber-400 mb-4" />
            <h3 className="text-xl font-bold text-slate-100">Validando código</h3>
            <p className="mt-1 text-sm text-slate-400">Por favor, espera un momento...</p>
          </div>
        ) : (
          /* FORM STATE */
          <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6 shadow-2xl backdrop-blur-xl">
            
            {/* Step 1: Validate Promo Token */}
            {!tokenValidatedData?.valido ? (
              <div className="space-y-5">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-slate-100">Ingresa tu código</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Ingresa el token impreso en tu ticket de compra para participar.
                  </p>
                </div>

                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="token" className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-indigo-400" /> Código de Promoción (8 caracteres)
                    </Label>
                    <Input
                      id="token"
                      type="text"
                      maxLength={8}
                      placeholder="Ej: ABC123XYZ"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                      className="h-12 rounded-xl bg-slate-900 border-slate-850 focus:border-indigo-500 text-center font-mono text-xl tracking-widest text-amber-300 font-bold uppercase placeholder:text-slate-650"
                      disabled={isValidatingToken}
                    />
                  </div>

                  {tokenError && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 flex items-start gap-2.5 text-rose-300 text-sm">
                      <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                      <span>{tokenError}</span>
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={() => handleValidarToken(tokenInput)}
                    disabled={isValidatingToken || !tokenInput.trim()}
                    className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-12 flex items-center justify-center gap-2"
                  >
                    {isValidatingToken ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Validando código...
                      </>
                    ) : (
                      "Validar Código"
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              /* Step 2: Customer & Prediction Form */
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="flex items-center justify-between border-b border-slate-905 pb-3">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-500">Código Validado</p>
                    <p className="font-mono text-sm font-bold text-amber-300">{tokenInput}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Campaign details header */}
                  {selectedCampana && (
                    <div className="rounded-2xl border border-violet-500/30 bg-violet-650/10 p-4">
                      <p className="text-[9px] font-bold text-violet-400 uppercase tracking-widest">
                        Campaña Activa
                      </p>
                      <h3 className="text-base font-black text-slate-100">{selectedCampana.titulo}</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Si ganas obtienes <span className="font-bold text-violet-300">{selectedCampana.porcentaje_descuento}% de descuento</span> en tu próximo consumo.
                      </p>
                    </div>
                  )}

                  {/* Customer Information Section */}
                  <div className="space-y-3 border-t border-slate-905 pt-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="h-4 w-4 text-indigo-400" /> Tus Datos de Cliente
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="cedula" className="text-[10px] text-slate-400 uppercase font-semibold">Cédula / RUC</Label>
                        <Input
                          id="cedula"
                          type="text"
                          maxLength={10}
                          placeholder="10 dígitos"
                          value={cedula}
                          onChange={(e) => handleCedulaChange(e.target.value)}
                          className="h-10 rounded-lg bg-slate-900 border-slate-800 focus:border-indigo-500 font-semibold"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="celular" className="text-[10px] text-slate-400 uppercase font-semibold">Celular</Label>
                        <Input
                          id="celular"
                          type="text"
                          maxLength={10}
                          placeholder="09XXXXXXXX"
                          value={celular}
                          onChange={(e) => handleCelularChange(e.target.value)}
                          className="h-10 rounded-lg bg-slate-900 border-slate-800 focus:border-indigo-500 font-semibold"
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="nombres" className="text-[10px] text-slate-400 uppercase font-semibold">Nombres</Label>
                        <Input
                          id="nombres"
                          type="text"
                          placeholder="Tus nombres"
                          value={nombres}
                          onChange={(e) => handleNombresChange(e.target.value)}
                          className="h-10 rounded-lg bg-slate-900 border-slate-800 focus:border-indigo-500 uppercase font-semibold"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="apellidos" className="text-[10px] text-slate-400 uppercase font-semibold">Apellidos</Label>
                        <Input
                          id="apellidos"
                          type="text"
                          placeholder="Tus apellidos"
                          value={apellidos}
                          onChange={(e) => handleApellidosChange(e.target.value)}
                          className="h-10 rounded-lg bg-slate-900 border-slate-800 focus:border-indigo-500 uppercase font-semibold"
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Predictions Grid */}
                  <div className="space-y-3 border-t border-slate-905 pt-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Smartphone className="h-4 w-4 text-indigo-400" /> Elige tu Predicción
                    </p>

                    {isLoadingCampanas ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                      </div>
                    ) : ofertasVisibles.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No hay predicciones disponibles para esta campaña en este momento.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {ofertasVisibles.map((oferta) => (
                          <button
                            key={oferta.id_oferta}
                            type="button"
                            onClick={() => setSelectedOfertaId(oferta.id_oferta)}
                            className={cn(
                              "rounded-xl border p-3 text-left transition-all relative flex flex-col justify-between h-20",
                              selectedOfertaId === oferta.id_oferta
                                ? "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400"
                                : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                            )}
                          >
                            <p className="text-xs font-bold text-slate-200 line-clamp-2 leading-snug">
                              {oferta.descripcion}
                            </p>
                            <p className="text-[10px] font-mono text-amber-400 mt-1">
                              Cuota: {Number(oferta.cuota).toFixed(2)}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {submitError && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={!isFormValid || isSubmitting}
                    className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black h-12 mt-2 shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Registrando...
                      </>
                    ) : (
                      "Confirmar Predicción y Registrar"
                    )}
                  </Button>
                </div>
              </form>
            )}

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="relative w-full max-w-lg mx-auto px-6 py-6 text-center text-[10px] text-slate-500 z-10">
        <p>© 2026 Restaurante El Pulpo. Todos los derechos reservados.</p>
        <p className="mt-1">Solo se permite una predicción por token válido y por orden de compra.</p>
      </footer>
    </div>
  );
}
