/**
 * Cobro v2: ventana con total, denominaciones y monto por transferencia.
 * El diálogo clásico (`PaymentDialog.tsx`) no se modifica; se usa cuando esto es false.
 *
 * - En **desarrollo** (`import.meta.env.DEV`): activo por defecto para probar el nuevo flujo.
 * - En **producción**: solo si `VITE_PAYMENT_UI_V2=true` en el entorno de build.
 * - Forzar clásico en dev: `VITE_PAYMENT_UI_V2=false` en `.env.local`.
 */
export const USE_PAYMENT_DIALOG_V2 =
  import.meta.env.VITE_PAYMENT_UI_V2 === "true" ||
  (import.meta.env.VITE_PAYMENT_UI_V2 !== "false" && import.meta.env.DEV);
