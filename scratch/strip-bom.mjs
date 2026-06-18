import fs from 'fs';
import path from 'path';

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir);
let count = 0;
for (const file of files) {
  if (file.endsWith('.sql')) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.substring(1);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`BOM removed from ${file}`);
      count++;
    }
  }
}
console.log(`Completed. Cleaned BOM from ${count} files.`);
