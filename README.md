# dsh-subagent-arg-guard

独立、零运行依赖的 DSH 子代理参数补救插件。

当原生 `subagent` / `subagent_fork` 因特定的选模参数错误而失败时，删除 `provider`、`model`、`reasoning_effort` 后重试一次，让调用恢复原本的默认行为。无需安装默认模型插件，也不会接管模型池、修改合法显式选择或放宽权限。

**当前版本：0.1.0。仅审计并声明兼容 DSH 0.2.2-rc.1；Node.js >=22。**

## 文档与下载

- [完整中文说明](README.zh-CN.md)：精确补救范围、兼容限制、审计语义和安装说明。
- [测试与验证报告](TESTING.zh-CN.md)：65 项隔离测试，以及独立的真实进程冒烟验证；未验证项单独列出。
- [GitHub Releases](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases)：安装包与 SHA-256 校验文件。未发布 npm，不应直接按包名从 npm 安装。

## 快速安装

**本插件仅通过 GitHub 发布，未发布 npm，也不要求先进入 DSH 插件市场。** 推荐安装固定版本的 Release `.tgz`，无需先 clone 仓库或安装 `gh`。

- 适用版本：**DSH 0.2.2-rc.1**，Node.js >=22。其他 DSH 版本先不要装，不要授予版本豁免。
- [v0.1.0 安装包直链](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/dsh-subagent-arg-guard-0.1.0.tgz)
- [同版本 SHA-256 校验文件](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/SHA256SUMS.txt)

### 方法一：在 DSH 对话中让模型安装（推荐）

把下面这段话复制到**你要使用插件的 DSH profile 中的会话**：

```text
请使用 DSH 的 plugin_manager 工具安装并启用 dsh-subagent-arg-guard。
先 list_bundles 检查当前安装状态，再通过 install_bundle 安装：
target: https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/dsh-subagent-arg-guard-0.1.0.tgz
enabled: true

插件仅兼容 DSH 0.2.2-rc.1；版本不符时请停止，不授予版本豁免。
请直接使用以上 GitHub Release 地址，不要从 npm 按同名包安装，
不额外安装默认模型插件，不修改 ASAR，不批准额外的安装脚本。
沿用当前 registry 配置；可选参数不用时请省略，不要填写空字符串。
完成后再次 list_bundles，确认版本为 0.1.0、installed 和 enabled 都为 true，
并报告 application 状态；如果需要重启，请明确告诉我，不要把未生效说成成功。
```

这是对**当前 profile** 的持久改动，会影响该 profile 的其他会话。按 DSH 提示批准安装；不要为了安装而无条件关闭所有安全保护。`application: applied` 表示已应用；若是 `restart-required`，按返回的 `nextStep` 重启后再核对。没有 `plugin_manager` 工具时，使用下面的命令行方法，不要让模型虚构安装成功。

### 方法二：直接用 DSH 命令行安装 GitHub URL

以下以桌面版常用的 `desktop` profile 为例。若你使用别的 profile，把命令中的 `desktop` 改成当前使用的名称；不要随意填一个新名字，否则 CLI 可能初始化另一个 profile。

先完全退出使用该 profile 的 DSH（桌面版包括托盘），在终端执行：

```sh
dsh plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/dsh-subagent-arg-guard-0.1.0.tgz"
```

安装命令成功后重新打开 DSH，并用 `plugin_manager` 的 `list_bundles` 或插件管理页核对安装与启用状态。DSH 会通过自己的 profile 包管理流程识别 bundle；不要在普通工作区中用 `npm install dsh-subagent-arg-guard` 代替。

如果 Windows 标准安装的 `dsh` 没有加入 PATH，可在 PowerShell 使用启动器路径：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.1.0/dsh-subagent-arg-guard-0.1.0.tgz"
```

该路径只适用于 Windows 标准安装位置；自定义安装或其他系统请使用各自实际的 `dsh` 启动器。

### 方法三：浏览器下载后，作为本地包安装

如果模型或安装入口不能处理远程 URL，先从上述 Release 下载 `.tgz` 和 `SHA256SUMS.txt`。在下载目录中核对包的 SHA-256，例如 PowerShell：

```powershell
Get-FileHash .\dsh-subagent-arg-guard-0.1.0.tgz -Algorithm SHA256
```

输出应与 `SHA256SUMS.txt` 中的值一致。然后完全退出 DSH，在同一 PowerShell 中安装下载包：

```powershell
$package = (Resolve-Path ".\dsh-subagent-arg-guard-0.1.0.tgz").Path
dsh plugin --profile desktop add "$package"
```

本地路径需要绝对路径，上面的 `Resolve-Path` 会完成转换；`dsh` 不在 PATH 时换用前述 Windows 启动器。完成后重新打开 DSH 并核对启用状态。

### 关闭或卸载

可在当前 profile 让模型先 `list_bundles`，再用 `set_bundle` 把目标 `dsh-subagent-arg-guard` 的 `enabled` 设为 `false`，或用 `remove_bundle` 卸载；若返回需要停止/重启，请按 `nextStep` 操作。

命令行卸载同样应先完全退出使用该 profile 的 DSH，再执行并重新打开：

```sh
dsh plugin --profile desktop remove dsh-subagent-arg-guard
```

**安装范围说明：**“仅 GitHub”指本插件的发布/下载来源，不代表 DSH 的全部网络流量只访问 GitHub。安装器仍可能按现有配置访问 registry 处理 profile 的其他依赖；不要因此把插件 target 改成 npm 同名包。本段方法依据 DSH 0.2.2-rc.1 的安装 spec、工具和 CLI 接口核对；现有真实验收是本地 `.tgz` 安装/启用与一次空字段冒烟，不冒充每条远程安装、UI 或卸载路径都已实测。

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
