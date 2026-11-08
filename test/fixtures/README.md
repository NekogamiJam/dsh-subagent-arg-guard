# 测试夹具来源与许可

这些文件仅用于离线隔离集成测试，不进入生产 npm tarball；不是本插件运行依赖。

## DSH 0.2.2-rc.1

以下源码从本次运行安装的官方 DSH app.asar 中逐字节复制，未修改：

| 本地夹具 | 发行包中的路径 |
| --- | --- |
| [tools.js](tools.js) | @deepseek-ai/dsh-tools/lib/index.js |
| [pipeline.js](pipeline.js) | @deepseek-ai/dsh-tools/lib/pipeline.js |
| [shared-DTdn5dXO.js](shared-DTdn5dXO.js) | @deepseek-ai/dsh-tools/lib/shared-DTdn5dXO.js |
| [subagent.js](subagent.js) | @deepseek-ai/dsh-tool-subagent/lib/index.js |
| [native.js](native.js) | @deepseek-ai/dsh-tool-executor-native/lib/index.js |
| [ptc.js](ptc.js) | @deepseek-ai/dsh-tool-executor-ptc/lib/index.js |

Copyright (c) 2026 DeepSeek。MIT 许可原文见 [LICENSE.DSH](LICENSE.DSH)，从同一 ASAR 的 dsh-tool-subagent/LICENSE 提取。

## dsh-subagent-default-model 2.2.0

[default-model.js](default-model.js) 从已安装插件的 lib/index.js 逐字节复制，未修改。项目：https://github.com/dingminhua/dsh-subagent-default-model 。

Copyright (c) 2026 LaoDing。MIT 许可原文见 [LICENSE.default-model](LICENSE.default-model)。

## 完整性

[sha256.json](sha256.json) 记录所有源码夹具的原始 SHA-256。从项目根目录运行 `node test/verify-fixtures.mjs` 验证。

测试加载器在 VM 模块的外部依赖连接处提供隔离服务替身；不会改写夹具源码。夹具来源、版本及许可证不构成对完整真实进程或其他版本兼容性的保证。
