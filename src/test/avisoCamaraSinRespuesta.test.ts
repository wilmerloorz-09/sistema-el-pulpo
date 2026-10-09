import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAvisoCamaraSinRespuesta } from "@/hooks/useAvisoCamaraSinRespuesta";

describe("useAvisoCamaraSinRespuesta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("avisa si la camara no se abrio", () => {
    const onSinRespuesta = vi.fn();
    const { result } = renderHook(() => useAvisoCamaraSinRespuesta(onSinRespuesta));

    result.current.vigilar();
    vi.advanceTimersByTime(5_000);

    expect(onSinRespuesta).toHaveBeenCalledTimes(1);
  });

  it("no avisa si la app perdio el foco (se abrio la camara)", () => {
    const onSinRespuesta = vi.fn();
    const { result } = renderHook(() => useAvisoCamaraSinRespuesta(onSinRespuesta));

    result.current.vigilar();
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(5_000);

    expect(onSinRespuesta).not.toHaveBeenCalled();
  });

  it("no avisa si llego la foto", () => {
    const onSinRespuesta = vi.fn();
    const { result } = renderHook(() => useAvisoCamaraSinRespuesta(onSinRespuesta));

    result.current.vigilar();
    vi.advanceTimersByTime(2_000);
    result.current.cancelar();
    vi.advanceTimersByTime(5_000);

    expect(onSinRespuesta).not.toHaveBeenCalled();
  });

  it("no avisa si la ventana sigue sin foco al vencer la espera", () => {
    const onSinRespuesta = vi.fn();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = renderHook(() => useAvisoCamaraSinRespuesta(onSinRespuesta));

    result.current.vigilar();
    vi.advanceTimersByTime(5_000);

    expect(onSinRespuesta).not.toHaveBeenCalled();
  });
});
