# Desktop releases

Run `npm ci`, then `npm run release` from the repository. Use Node 22+ and the Rust 1.90 toolchain pinned in `rust-toolchain.toml`. The version must agree in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

The command validates the environment, archives existing installers, runs Tauri's existing frontend and native build, verifies distributables, collects them, and prints results. A failed archive stops before any build or bundle cleanup. SHA-256 hashes, file sizes, executable permissions, and relative symlink targets are compared during copying. No Rust caches, `node_modules`, debug builds, or temporary `rw.*.dmg` files are archived.

## Native builds

Install [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/) for the machine's OS. macOS needs Xcode command-line tools and an SDK; Windows needs the MSVC C++ build tools and WebView2; Linux needs WebKitGTK 4.1 and the native development libraries. Windows and Linux releases require a native x64 Rust host. The script uses Cargo metadata to locate output, including a configured `CARGO_TARGET_DIR` or `.cargo/config.toml` target directory.

| Host        | Default artifacts                              | Rust target                                   |
| ----------- | ---------------------------------------------- | --------------------------------------------- |
| macOS       | `.app`, `.dmg` for each installed architecture | `aarch64-apple-darwin`, `x86_64-apple-darwin` |
| Windows x64 | MSI and NSIS setup EXE                         | `x86_64-pc-windows-msvc`                      |
| Linux x64   | AppImage, DEB, RPM                             | `x86_64-unknown-linux-gnu`                    |

On macOS:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run release
npm run release -- --target aarch64-apple-darwin   # Only Apple Silicon
npm run release -- --target x86_64-apple-darwin    # Only Intel
npm run desktop:build:mac                         # Universal .app and .dmg
```

The default Mac command builds the host architecture first and then the other architecture if installed. A missing optional target is explicitly reported as skipped. An explicitly requested target or universal build requires all relevant Rust targets. Intel support depends on a successful build with the available SDK; a target is never reported as successful based on target installation alone. Separate installers keep downloads smaller and make target failures easier to diagnose; the existing universal option remains available when one installer for both architectures is useful.

On Windows:

```sh
rustup target add x86_64-pc-windows-msvc
npm run release
```

On Ubuntu 22.04 x64 (the CI baseline):

```sh
sudo apt-get update
sudo apt-get install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libdbus-1-dev xdg-utils rpm
rustup target add x86_64-unknown-linux-gnu
npm run release
```

Use the oldest Linux distribution you intend to support that meets [Tauri's AppImage requirements](https://v2.tauri.app/distribute/appimage/). Linux artifacts built on a newer distribution may require newer system libraries. In containers or CI without FUSE, set `APPIMAGE_EXTRACT_AND_RUN=1`.

Each OS builds its own native installers. macOS cannot produce this workflow's Windows or Linux installers. Skipped other operating systems are listed in the summary; use native machines or the CI matrix for them.

## Output and history

Only directories with artifacts are created:

```text
releases/current/
  build-info.json
  SHA256SUMS.txt
  macos/arm64/
    Deck.app
    Deck-0.1.0-macos-arm64.dmg
    build-info.json
    SHA256SUMS.txt
  macos/x64/
  macos/universal/
  windows/x64/
  linux/x64/

build-history/v0.1.0_2026-10-02_19-05-32/
  build-info.json
  previous-build-info.json
  previous-SHA256SUMS.txt
  SHA256SUMS.txt
  macos/arm64/
  windows/x64/
  linux/x64/
