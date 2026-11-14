# dsh-subagent-arg-guard

An independent DSH subagent argument-recovery plugin.

When the native `subagent` / `subagent_fork` tool fails because of a known model-selection argument error, this plugin removes `provider`, `model`, and `reasoning_effort` and retries once, restoring the call's original default behavior. It does not require a default-model plugin, take over a model pool, modify valid explicit selections, or widen permissions.

> **For Chinese readers:** see the [Chinese documentation](README.zh-CN.md).

### Verification scope

The current DSH host in this round is **0.2.2-rc.3**. One minimal `subagent` call was completed on the real host without using tools or changing files; it returned `RC3_LIVE_SMOKE_OK`. This confirms that version detection, the plugin entry point, and the argument-recovery path can start, but it is not a complete Native/PTC, fork, restart-persistence, or real-model-API matrix. The main rc.1/rc.2/rc.3 logic is selected by exact version branches; rc.3 reuses the relevant runtime modules verified byte-for-byte identical to rc.2.

At runtime, the plugin uses the host's public version API to select an exact branch and disables itself when the version is unknown or detection fails. It provides six switches under **More > Settings > Subagent Tools and Argument Recovery**: whether to allow `subagent`, whether to allow `subagent_fork`, and the four original recovery settings. The two tools can be disabled independently; **turning off argument recovery does not disable the tool-access rules**. The existing entry ID is retained, so old configuration is not migrated or discarded. The former custom configuration row on the Installed page has been removed. Changes save automatically and later calls read the new settings without a refresh or restart. The settings schema uses a lightweight Schemastery dependency; the host app-boot package and client slots/settings packages are optional peers. See the [Chinese documentation](README.zh-CN.md) for the full details.

The tool switches reject new calls at the native prepare and dispatch entry points. They **do not cancel calls that have already started or subagents that already exist**; the tools may still appear in a list already received by the model. They control only these two tool names and do not intercept other plugins that call the subagent service directly. Disabling the whole plugin also removes these tool restrictions; this is not a global subagent security sandbox.

## Documentation and downloads

- [Chinese documentation](README.zh-CN.md): exact recovery scope, compatibility limits, audit semantics, and installation instructions.
- [Test and verification report](TESTING.zh-CN.md): 193 isolated tests across three versions, the minimal real rc.3 host smoke test, the rc.1 native Config/version read-only probe, explicit unverified areas, and historical smoke-test evidence.
- [GitHub Releases](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases): packages and SHA-256 files. The plugin is not published to npm; do not install it from npm by package name.

## Version and dependencies

Source version **0.3.1** adds rc.3 version detection and adaptation. The current profile still runs the previously installed 0.3.1-local.1 build, while GitHub has the formal **0.3.1** release. The current profile has been switched to DSH 0.2.2-rc.3; real-host verification of the local package is currently limited to one minimal smoke test.

## Quick installation

The fixed v0.3.1 Release corresponding to this source includes rc.3 version detection, the general settings page, and tool switches; older Releases remain available and are not overwritten.

**This plugin is published only through GitHub. It is not published to npm, and it does not need to be listed in the DSH plugin market first.** The recommended method is to install the fixed Release `.tgz`; cloning the repository and installing `gh` are not required.

- The public v0.3.1 package supports **DSH 0.2.2-rc.1 / rc.2 / rc.3**; rc.3 currently has only the minimal real smoke test and not a complete host matrix. Do not install it on other versions or grant a version exemption.
- [v0.3.1 package](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/dsh-subagent-arg-guard-0.3.1.tgz)
- [SHA-256 file for the same version](https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/SHA256SUMS.txt)

### Method 1: Ask a DSH conversation to install it (recommended)

Copy the following text into a conversation in the DSH profile where you want to use the plugin:

