import { readdirSync } from 'fs';
import { join } from 'path';

const dirs = ['moderation', 'utility', 'backup', 'antinuke', 'ticket', 'welcome'];
const cmds = [];

for (const dir of dirs) {
  for (const file of readdirSync(join('src/commands', dir)).filter(f => f.endsWith('.js')).sort()) {
    const mod = await import(`../src/commands/${dir}/${file}`);
    if (mod.data) cmds.push({ name: mod.data.name, file: `${dir}/${file}`, json: mod.data.toJSON() });
  }
}

function checkOptions(opts, path) {
  if (!opts) return;
  let seenOptional = false;
  for (let oi = 0; oi < opts.length; oi++) {
    const o = opts[oi];
    if (!o.required) seenOptional = true;
    else if (seenOptional) {
      console.log(`ISSUE ${path} options[${oi}] ${o.name} required after optional`);
    }
    checkOptions(o.options, `${path} > ${o.name}`);
  }
}

cmds.forEach((c, i) => checkOptions(c.json.options, `cmd[${i}] ${c.name} (${c.file})`));
console.log('Total:', cmds.length);
cmds.forEach((c, i) => console.log(i, c.name));
