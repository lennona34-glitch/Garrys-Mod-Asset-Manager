# Garry's Mod Map & Asset Manager

[![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)](https://github.com/lennona34-glitch/Garrys-Mod-Asset-Manager)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Framework](https://img.shields.io/badge/electron-v44-9cf.svg)](https://www.electronjs.org/)

A modern, high-performance desktop application built to inspect, diagnose, optimize, manage, and launch **Garry's Mod** maps, workshop addons, base frameworks, and configurations effortlessly with zero terminal commands needed.

---

## 🌟 Key Features

### 1. 🗺️ Unified Maps Hub
- **Universal Map Discovery**: Catalogs native loose `.bsp` files in `garrysmod/maps` and maps packaged inside Steam Workshop `.gma` archives.
- **Embedded Workshop Screenshot Extractor**: Deep-scans inside `.gma` workshop archives to automatically extract embedded level previews (`maps/thumb/<map>.png`), ensuring maps like Sprunki and community levels display high-res previews instead of blank banners.
- **Smart Gamemode Badges**: Automatically categorizes maps by prefix (`gm_` Sandbox, `ttt_` Trouble in Terrorist Town, `rp_` Roleplay, `ph_` Prop Hunt, `dr_` Deathrun, `zs_` Zombie Survival, Horror, etc.).
- **5-Column Modern Grid & Zen Mode**: Clean, responsive high-density map grid with fullscreen toggle (<kbd>F11</kbd>).
- **Direct Quick Launch & Auto-Extraction**: Automatically extracts maps on-the-fly when launching via the Steam protocol to prevent Source engine `map not found` startup errors.

### 2. 🤖 Zero-Terminal NavMesh Autopilot
- **1-Click AI NavMesh Generation**: No console opening, no typing `sv_cheats 1`, `nav_mark_walkable`, or `nav_generate`. Click **"Generate NavMesh"** in the app, and a temporary Lua bridge automatically orchestrates generation upon map load.
- **Multi-Layered Completion Feedback**:
  - **In-Game Audio Chime**: Plays a victory sound (`save_load1.wav`) when the generation finishes and the level reloads.
  - **HUD Popups**: Center-screen broadcast and bottom-right green notifications confirm that Nextbots and NPCs can now navigate the map.
  - **Desktop App Notification & Live Badge Flip**: The desktop app watches the filesystem in real time, alerts you when the `.nav` file is finalized on disk, and flips the map badge from red to green.

### 3. 🩺 Addon Doctor & Diagnostics
- **Texture & Content Detection**: Scans for Counter-Strike: Source (CS:S) texture mounts and workshop fix packs to resolve purple checkerboard textures and red ERROR models.
- **Addon Conflict Resolver**: Detects duplicate packs and entity collisions with 1-click safe resolution (`.disabled` state preserves files with instant undo).
- **Base Framework Detection**: Detects missing weapon and vehicle frameworks (TFA Base, ARC9, simfphys, VJ Base, DrGBase) with 1-click Steam subscriptions.
- **Curated Asset Hub**: Direct recommendations and 1-click Steam Workshop links for weapons, cars, and SNPCs matching your installed frameworks.

### 4. 📦 Assets & Addons Manager
- **Complete Mod Inventory**: Scans and catalogs all installed workshop and legacy addons.
- **Instant Enable / Disable Toggle**: Toggle individual addons or use bulk controls. Works by cleanly renaming to `.gma.disabled` so GMod skips loading without un-subscribing.
- **Pure JS GMA Binary Parser**: Fast custom parser reads internal file hierarchies, file paths, CRCs, and exact byte sizes without requiring full extraction.
- **GMAD Unpacker**: One-click extraction using GMod's bundled `bin/gmad.exe` into editable folders.
- **Pack Folder to GMA**: Create custom `.gma` archives from any folder.

### 5. ⚡ Presets & Loadout Switcher
- Save your active addon configurations into named presets (e.g., "Minimal Vanilla", "TTT Night", "Sandbox Props & Build", "Horror / Nextbots").
- Switch profiles in one click before booting Garry's Mod.

### 6. 🌐 Native Steam Desktop Client Integration
- Bypasses browser login walls by routing all Steam Workshop items, collections, bases, and asset queries directly into your logged-in desktop Steam client (`steam://openurl/...`).

### 7. 🧹 Storage & Cache Cleaner
- Analyzes disk space consumed by addons, maps, and multiplayer server cache (`garrysmod/download/`).
- One-click safe cache cleaner to reclaim gigabytes of SSD space without touching subscribed mods.

---

## 🚀 Getting Started

### Prerequisites
- **Windows 10 / 11**
- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- **Garry's Mod** installed on Steam

### Installation & Launch

1. **Clone the repository:**
   ```bash
   git clone https://github.com/lennona34-glitch/Garrys-Mod-Asset-Manager.git
   cd Garrys-Mod-Asset-Manager
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Launch the application:**
   ```bash
   npm start
   ```
   *Alternatively, double-click `Launch GMod Manager.bat` on Windows.*

---

## 💻 Tech Stack
- **Electron**: Lightweight desktop application runtime
- **Node.js**: Asynchronous file system operations, binary stream parsing, and child process automation
- **Custom GMA Binary Parser**: Ultra-fast pure JavaScript parser for Valve's Garry's Mod Addon (`.gma`) format
- **HTML5 / CSS3 / Vanilla JS**: Responsive dark-themed interface with zero heavyweight frontend dependencies

---

## 📄 License
MIT License. Free to use, modify, and distribute.
