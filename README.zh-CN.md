# dsh-subagent-arg-guard

独立的子代理参数补救插件。只在当前原生 `subagent` / `subagent_fork` 返回特定选模参数错误时，删除整个选模参数组并重试一次，恢复该调用原本的默认行为。

**源码版本：0.3.1；当前 profile 仍运行此前安装的 0.3.1-local.1 构建；GitHub Release 已同步为正式 0.3.1。新增 rc.3 精确版本分支及官方发行代码隔离测试：193 项测试、19 个第三方夹具 SHA-256 与 5 个生产文件语法检查通过。当前 DSH 0.2.2-rc.3 已完成一次最小真实 `subagent` 冒烟，返回 `RC3_LIVE_SMOKE_OK`；尚未完成完整实机矩阵。**

## 验证范围

本轮当前 DSH 已为 **0.2.2-rc.3**。已在真实宿主完成一次不使用工具、不改文件的最小 `subagent` 调用，返回 `RC3_LIVE_SMOKE_OK`，用于确认版本检测、插件入口和参数补救链路可启动；这不等于完整的 Native/PTC、fork、重启持久化或真实模型 API 矩阵。rc.1/rc.2/rc.3 的主要逻辑仍由精确版本分支选择，rc.3 复用已核对与 rc.2 字节一致的相关运行模块。


## 解决什么

模型把可选的 `provider` / `model` 填成空字符串、null、错误类型、只填一半，或显式填写不在当前 Session 允许列表里的路由，原生工具会在创建子代理之前报错。

本插件不选择任何 provider/model，也不自建模型池。它把失败调用中的 `provider`、`model`、`reasoning_effort` **一起删除**，保留任务、工作目录、描述、preset 等其他参数，让原生工具按“没有显式选模”的方式正常处理。

可选字段的正确省略方式是完全不提供；不是填空字符串、null 或虚构默认值。

## 无需默认模型插件

| 环境 | 补救后的行为 |
| --- | --- |
| 原版 DSH，没有其他子代理路由插件 | 走原生省略参数路径；通常继承父代理模型，原生已配置 agentOptions 时使用其默认值 |
| 安装并配置 dsh-subagent-default-model | 继续由它选择默认模型/模型池；本插件不读取或复制它的配置 |
| 默认模型插件不处理 fork（其通常默认行为） | fork 继续按原生规则继承，不强塞 spawn 的默认模型池 |
| 原调用合法显式指定模型 | 完全不修改、不重试，合法显式选择仍优先 |

不依赖 dsh-subagent-default-model；不需要 API Key，没有模型/网络请求或安装脚本。为原生设置 schema 新增轻量依赖 `@deepseek-ai/schemastery@3.18.4`；运行时版本来自宿主公开的 `@deepseek-ai/dsh-app-boot.getDshRuntimeVersion()`。宿主包与客户端 slots 声明为 optional peers，不要求安装另一份 DSH；版本 API 不可解析时明确停用补救，不猜版本。

## 双版本识别与设置

- rc.1：保留 `subagentId` 输出、无 presentationMeta 的原工具契约与该版本精确错误后缀。
- rc.2：适配 `name` 输出、presentationMeta、effort 必须与 provider/model 同时提供的新错误；保留用户的 name，后端请求仍由原生工具构造。
- rc.3：本轮针对官方 npm 0.2.2-rc.3 发行夹具单独测试；相关工具、参数校验、执行器和设置源逻辑与 rc.2 字节一致。它复用 rc.2 适配分支，不增加猜测性行为；当前 rc.3 宿主已完成一次最小真实冒烟，但尚未完成完整宿主矩阵。
- 运行时读取宿主版本，精确选择 rc.1、rc.2 或 rc.3 对应分支（rc.3 与 rc.2 共用经确认相同的核心合同）。其他版本或 API 缺失/异常时插件整体停用，不提供补救或工具禁用；契约不符时停止补救，不影响已注册的工具访问规则。没有用户可调的“强制版本”或版本豁免开关。

设置入口为 **「更多 → 设置 → 子代理工具与参数补救」**，不再注册原「插件 → 已安装」配置行的自定义页面。通过宿主 `settings.section` 与 `configForms` 使用固定 Config entry ID `dsh-subagent-arg-guard`；不扫描 namespace、不手写 profile、不建立第二份配置存储。升级沿用原四项值，新增两项缺省为 true。

