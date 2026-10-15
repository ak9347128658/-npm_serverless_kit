# Publish serverless-kit to npm

This is the release checklist for the `node_serverless_kit` package. Do it from a clean clone. The `prepublishOnly` script runs `npm run build` and `npm test` before the tarball is packed.

The package author in `package.json` is Asif Khan @ Kavion.ai. The npm name is `node_serverless_kit`. The unscoped name `serverless-kit` belongs to another account, so this package does not use it. The installed commands are still `sk` and `serverless-kit`.

## 1. Accounts and access

1. Create an npm user at https://www.npmjs.com/signup if you do not have one.
2. Enable two-factor authentication on the account. npm requires 2FA for publishes.
3. If the package is scoped and public, you will pass `--access public`. Unscoped packages are public by default.
4. If an organization owns the scope, an owner must grant you publish rights.

## 2. Machine

- Node.js 18 or newer. The package `engines` field is `>=18`. CI in `.github/workflows/ci.yml` uses Node 22.
- npm 9 or newer (ships with current Node).
- A clean working tree. Commit or stash everything you intend to publish. `npm publish` packs the files listed below, not whatever is only on disk and gitignored, except that `dist/` is built during `prepublishOnly` and is included.

## 3. What gets uploaded

`package.json` `files`:

- `dist/` (built by `prepublishOnly`, not committed)
- `docs/`
- `examples/`
- `deploy_docs/`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `CONTRIBUTING.md`

`.npmignore` drops `src/`, `test/`, and `.github/`. Consumers install the compiled CLI (`sk` and `serverless-kit` point at `dist/cli.js`).

Confirm the ignore rules with a dry run (step 6) before you publish.

## 4. Version

`package.json` `version` is the version npm will publish. It must be higher than the version already on the registry.

1. Update `CHANGELOG.md` with the version and the user-visible changes.
2. Set the version:

   ```bash
   npm version 0.1.0
   ```

   `npm version` writes `package.json` and `package-lock.json` and creates a git commit and a tag when the directory is a git repo. Use `npm version 0.1.0 --no-git-tag-version` if you only want the file change and will tag yourself.

3. The CLI prints the version from the commander `.version("0.1.0")` call in `src/cli/program.ts`. Update that string so `sk --version` matches `package.json`.

## 5. Checks

From the repository root:

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/cli.js --version
```

`npm test` parses every example YAML and renders Terraform for it. Fix failures before you publish. Do not use `--force` to skip `prepublishOnly`.

## 6. Inspect the tarball

```bash
npm pack --dry-run
```

Read the file list. You want `dist/cli.js`, `dist/index.js`, `dist/runtime/`, the docs, the examples, and the license. You do not want `src/`, `test/`, `.serverless-kit/`, or cloud credentials.

Then write the tarball without publishing:

```bash
npm pack
```

That creates `node_serverless_kit-<version>.tgz`. Open it if you want to see the exact bytes. Delete the tarball after you publish so it is not committed.

## 7. Log in

```bash
npm login
npm whoami
```

On an automation token:

```bash
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"
```

Prefer a granular access token with publish permission for this package only. Do not commit the token. Do not put it in the repository or in generated Terraform.

## 8. Publish

```bash
npm publish
```

For a scoped public package:

```bash
npm publish --access public
```

npm will ask for a one-time password if the account uses 2FA. `prepublishOnly` builds and tests again. If tests fail, nothing is uploaded.

Provenance (optional, from a public GitHub Actions run):

```bash
npm publish --provenance --access public
```

The workflow must have `id-token: write` and `contents: read`. The release workflow is not included in this repo. Add one when you want attestations.

## 9. Confirm

```bash
npm view node_serverless_kit version
npm view node_serverless_kit dist.tarball
```

In an empty directory:

```bash
npm install node_serverless_kit
npx sk --version
npx sk init .
```

`sk init` writes `serverless-kit.yml` and `src/handler.js`. It does not deploy.

## 10. Tag the release

If `npm version` did not already tag:

```bash
git tag v0.1.0
git push origin main --tags
```

Push only when you mean to. The tag should point at the commit that matches the published version.

## 11. Later releases

1. Change the code.
2. Add a `CHANGELOG.md` section.
3. Bump `package.json` and `src/cli/program.ts`.
4. `npm test` and `npm run build`.
5. `npm publish`.

Tags:

- `latest` is the default dist-tag.
- A breaking pre-release: `npm publish --tag next`, then `npm dist-tag add node_serverless_kit@x.y.z latest` when you are ready.

Unpublishing is limited. npm lets you unpublish within 72 hours if nothing else depends on the version, and the name stays reserved. Prefer `npm deprecate node_serverless_kit@0.1.0 "message"` over unpublish.

## 12. Do not publish

- `.serverless-kit/` state, `deployment.json`, or invoke tokens
- cloud credentials, `.env` files, or real account ids from a customer project
- `node_modules/`

The examples use placeholders (`demo-project`, `ocid1...example`, `replace-with-account-id`). Replace those in a real service. Leave the placeholders in the published examples.
