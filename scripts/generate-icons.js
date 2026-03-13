import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "public", "logo.png");
const iconsDir = path.join(rootDir, "public", "icons");

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`No se encontro el archivo fuente: ${sourcePath}`);
  }

  fs.mkdirSync(iconsDir, { recursive: true });

  const sizes = [192, 512];
  await Promise.all(
    sizes.map((size) =>
      sharp(sourcePath)
        .resize(size, size, { fit: "cover" })
        .png()
        .toFile(path.join(iconsDir, `icon-${size}.png`))
    )
  );

  console.log("Iconos PWA generados correctamente.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