六个短开关默认均开启：

- `allowSubagent`：允许调用 `subagent` 工具。
- `allowSubagentFork`：允许调用 `subagent_fork` 工具。
- `enabled`：启用参数补救，**不影响上述工具调用开关**。
- `repairDisallowedRoutes`：补救 Session 不允许的显式路由；关闭后空值/类型/半 pair 仍可补救。
- `repairForks`：补救 fork 参数；关闭不等于禁用 fork，也不改变 fork 默认模型。
- `logRepairs`：记录脱敏补救日志。

工具开关使用原生 `tools.guard` 在 prepare 阶段拒绝，并在 dispatch 入口复检；对 Native 和 PTC 内的这两个工具调用都有效。关闭时不更改工具定义，**可能仍显示在模型已收到的工具列表中，但新调用会明确报已禁用**。不取消已获准并开始执行的调用（包括仍在原生预检中等待的调用），不停止已有子代理；不拦截第三方插件通过 `subagent_role` 等其他工具或直接服务创建子代理。停用/卸载整个插件也会解除这层限制，不是全局子代理沙箱。

配置为原生 volatile：点击单项即带当前 revision 自动写入；宿主不可写时禁用控件，拒绝/异常不显示成功。宿主确认保存后，后续调用读取新设置，**不需要手动刷新或重启 DSH**。保存期间显示“正在保存”；失败提示重试或返回设置后重新进入本页。2026-11-13，用户已确认新设置页可见，并在页面关闭 `allowSubagentFork` 后验证真实 fork 调用被拒绝、普通 subagent 仍成功；尚未验证重启持久化或两个开关的完整实机矩阵。

## 精确补救范围

仅接受结构化的 `result.error.message`，不靠工具输出中的模糊字符串搜索：

- 当前原生工具的 `child LLM \`provider/model/reasoning_effort\` must be non-empty` 错误，并核对实际字段确为空字符串/空白字符串。
- 当前原生工具的 provider/model 必须成对提供错误，并核对实际确实缺一半。
- rc.2/rc.3 的 `reasoning_effort` 未同时配齐 provider/model 的精确错误，并核对确实缺字段。
- 当前原生工具的 Session 路由不允许错误，包括没有已记录选模策略时各版本的确切后缀；完整显式路由必须与错误中的路由一致。
- `ToolArgsError` / `INVALID_ARGS`，仅当真实 schema 违反项全部属于模型三字段，且移除三字段后其他参数完全合法。
- 当前官方工具禁用了显式选模、schema 隐藏模型字段，但调用仍额外提供模型字段时的确切拒绝。

这里只是恢复原来可以使用的默认路径，不添加允许路由，不提升权限，不把任意模型变成允许模型。

## 不补救

API 鉴权、额度、429、超时、网络错误、模型适配器不存在、任意预检失败、不支持的 reasoning effort、递归深度错误、任务/cwd/preset 等其他参数错误、执行策略拒绝、取消、未知错误以及已成功创建子代理后的输出/后处理错误，均不作为参数补救的触发器。

不会把“not allowed for this Session”当成“该模型客观不存在”。不会重写合法显式调用。不会给 `list_subagent_models`、团队工具、`subagent_role` 或其他第三方派发工具兜底。

原默认模型本身不可用时，返回真实失败；不伪造成功，也不再无限重试。

## 执行与审计语义

1. 首先执行原调用，保留合法显式选择和原生优先级。
2. 调用开始前捕获当前执行器、流水线和原工具定义；等待期间若被替换，不补救。
3. 仅对已识别的参数错误构造删除三字段后的参数，再次执行原生 prepare 和 dispatch。修正参数仍须通过 pre-execute、审批、guards、schema、取消和 PTC 的嵌套调用准入。
4. 使用新执行 token，保留 agent、toolSet、schema、parent、rootCallId、callId 和 signal；不调用旧版 `tools.execute(singleCall)`，也不嵌套提交新 batch。
5. 由原外层调度器完成唯一一次 post-execute、tools/result 和持久化记录。内层不 complete，避免重复观察事件或多组 durable call/result。

