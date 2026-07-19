import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const toJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type VisionResult = {
  numero_transferencia: string | null;
  monto: number | null;
  banco_origen: string | null;
  banco_destino: string | null;
  titular_destino: string | null;
  cuenta_destino: string | null;
  fecha_transferencia: string | null;
  confianza: number;
  observaciones: string;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function normalizarResultado(value: unknown): VisionResult {
  const data = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const rawMonto = data.monto;
  const monto = typeof rawMonto === "number" && Number.isFinite(rawMonto) && rawMonto > 0
    ? Math.round(rawMonto * 100) / 100
    : null;
  const rawConfianza = typeof data.confianza === "number" ? data.confianza : 0;

  return {
    numero_transferencia: typeof data.numero_transferencia === "string"
      ? data.numero_transferencia.trim() || null
      : null,
    monto,
    banco_origen: typeof data.banco_origen === "string"
      ? data.banco_origen.trim() || null
      : null,
    banco_destino: typeof data.banco_destino === "string"
      ? data.banco_destino.trim() || null
      : null,
    titular_destino: typeof data.titular_destino === "string"
      ? data.titular_destino.trim() || null
      : null,
    cuenta_destino: typeof data.cuenta_destino === "string"
      ? data.cuenta_destino.trim() || null
      : null,
    fecha_transferencia: typeof data.fecha_transferencia === "string"
      ? data.fecha_transferencia.trim() || null
      : null,
    confianza: Math.max(0, Math.min(1, rawConfianza)),
    observaciones: typeof data.observaciones === "string"
      ? data.observaciones.trim()
      : "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return toJson({ error: "Metodo no permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return toJson({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
    const openAiModel = Deno.env.get("OPENAI_VISION_MODEL") || "gpt-4.1-mini";

    if (!supabaseUrl || !serviceRoleKey) {
      return toJson({ error: "Configuracion incompleta del servidor" }, 500);
    }
    if (!openAiApiKey) {
      return toJson({
        error: "La lectura automatica no esta configurada. Ingresa los datos manualmente.",
        code: "vision_not_configured",
      }, 503);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user: caller },
      error: callerError,
    } = await adminClient.auth.getUser(bearerToken);

    if (callerError || !caller) return toJson({ error: "No autorizado" }, 401);

    const formData = await req.formData();
    const image = formData.get("imagen");
    if (!(image instanceof File)) {
      return toJson({ error: "Debes adjuntar una imagen del comprobante" }, 400);
    }
    if (!image.type.startsWith("image/")) {
      return toJson({ error: "El archivo debe ser una imagen" }, 400);
    }
    if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      return toJson({ error: "La imagen debe pesar maximo 8 MB" }, 400);
    }

    const bancos = String(formData.get("bancos") ?? "").trim();
    const montoEsperado = String(formData.get("monto_esperado") ?? "").trim();
    const imageBase64 = arrayBufferToBase64(await image.arrayBuffer());

    const prompt = [
      "Analiza este comprobante bancario ecuatoriano.",
      "Extrae solamente datos visibles; no inventes ni completes digitos.",
      "numero_transferencia: referencia, numero de comprobante, transaccion u operacion. Conserva letras y digitos, elimina espacios decorativos.",
      "monto: total efectivamente transferido, como numero decimal sin simbolo de moneda.",
      "banco_origen: banco o aplicacion desde donde se emitio la transferencia.",
      "banco_destino: banco de la cuenta que recibio el dinero. No lo confundas con banco_origen.",
      "titular_destino: nombre visible del beneficiario o destinatario.",
      "cuenta_destino: cuenta del beneficiario exactamente como aparece, conservando X, asteriscos y digitos enmascarados.",
      "fecha_transferencia: fecha efectiva mostrada en formato YYYY-MM-DD. Si solo hay fecha sin hora, igual extraela. No uses la fecha de procesamiento del sistema.",
      "confianza: confianza global entre 0 y 1.",
      "Si un dato no es legible usa null y explica brevemente en observaciones.",
      bancos ? `Bancos configurados en el POS (solo como ayuda de normalizacion): ${bancos}` : "",
      montoEsperado
        ? `Monto esperado en caja: ${montoEsperado}. No lo copies si no aparece claramente en la imagen.`
        : "",
    ].filter(Boolean).join("\n");

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        temperature: 0,
        max_tokens: 350,
        messages: [
          {
            role: "system",
            content: "Eres un lector preciso de comprobantes bancarios. Responde unicamente con el JSON solicitado.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.type};base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "datos_comprobante_transferencia",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                numero_transferencia: { type: ["string", "null"] },
                monto: { type: ["number", "null"] },
                banco_origen: { type: ["string", "null"] },
                banco_destino: { type: ["string", "null"] },
                titular_destino: { type: ["string", "null"] },
                cuenta_destino: { type: ["string", "null"] },
                fecha_transferencia: { type: ["string", "null"] },
                confianza: { type: "number", minimum: 0, maximum: 1 },
                observaciones: { type: "string" },
              },
              required: [
                "numero_transferencia",
                "monto",
                "banco_origen",
                "banco_destino",
                "titular_destino",
                "cuenta_destino",
                "fecha_transferencia",
                "confianza",
                "observaciones",
              ],
            },
          },
        },
      }),
    });

    const openAiPayload = await openAiResponse.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    if (!openAiResponse.ok) {
      console.error("OpenAI vision error", openAiResponse.status, openAiPayload);
      return toJson({
        error: "No se pudo leer el comprobante. Ingresa los datos manualmente.",
        code: "vision_provider_error",
      }, 502);
    }

    const choices = Array.isArray(openAiPayload?.choices)
      ? openAiPayload.choices as Array<Record<string, unknown>>
      : [];
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === "string" ? message.content : "";
    if (!content) {
      return toJson({
        error: "La imagen no produjo datos legibles. Ingresa los datos manualmente.",
        code: "vision_empty_result",
      }, 422);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return toJson({
        error: "No se pudo interpretar la lectura. Ingresa los datos manualmente.",
        code: "vision_invalid_result",
      }, 422);
    }

    return toJson({ data: normalizarResultado(parsed) });
  } catch (error) {
    console.error("analizar-comprobante-transferencia", error);
    return toJson({
      error: "No se pudo analizar el comprobante. Ingresa los datos manualmente.",
      code: "vision_unexpected_error",
    }, 500);
  }
});
