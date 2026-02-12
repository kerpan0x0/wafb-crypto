# WAFB – WebADB Forensics Bridge

**WAFB** is a browser‑based forensic triage tool for Android devices.  
It uses **WebUSB** to connect directly to your device – **no ADB server, no drivers, no installation**.

🔗 **Try the live demo**: [https://wafb.jamme.la](https://wafb.jamme.la)

---

## ✨ Features

- Connect to any Android device with USB debugging enabled
- Acquire **16+ forensic artifacts** in a single session:
  - Bugreport, dumpsys, logcat, system logs
  - Installed packages, running processes, system services
  - SELinux state, mount points, environment variables
  - Root binaries, temporary files, full file listing (with hashes)
  - Device info, battery, network, storage, memory, sensors
- All results bundled into one **timestamped ZIP** with JSON manifest
- Works entirely in the browser – **no data leaves your machine**
- [MVT](https://docs.mvt.re/en/latest/) compliance for acquisition analysis
- Responsive UI – adapts to any screen size

---

## ⚙️ Requirements

- **Browser**: Chrome or Edge (WebUSB support required)
- **Android device**: USB debugging enabled (Settings → Developer options)
- **USB cable**: connected to your computer
- **ADB**: desktop ADB server **must be stopped**  
  (`adb kill-server` – otherwise WebUSB cannot claim the device)

---

## 🚀 Quick Start (Development)

```bash
# 1. Clone the repository
git clone https://git.lattuga.net/garrett/wafb.git
cd wafb

# 2. Install dependencies
pnpm install

# 3. Build core and start dev server
pnpm start

# 4. Open http://localhost:3000
```

## 📁 Project Structure

```text
wafb/
├── packages/
│   ├── core/          # ADB communication, forensic acquirers, shared utils
│   ├── web/           # React + Tailwind frontend (Vite)
│   └── cli/           # (planned) CLI counterpart
├── scripts/           # Version utilities, build helpers
├── package.json       # Root – workspace orchestration
└── turbo.json         # Turborepo pipeline configuration
```

## ⚠️ Warning – Sensitive Data

**WAFB extracts forensic artifacts directly from your Android device.**  
The acquired data may contain **personally identifiable information (PII)**, including but not limited to:

- Contacts, messages, call logs
- Installed applications and usage history
- Location data, Wi‑Fi passwords, account tokens
- System logs and diagnostic dumps (may contain device identifiers, IP addresses, recent activity)

**You are solely responsible for how you handle this data.**  
- Always treat extracted archives as **highly confidential**.  
- Never share acquisition results publicly or with unauthorised parties.  
- Delete local copies immediately after analysis.  
- Ensure your storage and transfer methods are secure.

This tool is designed for **legitimate forensic investigations, security research, and personal device backups only**.  
Misuse may violate privacy laws and regulations. By using WAFB, you acknowledge these responsibilities.

## 🙏 Acknowledgments

- [@yume-chan/adb](https://github.com/yume-chan/ya-webadb) - WebADB implementation
- AndroidQF format specification

## 📄 License

GPL‑3.0 © 2026

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

## 👥 Authors

- garrett (@garrett)
- ntonjeta (@n)

Contributions are welcome – see the repository for open issues and merge requests.
