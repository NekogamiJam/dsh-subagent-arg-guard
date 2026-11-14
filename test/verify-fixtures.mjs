import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('./fixtures/', import.meta.url);
let count = 0;
for (const subdir of ['', 'rc2/', 'rc3/']) {
  const directory = new URL(subdir, root);
  const expected = JSON.parse(await fs.readFile(new URL('sha256.json', directory), 'utf8'));
  for (const { file, Hash } of expected) {
    assert.match(file, /^[\w.-]+\.js$/);
    const actual = createHash('sha256').update(await fs.readFile(new URL(file, directory))).digest('hex').toUpperCase();
    assert.equal(actual, Hash, `${subdir}${file}: fixture was modified`);
    count++;
  }
}
console.log(`Verified ${count} unmodified source fixtures`);
