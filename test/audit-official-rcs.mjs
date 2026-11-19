// Read-only audit of official npm tarballs; never imports or runs their code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const packages = ['dsh-app-boot', 'dsh-tools', 'dsh-tool-subagent', 'dsh-subagent',
  'dsh-tool-executor-native', 'dsh-tool-executor-ptc', 'dsh-client-ui-settings', 'dsh-client-ui-slots'];
async function fetchOk(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response;
}
async function readArtifacts(name, rc) {
  const version = `0.2.2-rc.${rc}`;
  const metadata = await (await fetchOk(`https://registry.npmjs.org/@deepseek-ai%2f${name}/${version}`)).json();
  const bytes = Buffer.from(await (await fetchOk(metadata.dist.tarball)).arrayBuffer());
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, metadata.dist.integrity);
  const tar = gunzipSync(bytes);
  const entries = new Map();
  for (let i = 0; i + 512 <= tar.length && tar[i];) {
    const path = tar.toString('utf8', i, i + 100).split('\0')[0];
    const size = Number.parseInt(tar.toString('ascii', i + 124, i + 136).split('\0')[0].trim(), 8);
    assert(Number.isSafeInteger(size) && size >= 0 && i + 512 + size <= tar.length, `bad TAR entry: ${path}`);
    if (/^package\/lib\/.*\.(?:[cm]?js|d\.ts)$/.test(path)) {
      entries.set(path, tar.subarray(i + 512, i + 512 + size));
    }
    i += 512 + Math.ceil(size / 512) * 512;
  }
  assert(entries.size, `${name}@${version}: no lib artifacts`);
  return entries;
}
for (const name of packages) {
  const [baseline, ...targets] = await Promise.all([3, 4, 5].map(rc => readArtifacts(name, rc)));
  for (const [index, target] of targets.entries()) {
    const rc = index + 4;
    assert.deepEqual([...target.keys()].sort(), [...baseline.keys()].sort(), `${name} rc.${rc}: artifact paths`);
    for (const [path, bytes] of baseline) {
      assert(bytes.equals(target.get(path)), `${name} rc.${rc}: ${path} differs from rc.3`);
    }
    console.log(`${name} rc.${rc}: ${target.size} files match rc.3 byte for byte`);
  }
}
