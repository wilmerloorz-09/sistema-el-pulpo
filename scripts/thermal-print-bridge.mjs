/**
 * Puente local de impresion termica ESC/POS (80mm).
 *
 * Uso:
 *   node scripts/thermal-print-bridge.mjs
 *
 * Variables de entorno:
 *   THERMAL_PRINTER_HOST=192.168.1.50:9100   (recomendado: red RAW)
 *   THERMAL_PRINTER_NAME=Nombre exacto en Windows   (USB/compartida)
 *   THERMAL_PRINT_PORT=17888
 *
 * El POS envia POST http://127.0.0.1:17888/print
 * Body: { "data": "<base64 ESC/POS>", "printerName": "opcional" }
 */

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.THERMAL_PRINT_PORT || 17888);
const DEFAULT_HOST = process.env.THERMAL_PRINTER_HOST || "";
const DEFAULT_PRINTER = process.env.THERMAL_PRINTER_NAME || "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PS1 = path.join(__dirname, "send-raw-to-printer.ps1");

function sendToNetworkPrinter(hostSpec, buffer) {
  return new Promise((resolve, reject) => {
    const [host, portStr] = hostSpec.split(":");
    const port = Number(portStr || 9100);
    const socket = new net.Socket();
    socket.setTimeout(10000);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timeout conectando a ${host}:${port}`));
    });
    socket.connect(port, host, () => {
      socket.write(buffer, (err) => {
        socket.end();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function sendToWindowsPrinter(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `pulpo-ticket-${Date.now()}.prn`);
    fs.writeFileSync(tmpFile, buffer);

    const ps = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", RAW_PS1, "-PrinterName", printerName, "-FilePath", tmpFile],
      { windowsHide: true },
    );

    let stderr = "";
    ps.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ps.on("close", (code) => {
      fs.unlink(tmpFile, () => {});
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell salio con codigo ${code}`));
    });
  });
}

async function handlePrint(body) {
  const parsed = JSON.parse(body || "{}");
  const base64 = parsed.data;
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Falta campo data (base64)");
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw new Error("Buffer ESC/POS vacio");
  }

  const host = DEFAULT_HOST;
  const printerName = String(parsed.printerName || DEFAULT_PRINTER || "").trim();

  if (host) {
    await sendToNetworkPrinter(host, buffer);
    return { mode: "network", host };
  }

  if (!printerName) {
    throw new Error(
      "Configure THERMAL_PRINTER_HOST (IP:9100) o THERMAL_PRINTER_NAME (nombre en Windows)",
    );
  }

  await sendToWindowsPrinter(printerName, buffer);
  return { mode: "windows-raw", printerName };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, host: DEFAULT_HOST || null, printer: DEFAULT_PRINTER || null }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/print") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");

  try {
    const info = await handlePrint(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...info }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[thermal-print-bridge] Escuchando en http://127.0.0.1:${PORT}/print`);
  if (DEFAULT_HOST) console.log(`[thermal-print-bridge] Red: ${DEFAULT_HOST}`);
  if (DEFAULT_PRINTER) console.log(`[thermal-print-bridge] Windows: ${DEFAULT_PRINTER}`);
});
