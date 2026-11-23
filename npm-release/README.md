# npm and GitHub releases

Store generated archives and checksums in this directory, not in the workspace root. From the plugin root, run:

```sh
npm pack --ignore-scripts --pack-destination npm-release
```

Publish the resulting archive to npm and attach the **same bytes** to the matching `v<version>` GitHub Release. Attach `SHA256SUMS.txt` and, for a stable GitHub download URL, a byte-identical copy named `dsh-subagent-arg-guard.tgz`. Keep the npm package’s `repository.url` pointed at the canonical GitHub repository listed by the market; the catalog automatically discovers the npm mapping, so do not add a manual `npm:` field to its YAML. Never place credentials here. Generated files in this directory are not committed or included in the plugin package.
