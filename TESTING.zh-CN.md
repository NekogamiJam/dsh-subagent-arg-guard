# 测试报告：dsh-subagent-arg-guard 0.3.0

日期：2026-11-13。0.3.0 的 5 个生产文件与已安装的 0.3.0-local.1 一致，只更新正式版本号与发布文档；宿主保持 DSH 0.2.2-rc.1。本轮迁移设置入口并新增两个工具调用开关，已获得下述有限实机证据。

## 结果与层级

**163 项离线隔离测试通过，0 失败、0 跳过；13 个第三方源码夹具 SHA-256 校验通过；5 个生产文件语法检查通过。** 总入口 [all.test.mjs](test/all.test.mjs)。

- rc.1：保留原有 65 项覆盖，使用真实官方工具、schema validator、流水线、Native/PTC，以及默认模型插件 2.2.0 的原始实现。
- rc.2：使用官方 npm 0.2.2-rc.2 的真实编译发行代码；先验证 registry SHA-512，再复制六个未经修改的夹具。覆盖新增 name/presentationMeta、effort 成对约束、版本专用错误后缀与执行器变化。
- 宿主版本/设置：覆盖精确版本判定、未知/空/伪造格式/检测异常停用、两版本实际入口、六个 default-on volatile 开关及运行中启停。旧四字段配置不丢失，新字段缺省允许调用。
- 工具禁用：两版本 × 两工具覆盖合法/坏参数均禁用、两个开关独立、参数补救关闭仍禁用、prepare 后关闭、retry 前关闭、坏 getter、真实 PTC bindings 调用拒绝。先挂起已进入 startActivation 的调用，再禁用并拒绝新调用，释放旧调用后仍成功；不取消 caller signal。
- 客户端：在轻量 React/slots/ConfigForms 替身中执行原始 client.js，验证只注册 `settings.section`、只获取精确 entry ID、订阅与取消订阅函数转发、不 dispose 共享 form、六项设置、缺失 namespace/禁写状态、带 revision 的单字段写入、拒绝/异常不假报成功和异步保存提示。手动快照更新与订阅转发单测不是完整 React 生命周期或真实 GUI 验收。

另有一次**真实 rc.1 宿主包只读探针**：使用当前安装宿主的 Electron-as-Node，加载真实 `getDshRuntimeVersion` 与 Schemastery，确认版本返回 rc.1、Config 被宿主 `isNativeConfigSchema` 接受、六项默认值均为 true（真实 volatile `.get()` 包装器），并注册工具 hook/guard。探针未创建 profile、写配置、安装插件、启动子代理或调用模型。

## 隔离边界

服务替身包括 Cordis 事件/注入环境、外部 SDK、session/registry/guards、LLM resolveCallConfig、startActivation 后端与 PTC 求值运行时。后台只记录请求、返回模拟身份；真实 rc.2 工具负责构造扁平请求，rc.1 工具负责构造嵌套 request。

真实 rc.2 PTC 测试执行官方 `run_code` 工具及实际 bindings 调度/prepare/dispatch/complete；仅求值运行时用替身触发 bindings。限制为 1 次子调用：第一次坏字段调用补救成功，第二次 binding 因超限拒绝，只有一个子代理启动与一组嵌套持久化事件。它不是完整沙箱 JavaScript 引擎或真实模型 API 验收。

默认模型插件 2.2.0 联动只验证 **rc.1** 的默认选路、round-robin、fork 默认/opt-in 和显式优先；关闭了它的 API failover 与上下文注入。不宣称该第三方插件兼容 rc.2。

## 主要安全覆盖

| 主题 | 已验证内容 |
| --- | --- |
| 省略语义 | 删除模型三字段，原版继承、原生默认值及已有默认插件继续按各自原规则处理 |
| rc.2 身份 | 保留 name，校验 name 输出与 presentationMeta；不手动创建后端请求 |
| 合法显式 | 不改有效 provider/model/effort，不补救本来省略的调用 |
| 精确触发 | 空/null/错误类型/半 pair/rc.2 effort-only/原生路由拒绝；混合 prompt/cwd/name 错误不补救 |
| 拒绝误匹配 | content 同文、typed API 同文、未知错误、超时/鉴权/适配器/输出错误不重试 |
| 策略与取消 | 修正参数重过 pre/guard/schema，保留 parent/signal/toolSet；结构化 guard denial 不吞掉 |
| PTC | 直接调用仍拒绝；保留嵌套准入；一次补救不变成第二个 binding，也不绕开后续配额 |
| 热替换 | retry pre/dispatch await 后替换工具/执行器/pipeline 时保守停止 |
| 一次性/审计 | reinjection 不递归补救；唯一一次 outer complete/post/result/持久化；保留 deferred contexts |
| 版本门禁 | manifest 只列 rc.1/rc.2，运行时精确检测，不靠 schema 猜版本；未知/检测失败不注册补救 |
| 工具访问 | prepare 的原生 guard 与 dispatch 入口复检；补救关闭不放开工具；已开始调用不被取消；不隐藏 schema 或拦截其他服务入口 |
| 设置健壮性 | 原生 volatile getter、动态启停；补救 getter 抛错停用补救，工具许可 getter 抛错拒绝创建；设置拒绝不报成功 |