```

Installers include Deck, version, platform, and architecture in their names. NSIS installers end in `-setup.exe`. The `.app` keeps its original name and internal contents to preserve signing compatibility. Checksums list individual regular files inside `.app` bundles as well as installer files. On macOS/Linux, verify with `shasum -a 256 -c SHA256SUMS.txt` or `sha256sum -c SHA256SUMS.txt` from the manifest's directory. Symlinks and executable modes are also checked while archiving.

The archive includes both `releases/current/` and previous native Tauri bundles under Cargo's release output directories. Legacy bundles are organized under `<platform>/<architecture>/tauri/` (or `tauri-native/` for output without an explicit Rust target). The distinction prevents old untargeted and targeted bundles from colliding. Unknown legacy architecture directories cause an actionable error rather than being silently skipped. Same-second archive names gain a numeric suffix. Every archive is retained indefinitely; remove old archives manually if needed.

Each archived set has `build-info.json`, including archive time with a local UTC offset, artifact paths and sizes, and available previous Git metadata. The archiving checkout's metadata is recorded separately as `archivedBy`. Legacy bundles have unknown provenance; they may predate the checkout's version. Missing Git metadata is represented as `null` and never blocks a build. A previous root manifest and checksum file are copied separately before new archive metadata is generated.

Each newly collected target has its own build manifest and checksums. The root manifest describes the most recent command and records complete/partial status, target errors, skipped targets, and the archive path. Other target directories are retained between runs and may have different versions; consult each target's manifest. The root list inventories available output, and does not assert that every retained target was rebuilt.

To archive without building, use `npm run release:archive`. A first build with no existing distributables creates no archive. `releases/` and `build-history/` are ignored by Git.

## Failure behavior

Builds are serialized with `releases/.release-lock.json`. An interrupted run may leave a lock; confirm no Deck build is running before removing it manually. Do not run concurrent raw Tauri builds in the same checkout.

Only after a verified archive does the script remove the selected target's old bundle directory, so a stale installer cannot pass a new build's verification. It preserves other targets and Rust caches. New files are copied and verified in a staging directory before replacing that target's normalized output. A failed copy leaves the current target untouched. A failed build can still collect usable partial output (for example, a completed `.app` when DMG packaging fails); that output is marked partial. Other requested targets continue. Any failed target makes the overall command exit nonzero and print **Deck Release Failed**. Archived previous releases remain available.

The Tauri `beforeBuildCommand` also runs the archive guard before building the frontend. This protects existing artifacts when using `npm run tauri -- build` directly; raw Tauri commands do not normalize output. During `npm run release`, the hook checks the active orchestrator's archive marker to avoid copying the same old builds twice. `DECK_RELEASE_TOKEN` is an internal per-run value, generated by the script; do not set it yourself or override the Tauri build hook.

## CI and distribution

The **Build desktop releases** GitHub Actions workflow runs manually or on pushed `v*` tags. A tag must match the current application version, for example `v0.1.0`. It uses `macos-14` for Apple Silicon, `macos-15-intel` for Intel, `windows-2022` for Windows x64, and `ubuntu-22.04` for Linux x64. Each runner invokes the same release command with an explicit target. The matrix disables fail-fast so successful platforms finish even if another fails. No app release is published automatically.

Download the per-platform artifacts from the Actions run. Each contains a `.tar.gz` of `releases/current/`, preserving `.app` symlinks and executable permissions. Extract with `tar -xzf <file.tar.gz>`. Manifests and checksums are inside. Collected partial builds are uploaded even when the release step fails. CI uploads expire after 90 days; download them for permanent storage. Local `build-history/` is independent and never expires automatically.

## Signing

Initial builds do not require signing credentials. macOS Developer ID signing/notarization and Windows signing can be configured through Tauri's supported environment variables and platform bundle configuration later. Keep certificates, signing identities, passwords, and tokens in a secure local environment or GitHub Actions secrets. The script inherits signing environment variables without logging their values. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) and [Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

## Verification

```sh
npm run test:release   # Archive safety, copy verification, target rules, partial failures
npm test              # Application domain tests
npm run build         # Frontend type check and production build
npm run test:native    # Rust tests
```

The repository has no lint script. Check release formatting with `npx prettier --check scripts/release*.mjs tests/release.test.mjs docs/releases.md .github/workflows/desktop-release.yml package.json src-tauri/tauri.conf.json`.
