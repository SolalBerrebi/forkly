# Releasing Forkly

This doc walks through cutting a release end-to-end: prepping the source, configuring the signing secrets on the GitHub repo, tagging, watching CI publish the draft release, and promoting it.

If you're a contributor reading this for the first time, the practical takeaway is: pushing a tag like `v0.1.0` triggers a 4-target matrix build via `tauri-action` that produces signed + notarized `.dmg`s for macOS, an `.msi` for Windows, and `.AppImage` + `.deb` for Linux. Everything lands in a GitHub Release as a draft for you to write notes and publish.

---

## One-time setup: GitHub repo secrets

Before the first signed release, set the following secrets at **Settings → Secrets and variables → Actions**. The macOS code-signing path needs all seven of the Apple ones; everything else is optional.

### Apple Developer (macOS code signing + notarization)

| Secret | What it is | How to get it |
|---|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` of your *Developer ID Application* cert. | See "Exporting the certificate" below. |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set on the `.p12` during export. | You typed this when exporting. |
| `APPLE_SIGNING_IDENTITY` | The exact identity string. Typically `Developer ID Application: Your Name (ABC1234567)` — full string including the team id in parentheses. | Keychain Access → right-click the cert → Get Info → "Common Name" field. Or run: `security find-identity -v -p codesigning` |
| `APPLE_ID` | Your Apple ID email. | The one your Developer Program is registered against. |
| `APPLE_PASSWORD` | An **app-specific password**, NOT your real Apple ID password. | [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords → Generate. Label it `Forkly CI`. |
| `APPLE_TEAM_ID` | Your 10-character team id. | [developer.apple.com/account#MembershipDetailsCard](https://developer.apple.com/account#MembershipDetailsCard) or in the parens of the signing identity. |
| `KEYCHAIN_PASSWORD` | Arbitrary password tauri-action uses for the temporary keychain it imports the cert into. | Any non-empty string. Generate one with `openssl rand -base64 24`. |

### Exporting the certificate

On your Mac, with Xcode installed and your Apple Developer Program account active:

```bash
# 1. In Xcode: Settings → Accounts → your team → Manage Certificates
#    → click + → "Developer ID Application". Xcode creates it in your
#    login keychain.

# 2. Open Keychain Access, find the new cert ("Developer ID Application:
#    Your Name"). Right-click → Export → Save as .p12 with a password.
#    Keep that password handy — it becomes APPLE_CERTIFICATE_PASSWORD.

# 3. Base64-encode the .p12 for paste into GitHub Secrets:
base64 -i path/to/DeveloperIDApp.p12 | pbcopy
#    pbcopy puts it on your clipboard. Paste into the
#    APPLE_CERTIFICATE secret on GitHub.
```

### Auto-updater signing (optional, not needed for v0.1)

If you later wire `tauri-plugin-updater` for in-app updates, generate an Ed25519 keypair:

```bash
pnpm tauri signer generate -w ~/.tauri/forkly.key
```

Then set `TAURI_SIGNING_PRIVATE_KEY` (paste the contents of the file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (whatever you typed when generating).

---

## Per-release process

### 1. Prep the source

- Update [`CHANGELOG.md`](../CHANGELOG.md): move `[Unreleased]` content under the new version heading, add a fresh `[Unreleased]` stub.
- Bump `version` in [`package.json`](../package.json), [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml), and [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json). They must match.
- Commit with `git commit -sm "chore(release): v0.1.0"` (the `-s` is the DCO sign-off — required).

### 2. Tag and push

```bash
git tag -s v0.1.0 -m "Forkly v0.1.0"   # signed tag
git push origin v0.1.0
```

If you don't have a GPG key configured for signed tags, drop the `-s`. Don't drop it on commits, though — the DCO action will block merge.

### 3. Watch CI

The push triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml). Open the Actions tab; the `Release` workflow runs four jobs in parallel:

- macOS (Apple Silicon) — signed + notarized
- macOS (Intel) — signed + notarized
- Linux — `.AppImage` + `.deb`, unsigned
- Windows — `.msi`, unsigned

Each takes ~12-18 minutes. Notarization adds 3-8 minutes per macOS job because Apple's service is asynchronous.

### 4. Publish the release

The workflow creates a **draft** release on GitHub Releases with all four artifacts attached. Open the draft:

- Edit the release notes (the workflow paste is a starting point; expand it with the highlights).
- Verify each artifact is present and named sensibly.
- Click **Publish release**.

### 5. After publishing

- Update the README's install section to point at the new release page (it should already link, but double-check).
- Post the release notes wherever you announce: HN Show, r/LocalLLaMA, X, your blog, etc.
- If something's broken, click "Edit release" → unpublish to draft → fix → re-publish. Tags can't be moved cleanly, so a botched release usually means tagging `v0.1.1` rather than re-tagging.

---

## Troubleshooting

### Notarization fails with "Unable to find requested file"

Usually means the cert wasn't imported correctly. Re-export the `.p12`, re-base64 it, re-paste into `APPLE_CERTIFICATE`. Make sure you grabbed the *Developer ID Application* cert, not *Apple Development*.

### Notarization succeeds but Gatekeeper still complains on first open

This typically means the staple step didn't run. The CI workflow stapling is automatic via tauri-action; if it failed, check the build log for `xcrun stapler staple`. Manual recovery: download the `.dmg`, run `xcrun stapler staple Forkly.dmg`, re-upload.

### "Hardened runtime / JIT" error at launch

The Entitlements.plist in `src-tauri/` is the source of truth. WebKit needs both `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`. If you ever change those, re-sign and re-notarize.

### macOS users on macOS 15+ get "broken or incomplete"

Almost always a stapling issue. See above.

### Linux: `.AppImage` won't run

The `.AppImage` needs the FUSE2 library on older distros. We document this in the release notes: `sudo apt install libfuse2` for Ubuntu 22.04 and older. Newer (24.04+) ships it.

### Windows SmartScreen warning

The `.msi` is unsigned in v0.1.x. Windows users see a SmartScreen warning on first open — click "More info" → "Run anyway". Code-signing certs for Windows are expensive (~$300/yr); we plan to apply for the SignPath OSS program for free signing.
