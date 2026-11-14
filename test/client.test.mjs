import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
function loadClient() {
  let entry;
  let states = [], cursor = 0;
  const stores = [];
  const React = {
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) { assert.equal(getSnapshot, getServerSnapshot); stores.push({ subscribe, getSnapshot }); return getSnapshot(); },
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; },
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], v => { states[index] = v; }]; }
  };
  const context = { window: { __ModuleLoader__: { load(spec) { assert.equal(spec.id, 'dsh-subagent-arg-guard'); entry = spec.factory(name => { assert.equal(name, 'react'); return React; }); } } } };
  vm.runInNewContext(source, context);
  return { entry, render(props) { cursor = 0; return entry.Settings(props); }, states, stores };
}
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(n => nodes(n, predicate))];
}
const form = mutate => ({ state: { status: 'ready', writable: true, revision: 7, value: { enabled: true, repairForks: false } }, mutate });
test('client registers only a settings section and binds its exact shared Config entry', async () => {
  const c = loadClient();
  let registration, Page, writes;
  let disposed = false, subscribed, unsubscribed = false;
  const unsubscribe = () => { unsubscribed = true; };
  const f = { getSnapshot: () => ({ status: 'ready', writable: true, revision: 19, value: { allowSubagent: false } }),
    subscribe(fn) { subscribed = fn; return unsubscribe; }, mutate: async (...args) => { writes = args; return true; }, dispose() { disposed = true; } };
  const off = () => 'slot-removed';
  const ctx = { configForms: { get(id) { assert.equal(id, 'dsh-subagent-arg-guard'); return f; } },
    slots: { inject(name, fn) { assert.equal(name, 'settings.section'); return fn(); }, register(spec, component) { registration = spec; Page = component; return off; } } };
  assert.equal(c.entry.apply(ctx), off);
  assert.equal(registration.name, 'settings.section');
  assert.equal(registration.id, 'dsh-subagent-arg-guard');
  assert.equal(registration.label, '子代理工具与参数补救');
  assert.equal(JSON.stringify(c.entry.inject), JSON.stringify(['slots', 'configForms']));
  const adapter = Page().props;
  const listener = () => {};
  const unbind = c.stores[0].subscribe(listener);
  assert.equal(subscribed, listener); assert.equal(unbind, unsubscribe);
  unbind(); assert.equal(unsubscribed, true); assert.equal(disposed, false);
  assert.equal(adapter.form.state.value.allowSubagent, false);
  assert.equal(await adapter.form.mutate([{ op: 'set', path: ['allowSubagent'], value: true }], 19), true);
  assert.equal(JSON.stringify(writes), JSON.stringify([[{ op: 'set', path: ['allowSubagent'], value: true }], 19]));
  off(); assert.equal(disposed, false); // The provider, not this slot, owns the shared controller.
});
test('client has six concise switches and disables unavailable/read-only form', () => {
  const c = loadClient();
  assert.equal(c.render({ view: 'summary' }), '选模参数错误时恢复默认路径；自动识别 rc.1 / rc.2 / rc.3。');
  for (const props of [{ view: 'page' }, { view: 'page', form: { state: { status: 'ready', writable: false } } }, { view: 'page', form: { state: { status: 'unavailable', writable: true } } }]) {
    const inputs = nodes(c.render(props), n => n.type === 'input');
    assert.equal(inputs.length, 6); assert.equal(inputs.every(n => n.props.disabled), true);
  }
  const inputs = nodes(c.render({ view: 'page', form: form() }), n => n.type === 'input');
  assert.equal(inputs[4].props.checked, false);
});
test('client writes only changed boolean with host expected revision', async () => {
  const c = loadClient();
  let call;
  const f = form(async (...args) => { call = args; return true; });
  const tree = c.render({ view: 'page', form: f });
  await nodes(tree, n => n.type === 'input')[2].props.onChange({ target: { checked: false } });
  assert.equal(JSON.stringify(call), JSON.stringify([[{ op: 'set', path: ['enabled'], value: false }], 7]));
  const rendered = c.render({ view: 'page', form: f });
  const status = nodes(rendered, n => n.props.role === 'status').map(n => n.children.join('')).join('');
  assert.match(status, /已保存。后续调用会读取新设置，无需刷新或重启 DSH/);
  assert.equal(status.includes('等待宿主刷新'), false);
  // No optimistic mutation of the host snapshot.
  assert.equal(f.state.value.enabled, true);
});
for (const outcome of [false, undefined, 'throw']) test(`client never reports save success for ${outcome}`, async () => {
  const c = loadClient();
  const f = form(async () => { if (outcome === 'throw') throw Error('refused'); return outcome; });
  await nodes(c.render({ view: 'page', form: f }), n => n.type === 'input')[2].props.onChange({ target: { checked: false } });
  const text = nodes(c.render({ view: 'page', form: f }), n => n.props.role === 'status').map(n => n.children.join('')).join('');
  assert.equal(text.includes('已保存'), false);
  assert.match(text, /未保存|保存失败/);
  assert.match(text, /返回设置后重新进入本页/);
  assert.equal(text.includes('请刷新'), false);
});

