import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Leer el .env para obtener las credenciales
const envVars = {};
const envContent = fs.readFileSync(".env", "utf8");
for (const line of envContent.split("\n")) {
  const [key, ...valueParts] = line.split("=");
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join("=").trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = envVars.VITE_SUPABASE_URL;
// Use service role if available, otherwise fallback to publishable
const supabaseKey = envVars.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Use a JWT token to impersonate an authenticated user if needed
  // For now, let's just use RPC to bypass RLS or check if RLS blocks us
  
  const { data, error } = await supabase
    .from("campanas_promocionales")
    .select("id, titulo, activa, cartelera_ofertas");

  if (error) {
    console.error("Error fetching:", error);
    process.exit(1);
  }

  console.log(`Found ${data.length} campaigns.`);
  for (const campana of data) {
    console.log(`\n=== CAMPAÑA: ${campana.titulo} ===`);
    console.log(`ID: ${campana.id}`);
    console.log(`ACTIVA: ${campana.activa}`);
    const cartelera = campana.cartelera_ofertas || [];
    console.log(`OFERTAS (${cartelera.length}):`);
    for (const oferta of cartelera) {
      console.log(`  - ${oferta.descripcion} (ID: ${oferta.id_oferta})`);
      console.log(`    inicio_at: ${oferta.inicio_at}`);
      console.log(`    bloqueo_at: ${oferta.bloqueo_at}`);
      console.log(`    resultado: ${oferta.resultado}`);
    }
  }
}

main();
