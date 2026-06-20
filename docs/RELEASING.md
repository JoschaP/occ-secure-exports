# Releasing

Releases are automated. You normally do **nothing** except merge Conventional
Commits to `main`.

## What happens on merge to `main`

1. **`release.yml`** runs [semantic-release](https://semantic-release.gitbook.io/):
   it analyzes commits, computes the next version, updates `CHANGELOG.md` and the
   manifests (`package.json`, `Cargo.toml`, `tauri.conf.json`), tags, and
   publishes a GitHub Release.
2. The build matrix compiles native bundles (macOS arm64 + Intel, Windows,
   Linux) and attaches them to the release.
3. **`package-managers.yml`** updates the Homebrew cask and Scoop manifest.

Version bumps follow the commit types: `fix:` → patch, `feat:` → minor,
`feat!:` / `BREAKING CHANGE:` → major. While the project is `0.x`, breaking
changes stay below `1.0` until a `1.0.0` is cut intentionally.

## One-time setup: the `PACKAGES_TOKEN` secret

Updating the **separate** tap/bucket repos needs a token the default
`GITHUB_TOKEN` doesn't have. Without it, the package-manager step logs a warning
and skips (the release itself still succeeds).

1. Create a **fine-grained Personal Access Token**
   (GitHub → Settings → Developer settings → Fine-grained tokens):
   - **Repository access:** only `JoschaP/homebrew-tap` and `JoschaP/scoop-bucket`
   - **Permissions:** Contents → **Read and write**
2. Add it to this repo as a secret named **`PACKAGES_TOKEN`**
   (Settings → Secrets and variables → Actions → New repository secret), or:

   ```bash
   gh secret set PACKAGES_TOKEN --repo JoschaP/occ-companion
   ```

## Publishing bundles for an existing tag (manual)

To (re)build and publish a specific tag — e.g. to bootstrap the first release:

```bash
gh workflow run build-release.yml -f tag=v0.1.0
```

This builds the bundles, attaches them to the `v0.1.0` release, and updates the
package managers.

## Code signing (optional)

Bundles are unsigned by default. To sign/notarize, add the documented secrets
(see the README's *Signing & notarization* section) — the workflows already
consume them.
