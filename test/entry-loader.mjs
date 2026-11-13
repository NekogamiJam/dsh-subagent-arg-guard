import vm from 'node:vm';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as guard from '../lib/guard.js';
import * as runtime from '../lib/runtime.js';
import * as access from '../lib/access.js';

// The production entry is evaluated unchanged; only its host package boundary
// is substituted. Schema rendering is tested separately against the real host.
export async function loadEntry({ version = '0.2.2-rc.1', fail = false } = {}) {
  const context = vm.createContext({ console });
  const schema = (type, dict) => {
    const node = { type, dict, meta: {}, [Symbol.for('schemastery')]: true,
      default(value) { this.meta.default = value; return this; },
      extra(key, value) { this.meta[key] = value; return this; },
      description(value) { this.meta.description = value; return this; }
    };
    return node;
  };
  const z = { object: dict => schema('object', dict), boolean: () => schema('boolean') };
  const host = { getDshRuntimeVersion() { if (fail) throw Error('host unavailable'); return version; } };
  const values = { '@deepseek-ai/schemastery': { default: z }, './guard.js': guard, './access.js': access,
    './runtime.js': { ...runtime, detectRuntimeVersion: () => runtime.detectRuntimeVersion(async () => host) } };
  const entry = new vm.SourceTextModule(await fs.readFile(new URL('../lib/index.js', import.meta.url), 'utf8'), { context, identifier: fileURLToPath(new URL('../lib/index.js', import.meta.url)) });
  await entry.link(specifier => {
    const external = values[specifier];
    if (!external) throw Error(`Unexpected production entry import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(external), function() { for (const [k,v] of Object.entries(external)) this.setExport(k,v); }, { context });
  });
  await entry.evaluate();
  return entry.namespace;
}
