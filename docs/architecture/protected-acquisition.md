# Protected acquisition (thesis extension of WAFB 0.3.1)

This document describes the extension that turns WAFB's local collection into a
**protected delivery** to a remote analyst. Design rationale is in the thesis
(chapter 2); this file maps it to the code.

## Roles and flow

```
Analyst (page "Analyst")                 Acquirer (wizard / advanced page)
────────────────────────                 ─────────────────────────────────
generate X25519 identity (memory only)
self-test encrypt/decrypt
create invite  ──── link #invite=… ───▶  load invite, fragment removed from URL
communicate key ID ═ independent ══════▶ compare full 64-hex key ID → confirm
                     authenticated                (mismatch blocks the start)
                     channel             preflight (secure context, WebUSB, FS Access)
                                         connect phone, choose modules
                                         choose destination (save dialog)
                                         acquisition: ADB → SHA-256 → age → ZIP → file
                                         summary + delivery reference (archive SHA-256)
receive .zip     ◀──── any channel ────
receive delivery ref ◀═ authenticated ══
verify archive, extract verified artefacts
```

## Archive layout (format `wafb-protected-archive` v1)

| Entry | Content |
|---|---|
| `a000001.age`, `a000002.age`, … | one independent age v1 message per artefact (opaque names) |
| `manifest.age` | private manifest (JSON, schema `wafb-manifest` v1), age-encrypted |
| `wafb-archive.json` | public descriptor: format block only (no case, device or key data) |

Container: ZIP, STORE, ZIP64-ready streamed entries (data descriptor with
64-bit sizes), ZIP64 EOCD when needed. Sizes, entry count and timing remain
observable; no padding is applied.

## Code map

| Concern | File |
|---|---|
| Source outcome (EOF / idle / cancel / error + exit code) | `packages/core/src/utils/source-monitor.ts` |
| SHA-256 passthrough (digest always settles), rechunk, byte counter | `packages/core/src/utils/stream-helpers.ts` |
| ZIP64 writer (fail-closed) | `packages/core/src/utils/streaming-zip.ts` |
| ZIP64 reader for verification | `packages/core/src/utils/zip-reader.ts` |
| Recipient validation, key ID, verification states | `packages/core/src/protection/recipient.ts` |
| Invite (fragment, schema v1) | `packages/core/src/protection/invite.ts` |
| Streaming age encryption/decryption | `packages/core/src/protection/age-stream.ts` |
| Seal-on-source-failure, abortable stage | `packages/core/src/protection/pipeline.ts` |
| Manifest / descriptor schema | `packages/core/src/protection/manifest.ts` |
| Session coordinator (state machine, V = S∧H∧E∧W) | `packages/core/src/protection/session.ts` |
| Analyst verification and extraction | `packages/core/src/protection/verify.ts` |
| Shared acquirer table | `packages/web/src/lib/moduleTasks.ts` |
| UI state mirror | `packages/web/src/stores/sessionStore.ts` |
| Wizard / advanced / analyst pages | `packages/web/src/components/{acquisition,analyst,protection}/` |

## Key identifier

`K = hex(SHA-256(UTF-8("wafb-recipient-v1:" ‖ R)))`, with `R` the canonical
(lower-case) recipient. Shown in full, in 16 groups of 4; only a full match
confirms the recipient.

## Completion

Per artefact: `V = S ∧ H ∧ E ∧ W` (source ended acceptably, full digest,
encryption finalised, entry written). Session: `completed` only if every
requested module completed and the sink confirmed `close()`; otherwise
`partial`. `failed` and `cancelled` never produce a confirmed archive.

Error classes: **preflight** (no start) · **module** before writing (recorded,
continue) · **fatal** during encryption/write/finalisation (abort). A source
failure *during* streaming is contained: the entry is sealed, recorded as
`incomplete` with an explicit `partialDigest`, and the session continues.

## What the protection does and does not cover

- Covers reading of the archive by storage/transport intermediaries, and
  detection of modification/truncation against the manifest.
- Does **not** authenticate the sender: anyone knowing the public recipient can
  produce a coherent archive. Binding the archive to the session requires the
  delivery reference (archive SHA-256) sent over an authenticated channel.
- Does not protect against a compromised acquirer computer during collection.

## Running the checks

```bash
pnpm install
pnpm --filter @wafb/core test                     # unit + E2E (Python zipfile, age CLI if present)
WAFB_LARGE_TESTS=1 pnpm --filter @wafb/core exec vitest run tests/unit/utils/streaming-zip64.test.ts  # >4 GiB
pnpm --filter @wafb/core build && pnpm --filter @wafb/web build

# UI smoke test (headless Chrome + Playwright for Python)
pnpm --filter @wafb/web preview --port 4173 &
python3 -I packages/web/tests/e2e_smoke_ui.py

# Benchmarks (in-browser, OPFS sink)
cd packages/web && npx vite build --config vite.bench.config.ts && npx vite preview --config vite.bench.config.ts &
python3 -I bench/run_bench.py --out bench-results.json && python3 -I bench/analyze.py bench-results.json
```
