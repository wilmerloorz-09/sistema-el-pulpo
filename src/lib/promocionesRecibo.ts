import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { listarCampanasActivas } from "@/services/campanasPromocionalesDb";

const PROMO_REGISTRO_BASE_URL = "https://sistema-el-pulpo.vercel.app/promociones/registro";

export async function hayCampanasPromocionalesActivas(): Promise<boolean> {
  const campanas = await listarCampanasActivas();
  return campanas.length > 0;
}

export async function fetchOrderTokenPromocion(orderId: string): Promise<string | null> {
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    try {
      const { data: orderData } = await supabase
        .from("orders")
        .select("token_promocion")
        .eq("id", orderId)
        .single();
      if (orderData?.token_promocion) return orderData.token_promocion;
    } catch (err) {
      console.error(`Attempt ${attempts} failed to fetch token_promocion:`, err);
    }
    if (attempts < 5) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return null;
}

export async function buildPromocionReciboExtras(
  token: string | null | undefined,
): Promise<{ token_promocion: string | null; qrCodeDataUrl: string | null }> {
  if (!token) return { token_promocion: null, qrCodeDataUrl: null };

  const tieneCampanaActiva = await hayCampanasPromocionalesActivas();
  if (!tieneCampanaActiva) {
    return { token_promocion: null, qrCodeDataUrl: null };
  }

  try {
    const url = `${PROMO_REGISTRO_BASE_URL}?t=${token}`;
    const qrCodeDataUrl = await QRCode.toDataURL(url, { width: 120, margin: 1 });
    return { token_promocion: token, qrCodeDataUrl };
  } catch (err) {
    console.error("Error generating QR code:", err);
    return { token_promocion: token, qrCodeDataUrl: null };
  }
}

export async function fetchPromocionReciboExtrasForOrder(
  orderId: string,
): Promise<{ token_promocion: string | null; qrCodeDataUrl: string | null }> {
  const tieneCampanaActiva = await hayCampanasPromocionalesActivas();
  if (!tieneCampanaActiva) {
    return { token_promocion: null, qrCodeDataUrl: null };
  }
  const token = await fetchOrderTokenPromocion(orderId);
  return buildPromocionReciboExtras(token);
}
