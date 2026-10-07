import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../pnpm-workspace.yaml', import.meta.url);
let text = readFileSync(file, 'utf8');
for (const name of ['esbuild>@esbuild/win32-x64', 'lightningcss>lightningcss-win32-x64-msvc', '@tailwindcss/oxide>@tailwindcss/oxide-win32-x64-msvc', 'rollup>@rollup/rollup-win32-x64-msvc']) {
 text = text.split(/\r?\n/).filter(line => !line.includes('"'+name+'"')).join('\n');
}
text = text.replace('replit uses linux-x64 only, we can exclude all other platforms', 'Retain Linux x64 and Windows x64 native dependencies for local operation').replaceAll('set this to true or false', 'true');
writeFileSync(file, text);
