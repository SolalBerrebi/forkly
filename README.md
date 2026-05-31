<div align="center">
  <img src="assets/logo/wordmark.svg" alt="Forkly" height="64" />

  <h3>Figma for LLM conversations.</h3>
  <p>A spatial canvas for forking, branching, and mixing models on one infinite board.</p>

  <p>
    <a href="https://github.com/SolalBerrebi/forkly/blob/main/LICENSE-MIT"><img alt="MIT or Apache-2.0" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-7c5cff?style=flat-square"></a>
    <img alt="Status" src="https://img.shields.io/badge/status-pre--alpha-orange?style=flat-square">
    <img alt="Built with Tauri" src="https://img.shields.io/badge/Tauri-2-5b8def?style=flat-square">
    <img alt="Claude · GPT · Gemini · Ollama" src="https://img.shields.io/badge/Claude%20·%20GPT%20·%20Gemini%20·%20Ollama-supported-a78bfa?style=flat-square">
  </p>

  <p><em>Pre-alpha — not yet a public release. <a href="#roadmap">See roadmap</a>.</em></p>
</div>

---

> Today, LLM conversations are linear: one chat, one thread, one model. Every interesting answer should be a fork in the road — instead it's a dead end.
>
> Forkly turns conversations into a **spatial canvas**. Every session is a card. Every reply can fork. Every node can run on a different model. Lineage threads show you the shape of how you thought through a problem.

## What you can do

- **Compare models on the same context.** Fork your Claude conversation into GPT and Gemini at the same message — three answers race on identical input.
- **Fan out.** Hover any message, press `2`–`9`, get N siblings streaming in parallel.
- **Merge.** Marquee-select sibling branches, hit `M`, get a synthesis node that distills their best-of into one reply.
- **Mix providers per cell.** Claude Code → GPT via Codex → Gemini via AI Studio → local Llama via Ollama, all in one workspace.
- **Recover from bad turns.** Realize the assistant went off-rails six messages ago? Fork from there, retry, keep the original branch as a discarded lineage you can read back later.
- **Read your tree at every zoom.** Pan out and cells collapse to labels; pan in and you're back inside the chat. Forkly is the same product at 1× and at 0.2×.

## Providers

Forkly speaks to four model families today, each with a **subscription path** (no API key, uses your existing plan) and an **API-key path** for the API tier:

| Provider | Subscription transport | API key transport |
|---|---|---|
| **Anthropic** · Claude | `claude` CLI (Claude Code subscription) | `/v1/messages` with `sk-ant-…` |
| **OpenAI** · GPT | `codex` CLI (ChatGPT Plus / Pro / Business) | `/v1/chat/completions` with `sk-…` |
| **Google** · Gemini | — (AI Studio free tier covers most use cases) | `streamGenerateContent` with `AIza…` |
| **Ollama** · local | n/a (it's already free + local) | `localhost:11434/api/chat` |

First launch detects what's already on your machine — Claude Code, Codex CLI, a running Ollama daemon — and asks you to pick one. The Gemini AI Studio walkthrough is the universal fallback: 30 seconds, no install, 1,000 free requests per day on Flash. **No API key is ever shipped in the binary** — the free path lives on your account, not ours.

## How it looks

> Demo GIF coming with `v0.1.0`. The recording will show: a Claude session forking into GPT, GPT forking into Gemini, all three streaming in parallel, then a merge node fanning the three back in for a best-of synthesis.

## Install

### Run from source (open-source path)

Forkly is meant to be cloneable. If you have Node + Rust + the Tauri prereqs, you're three commands from a running app:

```bash
git clone https://github.com/SolalBerrebi/forkly && cd forkly
pnpm install
pnpm tauri dev
```

Prereqs:

| | Version | One-liner |
|---|---|---|
| Node | 22+ | [`nvm install 22`](https://github.com/nvm-sh/nvm) |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Rust | 1.80+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Tauri prereqs | varies | [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |

When the app boots, the onboarding modal asks you which model you want to use. Pick **Claude Code** or **ChatGPT** and Forkly will offer to open Terminal with the install + login script ready — you hit enter once and watch it work. No manual copy-paste, no leaving the app to figure out which package manager you have.

If you'd rather paste a key, expand `Settings → API keys`. Anthropic / OpenAI / Google are all there.

### Signed binaries (for non-developers)

Coming with **v0.1.0** via signed `.dmg` (macOS), `.msi` (Windows), and `.AppImage` / `.deb` (Linux) on the [Releases page](https://github.com/SolalBerrebi/forkly/releases).

## Trust

Forkly is **local-first**. Your conversations live in a SQLite database under your OS app-data directory. The only network calls Forkly makes are to the LLM providers you choose — and every one of them appears in the in-app network log (`⌘⇧N`) with masked credentials and the raw upstream call. No telemetry, no analytics, no cloud sync. Ever, unless you opt in.

- API keys live in your OS keychain via the `keyring` crate. Never plaintext, never on disk.
- CLI transports (Claude Code, Codex) use the CLIs' own OAuth tokens. Forkly never sees them.
- The Ollama path doesn't leave your machine at all.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `2`–`9` (hovering a message) | Fan out N parallel sibling forks |
| `M` (with 2+ nodes selected) | Spawn a merge node that synthesizes them |
| `Delete` / `Backspace` (with nodes selected) | Delete sessions (with confirmation) |
| `⌘⇧L` | Auto-reorganize unlocked cells into a clean tree |
| `⌘⇧N` | Toggle the network log drawer |
| `Enter` (in composer) | Send |
| `Shift+Enter` (in composer) | Newline |

## Roadmap

Forkly is being built in milestones. Status as of `pre-alpha`:

- [x] **M0** — Scaffold (Tauri 2 + React 19 + Vite, dual MIT/Apache-2.0 license, DCO)
- [x] **M1** — Canvas shell with xyflow + grid background, light/dark theme that follows the OS
- [x] **M2** — Single-session chat: Claude Code (subscription) + Anthropic API key transports
- [x] **M3** — Forking, fan-out (`2`–`9`), merge nodes (`M`), auto-titling
- [x] **M4** — Zoom-dependent rendering (full chat → label)
- [x] **M5** — _multi-provider groundwork (folded into M8, which shipped OpenAI / Google / Ollama)_
- [x] **M6** — Workspaces ("pages / sheets"), delete with confirm, tooltips, release pipeline
- [x] **M7** — Per-cell info chips, resizable cells, dagre auto-layout, network log drawer, live-linked Claude Code session import, per-cell appearance toggle (terminal ↔ chat)
- [x] **M8** — OpenAI (Codex CLI + API), Google (Gemini API + free walkthrough), Ollama (local), cross-LLM fork picker, first-launch onboarding
- [ ] **v0.1.0** — Signed macOS builds, demo workspace on first launch, hero GIF, public release
- [ ] **v0.2** — Tool calls visualization, file attachments, export canvas as PNG / standalone HTML

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout, conventions, and the DCO sign-off requirement.

Forkly enforces a [Developer Certificate of Origin](https://developercertificate.org/) on every commit (`git commit -s`). No CLA — DCO is lighter-weight and contributor-friendly, but every commit must carry the `Signed-off-by:` trailer.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.

Includes [`@xyflow/react`](https://github.com/xyflow/xyflow) (MIT) — the canvas runtime — and other dependencies listed in `package.json` and `src-tauri/Cargo.toml`.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
