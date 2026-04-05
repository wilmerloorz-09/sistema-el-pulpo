import process from "node:process";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = "payment-proofs";
const pageSize = 100;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

async function listFolder(prefix = "") {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix,
      limit: pageSize,
      offset: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo listar ${prefix || "/"}: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function removePaths(paths) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo borrar lote: ${response.status} ${await response.text()}`);
  }
}

async function collectPaths(prefix = "") {
  const entries = await listFolder(prefix);
  const files = [];

  for (const entry of entries) {
    const name = entry?.name;
    if (!name) continue;

    if (entry.id) {
      files.push(prefix ? `${prefix}/${name}` : name);
      continue;
    }

    const childPrefix = prefix ? `${prefix}/${name}` : name;
    const nested = await collectPaths(childPrefix);
    files.push(...nested);
  }

  return files;
}

async function main() {
  const paths = await collectPaths();

  if (paths.length === 0) {
    console.log(`El bucket ${bucket} ya esta vacio.`);
    return;
  }

  for (let i = 0; i < paths.length; i += pageSize) {
    const batch = paths.slice(i, i + pageSize);
    await removePaths(batch);
    console.log(`Borrados ${Math.min(i + pageSize, paths.length)} / ${paths.length}`);
  }

  console.log(`Bucket ${bucket} vaciado correctamente.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
