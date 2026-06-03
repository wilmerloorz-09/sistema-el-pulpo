import { execSync } from "child_process";
import fs from "fs";
import path from "path";

async function run() {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs.readdirSync(migrationsDir);
  
  // Get all timestamps/versions
  const versions = files
    .map(f => {
      const match = f.match(/^(\d{14})_/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .sort();

  console.log(`Found ${versions.length} migrations locally.`);

  // Repair all migrations as applied, EXCEPT the last one (20260610010000)
  const targetVersion = "20260610010000";
  const toRepair = versions.filter(v => v !== targetVersion);

  console.log(`Repairing ${toRepair.length} migrations as applied...`);

  for (let i = 0; i < toRepair.length; i++) {
    const version = toRepair[i];
    console.log(`[${i + 1}/${toRepair.length}] Repairing version ${version}...`);
    try {
      execSync(`npx supabase migration repair --status applied ${version}`, {
        stdio: "inherit"
      });
    } catch (err) {
      console.error(`Failed to repair version ${version}:`, err.message);
    }
  }

  console.log("All migrations repaired. Now pushing the final migration...");
  try {
    execSync("npx supabase db push", { stdio: "inherit" });
    console.log("Migration push completed successfully!");
  } catch (err) {
    console.error("Failed to push final migration:", err.message);
  }
}

run();
