// Static-only audit of published DSH alpha tarballs; never imports or runs their code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const versions = ['0.2.3-alpha.1', '0.2.3-alpha.2'];
const packages = [
  'dsh-app-boot', 'dsh-error', 'dsh-tools', 'dsh-tool-subagent', 'dsh-subagent',
  'dsh-tool-executor-native', 'dsh-tool-executor-ptc',
  'dsh-client-ui-settings', 'dsh-client-ui-slots'
];
const selected = {
  'dsh-tools': [
    ['package/lib/index.js', 'tools.js'],
    ['package/lib/pipeline.js', 'pipeline.js'],
    ['package/lib/shared-DGx6D7zk.js', 'shared-DGx6D7zk.js']
  ],
  'dsh-tool-subagent': [['package/lib/index.js', 'subagent.js']],
  'dsh-tool-executor-native': [['package/lib/index.js', 'native.js']],
  'dsh-tool-executor-ptc': [
    ['package/lib/index.js', 'ptc.js'],
    ['package/lib/_chunks/ptc-calls-B2yhcs6M.js', 'ptc-calls.js']
  ]
};
const fixtureDir = fileURLToPath(new URL('./fixtures/alpha2/', import.meta.url));
const writeFixtures = process.argv.includes('--write-fixtures');
if (writeFixtures) await mkdir(fixtureDir, { recursive: true });

async function fetchOk(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response;
}

function readTarball(bytes) {
  const tar = gunzipSync(bytes);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const name = tar.toString('utf8', offset, offset + 100).split('\0')[0];
    const size = Number.parseInt(tar.toString('ascii', offset + 124, offset + 136).split('\0')[0].trim(), 8);
    assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, `invalid TAR entry ${name}`);
    if (name === 'package/package.json' || /^package\/lib\/.*\.(?:[cm]?js|d\.ts)$/.test(name)) {
      entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const builds = new Map();
const provenance = [];
for (const version of versions) {
  for (const name of packages) {
    const metadata = await (await fetchOk(`https://registry.npmjs.org/@deepseek-ai%2f${name}/${version}`)).json();
    const bytes = Buffer.from(await (await fetchOk(metadata.dist.tarball)).arrayBuffer());
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, metadata.dist.integrity,
      `${name}@${version}: npm integrity`);
    const files = readTarball(bytes);
    assert(files.has('package/package.json'), `${name}@${version}: package.json`);
    const manifest = JSON.parse(files.get('package/package.json').toString('utf8'));
    assert.equal(manifest.name, `@deepseek-ai/${name}`);
    assert.equal(manifest.version, version);
    builds.set(`${version}/${name}`, files);
    provenance.push({ name: `@deepseek-ai/${name}`, version, tarball: metadata.dist.tarball, integrity: metadata.dist.integrity });
  }
}

for (const [version, manifest] of [['3.18.4', 'plugin Schemastery'], ['3.20.0-alpha.1', 'alpha Host Schemastery']]) {
  const metadata = await (await fetchOk(`https://registry.npmjs.org/@deepseek-ai%2fschemastery/${version}`)).json();
  const bytes = Buffer.from(await (await fetchOk(metadata.dist.tarball)).arrayBuffer());
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, metadata.dist.integrity,
    `Schemastery@${version}: npm integrity`);
  const files = readTarball(bytes);
  assert(files.has('package/lib/index.mjs'), `Schemastery@${version}: ESM runtime`);
  builds.set(`schemastery/${version}`, files);
  provenance.push({ name: '@deepseek-ai/schemastery', version, role: manifest, tarball: metadata.dist.tarball, integrity: metadata.dist.integrity });
}
assert(builds.get('schemastery/3.18.4').get('package/lib/index.mjs').equals(
  builds.get('schemastery/3.20.0-alpha.1').get('package/lib/index.mjs')),
  'Plugin and alpha Host Schemastery ESM runtimes differ');