test('client explains autosave and does not promise to change existing agents', () => {
  const c = loadClient();
  const paragraphs = nodes(c.render({ view: 'page', form: form() }), n => n.type === 'p').map(n => n.children.join('')).join('');
  assert.match(paragraphs, /勾选后自动保存，无需刷新或重启 DSH/);
  assert.match(paragraphs, /后续子代理工具调用会读取新设置/);
  assert.match(paragraphs, /不会重启或改变已创建的子代理/);
});

test('client new tool switches persist separate keys and explain execution scope', async () => {
  for (const [index, field] of [[0, 'allowSubagent'], [1, 'allowSubagentFork']]) {
    const c = loadClient(); let call;
    const f = form(async (...args) => { call = args; return true; });
    const tree = c.render({ view: 'page', form: f });
    await nodes(tree, n => n.type === 'input')[index].props.onChange({ target: { checked: false } });
    assert.equal(JSON.stringify(call), JSON.stringify([[{ op: 'set', path: [field], value: false }], 7]));
    const text = nodes(tree, n => n.type === 'p').map(n => n.children.join('')).join('');
    assert.match(text, /关闭工具开关后拒绝该工具的后续调用/);
    assert.match(text, /不会停止已开始的调用或已创建的子代理/);
    assert.match(text, /不限制其他插件直接创建子代理/);
  }
});

test('client section takes refreshed values from shared host snapshot', () => {
  const c = loadClient(); let Page;
  let current = { status: 'loading', writable: false };
  const controller = { getSnapshot: () => current, subscribe: () => () => {}, mutate: async () => false };
  c.entry.apply({ configForms: { get: () => controller }, slots: { inject: (_name, next) => next(), register: (_spec, component) => { Page = component; return () => {}; } } });
  assert.equal(Page().props.form.state, current);
  current = { status: 'ready', writable: true, revision: 2, value: { allowSubagentFork: false } };
  const tree = c.render(Page().props);
  const inputs = nodes(tree, n => n.type === 'input');
  assert.equal(inputs[1].props.checked, false); assert.equal(inputs[1].props.disabled, false);
});

test('client shows saving status until host accepts and then reflects host snapshot', async () => {
  const c = loadClient();
  let finish;
  const f = form(() => new Promise(resolve => { finish = resolve; }));
  const pending = nodes(c.render({ view: 'page', form: f }), n => n.type === 'input')[2].props.onChange({ target: { checked: false } });
  const saving = c.render({ view: 'page', form: f });
  assert.equal(nodes(saving, n => n.type === 'input').every(n => n.props.disabled), true);
  assert.match(nodes(saving, n => n.props.role === 'status').map(n => n.children.join('')).join(''), /正在保存/);
  assert.equal(f.state.value.enabled, true);
  f.state = { ...f.state, revision: 8, value: { ...f.state.value, enabled: false } };
  finish(true);
  await pending;
  const saved = c.render({ view: 'page', form: f });
  assert.equal(nodes(saved, n => n.type === 'input')[2].props.checked, false);
  assert.equal(nodes(saved, n => n.type === 'input').some(n => n.props.disabled), false);
  const status = nodes(saved, n => n.props.role === 'status').map(n => n.children.join('')).join('');
  assert.match(status, /已保存/);
  assert.equal(status.includes('正在保存'), false);
});
