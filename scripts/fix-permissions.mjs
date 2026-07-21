import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

function processDir(dir) {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (file.endsWith('.js')) {
      let content = readFileSync(fullPath, 'utf-8');
      if (content.includes('.setDefaultMemberPermissions')) {
        content = content.replace(/\s*\.setDefaultMemberPermissions\([^)]+\)/g, '');
        writeFileSync(fullPath, content, 'utf-8');
        console.log(`Updated: ${file}`);
      }
    }
  }
}

processDir('src/commands');
