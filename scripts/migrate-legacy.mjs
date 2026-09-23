// One-time, read-only migration aid for the retired disk runtime; never used by the app.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw new Error('Usage: pnpm migrate:legacy <old projects directory> <new bundle directory>');
if (resolve(source) === resolve(destination)) throw new Error('Use a separate output directory.');
await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.name)) continue;
  const state = JSON.parse(await readFile(join(source, entry.name, 'state.json'), 'utf8'));
  const p = state.project,
    files = { 'project.json': strToU8(JSON.stringify(p, null, 2)) };
  for (const asset of Object.values(p.assets)) {
    if (!/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(asset.file))
      throw new Error('Invalid asset filename');
    const bytes = await readFile(join(source, entry.name, 'assets', asset.file));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
      throw new Error('Asset checksum mismatch: ' + asset.name);
    files['assets/' + asset.file] = bytes;
  }
  const output = join(destination, entry.name + '.muweave.zip');
  await writeFile(output, zipSync(files, { level: 0 }), { flag: 'wx' });
  console.log(p.title + ' → ' + output);
}
console.log(
  'Import these bundles using the browser project picker. Original files and history remain untouched.',
);
