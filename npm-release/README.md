# npm and GitHub releases

GitHub is the source of the release. The [release workflow](../.github/workflows/release.yml) tests the tagged source and packs it once. It publishes that archive to npm through Trusted Publishing (OIDC), verifies the registry integrity, then attaches the same bytes and `SHA256SUMS.txt` to the GitHub Release. The copy named `dsh-subagent-arg-guard.tgz` keeps the GitHub `latest/download` URL stable across releases. `repository.url` must continue to point at the canonical GitHub repository listed in the market; no manual `npm:` field is needed in the market catalog.

## One-time npm setup

Sign in to npm as a maintainer. On the [package Settings page](https://www.npmjs.com/package/dsh-subagent-arg-guard/access), open **Trusted publishing** and select **GitHub Actions**. Add the following trusted publisher:

| npm field | Value |
| --- | --- |
| Organization or user | `NekogamiJam` |
| Repository | `dsh-subagent-arg-guard` |
| Workflow filename | `release.yml` |
| Environment name | Leave blank |
| Allowed actions | Enable direct **`npm publish`**; separate `npm dist-tag` access is not needed |

Save the configuration using npm's own authentication prompt if asked. Do not add an npm token to GitHub, the repository, or this directory. The workflow's npm job has `id-token: write` and runs on a GitHub-hosted runner; the GitHub release job instead uses the platform's short-lived `GITHUB_TOKEN`. After the first successful OIDC release, npm recommends **Require two-factor authentication and disallow tokens** under the package's **Publishing access** to disable token-based publishing. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

## Check without publishing

A PR, a push to `main`, or an Actions **Run workflow** dispatch runs tests and generates the downloadable `release-package` artifact without either publish job. To pack locally without publishing, run `npm pack --ignore-scripts --pack-destination npm-release` from the plugin root. Generated files in this directory are neither committed nor included in the plugin package.

## Publish the next release

1. Update the version in `package.json` and any versioned installation links in both READMEs. Merge the release commit into `main` and make sure its check run passes.
2. Tag that commit with the exact manifest version, `v<major>.<minor>.<patch>`, and push **only that new tag**, e.g. `git push origin v0.3.7` after creating it. Do not reuse the `v0.3.6` tag or push test tags. Release one version at a time.
3. Confirm both publish jobs succeed and verify the npm package's provenance and the GitHub Release assets. If a later job fails, use **Re-run failed jobs** on that run after diagnosing the failure; do not force-push the tag or publish from a local shell. The workflow will not overwrite a published version or an asset with different contents.
