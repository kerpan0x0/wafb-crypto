# WebADB Forensics Bridge

[![pipeline status](https://gitlab.com/your-org/webadb-forensics-bridge/badges/main/pipeline.svg)](https://gitlab.com/your-org/webadb-forensics-bridge/-/commits/main)
[![coverage report](https://gitlab.com/your-org/webadb-forensics-bridge/badges/main/coverage.svg)](https://gitlab.com/your-org/webadb-forensics-bridge/-/commits/main)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

Browser-based Android forensic acquisition tool using WebADB technology. Eliminates the need for local driver installation and provides a cross-platform solution for mobile forensics.

## ⚠️ Legal Notice

This tool is intended for legitimate forensic investigations only. Users must:
- Have proper legal authorization to examine devices
- Comply with local laws and regulations
- Maintain chain of custody documentation
- Follow forensic best practices

## Features

- 🔌 Direct USB connection via WebUSB API
- 📱 Support for Android 5.0+
- 🔐 End-to-end data integrity verification (SHA-256, SHA-512, MD5)
- 📊 Comprehensive forensic acquisition
- 📄 Multiple export formats (JSON, PDF, UFED-compatible)
- 🔒 Optional encryption of acquired data
- 📝 Automated chain of custody documentation

## Quick Start

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
chmod +x scripts/setup.sh
./scripts/setup.sh

# Start development
pnpm dev
```

## GitLab CI/CD

This project uses GitLab CI/CD for:
- Automated testing
- Code quality checks
- Security scanning
- Docker image building
- Automated deployments

See `.gitlab-ci.yml` for pipeline configuration.

## Documentation

- 📖 [Full Documentation](https://git.lattuga.net/garrett/WABF.git)
- 🚀 [Getting Started](docs/guides/getting-started.md)
- 📝 [API Reference](docs/api/README.md)
- 🏗️ [Architecture](docs/architecture/overview.md)

## Contributing

See [CONTRIBUTING.md](docs/contributing.md) for contribution guidelines.

## License

GPL-3.0 - See [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built on [tango](https://github.com/yume-chan/ya-webadb) WebADB library
- Inspired by [androidqf](https://github.com/mvt-project/androidqf)