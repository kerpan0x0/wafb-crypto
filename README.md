# WAFB - WebADB Forensics Bridge

> An androidqf-compatible triage tool for Android forensic data acquisition via WebUSB

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D8.0.0-orange.svg)](https://pnpm.io/)

## ✨ Features

- 🔌 **WebUSB Integration** - Direct device connection from browser
- 📱 **Bugreport Acquisition** - Extract comprehensive Android diagnostic data
- 🎨 **Modern UI** - Clean, responsive interface built with React + Tailwind
- 🔒 **Browser-based** - No server required, runs entirely client-side
- 🚀 **Fast** - Optimized for quick triage scenarios
- 📦 **Modular** - Core library can be used independently

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Chrome or Edge browser (WebUSB support required)

### Installation

```bash
# Clone the repository
git clone https://git.lattuga.net/garrett/wafb.git
cd wafb

# Install dependencies
pnpm install

# Build core package
pnpm build:core
```

### Launch Web UI

**Method 1: Bash Script**
```bash
chmod +x start.sh
./start.sh
```

**Method 2: NPM Script**
```bash
pnpm start
```

**Method 3: Makefile**
```bash
make start
```

The web UI will open automatically at `http://localhost:3000`

## 📖 Usage

1. **Connect Device**: Ensure USB debugging is enabled on your Android device
2. **Stop ADB**: Run `adb kill-server` to avoid conflicts
3. **Launch UI**: Use any of the methods above
4. **Acquire**: Click "Start Acquisition" and select your device
5. **Download**: The bugreport will be automatically downloaded

## 📦 Project Structure

```
wafb/
├── packages/
│   ├── core/          # Core ADB library
│   │   ├── src/
│   │   │   ├── adb/           # ADB connection & commands
│   │   │   ├── utils/         # Utilities (logger, errors, streams)
│   │   │   └── index.ts
│   │   └── tests/
│   ├── web/           # React web UI
│   │   ├── src/
│   │   │   ├── components/    # React components
│   │   │   ├── hooks/         # Custom hooks
│   │   │   └── App.tsx
│   │   └── vite.config.ts
│   └── cli/           # CLI tool (future)
├── start.sh           # Bash launcher
├── Makefile           # Make commands
└── turbo.json         # Turborepo config
```

## 🛠️ Development

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm start` | Quick start - build core & run web |
| `pnpm dev` | Run all packages in dev mode |
| `pnpm dev:web` | Run only web UI |
| `pnpm dev:core` | Run only core in watch mode |
| `pnpm build` | Build all packages |
| `pnpm build:web` | Build only web package |
| `pnpm build:core` | Build only core package |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm format` | Format code with prettier |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm clean` | Clean all build artifacts |
| `pnpm preview` | Preview production build |

### Development Workflow

```bash
# First time setup
pnpm install
pnpm build:core

# Daily development
pnpm dev:web              # For UI-only changes
# or
pnpm dev                  # For full-stack development

# Before committing
pnpm lint:fix
pnpm format
pnpm test
pnpm build
```

## 🏗️ Architecture

### @wafb/core

Core library providing ADB connectivity and device management.

**Key Components:**
- `ADBConnection`: Manages WebUSB connection lifecycle
- `ADBDevice`: Device interface with property access
- `ADBCommands`: High-level command execution (shell, sync, etc.)
- Stream utilities for handling ADB data streams
- Custom error types and logging

**Example Usage:**
```typescript
import { ADBConnection } from '@wafb/core';

const connection = new ADBConnection();
const device = await connection.connect();
const props = await device.getProperties();
console.log(`Connected to ${props.model}`);
```

### @wafb/web

React-based web interface for forensic acquisition.

**Key Features:**
- Device connection UI
- Progress tracking
- Device information display
- Automatic bugreport download
- Error handling and recovery

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm --filter @wafb/core test:watch

# Run with coverage
pnpm --filter @wafb/core test:coverage

# Run integration tests (requires real device)
pnpm test:integration
```

## 📋 Requirements

### System Requirements
- **OS**: Linux, macOS, or Windows
- **Browser**: Chrome 61+ or Edge 79+ (WebUSB support)
- **Node.js**: 18.0.0 or higher
- **pnpm**: 8.0.0 or higher

### Device Requirements
- Android device with USB debugging enabled
- USB cable connection
- ADB authorization accepted on device

### Important Notes
- Desktop ADB server must be stopped (`adb kill-server`)
- HTTPS required for non-localhost domains
- WebUSB only works in secure contexts

## 🔧 Configuration

### Change Web UI Port

Edit `packages/web/vite.config.ts`:
```typescript
server: {
  port: 3001 // Your preferred port
}
```

### Customize Logging

```typescript
import { Logger } from '@wafb/core';

Logger.setLogLevel('debug'); // 'debug' | 'info' | 'warn' | 'error'
```

## 🐛 Troubleshooting

### Device Not Detected
1. Enable USB debugging on device
2. Accept ADB authorization prompt on device
3. Run `adb kill-server` to stop desktop ADB
4. Try disconnecting and reconnecting device

### Build Errors
```bash
# Clean and rebuild
pnpm clean
pnpm install
pnpm build
```

### Port Already in Use
```bash
# Kill process on port 3000
# Linux/Mac:
lsof -ti:3000 | xargs kill -9

# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## 🗺️ Roadmap

- [x] Core ADB library
- [x] WebUSB connection
- [x] Basic command execution
- [x] Bugreport acquisition
- [x] Web UI
- [ ] Advanced forensic modules
- [ ] Database acquisition
- [ ] Media file extraction
- [ ] Multiple export formats (PDF, JSON, UFED)
- [ ] Timeline analysis
- [ ] Artifact correlation
- [ ] CLI tool
- [ ] Encryption support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [@yume-chan/adb](https://github.com/yume-chan/ya-webadb) - WebADB implementation
- [Tango library](https://github.com/yume-chan/ya-webadb) - ADB protocol implementation
- AndroidQF format specification

## 📞 Support

- **Documentation**: See [QUICK_START.md](QUICK_START.md) for detailed setup
- **Issues**: Report bugs on the issue tracker
- **Discussions**: Join project discussions

## 🔐 Security

This tool is designed for legitimate forensic and debugging purposes. Users are responsible for ensuring they have proper authorization before accessing device data.

**Important**: Bugreports may contain sensitive information including:
- System logs
- Application data
- Network information
- Location data

Handle bugreports appropriately and in compliance with applicable laws and regulations.

---

**Author**: garrett  
**Repository**: https://git.lattuga.net/garrett/wafb.git  
**Version**: 0.1.0