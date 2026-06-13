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

  /** Permite inyectar bytes crudos (ej. comandos raster de imagen) */
  raw(bytes: Uint8Array | number[]) {
    return this.pushRaw(bytes);
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

  /** ESC M n — selecciona fuente (0 = Font A, 1 = Font B, 2 = Font C). */
  font(mode: "A" | "B" | "C" = "A") {
    const n = mode === "B" ? 1 : mode === "C" ? 2 : 0;
    return this.pushRaw([0x1b, 0x4d, n]);
  }

  /** ESC 3 n — ajusta interlineado en dots. Pasa null para restablecer al default (ESC 2). */
  lineSpacing(n: number | null = null) {
    if (n === null) {
      return this.pushRaw([0x1b, 0x32]);
    }
    return this.pushRaw([0x1b, 0x33, n]);
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
   * GS ( k — Genera e imprime un código QR utilizando la secuencia nativa.
   * @param data Datos a codificar en el QR.
   * @param moduleSize Tamaño del módulo del código QR (1-16). Por defecto 4.
   */
  qrcode(data: string, moduleSize = 4) {
    if (!data) return this;
    const dataBytes = textToLatin1Bytes(data);
    const len = dataBytes.length;

    // 1. Seleccionar modelo de QR (Modelo 2)
    this.pushRaw([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);

    // 2. Definir tamaño del módulo
    const size = Math.max(1, Math.min(16, moduleSize));
    this.pushRaw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);

    // 3. Nivel de corrección de errores (M = 49)
    this.pushRaw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 49]);

    // 4. Almacenar datos en el buffer de la impresora
    const pL = (len + 3) & 0xff;
    const pH = ((len + 3) >> 8) & 0xff;
    const storeHeader = new Uint8Array([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
    const storePayload = new Uint8Array(storeHeader.length + dataBytes.length);
    storePayload.set(storeHeader, 0);
    storePayload.set(dataBytes, storeHeader.length);
    this.pushRaw(storePayload);

    // 5. Imprimir el código QR almacenado
    this.pushRaw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 48]);

    return this;
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

/** 
 * Carga una imagen de forma asincrona y genera los bytes raster ESC/POS.
 * Ideal para imprimir logos en B/N mediante el comando GS v 0.
 */
export async function loadEscPosLogo(src: string = "/logo.png", targetWidth = 256): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Mantenemos proporcion de aspecto
      const scale = targetWidth / img.width;
      const targetHeight = Math.floor(img.height * scale);
      
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      
      // Fondo blanco puro para que los pixeles transparentes no salgan negros
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imgData.data;
      
      // En ESC/POS (GS v 0), xL,xH es el ancho en BYTES.
      const bytesWidth = Math.ceil(targetWidth / 8);
      const rasterBytes = new Uint8Array(bytesWidth * targetHeight);
      
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          
          // Calculo simple de luminancia para blanco/negro
          const luminance = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
          if (luminance < 128) {
            const byteIdx = (y * bytesWidth) + Math.floor(x / 8);
            // El bit 7 es el pixel mas a la izquierda del byte
            const bit = 7 - (x % 8);
            rasterBytes[byteIdx] |= (1 << bit);
          }
        }
      }
      
      // Comando GS v 0 m xL xH yL yH d1...dk
      // m=0 (Normal)
      const header = new Uint8Array([
        0x1d, 0x76, 0x30, 0x00,
        bytesWidth & 0xff,
        (bytesWidth >> 8) & 0xff,
        targetHeight & 0xff,
        (targetHeight >> 8) & 0xff
      ]);
      
      const out = new Uint8Array(header.length + rasterBytes.length);
      out.set(header, 0);
      out.set(rasterBytes, header.length);
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Genera un encabezado dinámico dibujando el logo a la izquierda y las líneas de texto a la derecha,
 * devolviendo los bytes del comando ESC/POS rasterizado para ahorrar papel físico.
 */
export async function buildCombinedHeaderRaster(
  logoSrc = "/logo.png",
  lines: string[],
  targetWidth = 576
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Restauramos las proporciones legibles del encabezado
      const logoWidth = 120;
      const logoHeight = Math.floor(img.height * (logoWidth / img.width));
      const lineSpacing = 28;
      const textHeight = lines.length * lineSpacing + 10;
      const targetHeight = Math.max(logoHeight, textHeight, 100);

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);

      // Fondo blanco puro
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // Dibujamos logotipo a la izquierda, centrado verticalmente
      const logoY = Math.floor((targetHeight - logoHeight) / 2);
      ctx.drawImage(img, 0, logoY, logoWidth, logoHeight);

      // Dibujamos líneas de texto a la derecha
      ctx.fillStyle = "black";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const startX = logoWidth + 24; // Espacio después del logo
      const totalTextHeight = lines.length * lineSpacing;
      const startY = Math.floor((targetHeight - totalTextHeight) / 2) + Math.floor(lineSpacing / 2);

      lines.forEach((line, idx) => {
        const isHeaderLine = idx === 0 || line.startsWith("ORDEN ");
        ctx.font = isHeaderLine ? "bold 24px monospace" : "20px monospace";
        ctx.fillText(line, startX, startY + idx * lineSpacing);
      });

      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imgData.data;

      // Conversión a monocromo ESC/POS
      const bytesWidth = Math.ceil(targetWidth / 8);
      const rasterBytes = new Uint8Array(bytesWidth * targetHeight);

      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          const luminance = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
          if (luminance < 128) {
            const byteIdx = (y * bytesWidth) + Math.floor(x / 8);
            const bit = 7 - (x % 8);
            rasterBytes[byteIdx] |= (1 << bit);
          }
        }
      }

      const header = new Uint8Array([
        0x1d, 0x76, 0x30, 0x00,
        bytesWidth & 0xff,
        (bytesWidth >> 8) & 0xff,
        targetHeight & 0xff,
        (targetHeight >> 8) & 0xff
      ]);

      const out = new Uint8Array(header.length + rasterBytes.length);
      out.set(header, 0);
      out.set(rasterBytes, header.length);
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = logoSrc;
  });
}

