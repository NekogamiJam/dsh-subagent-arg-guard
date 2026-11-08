import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('./fixtures/', import.meta.url);
const expected = JSON.parse(await fs.readFile(new URL('sha256.json', root), 'utf8'));
for (const { file, Hash } of expected) {
  assert.match(file, /^[\w.-]+\.js$/);
  const actual = createHash('sha256').update(await fs.readFile(new URL(file, root))).digest('hex').toUpperCase();
  assert.equal(actual, Hash, `${file}: fixture was modified`);
}
console.log(`Verified ${expected.length} unmodified source fixtures`);
