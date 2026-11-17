import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";

function readBuildVersion() {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, "public/app-version.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    const version = String(parsed?.version ?? "").trim();
    return version || "dev";
  } catch {
    return "dev";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildVersion = readBuildVersion();

  return {
    define: {
      __APP_BUILD_VERSION__: JSON.stringify(buildVersion),
    },
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      {
        name: "elpulpo-html-build-version",
        transformIndexHtml(html) {
          return html.replaceAll("%APP_BUILD_VERSION%", buildVersion);
        },
      },
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        sonner: path.resolve(__dirname, "./src/lib/sonner-stub.ts"),
      },
    },
  };
});
