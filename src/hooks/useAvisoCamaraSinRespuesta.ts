import { useCallback, useEffect, useRef } from "react";

export const MENSAJE_CAMARA_SIN_RESPUESTA =
  "La cámara no respondió. Cierra la app por completo (deslízala desde las apps recientes) y vuelve a abrirla. Puedes registrar el cobro sin foto.";

const ESPERA_CAMARA_MS = 5_000;

/**
 * En el WebView de Android, si una solicitud de cámara anterior quedó sin respuesta,
 * los siguientes clics en <input type="file"> se ignoran en silencio. Si tras el clic
 * la app nunca pierde el foco ni se oculta, la cámara/selector no se abrió.
 */
export function useAvisoCamaraSinRespuesta(onSinRespuesta: () => void) {
  const onSinRespuestaRef = useRef(onSinRespuesta);
  const limpiarRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onSinRespuestaRef.current = onSinRespuesta;
  }, [onSinRespuesta]);

  const cancelar = useCallback(() => {
    limpiarRef.current?.();
    limpiarRef.current = null;
  }, []);

  const vigilar = useCallback(() => {
    cancelar();

    const alAbrirse = () => cancelar();
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "hidden") cancelar();
    };

    window.addEventListener("blur", alAbrirse);
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    const timer = window.setTimeout(() => {
      cancelar();
      if (document.visibilityState === "hidden" || !document.hasFocus()) return;
      onSinRespuestaRef.current();
    }, ESPERA_CAMARA_MS);

    limpiarRef.current = () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", alAbrirse);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [cancelar]);

  useEffect(() => cancelar, [cancelar]);

  return { vigilar, cancelar };
}
