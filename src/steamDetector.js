const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getSteamPathFromRegistry() {
    try {
        if (process.platform === 'win32') {
            const output = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const match = output.match(/SteamPath\s+REG_SZ\s+(.*)/i);
            if (match && match[1]) {
                const regPath = match[1].trim().replace(/\//g, '\\');
                if (fs.existsSync(regPath)) return regPath;
            }
        }
    } catch (e) {
        // Fallback
    }

    try {
        if (process.platform === 'win32') {
            const output = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const match = output.match(/InstallPath\s+REG_SZ\s+(.*)/i);
            if (match && match[1]) {
                const regPath = match[1].trim().replace(/\//g, '\\');
                if (fs.existsSync(regPath)) return regPath;
            }
        }
    } catch (e) {
        // Fallback
    }

    const defaultPaths = [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        'D:\\Steam',
        'D:\\SteamLibrary',
        'E:\\SteamLibrary'
    ];
    for (const p of defaultPaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function parseLibraryFolders(steamPath) {
    const libraries = [];
    if (!steamPath) return libraries;

    // Steam itself is always a library
    libraries.push(steamPath);

    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(vdfPath)) return libraries;

    try {
        const content = fs.readFileSync(vdfPath, 'utf8');
        // Match "path" "..."
        const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g);
        for (const match of pathMatches) {
            const libPath = match[1].replace(/\\\\/g, '\\');
            if (fs.existsSync(libPath) && !libraries.includes(libPath)) {
                libraries.push(libPath);
            }
        }
    } catch (e) {
        console.error('Failed to parse libraryfolders.vdf:', e);
    }
    return libraries;
}

function detectGmodPaths(customGmodPath = null) {
    if (customGmodPath && fs.existsSync(customGmodPath)) {
        return buildGmodInfo(customGmodPath);
    }

    const steamPath = getSteamPathFromRegistry();
    const libraries = parseLibraryFolders(steamPath);

    for (const lib of libraries) {
        const potentialGmod = path.join(lib, 'steamapps', 'common', 'GarrysMod');
        if (fs.existsSync(potentialGmod) && fs.existsSync(path.join(potentialGmod, 'garrysmod'))) {
            return buildGmodInfo(potentialGmod, steamPath, lib);
        }
    }

    return null;
}

function buildGmodInfo(gmodRoot, steamPath = null, steamLibraryPath = null) {
    const garrysmodDir = path.join(gmodRoot, 'garrysmod');
    const mapsDir = path.join(garrysmodDir, 'maps');
    const addonsDir = path.join(garrysmodDir, 'addons');
    const downloadDir = path.join(garrysmodDir, 'download');
    const downloadListsDir = path.join(garrysmodDir, 'downloadlists');
    const gmadExe = path.join(gmodRoot, 'bin', 'gmad.exe');
    const gmodExe = path.join(gmodRoot, 'gmod.exe');
    const gmodWin64Exe = path.join(gmodRoot, 'gmod_win64.exe');

    // Find workshop directory for app 4000
    // Typically in <library>/steamapps/workshop/content/4000
    let workshopDir = null;
    if (steamLibraryPath) {
        const ws = path.join(steamLibraryPath, 'steamapps', 'workshop', 'content', '4000');
        if (fs.existsSync(ws)) workshopDir = ws;
    }

    if (!workshopDir) {
        // Try parent tree
        const libRoot = path.resolve(gmodRoot, '..', '..', '..');
        const ws1 = path.join(libRoot, 'workshop', 'content', '4000');
        const ws2 = path.join(libRoot, 'steamapps', 'workshop', 'content', '4000');
        if (fs.existsSync(ws1)) workshopDir = ws1;
        else if (fs.existsSync(ws2)) workshopDir = ws2;
    }

    return {
        gmodRoot,
        garrysmodDir,
        mapsDir,
        addonsDir,
        downloadDir,
        downloadListsDir,
        workshopDir,
        gmadExe: fs.existsSync(gmadExe) ? gmadExe : null,
        gmodExe: fs.existsSync(gmodWin64Exe) ? gmodWin64Exe : (fs.existsSync(gmodExe) ? gmodExe : null),
        steamPath: steamPath || getSteamPathFromRegistry()
    };
}

module.exports = {
    getSteamPathFromRegistry,
    parseLibraryFolders,
    detectGmodPaths,
    buildGmodInfo
};
