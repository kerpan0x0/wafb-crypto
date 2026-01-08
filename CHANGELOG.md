# Changelog

All notable changes to WAFB (WebADB Forensics Bridge) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha] - 2026-01-08

### ✨ Initial Proof of Concept (POC)
- First functional implementation of the WebADB Forensics Bridge (WAFB).
- **androidqf-compatible** acquisition engine for mobile forensics.
- Monorepo architecture managed via **Turborepo** (`@wafb/core`, `@wafb/web`, `@wafb/cli`).
- Web interface default port established on **3000**.

### Added
- **Forensic Acquisition & Triage:**
  - **Bugreport Acquisition:** Automated extraction and download of comprehensive Android diagnostic bugreports.
  - **Device Inventory:** Extraction of System Properties, Build metadata, and Package lists (system/third-party).
  - **Health Metrics:** Detailed battery service state monitoring (level, voltage, temperature).
  - **Root Analysis:** Advanced detection logic via `su` binary validation.
  - **Live Logs:** Real-time Logcat acquisition and streaming.
- **Connectivity:**
  - Driverless ADB communication via WebUSB (`@yume-chan/adb`).
  - Integrated command execution engine with robust timeout and error management.
- **Web UI:**
  - Modern dashboard built with React and Tailwind CSS.
  - Progress tracking for long-running acquisitions (bugreports).
  - Secure Context handling (HTTPS/Localhost) for WebUSB access.
- **Infrastructure:**
  - GitHub Actions CI for automated quality gates and Forgejo releases.
  - Comprehensive unit and integration test suite with Vitest.
  - Standardized structured logging system for forensic audit trails.