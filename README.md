# dsh-subagent-arg-guard

独立、零运行依赖的 DSH 子代理参数补救插件。

当原生 `subagent` / `subagent_fork` 因特定的选模参数错误而失败时，删除 `provider`、`model`、`reasoning_effort` 后重试一次，让调用恢复原本的默认行为。无需安装默认模型插件，也不会接管模型池、修改合法显式选择或放宽权限。

**当前版本：0.1.0。仅审计并声明兼容 DSH 0.2.2-rc.1；Node.js >=22。**

## 文档与下载

- [完整中文说明](README.zh-CN.md)：精确补救范围、兼容限制、审计语义和安装说明。
- [测试与验证报告](TESTING.zh-CN.md)：65 项隔离测试，以及独立的真实进程冒烟验证；未验证项单独列出。
- [GitHub Releases](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases)：安装包与 SHA-256 校验文件。未发布 npm，不应直接按包名从 npm 安装。

从 Release 下载 `.tgz` 后，使用支持本地 bundle/tarball 的 DSH 插件管理入口安装。请核对 DSH 版本，不要绕过版本门禁。插件没有自动安装脚本，不需要修改 ASAR。

## 从源码验证

不需要安装依赖，也不需要联网或真实模型凭据：

```sh
node test/verify-fixtures.mjs
node --experimental-vm-modules test/guard.test.mjs
node --check lib/guard.js
node --check lib/index.js
```

## 许可

本插件采用 [MIT 许可证](LICENSE)。测试夹具不进入生产安装包，其公开来源与第三方许可证见 [夹具说明](test/fixtures/README.md)。
