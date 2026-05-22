import { THERMAL_LINE_CHARS } from "./constants";

/** Convierte texto a bytes Latin-1 (compatible con code page 16 / WPC1252 en la mayoria de termicas). */
function textToLatin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i] = code <= 255 ? code : 0x3f;
  }
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export type EscPosAlign = "left" | "center" | "right";

export interface FinalizeTicketOptions {
  /** Lineas en blanco ANTES del corte (para pasar el texto bajo la cuchilla). Default: 2 */
  feedLines?: number;
  /** Pulso de cajon ANTES del corte (nunca despues). */
  openDrawer?: boolean;
}

/**
 * Generador de tickets ESC/POS.
 * Regla: inicializar al inicio; feed y cajon ANTES del corte;
 * el corte (GS V 0) es el ULTIMO byte — nada despues.
 */
export class EscPosEncoder {
  private chunks: Uint8Array[] = [];
  /** true tras finalizeTicket/cut: bloquea cualquier byte adicional. */
  private sealed = false;

  private pushRaw(bytes: number[] | Uint8Array) {
    if (this.sealed) {
      if (import.meta.env.DEV) {
        console.warn("[EscPosEncoder] Se ignoraron bytes enviados despues del corte.");
      }
      return this;
    }
    this.chunks.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return this;
  }

  /** ESC @ — reinicia impresora (solo al inicio del documento). */
  initialize() {
    return this.pushRaw([0x1b, 0x40]);
  }

  /** ESC t n — tabla de caracteres (16 = WPC1252 / Latin-1 en Epson). */
  codePageLatin1() {
    return this.pushRaw([0x1b, 0x74, 16]);
  }

  align(mode: EscPosAlign) {
    const n = mode === "center" ? 1 : mode === "right" ? 2 : 0;
    return this.pushRaw([0x1b, 0x61, n]);
  }

  bold(enabled: boolean) {
    return this.pushRaw([0x1b, 0x45, enabled ? 1 : 0]);
  }

  /** GS ! n — altura/ancho (0 = normal, 0x11 = doble alto y ancho). */
  textSize(normal = true) {
    return this.pushRaw([0x1d, 0x21, normal ? 0x00 : 0x11]);
  }

  text(value: string) {
    if (!value) return this;
    return this.pushRaw(textToLatin1Bytes(value));
  }

  line(value = "") {
    if (value) this.text(value);
    return this.pushRaw([0x0a]);
  }

  /** Avance de lineas en el cuerpo del ticket (no usar despues de finalizeTicket). */
  feed(lines = 1) {
    for (let i = 0; i < lines; i++) {
      this.pushRaw([0x0a]);
    }
    return this;
  }

  separator(char = "-") {
    return this.line(char.repeat(THERMAL_LINE_CHARS));
  }

  /**
   * Avance de papel con ESC d n (comando de alimentacion, no LF sueltos).
   * Solo usar ANTES de finalizeTicket.
   */
  feedPaper(lines = 1) {
    const n = Math.min(255, Math.max(0, lines));
    return this.pushRaw([0x1b, 0x64, n]);
  }

  /** ESC p — apertura de cajon. Debe llamarse ANTES de finalizeTicket. */
  openCashDrawer() {
    return this.pushRaw([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  }

  /**
   * Cierra el ticket: opcional cajon → feed → corte total.
   * GS V 0 (0x1D 0x56 0x00): corte sin la secuencia GS V 66 que avanza mucho papel extra.
   * Tras esto el encoder queda sellado: ningun byte mas se envia.
   */
  finalizeTicket(options: FinalizeTicketOptions = {}) {
    if (this.sealed) return this;

    const feedLines = options.feedLines ?? 2;

    if (options.openDrawer) {
      this.openCashDrawer();
    }

    // Solo LF antes del corte (suficiente para la mayoria de cuchillas 80mm)
    for (let i = 0; i < feedLines; i++) {
      this.pushRaw([0x0a]);
    }

    // Corte total — ULTIMO comando del buffer
    this.pushRaw([0x1d, 0x56, 0x00]);

    this.sealed = true;
    return this;
  }

  /** Alias de finalizeTicket. No anade feed interno extra (evita GS V 66). */
  cut(options?: FinalizeTicketOptions) {
    return this.finalizeTicket(options);
  }

  build(): Uint8Array {
    return concatBytes(...this.chunks);
  }
}

export function wrapWords(text: string, width: number): string[] {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return [""];
  if (normalized.length <= width) return [normalized];

  const lines: string[] = [];
  let current = "";

  for (const word of normalized.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (word.length > width) {
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      current = "";
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Fila con monto alineado a la derecha dentro de `width` caracteres. */
export function formatAmountLine(left: string, amount: string, width = THERMAL_LINE_CHARS): string {
  const leftPart = left.slice(0, Math.max(0, width - amount.length - 1)).trimEnd();
  const spaces = Math.max(1, width - leftPart.length - amount.length);
  return `${leftPart}${" ".repeat(spaces)}${amount}`;
}