**审计差异必须明确：** retry 的 pre-execute/guard 看到真正执行的修正参数；外层 post-execute/tools/result 和原调用日志仍是“原请求参数 + 补救后结果”。这是同一个原调用被补救，不是偷偷改写原始历史。日志另记 attempt/settled、工具名、callId、原因及删掉的字段名；不记录 prompt、cwd、模型值、完整参数或凭据。

补救中的取消/拒绝/真实失败原样返回。若取消发生在原验证错误已经产生之后，本插件不重试并保留原错误；不承诺所有竞争情形最终都改写成 ABORTED。

## 兼容与信任边界

- `engines.dsh` 精确声明 `0.2.2-rc.1 || 0.2.2-rc.2 || 0.2.2-rc.3`；当前工作树的 rc.3 声明不代表已发布安装包支持 rc.3。未知版本不特意兼容，不建议绕过版本限制。Node >=22。
- 正常 profile resolver 将 app-boot peer import 路由到宿主；不要自行添加 dependency 或打包嵌套 app-boot 副本，否则该 API 可能返回副本版本而非宿主版本。本包没有这种依赖/捆绑。版本 API 不可用时不补救，而非扫描目录或猜版本。
- 使用当前执行器的 `pipeline.constructor` 构造隔离的 retry 状态，逐次透传原 pipeline 的 resolve/reject 判定；不修改原 pipeline.source。
- pipeline 的实例字段/阶段方法并不是承诺长期稳定的插件重派发 API。未知执行器、接口变化、schema 增加未审计约束时保守不补救，保留原错误。
- 当前官方参数是 flat string/enum schema。验证器只实现这一严格白名单子集；遇到 minLength、oneOf、新类型、route enum 等约束，整工具不自动修复。
- 执行器构造器名字和工具 schema 是兼容性探测，**不是防恶意同名插件的认证**。假设 profile 中的插件可信。
- 当前原生模型选择错误是没有阶段标签的 plain Error，因此需要精确消息匹配。在已审计的原生实现里，这些错误在创建子代理前抛出。但若第三方 startActivation 包装器已创建子代理后又抛出完全相同的原生选模错误文本，单凭工具结果无法辨别来源，不能对这种非标准同文错误承诺绝不重复创建。不要将此组件当成任意工具的通用重试器。
- 多个插件若同时修复相同错误，组合语义须另测；本包不会擅自接管其他插件。

## 测试

开发源码包包含 rc.1 宿主中未经修改的官方 tools/subagent/Native/PTC/流水线/schema-validator 夹具、官方 npm rc.2/rc.3 发行代码夹具，以及默认模型插件 2.2.0 的原始实现；附 SHA-256 与第三方许可证。rc.3 的六个选择模块经哈希核实与 rc.2 字节一致，但仍用独立 rc.3 夹具加载测试。

运行（不安装依赖、不联网）：

```sh
node --experimental-vm-modules test/all.test.mjs
node test/verify-fixtures.mjs
npm run check
```

也可以 `npm test`。VM 模块的 ExperimentalWarning 只涉及测试加载器，不是生产插件的要求。测试直接进程运行，不用 node --test 派生工作进程。

上述隔离测试使用真实官方工具、参数验证与执行流水线代码；隔离替身包括 Cordis 服务、外部 SDK、session 服务、LLM 预检与 startActivation 后端。**隔离测试本身没有调用真实模型 API、创建真实运行中的子代理、验证 GUI 安装或验证真实账户额度。**

历史上旧版 **0.1.0** 在 Windows DSH 0.2.2-rc.1 中做过独立真实冒烟：安装/启用后空三字段成功创建子代理并返回 `ARG_GUARD_SMOKE_OK`，同时启用了默认模型插件 2.2.0。**该旧版证据不能代替 0.2.0、rc.2 或 rc.3 的宿主验收。** 另于 2026-11-12 安装 local.1 后，空三字段真实调用返回 `ARG_GUARD_LOCAL_020_SMOKE_OK`，用户确认设置页显示且点击后返回保存成功；完整重启持久化与设置生效矩阵尚未完成。local.2 修正后的保存提示也已在 rc.1 确认显示；0.2.0 只更新版本号与发布文档，不改运行逻辑。

