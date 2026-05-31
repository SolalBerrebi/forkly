# Contributing to Forkly

Thanks for considering a contribution! Forkly is built in the open, and the goal is to make it the most beautiful and useful way to explore LLM conversations as a spatial canvas.

## Getting set up

Prerequisites: Node 22+, pnpm 9+, Rust 1.80+, and the Tauri CLI.

```bash
git clone https://github.com/SolalBerrebi/forkly
cd forkly
pnpm install
pnpm tauri dev
```

If `pnpm` isn't installed, enable it via `corepack enable && corepack prepare pnpm@latest --activate`.

## Project layout

- `src/` — React + TypeScript frontend (Vite)
- `src-tauri/` — Rust backend (Tauri 2)
- `src-tauri/src/providers/` — LLM provider implementations (Anthropic, OpenAI, Ollama, …)
- `src/canvas/` — xyflow nodes, edges, background
- `src/chat/` — message rendering, composer
- `docs/` — architecture and provider plugin guide

Architecture overview lives in [`docs/architecture.md`](docs/architecture.md). Adding a new LLM provider? See [`docs/providers.md`](docs/providers.md).

## Good first issues

Look for issues tagged `good-first-issue`. New provider implementations (Mistral, Cohere, Groq, OpenRouter, etc.) are excellent starting points — the trait is small and there's a worked example in `providers/anthropic.rs`.

## Coding conventions

- TypeScript: strict mode, no `any` without a good reason. Prefer named exports.
- Rust: `cargo fmt` + `cargo clippy --all-targets` clean before pushing.
- Commits: conventional commits style (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Keep PRs focused — one logical change per PR.

## Developer Certificate of Origin (DCO)

Forkly uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. Every commit must be signed off:

```bash
git commit -s -m "feat: add Mistral provider"
```

The `-s` flag adds a `Signed-off-by:` trailer to your commit message, attesting that you wrote the code (or have the right to submit it) and that you're submitting it under the project's license terms. CI will reject PRs whose commits aren't signed off.

If you forgot to sign off, you can rewrite the trailing commits with:

```bash
git rebase --signoff HEAD~<n>
```

## License

Forkly is dual-licensed under either:

- [Apache License, Version 2.0](LICENSE-APACHE), or
- [MIT license](LICENSE-MIT)

at your option.

### Contribution licensing

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
