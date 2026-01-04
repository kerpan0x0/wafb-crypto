
# WABF - The WebADB Forensics Bridge

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

**An androidqf-compatible triage tool** for browser-based Android forensic acquisition using WebADB technology.

Repository: https://git.lattuga.net/garrett/WABF.git

## 🎯 Project Overview

WABF (The WebADB Forensics Bridge) eliminates the need for local driver installation and provides a cross-platform solution for mobile forensics, bringing forensic capabilities directly to the browser.

### Key Features

- 🔌 Direct USB connection via WebUSB API (no drivers needed)
- 📱 Support for Android 5.0+
- 🔐 End-to-end data integrity verification
- 📊 Comprehensive forensic acquisition
- 🔧 androidqf-compatible workflows
- 📄 Multiple export formats
- 🔒 Optional encryption of acquired data
- 📝 Automated chain of custody documentation

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and pnpm 8+
- Chrome/Edge/Opera browser (WebUSB support required)
- Android device with USB debugging enabled

### Installation

```bash
# Clone repository
git clone https://git.lattuga.net/garrett/WABF.git
cd WABF

# Run setup script
chmod +x scripts/setup-wabf.sh
./scripts/setup-wabf.sh
```

### Usage

```bash
# Web interface (when available)
cd packages/web
pnpm dev

# CLI tool (when available)
cd packages/cli
pnpm start acquire --output ./evidence/case-001

# Core library
cd packages/core
pnpm test
```

## 📦 Project Structure

```
WABF/
├── packages/
│   ├── core/          # Core library (@wabf/core)
│   ├── cli/           # CLI tool (coming soon)
│   └── web/           # Web UI (coming soon)
├── docs/              # Documentation
├── scripts/           # Setup and utility scripts
└── README.md
```

## 📚 Documentation

- [Getting Started](docs/guides/getting-started.md)
- [Core API Documentation](packages/core/README.md)
- [Setup Guide](README-SETUP.md)
- [Commands Reference](COMMANDS.md)

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## 🧪 Testing with Real Device

1. Enable USB debugging on Android device
2. Connect device via USB
3. Run example:
   ```bash
   cd packages/core
   node examples/basic-connection.js
   ```
4. Select device in browser dialog
5. Authorize computer on device screen

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](docs/contributing.md)

## 📜 License

GPL-3.0 - See [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- Built on [@yume-chan/adb](https://github.com/yume-chan/ya-webadb) - WebADB implementation
- Inspired by [androidqf](https://github.com/mvt-project/androidqf) from Amnesty International
- Follows NIST guidelines for forensic standards compliance

## ⚠️ Disclaimer

**Legal Notice**: This tool is intended for legitimate forensic investigations only. Users must:
- Have proper legal authorization to examine devices
- Comply with local laws and regulations
- Maintain chain of custody documentation
- Follow forensic best practices

The authors are not responsible for misuse or any legal consequences arising from its use.

## 📞 Support

- 🐛 [Issue Tracker](https://git.lattuga.net/garrett/WABF/-/issues)
- 📖 [Documentation](https://git.lattuga.net/garrett/WABF/-/tree/main/docs)
- 💬 [Discussions](https://git.lattuga.net/garrett/WABF/-/discussions)

---

**WABF** - Making browser-based mobile forensics accessible
Repository: https://git.lattuga.net/garrett/WABF.git
