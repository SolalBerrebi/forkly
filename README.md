<div align="center">
  <h1><code>forkly</code></h1>
  <p><strong>A spatial canvas for LLM conversations.</strong></p>
  <p>Fork from any message. Branch into different providers. Visualize how your thinking evolves.</p>

  <p>
    <a href="https://github.com/forkly/forkly/blob/main/LICENSE-MIT"><img alt="MIT or Apache-2.0" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-7C5CFF"></a>
    <img alt="Status" src="https://img.shields.io/badge/status-pre--alpha-orange">
    <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-5B8DEF">
  </p>

  <p>
    <em>Pre-alpha. Not yet a public release. <a href="#roadmap">See roadmap</a>.</em>
  </p>
</div>

---

> Today, LLM conversations are linear: one chat, one thread, one model.
> Forkly turns them into a **spatial canvas** — every session is a box, every fork is a branch, every node can use a different model.

## Why Forkly?

- **Prompt exploration** — four different system prompts on the same starter, all four branches streaming side by side.
- **Model comparison** — identical context, fork into Claude, GPT, and a local model. Read all three answers on one canvas.
- **Recovery from bad turns** — realize the assistant went off-rails six messages ago? Fork from message six, retry, keep the original branch as discarded lineage.
- **Reasoning trees** — for research or agentic workflows, each fork explores a sub-question. Your canvas becomes the thinking artifact.

## How it feels

Demo GIF coming with `v0.1.0`. The viral demo:

1. Start a new session, type a question.
2. Hover any message, press **`4`** → four sibling forks fan out and stream their own variants in parallel.
3. Marquee-select the forks, press **`M`** → a merge node fans in and synthesizes their best-of into one response.
4. Zoom out → nodes collapse to compact cards, then to bare labels — the whole tree stays scannable.

## Auth

Two ways to talk to Claude:

- **Claude Code (primary)** — uses your `claude.ai` Pro / Max / Team subscription via the `claude` CLI. No API charges, no key management. One-line install:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude login
  ```
- **Anthropic API key (advanced)** — pay-per-token, useful for orgs. Stored in the OS keychain, never on disk.

OpenAI / Gemini / Ollama support is on the roadmap (`M5`).

## Roadmap

Forkly is being built in milestones. Status as of `pre-alpha`:

- [x] **M0** — Scaffold (Tauri 2 + React 19 + Vite, dual MIT/Apache-2.0 license, DCO)
- [x] **M1** — Canvas shell with xyflow + cross-grid background, light/dark theme
- [x] **M2** — Single-session chat with both Claude Code (subscription) and API-key transports
- [x] **M3** — Forking, fan-out (`2`–`9`), merge nodes (`M`), auto-titling
- [x] **M4** — Zoom-dependent rendering (full chat → compact card → label)
- [x] **M6** — Delete sessions, workspaces ("pages / sheets"), tooltips, node animations, release pipeline
- [ ] **M5** — OpenAI + Ollama providers, per-node provider switching
- [ ] **v0.1.0** — Signed macOS builds, demo workspace on first launch, hero GIF, public release

## Install

Not yet — coming with **v0.1.0** via signed `.dmg` (macOS), `.msi` (Windows), and `.AppImage` / `.deb` (Linux) on the [Releases page](https://github.com/forkly/forkly/releases).

## Development

Prereqs: **Node 20+**, **pnpm 9+** (or `corepack enable`), **Rust 1.80+**, **Tauri CLI 2**.

```bash
git clone https://github.com/forkly/forkly
cd forkly
pnpm install
pnpm tauri dev
```

If `claude` isn't on your PATH, install it first (`npm i -g @anthropic-ai/claude-code` then `claude login`) — that's the primary auth path. Otherwise, open Settings → expand "api keys" and paste an Anthropic key.

See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout, conventions, and DCO sign-off requirements.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `2`–`9` (hovering a message) | Fan out N parallel sibling forks |
| `M` (with 2+ nodes selected) | Spawn a merge node that synthesizes them |
| `Delete` / `Backspace` (with nodes selected) | Delete sessions (with confirmation) |
| `Enter` (in composer) | Send |
| `Shift+Enter` (in composer) | Newline |

## Trust

Forkly is **local-first**. Your conversations live in a SQLite database under your OS app-data directory. The only network calls Forkly makes are to the LLM providers you choose. No telemetry, no analytics, no cloud sync. Ever, unless you opt in.

API keys are stored in your OS keychain, never in plaintext config. The Claude Code transport uses the `claude` CLI's own OAuth tokens — Forkly never sees them.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.

Includes [`@xyflow/react`](https://github.com/xyflow/xyflow) (MIT) — the canvas runtime — and other dependencies listed in `package.json`.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
