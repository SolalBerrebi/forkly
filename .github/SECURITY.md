# Security Policy

Forkly is a local-first desktop app: your conversations live in a SQLite
database under your OS app-data directory, API keys live in your OS keychain,
and the only outbound network calls are to the LLM providers you explicitly
choose. We take that trust model seriously.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Preferred: use GitHub's private reporting — **Security → [Report a vulnerability](https://github.com/SolalBerrebi/forkly/security/advisories/new)** on the repo. If you'd rather email, use **security@forkly.app**.

Include:

- a description of the issue and its impact,
- steps to reproduce (a proof-of-concept is ideal),
- the Forkly version (shown in the top-left pill) and your OS.

You'll get an acknowledgement within **72 hours**. We'll work with you on a fix
and coordinate a disclosure timeline — typically a patch release within 14 days
for confirmed high-severity issues, sooner when practical. We're happy to credit
you in the release notes unless you'd prefer to stay anonymous.

## Scope

In scope:

- Leakage of API keys, OAuth tokens, or conversation data.
- Arbitrary file read/write or code execution via the app (including through
  rendered LLM output, imported sessions, or the IPC bridge).
- Bypasses of the network-log transparency (a call that doesn't appear, or a
  secret that appears unmasked).

Out of scope:

- Vulnerabilities in the upstream LLM providers or their CLIs (`claude`,
  `codex`, Ollama) themselves.
- Issues that require a pre-compromised machine or a malicious local user with
  filesystem access (they can already read the SQLite DB and keychain).

## Supported versions

Forkly is pre-1.0 and ships from `main`. Security fixes land on the latest
release; please upgrade before reporting against an older build.
