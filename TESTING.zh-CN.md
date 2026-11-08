# 测试报告：dsh-subagent-arg-guard 0.1.0

日期：2026-11-08。被审计版本：DSH 0.2.2-rc.1；默认模型插件联动版本：dsh-subagent-default-model 2.2.0。

## 结果

**65 项测试全部通过，0 失败、0 跳过。** 测试源码见 [guard.test.mjs](test/guard.test.mjs)，加载器见 [core-loader.mjs](test/core-loader.mjs)。

## 使用的真实代码与隔离边界

真实、未经修改的发行代码：官方 subagent 工具的 apply/execute、defineTool/schema validator、ToolExecutionPipeline、NativeToolExecutor、PtcExecutor 的实际 source/reject，以及默认模型插件 2.2.0 的 apply/服务包装器。

服务替身：Cordis 事件/注入环境、外部 schema-builder SDK、session/registry/guards、LLM resolveCallConfig、子代理后端 startActivation。startActivation 只记录调用并返回模拟 childId；没有真实创建会话、发模型请求或消耗额度。官方完整 Native batch 的持久化只使用内存 session.append。

默认模型插件的失败切换与路由上下文注入在这组联动测试中关闭；验证的是默认选路、显式优先、round-robin 与 fork 策略，不是它的 API failover 功能。部分早期用例仍保留忠实接口替身作为独立单元回归，另有实际插件实现的联动用例。

## 覆盖矩阵

| 主题 | 已验证内容 |
| --- | --- |
| 原版环境 | 空 pair/单字段、null、非字符串、半 pair、空 effort、越权路由均删除三字段；送达后端的 request 不含 agentOptions，保留原生继承语义 |
| 不应改变的路径 | 合法显式 provider/model/effort 不变；本来省略的调用不变；父代理 options 不变；原生配置 defaults 优先 |
| 默认模型插件联动 | 真实 2.2.0 插件可接手补救后的请求；池按原 round-robin；fork 默认跳过，opt-in 后用池；合法显式和原生 defaults 不被覆盖 |
| 严格错误范围 | 非模型参数错误、未知参数、API/预检/adapter/timeout、输出错误不修复；不能靠 content 文本伪装触发；带请求类 error.info 的同文错误不修复 |
| 策略与取消 | 修正参数重新经过 pre-execute/guard，拒绝可生效；取消发生在修正 pre-execute await、开始前、子代理启动后以及 signal 被 listener 替换时，均不再次创建 |
| PTC | 实际 PtcExecutor source：直接调用依旧拒绝；嵌套调用保留 parent/rootCallId/toolSet/schema；parent 被删不能执行 |
| 热替换 | 在 retry pre/dispatch 的 await 后替换工具定义、执行器、pipeline，均不执行替换后的 body |
| 一次性 | 新 inner exec 同样标记；其他 listener 再塞回坏字段仍不递归修复；不同会话相同 callId 不互相干扰 |
| 日志/后处理 | 每个原调用只一次 post/result；完整 Native batch 只一组 durable call/result；保留 deferred context；日志异常不影响结果 |
| 保守兼容 | 入口无外部 imports，可在原版替身环境装载；未知 executor/schema/constraints fail closed；本地受限 validator 的相关诊断与真实 core 一致 |

## 复现

从源码根目录运行：

```sh
node test/verify-fixtures.mjs
node --experimental-vm-modules test/guard.test.mjs
node --check lib/guard.js
node --check lib/index.js
```

夹具哈希见 [sha256.json](test/fixtures/sha256.json)，许可与来源见 [夹具说明](test/fixtures/README.md)。

## 独立的真实进程冒烟

2026-11-08，在 Windows 上的真实 DSH 0.2.2-rc.1 进程中，经授权通过本地 bundle/tarball 管理入口安装并启用 0.1.0。该环境同时启用了 dsh-subagent-default-model 2.2.0。

向原生 `subagent` 显式传入空字符串的 `provider`、`model`、`reasoning_effort`，调用成功创建真实子代理，并收到 `ARG_GUARD_SMOKE_OK`。这是独立于上述隔离测试的真实模型 API/子代理执行证据，不是隔离测试后端改成了真实服务。

这一次冒烟仅覆盖本地包安装/启用和空三字段调用路径，不能代表所有错误类型、所有执行器/UI 入口或原版无默认模型插件环境已完成真实进程验收。公开报告不包含账户目录、真实模型池配置或凭据。

## 未验证，不能冒充已验证

- 真实卸载的实际执行、所有 UI 导入入口，以及原版无默认模型插件环境的完整真实进程验收。
- 所有错误路径、fork、合法显式调用及取消竞争的完整真实 API 回归；这些已有上述隔离覆盖，但没有相应的全面真实进程验收。
- Windows 以外宿主、其他 DSH 版本、第三方执行器、其他参数修复插件组合。
- 第三方在 child 已经创建后抛出与原生前置参数错误完全相同的 plain Error。这种错误结果无来源标签，无法仅靠精确文本证明阶段；详见 [兼容与信任边界](README.zh-CN.md#兼容与信任边界)。

后续扩展真实验收应在独立测试环境进行：分别验证无默认模型插件的继承、安装默认插件后的池行为、合法显式调用不变，以及错误 prompt/取消不被吞掉；不应把现有的一次冒烟扩大表述为全面验收。