```text
Use DSH's plugin_manager tool to install and enable dsh-subagent-arg-guard.
First use list_bundles to check the current installation, then install it with install_bundle:
target: https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/dsh-subagent-arg-guard-0.3.1.tgz
enabled: true

First check the DSH version: the public v0.3.1 manifest supports rc.1/rc.2/rc.3; rc.3 currently has one minimal real smoke test but no complete host matrix. Do not generalize one smoke test into full compatibility and do not grant a version exemption.
Stop on any other DSH version. Do not grant a version exemption or upgrade the host.
Use the GitHub Release URL above directly. Do not install the same-named package from npm,
do not install an additional default-model plugin, do not modify ASAR, and do not approve extra install scripts.
Keep the current registry configuration. Omit optional arguments when unused; do not fill them with empty strings.
After installation, run list_bundles again and confirm that the version is 0.3.1 and both installed and enabled are true.
Report the application status; if a restart is required, say so explicitly and do not describe an unapplied change as successful.
```

This is a persistent change to the current profile and affects its other sessions. Approve the installation when DSH asks; do not disable all security protections just to install it. `application: applied` means the change was applied. If the result is `restart-required`, follow the returned `nextStep` and verify again. If `plugin_manager` is unavailable, use the CLI method below instead of inventing a successful installation.

### Method 2: Install the GitHub URL with the DSH CLI

The example below uses the commonly used Desktop `desktop` profile. If you use another profile, replace `desktop` with its actual name. Do not invent a new name, or the CLI may initialize another profile.

Fully exit DSH using this profile first, including the tray process on Desktop, then run:

```sh
dsh plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/dsh-subagent-arg-guard-0.3.1.tgz"
```

After the command succeeds, reopen DSH and verify the installation and enabled state with `plugin_manager` `list_bundles` or the plugin manager page. DSH identifies the bundle through its own profile package-management flow; do not replace this with `npm install dsh-subagent-arg-guard` in an ordinary workspace.

If the standard Windows `dsh` command is not on `PATH`, use the launcher path in PowerShell:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/NekogamiJam/dsh-subagent-arg-guard/releases/download/v0.3.1/dsh-subagent-arg-guard-0.3.1.tgz"
```

That path applies only to the standard Windows installation location. Use the actual launcher for custom installations and other operating systems.

### Method 3: Download the package in a browser and install it locally

If the model or installation entry cannot handle a remote URL, download the `.tgz` and `SHA256SUMS.txt` from the Release above. Verify the package SHA-256 in the download directory, for example in PowerShell:

```powershell
Get-FileHash .\dsh-subagent-arg-guard-0.3.1.tgz -Algorithm SHA256
```

The output must match the value in `SHA256SUMS.txt`. Then fully exit DSH and install the downloaded package in the same PowerShell session:

```powershell
$package = (Resolve-Path ".\dsh-subagent-arg-guard-0.3.1.tgz").Path
dsh plugin --profile desktop add "$package"
```

The local package path must be absolute; `Resolve-Path` performs that conversion. If `dsh` is not on `PATH`, use the Windows launcher shown above. Reopen DSH and verify the enabled state afterward.

### Disable or uninstall

In the current profile, ask the model to run `list_bundles` first, then use `set_bundle` to set `enabled` to `false` for `dsh-subagent-arg-guard`, or use `remove_bundle` to uninstall it. If the result says that stopping or restarting is required, follow `nextStep`.

From the CLI, fully exit DSH using the profile first, then run this and reopen DSH:

```sh
dsh plugin --profile desktop remove dsh-subagent-arg-guard
```

**Installation scope:** “GitHub only” describes this plugin's publication/download source; it does not mean that all DSH network traffic goes only to GitHub. The installer may still access the configured registry for other profile dependencies. Do not change the plugin target to the same-named npm package. This section is based on the DSH 0.2.2-rc.3 installation spec, tools, and CLI interface. The local 0.3.1-local.1 build was installed and enabled from a local `.tgz` and passed the `RC3_LIVE_SMOKE_OK` minimal smoke test, but that does not mean every remote installation or uninstall path has been tested.

## Verify from source

No dependencies, network access, or real model credentials are required:

```sh
node test/verify-fixtures.mjs
node --experimental-vm-modules test/all.test.mjs
npm run check
```

## License

This plugin is distributed under the [MIT License](LICENSE). Test fixtures are not included in the production package; their public sources and third-party licenses are listed in the [fixture notes](test/fixtures/README.md).
