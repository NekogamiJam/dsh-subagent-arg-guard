// Plain host module-loader entry: no bundler, runtime eval or external network.
window.__ModuleLoader__.load({
  id: 'dsh-subagent-arg-guard',
  factory: function(require) {
    var React = require('react');
    var fields = [
      ['allowSubagent', '允许调用 subagent 工具'],
      ['allowSubagentFork', '允许调用 subagent_fork 工具'],
      ['enabled', '启用参数补救（不影响上面的工具开关）'],
      ['repairDisallowedRoutes', '显式路由被 Session 拒绝时，改走原默认路径'],
      ['repairForks', '同时补救 subagent_fork（不改变 fork 默认模型规则）'],
      ['logRepairs', '记录补救原因及字段名（不记录任务或模型值）']
    ];
    function Settings(props) {
      var busy = React.useState(false);
      var message = React.useState('');
      if (props.view === 'summary') return '选模参数错误时恢复默认路径；自动识别 rc.1 / rc.2。';
      var form = props.form;
      var state = form && form.state;
      var ready = !!(state && state.status === 'ready' && state.writable === true && typeof form.mutate === 'function');
      var value = (state && state.value) || {};
      async function set(field, checked) {
        if (!ready || busy[0]) return;
        busy[1](true); message[1]('');
        try {
          // One field / one transaction, fenced by the displayed host revision.
          // No guessed namespace, direct profile write, or optimistic success.
          var accepted = await form.mutate([{ op: 'set', path: [field], value: checked }], state.revision);
          message[1](accepted === true ? '已保存。后续调用会读取新设置，无需刷新或重启 DSH。' : '未保存：设置已变化或写入被拒绝，请重试；若仍失败，请返回设置后重新进入本页。');
        } catch (_error) {
          message[1]('保存失败，本次更改未确认保存。请重试；若仍失败，请返回设置后重新进入本页。');
        } finally { busy[1](false); }
      }
      return React.createElement('section', { 'aria-label': '子代理参数补救设置', style: { display: 'grid', gap: 10 } },
        React.createElement('p', null, '自动识别 DSH 0.2.2-rc.1 / rc.2；未知版本或检测失败时不补救。每次最多补救一次，不绕过权限。'),
        React.createElement('p', null, '勾选后自动保存，无需刷新或重启 DSH。保存成功后，后续子代理工具调用会读取新设置；不会重启或改变已创建的子代理。'),
        React.createElement('p', null, '关闭工具开关后拒绝该工具的后续调用；工具可能仍出现在已发送的列表中。不会停止已开始的调用或已创建的子代理，也不限制其他插件直接创建子代理。'),
        fields.map(function(field) {
          return React.createElement('label', { key: field[0], style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('input', { type: 'checkbox', checked: value[field[0]] !== false, disabled: !ready || busy[0],
              onChange: function(event) { return set(field[0], event.target.checked); } }), field[1]);
        }),
        !ready ? React.createElement('p', { role: 'status' }, '设置尚不可写。请确认插件已启用；若长时间不可用，请返回设置后重新进入本页。') : null,
        busy[0] ? React.createElement('p', { role: 'status', 'aria-live': 'polite' }, '正在保存…') : null,
        message[0] ? React.createElement('p', { role: 'status', 'aria-live': 'polite' }, message[0]) : null);
    }
    return {
      inject: ['slots', 'configForms'],
      apply: function(ctx) {
        // The bundle owns exactly this Config entry ID. Never scan namespaces,
        // guess another row, or dispose the shared host form controller.
        var form = ctx.configForms.get('dsh-subagent-arg-guard');
        var subscribe = function(fn) { return form.subscribe(fn); };
        var snapshot = function() { return form.getSnapshot(); };
        function Page() {
          var state = React.useSyncExternalStore(subscribe, snapshot, snapshot);
          return React.createElement(Settings, { view: 'page', form: {
            state: state,
            mutate: function(ops, revision) { return form.mutate(ops, revision); }
          } });
        }
        return ctx.slots.inject('settings.section', function() {
          return ctx.slots.register({ name: 'settings.section', id: 'dsh-subagent-arg-guard', order: 30, label: '子代理工具与参数补救' }, Page);
        });
      },
      // Test seam; the host reads only apply/inject.
      Settings: Settings
    };
  }
});