本轮 **0.3.0-local.1** 在 rc.1 安装后，空模型三字段真实调用返回 `ARG_GUARD_030_SMOKE_OK`；用户确认新的通用设置页显示，并在页面关闭 fork 后得到明确的创建前拒绝。同时普通 subagent 对照调用返回 `SUBAGENT_STILL_ENABLED_OK`，其调用使用空模型三字段并经补救成功，说明 fork 禁用没有影响普通工具或其参数补救。本次没有打开用户关闭的开关，不据此宣称重启持久化、关闭普通工具或完整 Native/PTC 实机矩阵已经通过。0.3.0 与该开发包的生产代码一致。详见 [真实调用记录与未验证项](TESTING.zh-CN.md#实机证据与边界)。

覆盖原版省略继承、合法显式模型、原生默认选项、实际默认模型池轮转、fork 默认与 opt-in、Native/PTC 准入、取消竞争、策略拒绝、await 中替换定义/执行器、一次补救上限、单次日志/后处理和误匹配防护。详见 [测试报告](TESTING.zh-CN.md)。

## 交付与安装

公共正式版本 **0.3.1** 与当前 profile 中此前安装的 **0.3.1-local.1** 构建对应同一套 rc.3 适配代码：本地新增 rc.3 精确版本识别、独立官方发行夹具与离线测试；本地包已安装到 DSH 0.2.2-rc.3，并完成一次 `RC3_LIVE_SMOKE_OK` 最小真实调用。GitHub Release 已提供正式 0.3.1；下方固定安装直链将指向新资产。

### 快速从 GitHub 安装

本插件不需要先发布到 npm 或进入插件市场。推荐使用固定版本 Release 的 `.tgz` 下载直链：

```text
https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/dsh-subagent-arg-guard-0.3.1.tgz
```

在 DSH 对话中，请模型先用 `plugin_manager` 的 `list_bundles` 检查，再以此 URL 为 `target` 执行 `install_bundle`（`enabled: true`），最后复查版本、安装/启用状态及是否需要重启。版本不匹配时停止，不授予版本豁免；不要从 npm 按同名包安装。

也可以先完全退出使用该 profile 的 DSH，再通过 CLI 安装，然后重新打开并核对启用状态（以下 `desktop` 应替换为你实际使用的 profile）：

```sh
dsh plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/dsh-subagent-arg-guard-0.3.1.tgz"
```

[首页的已发布版本安装步骤](README.md) 包含可直接粘贴给模型的安装请求、Windows 未加入 PATH 时的启动器写法、浏览器下载与校验、本地绝对路径安装和关闭/卸载方式。“仅 GitHub”指本插件的来源；安装器处理现有 profile 的其他依赖时仍可能访问其 registry。

### 发布与验证边界

源码与版本发布位于 [GitHub 项目](https://github.com/NekogamiJam/dsh-subagent-arg-guard)。[GitHub Releases](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases) 提供标准 npm `.tgz` 安装包及 SHA-256 校验文件；GitHub 的源码归档包含完整测试与第三方许可证。

安装包含 ESM 入口、`dsh.bundle.patch`、发布元信息与文档，不包含测试夹具、npm 缓存或运行日志。**本项目未发布 npm**，不能直接按 npm 包名从公共 npm 仓库安装。

请从 Release 下载 `.tgz`，核对校验值及精确支持的 DSH 版本后，使用支持本地 bundle/tarball 的 DSH 插件管理入口安装。当前公开 GitHub v0.3.1 manifest 支持 rc.1/rc.2/rc.3；rc.3 目前有一次最小真实冒烟，但未完成完整实机矩阵。不能把最小冒烟外推为完整兼容性承诺。不要绕过版本门禁，也不要为了试装直接手改 profile 的依赖与 patch。

插件没有自动安装脚本，不要求修改 ASAR；真实卸载、其他宿主和完整原版无默认模型插件环境的真实进程验收仍未完成，详见 [测试报告](TESTING.zh-CN.md)。

## 许可

本插件 MIT。测试夹具的权利和许可证见 [夹具许可与来源](test/fixtures/README.md)；生产发布包不包含这些第三方源码。
