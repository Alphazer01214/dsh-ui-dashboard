# Repo relationship to deepseek-harness

This repository hosts the source of the DeepSeek Harness web client plugin
`@deepseek-ai/dsh-usage-dashboard` (the sidebar usage dashboard), forked from
the DeepSeek Harness monorepo
(<https://github.com/deepseek-ai/deepseek-harness>) at commit
`47f943859bef60e4160492346772ded9b24f765a`, where the same plugin lives as
`@deepseek-ai/dsh-client-ui-dashboard` under `packages/client/ui-dashboard/`.

The monorepo owns the build and publication path:

- the plugin builds through the monorepo's client toolchain (shared tsdown
  preset, TypeScript project references) and is published by the monorepo's
  dsh-family release pipeline (`scripts/release/*` and `release.yml`);
- its npm peers (`@deepseek-ai/dsh-client-*`, `@deepseek-ai/cordis`,
  `@deepseek-ai/dsh-session-stats`, `@deepseek-ai/dsh-token-meter`, …) are
  declared as `workspace:^` inside the monorepo and substituted by
  `pnpm pack` at publication time.

This repository therefore does not build, test, or publish on its own — the
package has no standalone build environment. It exists to host and share the
plugin source under its own name.

## Syncing

Copy `src/`, `tests/`, and the manifest/config files from
`packages/client/ui-dashboard/` in the monorepo into this repository, apply
the rename (`@deepseek-ai/dsh-client-ui-dashboard` →
`@deepseek-ai/dsh-usage-dashboard`), update the README pairing record with
`git hash-object`, and commit, naming the monorepo commit in the commit
message. Excluded from the mirror: `lib/` (build output) and `node_modules/`.
