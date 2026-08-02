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

type VoidPaymentPayload = {
  payment_id?: string;
  request_id?: string;
  current_shift_id?: string;
  reason?: string;
  terminal_id?: string | null;
  supervisor_identifier?: string;
  supervisor_password?: string;
  payment_item_selections?: Array<{
    payment_item_id?: string;
    quantity?: number;
  }>;
  cash_refund_detail?: Array<{
    denomination_id?: string;
    qty?: number;
  }>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return toJson({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return toJson({ error: "Configuracion incompleta del servidor" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const anonClient = createClient(supabaseUrl, anonKey);
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    const {
      data: { user: caller },
      error: callerError,
    } = await adminClient.auth.getUser(bearerToken);

    if (callerError || !caller) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const payload = (await req.json()) as VoidPaymentPayload;
    const paymentId = String(payload.payment_id ?? "").trim();
    const requestId = String(payload.request_id ?? "").trim();
    const currentShiftId = String(payload.current_shift_id ?? "").trim();
    const reason = String(payload.reason ?? "").trim();
    const terminalId = String(payload.terminal_id ?? "").trim() || null;
    const supervisorIdentifier = String(payload.supervisor_identifier ?? "").trim();
    const supervisorPassword = String(payload.supervisor_password ?? "");
    const paymentItemSelections = Array.isArray(payload.payment_item_selections)
      ? payload.payment_item_selections
      : [];
    const cashRefundDetail = Array.isArray(payload.cash_refund_detail)
      ? payload.cash_refund_detail
      : [];
    const cashChangeReturnDetail = Array.isArray((payload as any).cash_change_return_detail)
      ? (payload as any).cash_change_return_detail
      : [];

    if (!paymentId) return toJson({ error: "El pago no existe" }, 400);
    if (!requestId) return toJson({ error: "La solicitud de anulacion no existe" }, 400);
    if (!currentShiftId) return toJson({ error: "No se encontro el turno actual" }, 400);
    if (!reason) return toJson({ error: "Debes indicar un motivo para anular el pago" }, 400);
    const { data: requestRow, error: requestError } = await adminClient
      .from("payment_void_requests")
      .select("id, payment_id, shift_id, requested_by_user_id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) return toJson({ error: requestError.message }, 400);
    if (!requestRow || requestRow.payment_id !== paymentId) {
      return toJson({ error: "La solicitud de anulacion no corresponde al pago indicado" }, 400);
    }
    if (requestRow.requested_by_user_id !== caller.id) {
      return toJson({ error: "La solicitud de anulacion no pertenece al usuario actual" }, 403);
    }
    if (requestRow.shift_id !== currentShiftId) {
      return toJson({ error: "El pago solo puede anularse dentro del mismo turno en que fue registrado" }, 400);
    }
    if (requestRow.status !== "pending") {
      return toJson({ error: "La solicitud de anulacion ya fue procesada" }, 400);
    }

    // Get order_id from the payment record
    const { data: paymentRow, error: paymentRowError } = await adminClient
      .from("payments")
      .select("order_id")
      .eq("id", paymentId)
      .maybeSingle();

    const orderIdForDispatchCheck = paymentRow?.order_id;

    // Check if order has dispatched items (full status or partial events)
    const { data: orderItems, error: itemsError } = await adminClient
      .from("order_items")
      .select("status, id")
      .eq("order_id", orderIdForDispatchCheck);

    if (itemsError) return toJson({ error: "Error al validar los items de la orden" }, 500);
    
    const itemIds = (orderItems ?? []).map(i => i.id);
    let hasDispatched = (orderItems ?? []).some(item => item.status === 'KITCHEN_DISPATCHED');

    if (!hasDispatched && itemIds.length > 0) {
      const { data: dispatchEvents, error: eventsError } = await adminClient
        .from("order_item_dispatch_events")
        .select("id")
        .in("order_item_id", itemIds)
        .eq("status", "APPLIED")
        .limit(1);
      
      if (!eventsError && dispatchEvents && dispatchEvents.length > 0) {
        hasDispatched = true;
      }
    }

    let supervisorId: string;

    if (hasDispatched) {
      if (!supervisorIdentifier || !supervisorPassword) {
        return toJson({ error: "Debes autenticar a un supervisor para continuar porque la orden ya tiene items despachados" }, 400);
      }

      let resolvedEmail = supervisorIdentifier.toLowerCase();

      if (!resolvedEmail.includes("@")) {
        const lookupIdentifier = supervisorIdentifier.trim();
        let profileEmail: string | null = null;

        const { data: byUsername, error: usernameError } = await adminClient
          .from("profiles")
          .select("email")
          .ilike("username", lookupIdentifier)
          .limit(1)
          .maybeSingle();

        if (usernameError) return toJson({ error: "Error validando el supervisor" }, 500);
        profileEmail = byUsername?.email ? String(byUsername.email) : null;

        if (!profileEmail) {
          const { data: byAlias, error: aliasError } = await adminClient
            .from("profiles")
            .select("email")
            .ilike("alias", lookupIdentifier)
            .limit(1)
            .maybeSingle();

          if (aliasError) return toJson({ error: "Error validando el supervisor" }, 500);
          profileEmail = byAlias?.email ? String(byAlias.email) : null;
        }

        if (!profileEmail) return toJson({ error: "Supervisor no autorizado" }, 401);
        resolvedEmail = profileEmail.toLowerCase();
      }

      const { data: supervisorSession, error: supervisorAuthError } = await anonClient.auth.signInWithPassword({
        email: resolvedEmail,
        password: supervisorPassword,
      });

      if (supervisorAuthError || !supervisorSession?.user?.id) {
        return toJson({ error: "Supervisor no autorizado" }, 401);
      }

      supervisorId = supervisorSession.user.id;

      const { data: supervisorProfile, error: supervisorProfileError } = await adminClient
        .from("profiles")
        .select("is_active")
        .eq("id", supervisorId)
        .maybeSingle();

      if (supervisorProfileError) return toJson({ error: "No se pudo validar el supervisor" }, 500);
      if (!supervisorProfile || supervisorProfile.is_active === false) {
        return toJson({ error: "Supervisor no autorizado" }, 403);
      }

      const { data: shiftRow, error: shiftError } = await adminClient
        .from("cash_shifts")
        .select("branch_id")
        .eq("id", currentShiftId)
        .maybeSingle();

      if (shiftError || !shiftRow?.branch_id) {
        return toJson({ error: "No se encontro el turno actual" }, 400);
      }

      const { data: canAuthorize, error: canAuthorizeError } = await adminClient.rpc("is_payment_void_authorizer", {
        p_user_id: supervisorId,
        p_shift_id: currentShiftId,
        p_branch_id: shiftRow.branch_id,
      });

      if (canAuthorizeError) return toJson({ error: canAuthorizeError.message }, 400);
      if (!canAuthorize) {
        return toJson({ error: "Solo un supervisor puede autorizar la anulacion del pago" }, 403);
      }
    } else {
      // Bypassing supervisor authentication because no items are dispatched
      supervisorId = caller.id;
    }

    const { data: result, error: approveError } = await adminClient.rpc("approve_and_void_payment", {
      p_payment_id: paymentId,
      p_request_id: requestId,
      p_reason: reason,
      p_current_shift_id: currentShiftId,
      p_requested_by_user_id: caller.id,
      p_supervisor_id: supervisorId,
      p_terminal_id: terminalId,
      p_payment_item_selections: paymentItemSelections,
      p_cash_refund_detail: cashRefundDetail,
      p_cash_change_return_detail: cashChangeReturnDetail,
    });

    if (approveError) {
      return toJson({ error: approveError.message }, 400);
    }

    return toJson({
      success: true,
      message: "Pago anulado correctamente",
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
