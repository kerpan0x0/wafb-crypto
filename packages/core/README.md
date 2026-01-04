
# @wabf/core

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

Core library for **WABF** (The WebADB Forensics Bridge) - An androidqf-compatible triage tool for browser-based Android forensic acquisition.

## Features

- 🔌 Direct USB connection via WebUSB API (no drivers needed)
- 📱 Full ADB command interface
- 🔐 Automatic device authentication
- 📊 Comprehensive device information extraction
- 🔄 Automatic retry and error handling
- 📝 Structured logging system
- 🧪 Fully tested with high coverage
- 🔧 androidqf-compatible workflows

## Installation

```bash
pnpm add @wabf/core
```

## Quick Start

```typescript
import { ADBConnection, Logger } from '@wabf/core';

// Enable debug logging
Logger.setLogLevel('debug');

// Create connection
const connection = new ADBConnection();

try {
  // Connect to device
  const device = await connection.connect();
  
  console.log('Connected to:', device.info.productName);
  
  // Get device properties
  const props = await device.getProperties();
  console.log('Android version:', props.androidVersion);
  console.log('Model:', props.model);
  
  // Check if rooted
  const isRooted = await device.isRooted();
  console.log('Device rooted:', isRooted);
  
  // Get battery info
  const battery = await device.getBatteryInfo();
  console.log('Battery level:', battery.level + '%');
  
  // List installed packages
  const packages = await device.commands.listPackages();
  console.log('Installed apps:', packages.length);
  
  // Get system logs
  const logs = await device.commands.getLogcat({ maxLines: 100 });
  console.log('Recent logs:', logs);
  
  // Disconnect
  await device.disconnect();
  
} catch (error) {
  console.error('Error:', error);
}
```

## Project Information

**WABF** (The WebADB Forensics Bridge) is an androidqf-compatible triage tool that brings mobile forensic acquisition capabilities directly to the browser, eliminating the need for local driver installations.

- **Repository**: https://git.lattuga.net/garrett/WABF.git
- **License**: GPL-3.0
- **Author**: garrett

## API Reference

See full documentation at [docs/api/README.md](../../docs/api/README.md)

### Core Classes

- `ADBConnection` - Manages USB/ADB connections
- `ADBDevice` - Represents connected Android device
- `ADBCommands` - Execute ADB commands
- `Logger` - Structured logging system

### Error Types

- `ADBError` - Base error class
- `ADBConnectionError` - Connection failures
- `ADBDeviceNotFoundError` - Device not found/selected
- `ADBCommandError` - Command execution failures

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build
pnpm build
```

## Browser Compatibility

- ✅ Chrome 61+
- ✅ Edge 79+
- ✅ Opera 48+
- ❌ Firefox (WebUSB not supported)
- ❌ Safari (WebUSB not supported)

## Requirements

- Node.js 18 or higher
- Modern browser with WebUSB support
- Android device with USB debugging enabled

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](../../docs/contributing.md)

## License

GPL-3.0 - See LICENSE file

## Acknowledgments

- Built on [@yume-chan/adb](https://github.com/yume-chan/ya-webadb)
- Inspired by [androidqf](https://github.com/mvt-project/androidqf) from Amnesty International

---

**⚠️ Legal Notice**: This tool is intended for legitimate forensic investigations only.
