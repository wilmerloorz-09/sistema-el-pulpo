export type SingleSessionAction = "ok" | "register-new" | "claim" | "kick";

export function decideSingleSessionAction(params: {
  ownedSessionId: string | null;
  ownedUserId: string | null;
  currentUserId: string;
  serverSessionIds: string[];
  confirmedSessionId: string | null;
}): SingleSessionAction {
  const {
    ownedSessionId,
    ownedUserId,
    currentUserId,
    serverSessionIds,
    confirmedSessionId,
  } = params;

  if (!ownedSessionId || ownedUserId !== currentUserId) {
    return "register-new";
  }

  if (serverSessionIds.includes(ownedSessionId)) {
    return "ok";
  }

  if (serverSessionIds.length === 0) {
    return "claim";
  }

  // Solo echar si esta pestana ya habia registrado el id y otro dispositivo lo piso.
  // Un id local viejo (login anterior / token expirado) debe reclamar el slot, no botar.
  if (confirmedSessionId === ownedSessionId) {
    return "kick";
  }

  return "claim";
}