// Alpha.1 and alpha.2 carry identical guard-facing implementation artifacts.
// app-boot's built implementation changes between alphas, but both retain the public version API.
for (const name of packages.filter(name => name !== 'dsh-app-boot')) {
  const first = builds.get(`${versions[0]}/${name}`);
  const second = builds.get(`${versions[1]}/${name}`);
  assert.deepEqual([...second.keys()].sort(), [...first.keys()].sort(), `${name}: alpha artifact paths`);
  for (const [path, bytes] of first) {
    if (path === 'package/package.json') continue;
    assert(bytes.equals(second.get(path)), `${name}:${path} differs between alpha builds`);
  }
}
for (const version of versions) {
  const appBoot = builds.get(`${version}/dsh-app-boot`);
  assert.match(appBoot.get('package/lib/index.js').toString(), /function getDshRuntimeVersion\(/,
    `${version}: public runtime version API`);
  assert.match(appBoot.get('package/lib/types/plugin-compatibility.d.ts').toString(), /getDshRuntimeVersion\(\): string/,
    `${version}: runtime version API type`);
}
const harnessError = builds.get(`${versions[1]}/dsh-error`).get('package/lib/index.js').toString();
assert.match(harnessError, /var HarnessError = class extends Error/);
const alphaTools = builds.get(`${versions[1]}/dsh-tools`).get('package/lib/pipeline.js').toString();
assert.match(alphaTools, /function errorInfo\(error\)[\s\S]{0,220}error instanceof HarnessError/);
for (const method of ['var ToolExecutionPipeline = class', 'constructor(ctx, source', 'resolveExecution(', 'async prepare(', 'async dispatch(']) {
  assert(alphaTools.includes(method), `dsh-tools alpha contract missing ${method}`);
}
const alphaSubagentTool = builds.get(`${versions[1]}/dsh-tool-subagent`).get('package/lib/index.js').toString();
for (const contract of [
  'new SubagentError(', '"MODEL_ROUTE_NOT_ALLOWED"', '"MODEL_SELECTION_DISABLED"',
  'new ToolArgsError(', 'name: toolName', 'toolName ?? "subagent"',
  'additionalProperties: false', 'const: "activation"', 'name: {', 'presentationMeta:'
]) assert(alphaSubagentTool.includes(contract), `dsh-tool-subagent alpha contract missing ${contract}`);
for (const [pkg, cls] of [['dsh-tool-executor-native', 'NativeToolExecutor'], ['dsh-tool-executor-ptc', 'PtcExecutor']]) {
  const code = builds.get(`${versions[1]}/${pkg}`).get('package/lib/index.js').toString();
  assert(code.includes(`var ${cls} = class`), `${pkg}: executor class`);
  assert(code.includes('this.pipeline = new ToolExecutionPipeline(ctx'), `${pkg}: shared tool pipeline`);
}

const copied = [];
for (const [name, files] of Object.entries(selected)) {
  const artifacts = builds.get(`${versions[1]}/${name}`);
  for (const [source, destination] of files) {
    const bytes = artifacts.get(source);
    assert(bytes, `${name}@${versions[1]}: missing ${source}`);
    copied.push({ file: destination, bytes, Hash: createHash('sha256').update(bytes).digest('hex').toUpperCase() });
    const target = new URL(destination, new URL('./fixtures/alpha2/', import.meta.url));
    if (writeFixtures) await fs.writeFile(target, bytes);
    else assert((await fs.readFile(target)).equals(bytes), `${destination}: fixture differs from verified npm artifact`);
  }
}

if (writeFixtures) {
  await fs.writeFile(new URL('sha256.json', new URL('./fixtures/alpha2/', import.meta.url)), `${JSON.stringify(copied.map(({ file, Hash }) => ({ file, Hash })), null, 2)}\n`);
  await fs.writeFile(new URL('provenance.json', new URL('./fixtures/alpha2/', import.meta.url)), `${JSON.stringify({ versions, packages: provenance, note: 'Official npm tarballs were SHA-512 verified before selected unmodified JavaScript files were copied. The audit script reads files as data; offline tests separately run selected artifacts in a VM with mocked host services, never on a DSH 0.2.3 alpha installation.' }, null, 2)}\n`);
}
console.log(`Verified ${provenance.length} official DSH npm tarballs; ${copied.length} selected alpha fixtures ${writeFixtures ? 'written' : 'match'}; alpha.1/alpha.2 contracts audited statically.`);
