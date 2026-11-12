// Optional read-only integration probe. Run with the host's Electron-as-Node
// and --experimental-vm-modules, passing its dsh/package.json as argv[2].
// Does not install, create a profile, start agents, or write configuration.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as guard from '../lib/guard.js';
import * as runtime from '../lib/runtime.js';
const requireHost = createRequire(process.argv[2]);
const host = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-app-boot')).href);
const z = requireHost('@deepseek-ai/schemastery');
const context = vm.createContext({ console });
const externals = {
  '@deepseek-ai/schemastery': { default: z }, './guard.js': guard,
  './runtime.js': { ...runtime, detectRuntimeVersion: () => runtime.detectRuntimeVersion(async () => host) }
};
const entry = new vm.SourceTextModule(await fs.readFile(new URL('../lib/index.js', import.meta.url), 'utf8'), { context });
await entry.link(spec => {
  const values = externals[spec]; if (!values) throw Error(`Unexpected import ${spec}`);
  return new vm.SyntheticModule(Object.keys(values), function() { for (const [k,v] of Object.entries(values)) this.setExport(k,v); }, { context });
});
await entry.evaluate();
assert.equal(host.isNativeConfigSchema(entry.namespace.Config), true);
const resolved = entry.namespace.Config({});
assert.equal(runtime.readFlag(resolved.enabled), true);
assert.equal(runtime.readFlag(resolved.repairForks), true);
for (const field of Object.values(entry.namespace.Config.dict)) assert.equal(field.meta.volatile, true);
const detected = await runtime.detectRuntimeVersion(async () => host);
assert.equal(detected.supported, true);
let installed = false;
await entry.namespace.apply({ logger: { info() {}, warn() {} }, on(event) { assert.equal(event, 'tools/execute'); installed = true; } }, resolved);
assert.equal(installed, true);
console.log(JSON.stringify({ runtime: detected.version, nativeConfigAccepted: true, defaultSwitches: Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, runtime.readFlag(value)])), handlerRegistered: true, profileWrites: 0, agentsStarted: 0 }));
