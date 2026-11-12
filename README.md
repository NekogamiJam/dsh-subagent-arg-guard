# dsh-subagent-arg-guard

独立的 DSH 子代理参数补救插件。

当原生 `subagent` / `subagent_fork` 因特定的选模参数错误而失败时，删除 `provider`、`model`、`reasoning_effort` 后重试一次，让调用恢复原本的默认行为。无需安装默认模型插件，也不会接管模型池、修改合法显式选择或放宽权限。

**版本：0.2.0。包含 DSH 0.2.2-rc.1 / rc.2 的对应逻辑；Node.js >=22。127 项隔离测试通过，13 个第三方夹具哈希校验通过。rc.1 开发包已完成本地安装、空选模参数真实冒烟，以及设置页显示/保存提示确认；rc.2 仅有离线覆盖。**

### 验证范围

我会继续使用 **DSH 0.2.2-rc.1**，**不会为 0.2.2-rc.2 升级本机，也不会对 rc.2 进行实机适配或验收**。现有 rc.2 分支及隔离回归测试保留，但仅代表基于官方发行代码的离线适配，**不承诺 rc.2 的实机可用性**；版本声明不等同于实机验证。

运行时使用宿主公开版本 API 精确分支，未知版本/检测失败时停用补救；原生 Config 与「插件 → 已安装 → 本插件配置行」提供四项短开关。勾选后自动保存，成功后后续调用读取新设置，无需刷新或重启 DSH。设置 schema 使用 Schemastery 轻量依赖，宿主 app-boot 与客户端 slots 只声明 optional peers，不打包另一份 DSH。详见 [双版本识别与设置](README.zh-CN.md#双版本识别与设置)。

## 文档与下载

- [完整中文说明](README.zh-CN.md)：精确补救范围、兼容限制、审计语义和安装说明。
- [测试与验证报告](TESTING.zh-CN.md)：127 项双版本隔离测试、真实 rc.1 原生 Config/版本只读探针与明确的未验证项；另保留旧版真实冒烟历史。
- [GitHub Releases](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases)：安装包与 SHA-256 校验文件。未发布 npm，不应直接按包名从 npm 安装。

## 版本与依赖

0.2.0 的运行逻辑与已验收的 0.2.0-local.2 相同，仅更新正式版本号与发布文档。完整重启持久化和全部设置生效矩阵仍未完成，不安排 rc.2 实机验证。宿主必须提供 app-boot peer，不能自行安装嵌套 app-boot 副本替代运行中宿主；正常 DSH profile resolver 会路由到宿主包。

## 快速安装

**本插件仅通过 GitHub 发布，未发布 npm，也不要求先进入 DSH 插件市场。** 推荐安装固定版本的 Release `.tgz`，无需先 clone 仓库或安装 `gh`。

- 推荐使用：**DSH 0.2.2-rc.1**，Node.js >=22。manifest 另列 rc.2，但仅离线覆盖、无实机可用性承诺；其他 DSH 版本不要安装，不授予版本豁免。
- [v0.2.0 安装包直链](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.2.0/dsh-subagent-arg-guard-0.2.0.tgz)
- [同版本 SHA-256 校验文件](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.2.0/SHA256SUMS.txt)

### 方法一：在 DSH 对话中让模型安装（推荐）

把下面这段话复制到**你要使用插件的 DSH profile 中的会话**：

```text
请使用 DSH 的 plugin_manager 工具安装并启用 dsh-subagent-arg-guard。
先 list_bundles 检查当前安装状态，再通过 install_bundle 安装：
target: https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.2.0/dsh-subagent-arg-guard-0.2.0.tgz
enabled: true

请先核对 DSH 版本：rc.1 已有本地实机证据；rc.2 仅离线覆盖，安装前明确提示实机未验证。
其他 DSH 版本请停止，不授予版本豁免，不升级宿主。
请直接使用以上 GitHub Release 地址，不要从 npm 按同名包安装，
不额外安装默认模型插件，不修改 ASAR，不批准额外的安装脚本。
沿用当前 registry 配置；可选参数不用时请省略，不要填写空字符串。
完成后再次 list_bundles，确认版本为 0.2.0、installed 和 enabled 都为 true，
并报告 application 状态；如果需要重启，请明确告诉我，不要把未生效说成成功。
```

这是对**当前 profile** 的持久改动，会影响该 profile 的其他会话。按 DSH 提示批准安装；不要为了安装而无条件关闭所有安全保护。`application: applied` 表示已应用；若是 `restart-required`，按返回的 `nextStep` 重启后再核对。没有 `plugin_manager` 工具时，使用下面的命令行方法，不要让模型虚构安装成功。

### 方法二：直接用 DSH 命令行安装 GitHub URL

以下以桌面版常用的 `desktop` profile 为例。若你使用别的 profile，把命令中的 `desktop` 改成当前使用的名称；不要随意填一个新名字，否则 CLI 可能初始化另一个 profile。

先完全退出使用该 profile 的 DSH（桌面版包括托盘），在终端执行：

```sh
dsh plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.2.0/dsh-subagent-arg-guard-0.2.0.tgz"
```

安装命令成功后重新打开 DSH，并用 `plugin_manager` 的 `list_bundles` 或插件管理页核对安装与启用状态。DSH 会通过自己的 profile 包管理流程识别 bundle；不要在普通工作区中用 `npm install dsh-subagent-arg-guard` 代替。

如果 Windows 标准安装的 `dsh` 没有加入 PATH，可在 PowerShell 使用启动器路径：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.2.0/dsh-subagent-arg-guard-0.2.0.tgz"
```

该路径只适用于 Windows 标准安装位置；自定义安装或其他系统请使用各自实际的 `dsh` 启动器。

### 方法三：浏览器下载后，作为本地包安装

如果模型或安装入口不能处理远程 URL，先从上述 Release 下载 `.tgz` 和 `SHA256SUMS.txt`。在下载目录中核对包的 SHA-256，例如 PowerShell：

```powershell
Get-FileHash .\dsh-subagent-arg-guard-0.2.0.tgz -Algorithm SHA256
```

输出应与 `SHA256SUMS.txt` 中的值一致。然后完全退出 DSH，在同一 PowerShell 中安装下载包：

```powershell
$package = (Resolve-Path ".\dsh-subagent-arg-guard-0.2.0.tgz").Path
dsh plugin --profile desktop add "$package"
```

本地路径需要绝对路径，上面的 `Resolve-Path` 会完成转换；`dsh` 不在 PATH 时换用前述 Windows 启动器。完成后重新打开 DSH 并核对启用状态。

### 关闭或卸载

可在当前 profile 让模型先 `list_bundles`，再用 `set_bundle` 把目标 `dsh-subagent-arg-guard` 的 `enabled` 设为 `false`，或用 `remove_bundle` 卸载；若返回需要停止/重启，请按 `nextStep` 操作。

命令行卸载同样应先完全退出使用该 profile 的 DSH，再执行并重新打开：

```sh
dsh plugin --profile desktop remove dsh-subagent-arg-guard
```

**安装范围说明：**“仅 GitHub”指本插件的发布/下载来源，不代表 DSH 的全部网络流量只访问 GitHub。安装器仍可能按现有配置访问 registry 处理 profile 的其他依赖；不要因此把插件 target 改成 npm 同名包。本段方法依据 DSH 0.2.2-rc.1 的安装 spec、工具和 CLI 接口核对；真实验收覆盖开发包的本地 `.tgz` 安装/启用、空字段冒烟及设置页/保存提示，不代表每条远程安装或卸载路径都已实测。

## 从源码验证

不需要安装依赖，也不需要联网或真实模型凭据：

```sh
node test/verify-fixtures.mjs
node --experimental-vm-modules test/all.test.mjs
npm run check
```

## 许可

本插件采用 [MIT 许可证](LICENSE)。测试夹具不进入生产安装包，其公开来源与第三方许可证见 [夹具说明](test/fixtures/README.md)。