## 复现

不安装依赖、不联网、不需要模型凭据：

```sh
node test/verify-fixtures.mjs
node --experimental-vm-modules test/all.test.mjs
npm run check
```

`npm test` 同样运行完整 all 入口。VM ExperimentalWarning 仅属于测试。测试不需要 `node --test` 派生工作进程。

可选只读宿主探针 [check-host-readonly.mjs](test/check-host-readonly.mjs) 需要宿主 Electron-as-Node、`--experimental-vm-modules` 和该宿主的 `dsh/package.json` 绝对路径参数；不把个人安装目录写进项目。

夹具哈希：[rc.1](test/fixtures/sha256.json)、[rc.2](test/fixtures/rc2/sha256.json)；许可与来源：[夹具说明](test/fixtures/README.md)。

## 实机证据与边界

2026-11-08，**旧版 0.1.0** 在 Windows DSH 0.2.2-rc.1 中，经授权安装/启用，空字符串三字段调用成功创建真实子代理并返回 `ARG_GUARD_SMOKE_OK`；环境启用了 dsh-subagent-default-model 2.2.0。

2026-11-12，经授权安装 **0.2.0-local.1** 后，空三字段真实子代理调用返回 `ARG_GUARD_LOCAL_020_SMOKE_OK`。用户确认设置页显示且点击后返回保存成功。local.2 仅修正保存提示，不改补救逻辑；安装后已确认新版提示正确显示。0.2.0 不再修改运行逻辑。旧版和 rc.1 的证据均不能作为 rc.2 实机验收。

2026-11-13，经授权在同一 Windows rc.1 环境安装 **0.3.0-local.1**，安装管理器返回 applied/installed/enabled，5 个生产文件与源码相同，原有配置保留。故意传入空字符串模型三字段，真实 subagent 成功返回 `ARG_GUARD_030_SMOKE_OK`。用户确认「更多 → 设置」中的新设置页可见。

随后用户在页面关闭 `allowSubagentFork`，配置保留为 false。使用正常任务、工作目录和描述（无模型字段）发起真实 `subagent_fork`，返回：

```text
Error: subagent_fork is disabled in Subagent Arg Guard settings; no subagent was created by this call
```

拒绝发生在已审计的原生 tools.guard/dispatch 创建前路径，工具未返回子代理 ID。独立的普通 subagent 对照调用仍成功并返回 `SUBAGENT_STILL_ENABLED_OK`（该对照同时传入空模型三字段，沿用原参数补救）。测试没有重新打开 fork 开关。此证据只覆盖用户从页面关闭 fork 的保存与即时生效，不代替完整开关/重启持久化矩阵。正式版 0.3.0 只调整版本和文档，未重新替换本机开发包。

## 尚未验证

- 重启后设置持久化、关闭 `allowSubagent` 的实机行为、重新打开 fork 后的实机调用、两个工具开关的完整 Native/PTC 真实 API 矩阵及新版卸载；均不能由上述单次关闭 fork 的证据推出。
- rc.2 的完整宿主启动、真实模型 API/真实子代理与第三方路由插件组合；不计划升级本机或进行 rc.2 实机适配/验收。
- 新版本全部错误路径、fork、取消竞争的真实 API 全矩阵；上述已有离线隔离覆盖。
- Windows 以外宿主、其他 DSH 版本/执行器/未知同类修复插件组合。
- 第三方在子代理已创建后抛出与原生前置参数错误完全相同的 plain Error；结果缺阶段来源，仍保留原有信任边界。

后续仍只在 rc.1 验证尚未覆盖的持久化和实际生效行为；不安排 rc.2 实机验证。
