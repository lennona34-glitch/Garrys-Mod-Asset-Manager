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

### 3. 🎨 2D Character & NextBot Asset Studio
- **Beginner-Friendly Modding**: Pick any downloaded 2D character/NextBot addon (or start from scratch), swap in your own photo, zoom/pan/rotate (`90°` steps) to fit, and customize movement speed, jump behavior, and health.
- **Smart Cutout & Visual Filters**: 1-click **Auto Remove Background** (magic wand corner flood-fill + feathering), **Face Oval / Circle Cutout**, and **Dramatic Black & White / High-Contrast Noir** filters.
- **Built-in Voicemod & Chase Audio Studio**: Swap in custom chase music, restore default or silent audio, or record your own microphone straight in the app with real-time voice effects (**Monster / Demon**, **Robot**, **Chipmunk**, **Megaphone / Radio**, **Haunted Echo**).
- **Non-Overlapping Audio Lifecycle**: Automatically stops chase loops on entity removal/cleanup or when spawning multiple copies so tracks never stack over each other.
- **1-Click Install & Steam Workshop Publishing**: Save directly into `garrysmod/addons` for instant local play or package and publish to Steam Workshop.

### 4. 📦 9-Section Assets & Addons Manager
- **Smart 9-Category Classification**: Automatically organizes all installed `.gma` and legacy `.bin` Workshop packages plus local studio creations into collapsible sections:
  - **🎨 2D Studio Characters**, **🎮 Gamemodes**, **🤖 NPCs & NextBots**, **🔫 Weapons**, **🚗 Vehicles**, **🧍 Models & Playermodels**, **✨ Effects & Realism**, **🛠️ Tools & Utilities**, and **🗺️ Maps & NavMeshes**.
- **Per-Section Enable / Disable**: Enable or disable an entire section (e.g., just Weapons or just NPCs) in a single atomic `addonnomount.txt` write—keeping Garry's Mod boot times fast and graphics running at full performance without loading hundreds of unused addons at once.
- **Pure JS GMA Binary Parser & GMAD Unpacker**: Inspect internal files, unpack `.gma` archives, or pack folders into `.gma` format.

### 5. 🌐 Host & Join Private / Local Multiplayer Hub
- **1-Click Private Server Hosting**: Launch a local LAN or Friends-Only Steam P2P (`+p2p_enabled 1`) game with custom map, gamemode, max players, and server password.
- **UDP LAN Server Scanner**: Automatically discovers active Garry's Mod servers on your local network via Valve `A2S_INFO` queries for 1-click joining.

### 6. 🎮 Wireless Controller & Gamepad Tuning
- **Zero-Drift Deadzone & Sensitivity Profiles**: Tune analog stick deadzones, turn speed, aim assist, and trigger behavior (`arc9_cruelty_reload 0` to prevent accidental left-trigger stutter) with automatic persistence to `autoexec.cfg`.

### 7. 🩺 Addon Doctor & Diagnostics
- **Texture & Content Detection**: Scans for Counter-Strike: Source (CS:S) texture mounts and workshop fix packs to resolve purple checkerboard textures and red ERROR models.
- **Addon Conflict & Crash Resolver**: Detects duplicate packs, entity collisions, and known Lua hook conflicts (such as GCAL vs. VManip) with 1-click safe resolution.
- **Base Framework Detection**: Detects missing weapon and vehicle frameworks (TFA Base, ARC9, simfphys, VJ Base, DrGBase) with 1-click Steam subscriptions.

### 8. ⚡ Presets, Native Steam Integration & Cache Cleaner
- **Loadout Presets**: Save and switch active addon profiles in one click.
- **Native Steam Client Routing**: Opens Workshop items and uploads directly inside your logged-in Steam desktop client (`steam://openurl/...`).
- **Storage & Cache Cleaner**: Reclaim disk space from `garrysmod/download/` and unused caches safely.

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
