import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config(); // Load .env

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("No se encontraron VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from("campanas_promocionales")
    .select("id, titulo, cartelera_ofertas, activa")
    .eq("activa", true);

  if (error) {
    console.error("Error fetching:", error);
    process.exit(1);
  }

  for (const campana of data) {
    console.log(`\nCampana: ${campana.titulo}`);
    const cartelera = campana.cartelera_ofertas || [];
    for (const oferta of cartelera) {
      console.log(`  Oferta: ${oferta.descripcion}`);
      console.log(`    inicio_at: ${oferta.inicio_at}`);
      console.log(`    bloqueo_at: ${oferta.bloqueo_at}`);
      console.log(`    resultado: ${oferta.resultado}`);
      
      const ahora = Date.now();
      const bloqueoTime = new Date(oferta.bloqueo_at).getTime();
      const inicioTime = oferta.inicio_at ? new Date(oferta.inicio_at).getTime() : 0;
      
      console.log(`    ahora: ${new Date(ahora).toISOString()} (${ahora})`);
      console.log(`    bloqueoTime: ${new Date(bloqueoTime).toISOString()} (${bloqueoTime})`);
      console.log(`    inicioTime: ${new Date(inicioTime).toISOString()} (${inicioTime})`);
      
      console.log(`    ahora > bloqueoTime: ${ahora > bloqueoTime}`);
      console.log(`    ahora < inicioTime: ${ahora < inicioTime}`);
      
      let disponible = true;
      if (oferta.resultado === "GANADA" || oferta.resultado === "PERDIDA") {
        disponible = false;
        console.log(`    Falla por resultado: ${oferta.resultado}`);
      }
      if (!oferta.bloqueo_at) {
        disponible = false;
        console.log(`    Falla por falta de bloqueo_at`);
      }
      if (ahora > bloqueoTime) {
        disponible = false;
        console.log(`    Falla por bloqueo expirado`);
      }
      if (oferta.inicio_at && ahora < inicioTime) {
        disponible = false;
        console.log(`    Falla por inicio en el futuro`);
      }
      
      console.log(`    DISPONIBLE: ${disponible}`);
    }
  }
}

main();
