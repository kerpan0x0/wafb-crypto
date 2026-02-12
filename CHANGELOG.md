# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-02-12

### 🚀 Added

#### Forensic Acquisition Modules
- **`dumpsys` acquirer** – full system diagnostic dump (raw output) (#40)
- **`tmp` acquirer** – acquisition of temporary files from `/data/local/tmp` (#38)
- **`logs` acquirer** – system log files (ANR, kernel, pstore, uiderrors) (#36)
- **`files` acquirer** – complete file system listing with forensic metadata, optional SHA‑256 hashing (device or browser) (#35)
- **`services` acquirer** – list of active system services, enriched with PID, process name, and running/stopped state
- **`process` acquirer** – snapshot of running processes with PID, PPID, UID, SELinux context, and system/user classification
- **`settings` acquirer** – export of `global`, `system`, and `secure` settings via `cmd settings list` (#27)
- **`mount` acquirer** – combined mount points from `mount` and `/proc/mounts` (#23)
- **`selinux` acquirer** – mode, policy version, process contexts, file contexts, and denial log parsing (#24)
- **`env` acquirer** – environment variables dump (#7)
- **`rootBinaries` acquirer** – detection of `su`, `magisk`, `busybox`, and other root artifacts (#5)
- **`system_info` acquirer** – detailed device information (battery, network, storage, memory, sensors) (#6)

#### User Interface & Experience
- **Single ZIP bundle** – all selected acquisitions are now packed into one timestamped archive with a `manifest.json` containing metadata, hashes and acquisition summary (#41)
- **Responsive layout** – header and footer now share consistent width (`max-w-6xl`) and footer always sticks to bottom of viewport
- **Build version in footer** – displays `{package.json-version}-{short-commit}` (e.g. `0.2.0-a1b2c3d`) – unified across all environments

#### Development & Infrastructure
- **Version management** – centralised `scripts/version-utils.mjs`; Vite injects version dynamically; `pnpm version:sync` and `pnpm version:sync-dev` update all `package.json` files
- **CI/CD** – automated deployment to `https://wafb.jamme.la` on tag push
- **ESM‑safe version fallback** – uses `fs.readFileSync` + `JSON.parse` instead of `require` for CI environments without Git

### 🔧 Changed

- **Command pattern refactor** – all ADB interactions moved to dedicated `*Command` classes; acquirers consume them via the `ADBCommands` interface (#26, #18)
- **Acquisition workflow** – `AcquisitionPage` now uses a dynamic factory map, eliminating hard‑coded conditionals
- **Bugreport** – improved path parsing (regex + `OK:` prefix); cleanup tracking; idle timeout set to 3 minutes
- **Packages** – permission extraction, SDK version parsing, better heuristics for system app identification
- **Logcat** – added metadata header, statistics (error/warning counts), configurable buffer selection
- **File acquirer** – adaptive batching, device‑side hashing with fallback to browser `SubtleCrypto`, parallel folder scans, `maxHashFileSize` and `excludeHashPaths` options
- **Testing** – full test suites for all acquirers (≥80% coverage), centralised test helpers (`createMockADBDeviceWithCommands`, `setupAcquirerDOMMocks`)
- **Logger** – browser detection to avoid CSS formatting in Node/Vitest; improved log retention

### 🐛 Fixed

- **Bugreport cleanup** – now attempted even when acquisition fails (critical for forensic integrity)
- **ShellCommand** – added **idle timeout** (default 5s) to prevent hanging on devices that never close the stream
- **Store compatibility** – use `globalThis` instead of `window` for `__ACQUISITION_TYPES__` to support `happy-dom` test environment
- **Turbo cache** – removed from version control
- **ESLint / TypeScript** – resolved ESM/CJS conflicts in core package

### 📚 Documentation

- README completely overhauled with:
  - Quick start (clone, install, run)
  - Live demo link: [https://wafb.jamme.la](https://wafb.jamme.la)
  - Requirements and architecture overview
- CHANGELOG now follows "Keep a Changelog" format

---

## [0.1.0] - 2026-01-10

### 🚀 Added

#### Core Functionality
- **ADB over WebUSB** – device connection, authentication, shell commands, file transfer
- **Bugreport acquisition** – both legacy (`bugreport > file`) and modern (`bugreportz`) formats, with automatic fallback
- **Package listing** – `pm list packages` with optional system/user filtering
- **Logcat acquisition** – dump mode, buffer selection, line limits, priority filtering
- **Acquisition store** – Zustand-based state management for multi‑session triage

#### Web UI
- **React + TypeScript + Vite** application with Tailwind CSS
- **Device connection screen** – WebUSB picker, requirement checklist, error handling
- **Acquisition selection grid** – visual cards with icons, categories, progress bars
- **Session progress** – global progress bar, per‑acquisition status, completion summary
- **Automatic download** – individual files (ZIP for bugreportz, TXT for legacy)

#### Developer Experience
- **Monorepo structure** – `packages/core`, `packages/web`, `packages/cli` (scaffold)
- **Turborepo** – parallel task execution, caching
- **TypeScript project references** – strict type checking across packages
- **Husky + lint-staged** – pre‑commit linting and formatting

### 🔧 Changed

- N/A – initial release

### 🐛 Fixed

- N/A – initial release

### 📚 Documentation

- Initial README with project description, goals, and setup instructions
- GPL-3.0 license added

---

[0.2.0]: https://git.lattuga.net/garrett/wafb/compare/v0.1.0...v0.2.0
[0.1.0]: https://git.lattuga.net/garrett/wafb/releases/tag/v0.1.0
