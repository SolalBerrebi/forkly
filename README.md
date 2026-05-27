<div align="center">
  <h1><code>forkly</code></h1>
  <p><strong>A spatial canvas for LLM conversations.</strong></p>
  <p>Fork from any message. Branch into different providers. Visualize how your thinking evolves.</p>

  <p>
    <em>Status: pre-alpha — M0 scaffold. Not yet usable. <a href="#roadmap">See roadmap</a>.</em>
  </p>
</div>

---

> Today, LLM conversations are linear: one chat, one thread, one model.
> Forkly turns them into a **spatial canvas** — every session is a box, every fork is a branch, every model can be different.

## Why Forkly?

- **Prompt exploration** — try four different system prompts on the same starter, see all four branches side by side.
- **Model comparison** — identical context, fork into Claude, GPT, and a local model. Read all three answers on one canvas.
- **Recovery from bad turns** — realize the assistant went off-rails six messages ago? Fork from message six, retry, keep the original branch as discarded lineage.
- **Reasoning trees** — for research or agentic workflows, each fork explores a sub-question. Your canvas becomes the thinking artifact.

## Roadmap

Forkly is being built in milestones. The full plan lives at [`docs/PLAN.md`](docs/PLAN.md) (TBD — copied from the planning session).

- [x] **M0** — Scaffold (Tauri 2 + React 19 + Vite, dual MIT/Apache-2.0 license, DCO)
- [ ] **M1** — Canvas shell with xyflow + cross-grid background, light/dark theme
- [ ] **M2** — Single-session chat with Anthropic provider (streaming, persisted to SQLite)
- [ ] **M3** — Forking, fan-out, merge nodes, auto-titling
- [ ] **M4** — Zoom-dependent rendering (full chat → compact card → dot)
- [ ] **M5** — OpenAI + Ollama providers, per-node provider switching
- [ ] **M6** — Polish, demo workspace, signed builds, first release

## Install

Not yet — coming with v0.1.0.

## Development

Prereqs: Node 20+, pnpm 9+ (or `corepack enable`), Rust 1.80+, Tauri CLI 2.

```bash
git clone https://github.com/forkly/forkly
cd forkly
pnpm install
pnpm tauri dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout, conventions, and DCO sign-off requirements.

## Trust

Forkly is **local-first**. Your conversations live in a SQLite database on your machine. The only network calls Forkly makes are to the LLM providers you choose (Anthropic, OpenAI, etc.) — and you'll be able to see every one of them in the built-in network log. No telemetry, no analytics, no cloud sync. Ever, unless you opt in.

API keys are stored in your OS keychain, never in plaintext config.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
