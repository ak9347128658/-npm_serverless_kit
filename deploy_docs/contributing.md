# Contributing to serverless-kit

Author and maintainer: Asif Khan @ Kavion.ai.

Thanks for working on the kit. The useful change is one that keeps a handler portable: the same JavaScript or TypeScript, a different YAML file, Terraform that can apply.

## Setup

- Node.js 18 or newer
- npm
- Terraform 1.5 or newer if you will run `sk plan` or `sk deploy` against a real account. Unit tests do not call Terraform.

```bash
git clone <your-fork>
cd npm_serverless_kit
npm install
npm run typecheck
npm test
```

`npm install` must be allowed to run the esbuild postinstall, or the binary will be missing and bundle tests fail. If you see an allow-scripts warning, approve `esbuild` and install again.

Run the CLI from a checkout without publishing:

```bash
npx tsx src/cli.ts --help
npx tsx src/cli.ts validate --config examples/http-javascript/serverless-kit.yml
```

`npm run build` writes `dist/`. `npm test` uses `tsx` and does not need `dist/`.

## What to change

A contribution usually does one of these:

- Fixes a generated resource so `terraform validate` would accept it.
- Adds a test that renders Terraform and asserts the resource names.
- Adds an example under `examples/` and a section in `examples/README.md`.
- Documents a limit that the generator cannot hide. A comment in Terraform that does not create the trigger is not support. `EVENT_SUPPORT` in `src/catalog.ts` must say `no`, and `sk validate` must fail, until the resource is real.

## Layout

| Path | Role |
| --- | --- |
| `src/config` | YAML schema and validation |
| `src/catalog.ts` | Provider list and the event matrix |
| `src/plan` | Physical functions, internal routes, the workflow runner |
| `src/package` | esbuild entries and zips |
| `src/runtime` | The adapter. No Node built-ins at the top level of these modules |
| `src/terraform` | HCL for the ten providers |
| `src/cli` | `sk` commands |
| `src/ui` | The dashboard |
| `test` | `node:test` via `tsx` |
| `examples` | YAML that `test/examples.test.ts` parses |
| `docs` | User docs |
| `deploy_docs` | How to publish and how to contribute |

## Rules that keep the kit honest

- Do not write credentials, environment values, or the invoke token into the dashboard or into a committed file.
- `writeTerraform` may delete `*.tf`. It must not delete `terraform.tfstate`, `.terraform`, or `.terraform.lock.hcl`.
- A new event on a provider is `yes` in `EVENT_SUPPORT` only when `renderTerraform` emits a real resource. Otherwise it is `no` and `unsupportedHint` explains the substitute.
- Provider-specific Terraform belongs in `src/terraform/providers`. Shared HCL helpers stay in `src/terraform/support.ts` and `src/util/hcl.ts`.
- JSON values inside HCL go through `hclJson` or a quoted JSON string. Do not emit `jsonencode(${JSON.stringify(...)})`.
- Runtime code that Cloudflare bundles cannot import `fs`, `net`, or `child_process` at the top level.
- `sk destroy` keeps requiring `--yes`.
- Oracle `image` stays optional for `package` and required for `deploy`.

## Tests

Add or extend a test in `test/` for the behavior you changed. Rendered Terraform tests live in `test/terraform.test.ts`. Example YAML is checked by `test/examples.test.ts`. If you add a file under `examples/`, that test picks it up. The new file must validate with `checkFiles: true`, so the handler path has to exist next to the YAML.

```bash
npm test
npm run typecheck
```

`noUnusedLocals` and `noUnusedParameters` are on. Delete unused imports. Do not disable the check for a file.

The test script lists files explicitly because a directory argument is not a reliable glob on Windows. When you add `test/something.test.ts`, add it to the `test` script in `package.json`.

## A new provider or a new event

1. Add the name to `PROVIDER_NAMES` in `src/types.ts` and a `ProviderInfo` in `src/catalog.ts`.
2. Extend the zod provider object in `src/config/schema.ts`.
3. Set every event to `yes` or `no` in `EVENT_SUPPORT`.
4. Teach `mapRuntime` the real runtime id. Warn when you downgrade.
5. Teach `planDeployment` how many physical functions the platform needs.
6. Teach `renderEntry` in `src/package/bundle.ts` if the platform cannot use the Lambda-style `index.handler` entry.
7. Add `renderYourCloud` and a branch in `src/terraform/render.ts`.
8. Normalize that cloud's payload in `src/runtime/normalize.ts`.
9. Add a YAML file under `examples/switch-provider/` and a row in the matrix doc.
10. Add a render test that asserts the resource addresses, not a snapshot of the whole file.

Look up the Terraform resource on the provider registry before you invent an argument. A wrong argument applies as a failed deploy, which is worse than a validation error.

## Docs

User-visible behavior needs a paragraph in `docs/` and, when it is a scenario, a folder under `examples/` plus a section in `examples/README.md`. The README at the repo root should stay a short entry point.

## Pull requests

- One change per request when you can. A new provider and a drive-by refactor are hard to review.
- Describe the cloud resource you generated and the registry doc you followed.
- Say how you tested. `npm test` and `npm run typecheck` are the minimum. If you applied against a real account, say which provider and that you destroyed the stack.
- Do not commit `.serverless-kit/`, `dist/`, or `node_modules/`.
- Do not commit customer account ids, tokens, or state files.

CI on GitHub (`.github/workflows/ci.yml`) runs `npm run typecheck` and `npm test` on Ubuntu with Node 22.

## Code of conduct

Be specific in reviews. Point at the file and the resource. The license is Apache-2.0. Your contribution is licensed under that file (`LICENSE`).

## Publishing

Maintainers publish. Contributors do not need an npm token. The release steps are [npm-publish.md](npm-publish.md).
