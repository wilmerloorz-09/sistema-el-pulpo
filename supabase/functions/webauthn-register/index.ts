import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "https://esm.sh/@simplewebauthn/server@13.1.1";
import type { AuthenticatorTransportFuture } from "https://esm.sh/@simplewebauthn/types@13.1.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;

const toJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return toJson({ error: "Configuracion incompleta del servidor" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(bearerToken);

    if (authError || !user) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const { action, ...body } = await req.json();
    const origin = req.headers.get("origin") || "https://localhost";
    const rpID = new URL(origin).hostname;
    const rpName = "El Pulpo POS";

    if (action === "options") {
      const { data: existingCreds, error: existingCredsError } = await adminClient
        .from("webauthn_credentials")
        .select("credential_id, transports")
        .eq("user_id", user.id);

      if (existingCredsError) {
        return toJson({ error: "No se pudieron leer credenciales existentes" }, 500);
      }

      const excludeCredentials = (existingCreds || []).map((credential: { credential_id: string; transports: string[] | null }) => ({
        id: credential.credential_id,
        transports: (credential.transports || []) as AuthenticatorTransportFuture[],
      }));

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: user.email || user.id,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials,
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      const { error: insertChallengeError } = await adminClient.from("webauthn_challenges").insert({
        user_id: user.id,
        challenge: options.challenge,
        type: "registration",
      });

      if (insertChallengeError) {
        return toJson({ error: "No se pudo guardar el challenge" }, 500);
      }

      return toJson(options);
    }

    if (action === "verify") {
      const { attestation, deviceName } = body;

      const { data: challengeRow, error: challengeError } = await adminClient
        .from("webauthn_challenges")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "registration")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (challengeError || !challengeRow) {
        return toJson({ error: "Challenge no encontrado" }, 400);
      }

      const challengeAgeMs = Date.now() - new Date(challengeRow.created_at).getTime();
      if (Number.isFinite(challengeAgeMs) && challengeAgeMs > CHALLENGE_MAX_AGE_MS) {
        await adminClient
          .from("webauthn_challenges")
          .delete()
          .eq("user_id", user.id)
          .eq("type", "registration");
        return toJson({ error: "Challenge expirado" }, 400);
      }

      const verification = await verifyRegistrationResponse({
        response: attestation,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return toJson({ error: "Verificacion fallida" }, 400);
      }

      const { credential } = verification.registrationInfo;

      const { error: insertCredentialError } = await adminClient.from("webauthn_credentials").insert({
        user_id: user.id,
        credential_id: credential.id,
        public_key: btoa(String.fromCharCode(...credential.publicKey)),
        counter: Number(credential.counter),
        transports: credential.transports || [],
        device_name: deviceName || "Dispositivo",
      });

      if (insertCredentialError) {
        return toJson({ error: "No se pudo guardar la credencial" }, 500);
      }

      await adminClient
        .from("webauthn_challenges")
        .delete()
        .eq("user_id", user.id)
        .eq("type", "registration");

      return toJson({ verified: true });
    }

    return toJson({ error: "Accion no valida" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    console.error("WebAuthn register error:", message);
    return toJson({ error: message }, 500);
  }
});
