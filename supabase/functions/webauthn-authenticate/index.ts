import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "https://esm.sh/@simplewebauthn/server@13.1.1";
import type { AuthenticatorTransportFuture } from "https://esm.sh/@simplewebauthn/types@13.1.0";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Configuracion incompleta del servidor" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { action, ...body } = await req.json();
    const origin = req.headers.get("origin") || "https://localhost";
    const rpID = new URL(origin).hostname;

    if (action === "options") {
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "preferred",
      });

      const challengeId = generateUUID();
      await adminClient.from("webauthn_challenges").insert({
        id: challengeId,
        challenge: options.challenge,
        type: "authentication",
      });

      return new Response(JSON.stringify({ ...options, challengeId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const { assertion, challengeId } = body;

      const { data: challengeRow } = await adminClient
        .from("webauthn_challenges")
        .select("*")
        .eq("id", challengeId)
        .eq("type", "authentication")
        .single();

      if (!challengeRow) {
        return new Response(JSON.stringify({ error: "Challenge no encontrado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const challengeAgeMs = Date.now() - new Date(challengeRow.created_at).getTime();
      if (Number.isFinite(challengeAgeMs) && challengeAgeMs > CHALLENGE_MAX_AGE_MS) {
        await adminClient.from("webauthn_challenges").delete().eq("id", challengeId);
        return new Response(JSON.stringify({ error: "Challenge expirado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const credentialId = assertion.id;
      const { data: credRow } = await adminClient
        .from("webauthn_credentials")
        .select("*")
        .eq("credential_id", credentialId)
        .single();

      if (!credRow) {
        return new Response(JSON.stringify({ error: "Credencial no encontrada" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const publicKeyBytes = Uint8Array.from(atob(credRow.public_key), (char) => char.charCodeAt(0));

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: assertion,
          expectedChallenge: challengeRow.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id: credRow.credential_id,
            publicKey: publicKeyBytes,
            counter: Number(credRow.counter),
            transports: (credRow.transports || []) as AuthenticatorTransportFuture[],
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Verificacion fallida";
        console.error("WebAuthn verification detail:", {
          message,
          origin,
          rpID,
          credentialId,
          challengeId,
        });
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!verification.verified) {
        console.error("WebAuthn verification rejected:", {
          origin,
          rpID,
          credentialId,
          challengeId,
        });
        return new Response(JSON.stringify({ error: "Verificacion fallida" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await adminClient
        .from("webauthn_credentials")
        .update({ counter: Number(verification.authenticationInfo.newCounter) })
        .eq("credential_id", credentialId);

      await adminClient.from("webauthn_challenges").delete().eq("id", challengeId);

      const { data: profile } = await adminClient
        .from("profiles")
        .select("id, username, is_active")
        .eq("id", credRow.user_id)
        .single();

      if (!profile || profile.is_active === false) {
        return new Response(JSON.stringify({ error: "Usuario inactivo" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const {
        data: { user: authUser },
      } = await adminClient.auth.admin.getUserById(credRow.user_id);

      if (!authUser?.email) {
        return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: authUser.email,
      });

      if (linkError || !linkData) {
        return new Response(JSON.stringify({ error: "Error generando sesion" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const actionUrl = new URL(linkData.properties.action_link);
      const tokenHash = actionUrl.searchParams.get("token_hash");
      const type = actionUrl.searchParams.get("type");

      return new Response(
        JSON.stringify({
          verified: true,
          token_hash: tokenHash,
          type,
          email: authUser.email,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: "Accion no valida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    console.error("WebAuthn auth error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
