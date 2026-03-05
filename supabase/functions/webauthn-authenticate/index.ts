import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "https://esm.sh/@simplewebauthn/server@13.1.1";
import type {
  AuthenticatorTransportFuture,
} from "https://esm.sh/@simplewebauthn/types@13.1.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { action, ...body } = await req.json();
    const origin = req.headers.get("origin") || "https://localhost";
    const rpID = new URL(origin).hostname;

    if (action === "options") {
      // Get all credentials (allowCredentials empty = discoverable/resident key)
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "preferred",
        // Empty allowCredentials = use discoverable credentials (passkeys)
      });

      // Store challenge with no user_id (we don't know who yet)
      const challengeId = crypto.randomUUID();
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

      // Get stored challenge
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

      // Find credential by ID
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

      // Decode stored public key
      const publicKeyBytes = Uint8Array.from(atob(credRow.public_key), (c) =>
        c.charCodeAt(0)
      );

      const verification = await verifyAuthenticationResponse({
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

      if (!verification.verified) {
        return new Response(JSON.stringify({ error: "Verificación fallida" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update counter
      await adminClient
        .from("webauthn_credentials")
        .update({ counter: Number(verification.authenticationInfo.newCounter) })
        .eq("credential_id", credentialId);

      // Clean up challenge
      await adminClient
        .from("webauthn_challenges")
        .delete()
        .eq("id", challengeId);

      // Get user email to generate magic link
      const { data: profile } = await adminClient
        .from("profiles")
        .select("id, username")
        .eq("id", credRow.user_id)
        .single();

      // Get user from auth to get email
      const { data: { user: authUser } } = await adminClient.auth.admin.getUserById(
        credRow.user_id
      );

      if (!authUser?.email) {
        return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate magic link for passwordless sign-in
      const { data: linkData, error: linkError } =
        await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: authUser.email,
        });

      if (linkError || !linkData) {
        return new Response(
          JSON.stringify({ error: "Error generando sesión" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Extract token hash from the action link
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
        }
      );
    }

    return new Response(JSON.stringify({ error: "Acción no válida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("WebAuthn auth error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
