import fs from 'fs';
import path from 'path';

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

const prefixMap = {};

for (const file of files) {
  const match = file.match(/^(\d{14})_(.+)$/);
  if (!match) continue;
  const [_, prefix, name] = match;
  if (!prefixMap[prefix]) {
    prefixMap[prefix] = [];
  }
  prefixMap[prefix].push({ file, prefix, name });
}

let renameCount = 0;
for (const prefix in prefixMap) {
  const list = prefixMap[prefix];
  if (list.length > 1) {
    console.log(`Conflict found for prefix ${prefix}:`);
    for (let i = 1; i < list.length; i++) {
      const { file, name } = list[i];
      // Generate a new unique 14-digit prefix by adding i to the number
      const newPrefix = (BigInt(prefix) + BigInt(i)).toString();
      const newFile = `${newPrefix}_${name}`;
      const oldPath = path.join(dir, file);
      const newPath = path.join(dir, newFile);
      fs.renameSync(oldPath, newPath);
      console.log(`  Renamed: ${file} -> ${newFile}`);
      renameCount++;
    }
  }
}

console.log(`Prefix check completed. Renamed ${renameCount} conflicting migration files.`);
