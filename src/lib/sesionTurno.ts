const SESION_TURNO_STORAGE_KEY = "authSessionShift";

export type SesionTurno = {
  userId: string;
  branchId: string;
  shiftId: string;
};

export const leerSesionTurno = (): SesionTurno | null => {
  const raw = localStorage.getItem(SESION_TURNO_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SesionTurno>;
    if (
      typeof parsed.userId !== "string"
      || typeof parsed.branchId !== "string"
      || typeof parsed.shiftId !== "string"
    ) {
      return null;
    }
    return parsed as SesionTurno;
  } catch {
    return null;
  }
};

export const guardarSesionTurno = (sesion: SesionTurno) => {
  localStorage.setItem(SESION_TURNO_STORAGE_KEY, JSON.stringify(sesion));
};

export const limpiarSesionTurno = () => {
  localStorage.removeItem(SESION_TURNO_STORAGE_KEY);
};

/**
 * La sesion pertenece al turno en que se uso por primera vez: si ese turno ya no
 * esta abierto (cerrado, o reemplazado por otro), la sesion debe cerrarse.
 */
export const turnoDeSesionTerminado = (
  sesion: SesionTurno | null,
  actual: { userId: string; branchId: string; shiftOpen: boolean; shiftId: string | null },
): boolean => {
  if (!sesion) return false;
  if (sesion.userId !== actual.userId || sesion.branchId !== actual.branchId) return false;
  return !actual.shiftOpen || actual.shiftId !== sesion.shiftId;
};
