import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = await readFile(resolve(root, 'worker/index.js'), 'utf8');
const core = await readFile(resolve(root, 'worker/core.js'), 'utf8');
const menu = await readFile(resolve(root, 'menu.json'), 'utf8');
const assets = Object.fromEntries(await Promise.all(['index.html', 'app.js', 'styles.css', 'split.js', 'favicon.svg'].map(async file => [
  `/${file}`, await readFile(resolve(root, 'public', file), 'utf8')
])));
const worker = source.replace('__MENU__', menu).replace('__ASSETS__', JSON.stringify(assets)).replace('/* __CORE__ */', core);
const dist = resolve(root, 'dist');
await mkdir(resolve(dist, 'server'), { recursive: true });
await mkdir(resolve(dist, '.openai'), { recursive: true });
await writeFile(resolve(dist, 'server/index.js'), worker);
await writeFile(resolve(dist, '.openai/hosting.json'), await readFile(resolve(root, '.openai/hosting.json')));
