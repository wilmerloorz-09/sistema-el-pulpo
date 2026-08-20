import { describe, expect, it } from "vitest";
import { decideSingleSessionAction } from "@/lib/singleSession";

describe("decideSingleSessionAction", () => {
  it("registra un id nuevo si no hay sesion local", () => {
    expect(
      decideSingleSessionAction({
        ownedSessionId: null,
        ownedUserId: null,
        currentUserId: "user-1",
        serverSessionIds: ["server-a"],
        confirmedSessionId: null,
      }),
    ).toBe("register-new");
  });

  it("registra un id nuevo si el id local es de otro usuario", () => {
    expect(
      decideSingleSessionAction({
        ownedSessionId: "local-a",
        ownedUserId: "user-2",
        currentUserId: "user-1",
        serverSessionIds: ["server-a"],
        confirmedSessionId: null,
      }),
    ).toBe("register-new");
  });

  it("acepta la sesion si el id local ya esta en el servidor", () => {
    expect(
      decideSingleSessionAction({
        ownedSessionId: "local-a",
        ownedUserId: "user-1",
        currentUserId: "user-1",
        serverSessionIds: ["local-a", "other"],
        confirmedSessionId: "local-a",
      }),
    ).toBe("ok");
  });

  it("reclama el slot si el servidor no tiene sesiones", () => {
    expect(
      decideSingleSessionAction({
        ownedSessionId: "local-a",
        ownedUserId: "user-1",
        currentUserId: "user-1",
        serverSessionIds: [],
        confirmedSessionId: null,
      }),
    ).toBe("claim");
  });

  it("reclama el slot en el primer login si el id local esta desfasado", () => {
    expect(
      decideSingleSessionAction({
        ownedSessionId: "stale-local",
        ownedUserId: "user-1",
        currentUserId: "user-1",
        serverSessionIds: ["server-other"],
        confirmedSessionId: null,
      }),
    ).toBe("claim");
  });

  it("echa la pestana si ya habia confirmado el id y otro dispositivo lo reemplazo", () => {
    expect(
      decideSingleSessionAction({
        ownedSessionId: "local-a",
        ownedUserId: "user-1",
        currentUserId: "user-1",
        serverSessionIds: ["server-other"],
        confirmedSessionId: "local-a",
      }),
    ).toBe("kick");
  });
});
