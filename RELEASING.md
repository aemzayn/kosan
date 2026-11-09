# Releasing

Kosan uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing across all packages in the monorepo.

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- An npm account with access to the `@kosan` org
- 2FA enabled on your npm account (required to publish)

---

## Day-to-day: recording a change

After making changes to one or more packages, run:

```bash
pnpm changeset
```

The CLI will ask:

1. **Which packages changed?** — select with spacebar
2. **Patch, minor, or major?** — see the semver guide below
3. **Summary** — one line describing what changed (ends up in the changelog)

This creates a small markdown file in `.changeset/`. Commit it alongside your code changes.

### Semver guide

| Change type | Bump |
|---|---|
| Docs, README, comments | `patch` |
| Bug fix | `patch` |
| New feature, backwards-compatible | `minor` |
| Breaking API change | `major` |

> While the project is pre-1.0, `minor` is acceptable for breaking changes.

---

## Releasing

### 1. Apply changesets → bump versions

```bash
pnpm version
```

This reads all pending `.changeset/*.md` files, bumps the version in each affected `package.json`, updates `CHANGELOG.md` for each package, and deletes the consumed changeset files.

Review the diff before committing — make sure versions and changelogs look correct.

```bash
git add .
git commit -m "chore: release"
```

### 2. Build and publish

```bash
pnpm release --otp=YOUR_OTP
```

`pnpm release` runs `pnpm build` first (so the `dist/` is fresh), then calls `changeset publish` which publishes every package whose version is not yet on npm.

Get your OTP from your authenticator app. If you prefer a token over OTP, see [npm access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens).

### 3. Tag and push

After a successful publish, push the version bump commit and the tags changesets created:

```bash
git push --follow-tags
```

---

## Publishing a subset of packages

If you only want to publish specific packages:

```bash
pnpm --filter @kosan/core --filter @kosan/sequelize publish --access public --otp=YOUR_OTP
```

---

## First-time publish (new package)

New packages in `packages/` start at version `0.1.0`. To publish for the first time:

```bash
pnpm --filter @kosan/new-package publish --access public --otp=YOUR_OTP
```

No changeset needed for an initial publish.

---

## Troubleshooting

**`E403` — Two-factor authentication required**
Pass `--otp=YOUR_CODE` with the current 6-digit code from your authenticator app.

**`E404` — Not found / no permission**
Make sure you are logged in (`npm whoami`) and that your npm account has access to the `@kosan` org.

**`E403` — Cannot publish over existing version**
The version in `package.json` is already on npm. Run `pnpm changeset` + `pnpm version` to bump it first.
