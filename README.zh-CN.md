# dsh-subagent-arg-guard

独立、零运行依赖的子代理参数补救插件。只在当前原生 `subagent` / `subagent_fork` 返回特定选模参数错误时，删除整个选模参数组并重试一次，恢复该调用原本的默认行为。

**版本：0.1.0。当前验证范围：DSH 0.2.2-rc.1，Native / PTC 执行器。已通过 65 项隔离测试，并在 Windows 真实 DSH 进程中完成本地包安装/启用及一次空选模字段冒烟；完整真实环境回归范围见测试报告。**

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

没有运行时依赖、peer dependency、API Key、联网请求或安装脚本，也不依赖 dsh-subagent-default-model。

## 精确补救范围

仅接受结构化的 `result.error.message`，不靠工具输出中的模糊字符串搜索：

- 当前原生工具的 `child LLM \`provider/model/reasoning_effort\` must be non-empty` 错误，并核对实际字段确为空字符串/空白字符串。
- 当前原生工具的 provider/model 必须成对提供错误，并核对实际确实缺一半。
- 当前原生工具的 Session 路由不允许错误，包括没有已记录选模策略时的确切后缀；完整显式路由必须与错误中的路由一致。
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

- `engines.dsh` 精确声明 `0.2.2-rc.1`；升级后应重新审计并运行测试，不建议绕过版本限制安装。Node >=22。
- 使用当前执行器的 `pipeline.constructor` 构造隔离的 retry 状态，逐次透传原 pipeline 的 resolve/reject 判定；不修改原 pipeline.source。
- pipeline 的实例字段/阶段方法并不是承诺长期稳定的插件重派发 API。未知执行器、接口变化、schema 增加未审计约束时保守不补救，保留原错误。
- 当前官方参数是 flat string/enum schema。验证器只实现这一严格白名单子集；遇到 minLength、oneOf、新类型、route enum 等约束，整工具不自动修复。
- 执行器构造器名字和工具 schema 是兼容性探测，**不是防恶意同名插件的认证**。假设 profile 中的插件可信。
- 当前原生模型选择错误是没有阶段标签的 plain Error，因此需要精确消息匹配。在已审计的原生实现里，这些错误在创建子代理前抛出。但若第三方 startActivation 包装器已创建子代理后又抛出完全相同的原生选模错误文本，单凭工具结果无法辨别来源，不能对这种非标准同文错误承诺绝不重复创建。不要将此组件当成任意工具的通用重试器。
- 多个插件若同时修复相同错误，组合语义须另测；本包不会擅自接管其他插件。

## 测试

开发源码包包含安装版本中未经修改的官方工具/Native/PTC/流水线/schema-validator 夹具，以及默认模型插件 2.2.0 的原始实现；附 SHA-256 与第三方许可证。

运行（不安装依赖、不联网）：

```sh
node --experimental-vm-modules test/guard.test.mjs
node test/verify-fixtures.mjs
node --check lib/guard.js
node --check lib/index.js
```

也可以 `npm test`。VM 模块的 ExperimentalWarning 只涉及测试加载器，不是生产插件的要求。测试直接进程运行，不用 node --test 派生工作进程。

上述隔离测试使用真实官方工具、参数验证与执行流水线代码；隔离替身包括 Cordis 服务、外部 SDK、session 服务、LLM 预检与 startActivation 后端。**隔离测试本身没有调用真实模型 API、创建真实运行中的子代理、验证 GUI 安装或验证真实账户额度。**

另一次独立的真实进程冒烟已在 Windows DSH 0.2.2-rc.1 中完成：本地包安装/启用后，原生 `subagent` 的三个选模字段均为空字符串时仍成功创建子代理，并返回 `ARG_GUARD_SMOKE_OK`。该环境同时启用了 dsh-subagent-default-model 2.2.0；它不是所有环境或全部错误路径的全面验收。

覆盖原版省略继承、合法显式模型、原生默认选项、实际默认模型池轮转、fork 默认与 opt-in、Native/PTC 准入、取消竞争、策略拒绝、await 中替换定义/执行器、一次补救上限、单次日志/后处理和误匹配防护。详见 [测试报告](TESTING.zh-CN.md)。

## 交付与安装

### 快速从 GitHub 安装

本插件不需要先发布到 npm 或进入插件市场。推荐使用固定版本 Release 的 `.tgz` 下载直链：

```text
https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/dsh-subagent-arg-guard-0.1.0.tgz
```

在 DSH 对话中，请模型先用 `plugin_manager` 的 `list_bundles` 检查，再以此 URL 为 `target` 执行 `install_bundle`（`enabled: true`），最后复查版本、安装/启用状态及是否需要重启。版本不匹配时停止，不授予版本豁免；不要从 npm 按同名包安装。

也可以先完全退出使用该 profile 的 DSH，再通过 CLI 安装，然后重新打开并核对启用状态（以下 `desktop` 应替换为你实际使用的 profile）：

```sh
dsh plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/dsh-subagent-arg-guard-0.1.0.tgz"
```

[首页的完整快速安装步骤](README.md#快速安装) 包含可直接粘贴给模型的安装请求、Windows 未加入 PATH 时的启动器写法、浏览器下载与校验、本地绝对路径安装和关闭/卸载方式。“仅 GitHub”指本插件的来源；安装器处理现有 profile 的其他依赖时仍可能访问其 registry。

### 发布与验证边界

源码与版本发布位于 [GitHub 项目](https://github.com/NekogamiJam/dsh-subagent-arg-guard)。[GitHub Releases](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases) 提供标准 npm `.tgz` 安装包及 SHA-256 校验文件；GitHub 的源码归档包含完整测试与第三方许可证。

安装包含 ESM 入口、`dsh.bundle.patch`、发布元信息与文档，不包含测试夹具、npm 缓存或运行日志。**本项目未发布 npm**，不能直接按 npm 包名从公共 npm 仓库安装。

请从 Release 下载 `.tgz`，核对校验值及精确支持的 DSH 版本后，使用支持本地 bundle/tarball 的 DSH 插件管理入口安装。当前 Windows DSH 0.2.2-rc.1 的本地包安装/启用路径已有真实冒烟证据；不据此承诺每个 UI 或安装入口都支持相同路径。不要绕过版本门禁，也不要为了试装直接手改 profile 的依赖与 patch。

插件没有自动安装脚本，不要求修改 ASAR；真实卸载、其他宿主和完整原版无默认模型插件环境的真实进程验收仍未完成，详见 [测试报告](TESTING.zh-CN.md)。

## 许可

本插件 MIT。测试夹具的权利和许可证见 [夹具许可与来源](test/fixtures/README.md)；生产发布包不包含这些第三方源码。
