const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { parseGmaHeader, extractSingleFile } = require('./gmaParser');

/**
 * Determine gamemode and friendly category from map filename
 */
function classifyMap(mapName) {
    const lower = mapName.toLowerCase();
    if (lower.startsWith('gm_')) return { id: 'sandbox', label: 'Sandbox', color: '#10b981' };
    if (lower.startsWith('ttt_')) return { id: 'ttt', label: 'Trouble in Terrorist Town', color: '#ef4444' };
    if (lower.startsWith('rp_')) return { id: 'roleplay', label: 'Roleplay / DarkRP', color: '#8b5cf6' };
    if (lower.startsWith('ph_')) return { id: 'prophunt', label: 'Prop Hunt', color: '#f59e0b' };
    if (lower.startsWith('zs_')) return { id: 'zombiesurvival', label: 'Zombie Survival', color: '#ec4899' };
    if (lower.startsWith('dr_') || lower.startsWith('deathrun_')) return { id: 'deathrun', label: 'Deathrun', color: '#06b6d4' };
    if (lower.startsWith('surf_')) return { id: 'surf', label: 'Surf', color: '#3b82f6' };
    if (lower.startsWith('bhop_')) return { id: 'bhop', label: 'Bunnyhop', color: '#6366f1' };
    if (lower.startsWith('dm_') || lower.startsWith('de_') || lower.startsWith('cs_')) return { id: 'pvp', label: 'Counter-Strike / PvP', color: '#f97316' };
    if (lower.startsWith('c1') || lower.startsWith('c2') || lower.startsWith('c3') || lower.startsWith('d1_') || lower.startsWith('d2_') || lower.startsWith('d3_') || lower.startsWith('ep1_') || lower.startsWith('ep2_')) {
        return { id: 'campaign', label: 'Half-Life 2 / Campaign', color: '#eab308' };
    }
    if (lower.startsWith('slender_') || lower.includes('horror') || lower.startsWith('scary_')) {
        return { id: 'horror', label: 'Horror / Nextbot', color: '#881337' };
    }
    if (lower.startsWith('ze_')) return { id: 'zombieescape', label: 'Zombie Escape', color: '#14b8a6' };
    if (lower.startsWith('cinema_') || lower.startsWith('theater_')) return { id: 'cinema', label: 'Cinema / Video', color: '#a855f7' };
    if (lower.startsWith('trade_') || lower.startsWith('achievement_')) return { id: 'fun', label: 'Trade / Achievement', color: '#64748b' };
    return { id: 'other', label: 'Custom / Other', color: '#6b7280' };
}

/**
 * Scans all loose .bsp maps and maps inside workshop/local GMAs
 */
async function scanAllMaps(gmodInfo) {
    const maps = [];
    if (!gmodInfo) return maps;

    // 1. Scan native loose maps in garrysmod/maps
    if (gmodInfo.mapsDir && fs.existsSync(gmodInfo.mapsDir)) {
        try {
            const entries = fs.readdirSync(gmodInfo.mapsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.bsp')) {
                    const bspPath = path.join(gmodInfo.mapsDir, entry.name);
                    const mapName = path.basename(entry.name, '.bsp');
                    const stats = fs.statSync(bspPath);
                    const classification = classifyMap(mapName);

                    // Check for thumbnail (.png, .jpg)
                    let thumbnail = null;
                    const pngThumb = path.join(gmodInfo.mapsDir, `${mapName}.png`);
                    const jpgThumb = path.join(gmodInfo.mapsDir, `${mapName}.jpg`);
                    if (fs.existsSync(pngThumb)) {
                        thumbnail = 'file://' + pngThumb.replace(/\\/g, '/');
                    } else if (fs.existsSync(jpgThumb)) {
                        thumbnail = 'file://' + jpgThumb.replace(/\\/g, '/');
                    }

                    // Check for nav mesh
                    const navPath = path.join(gmodInfo.mapsDir, `${mapName}.nav`);
                    const hasNav = fs.existsSync(navPath);

                    maps.push({
                        id: `loose_${mapName}`,
                        mapName,
                        displayName: mapName,
                        source: 'loose', // loose bsp in garrysmod/maps
                        filePath: bspPath,
                        fileSize: stats.size,
                        modified: stats.mtime,
                        classification,
                        thumbnail,
                        hasNav,
                        isEnabled: true,
                        parentAddon: null,
                        workshopId: null
                    });
                }
            }
        } catch (e) {
            console.error('Error reading native maps directory:', e);
        }
    }

    // 2. Scan workshop GMAs for embedded maps
    const gmaPaths = [];

    // Check Workshop folder (steamapps/workshop/content/4000)
    if (gmodInfo.workshopDir && fs.existsSync(gmodInfo.workshopDir)) {
        try {
            const itemFolders = fs.readdirSync(gmodInfo.workshopDir, { withFileTypes: true });
            for (const itemFolder of itemFolders) {
                if (itemFolder.isDirectory()) {
                    const itemPath = path.join(gmodInfo.workshopDir, itemFolder.name);
                    const files = fs.readdirSync(itemPath);
                    for (const f of files) {
                        if (f.toLowerCase().endsWith('.gma') || f.toLowerCase().endsWith('.gma.disabled')) {
                            gmaPaths.push({
                                filePath: path.join(itemPath, f),
                                workshopId: itemFolder.name,
                                isDisabled: f.toLowerCase().endsWith('.disabled')
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error scanning workshop folder for maps:', e);
        }
    }

    // Check legacy addons directory (garrysmod/addons)
    if (gmodInfo.addonsDir && fs.existsSync(gmodInfo.addonsDir)) {
        try {
            const files = fs.readdirSync(gmodInfo.addonsDir);
            for (const f of files) {
                if (f.toLowerCase().endsWith('.gma') || f.toLowerCase().endsWith('.gma.disabled')) {
                    gmaPaths.push({
                        filePath: path.join(gmodInfo.addonsDir, f),
                        workshopId: null,
                        isDisabled: f.toLowerCase().endsWith('.disabled')
                    });
                }
            }
        } catch (e) {
            console.error('Error scanning addons folder for maps:', e);
        }
    }

    // Parse GMAs and find maps
    for (const gmaItem of gmaPaths) {
        try {
            const header = parseGmaHeader(gmaItem.filePath);
            if (!header || !header.maps || header.maps.length === 0) continue;

            for (const mapEntry of header.maps) {
                const mapName = mapEntry.mapName;
                const classification = classifyMap(mapName);
                
                // Check if navmesh exists inside GMA or natively on disk
                const nativeNavPath = gmodInfo.mapsDir ? path.join(gmodInfo.mapsDir, `${mapName}.nav`) : null;
                const hasNav = (nativeNavPath && fs.existsSync(nativeNavPath)) ||
                               Boolean(header.navMeshes && header.navMeshes.includes(mapName));

                // Look for embedded map thumbnail inside GMA (e.g. maps/thumb/<map>.png, maps/<map>.png)
                let internalThumbnail = null;
                const lowerMap = mapName.toLowerCase();
                const thumbFile = header.files.find(f => {
                    const fn = f.name.toLowerCase();
                    return fn === `maps/thumb/${lowerMap}.png` ||
                           fn === `maps/${lowerMap}.png` ||
                           fn === `maps/${lowerMap}.jpg` ||
                           fn === `materials/vgui/maps/${lowerMap}.png` ||
                           fn === `materials/vgui/maps/${lowerMap}.jpg`;
                });

                if (thumbFile) {
                    try {
                        const thumbCacheDir = path.join(__dirname, '..', 'data', 'thumbnails');
                        if (!fs.existsSync(thumbCacheDir)) fs.mkdirSync(thumbCacheDir, { recursive: true });
                        const ext = path.extname(thumbFile.name) || '.png';
                        const destThumb = path.join(thumbCacheDir, `${mapName}${ext}`);
                        if (!fs.existsSync(destThumb)) {
                            extractSingleFile(gmaItem.filePath, thumbFile.name, destThumb);
                        }
                        if (fs.existsSync(destThumb)) {
                            internalThumbnail = 'file://' + destThumb.replace(/\\/g, '/');
                        }
                    } catch (_) {}
                }

                maps.push({
                    id: `gma_${path.basename(gmaItem.filePath)}_${mapName}`,
                    mapName,
                    displayName: header.name !== mapName ? `${header.name} (${mapName})` : mapName,
                    source: 'workshop_gma',
                    filePath: gmaItem.filePath,
                    internalMapPath: mapEntry.fullPath,
                    fileSize: mapEntry.size,
                    totalAddonSize: header.totalContentSize,
                    modified: header.timestamp,
                    classification,
                    thumbnail: internalThumbnail, // Uses internal screenshot if available
                    hasNav,
                    isEnabled: !gmaItem.isDisabled,
                    parentAddon: {
                        name: header.name,
                        author: header.author,
                        description: header.description,
                        tags: header.tags
                    },
                    workshopId: gmaItem.workshopId
                });
            }
        } catch (err) {
            // Ignore corrupted GMA or continue
        }
    }

    // Unified deduplication: merge loose BSPs and GMA maps by unique mapName
    const unifiedMaps = new Map();
    for (const m of maps) {
        const key = m.mapName.toLowerCase();

        // Double check native .nav file on disk
        if (gmodInfo.mapsDir) {
            const diskNav = path.join(gmodInfo.mapsDir, `${m.mapName}.nav`);
            if (fs.existsSync(diskNav)) {
                m.hasNav = true;
            }
        }

        if (!unifiedMaps.has(key)) {
            unifiedMaps.set(key, m);
        } else {
            const existing = unifiedMaps.get(key);
            // Merge properties from GMA and loose files
            if (!existing.thumbnail && m.thumbnail) existing.thumbnail = m.thumbnail;
            if (m.hasNav) existing.hasNav = true;
            if (!existing.workshopId && m.workshopId) existing.workshopId = m.workshopId;
            if (!existing.parentAddon && m.parentAddon) existing.parentAddon = m.parentAddon;
            if (existing.source === 'loose' && m.source === 'workshop_gma') {
                existing.displayName = m.displayName;
                existing.internalMapPath = m.internalMapPath;
                existing.filePath = m.filePath;
                existing.totalAddonSize = m.totalAddonSize;
            }
        }
    }

    return Array.from(unifiedMaps.values());
}

/**
 * Extracts a map (.bsp) and optional .nav from a GMA directly into garrysmod/maps
 */
async function extractMapToNative(gmodInfo, gmaPath, internalMapPath) {
    if (!gmodInfo.mapsDir) {
        throw new Error('Garry\'s Mod maps directory not found');
    }

    const mapFileName = path.basename(internalMapPath);
    const destBspPath = path.join(gmodInfo.mapsDir, mapFileName);

    // Extract BSP
    extractSingleFile(gmaPath, internalMapPath, destBspPath);

    // Check if navmesh exists inside GMA
    try {
        const navInternalPath = internalMapPath.replace(/\.bsp$/i, '.nav');
        const destNavPath = path.join(gmodInfo.mapsDir, path.basename(navInternalPath));
        extractSingleFile(gmaPath, navInternalPath, destNavPath);
    } catch (_) {
        // Navmesh optional
    }

    return destBspPath;
}

/**
 * Ensures map .bsp is extracted to garrysmod/maps so engine command-line +map can find it immediately
 */
async function findAndExtractMapIfNeeded(gmodInfo, mapName) {
    if (!gmodInfo || !gmodInfo.mapsDir) return false;
    const destBsp = path.join(gmodInfo.mapsDir, `${mapName}.bsp`);
    if (fs.existsSync(destBsp)) return true; // Already extracted or native

    // Search workshop and addons folders
    const searchDirs = [];
    if (gmodInfo.workshopDir && fs.existsSync(gmodInfo.workshopDir)) {
        searchDirs.push(gmodInfo.workshopDir);
    }
    if (gmodInfo.addonsDir && fs.existsSync(gmodInfo.addonsDir)) {
        searchDirs.push(gmodInfo.addonsDir);
    }

    for (const baseDir of searchDirs) {
        try {
            const entries = fs.readdirSync(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                let gmaPath = null;
                if (entry.isDirectory()) {
                    const subFiles = fs.readdirSync(path.join(baseDir, entry.name));
                    const gmaFile = subFiles.find(f => f.toLowerCase().endsWith('.gma') && !f.toLowerCase().endsWith('.disabled'));
                    if (gmaFile) gmaPath = path.join(baseDir, entry.name, gmaFile);
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gma') && !entry.name.toLowerCase().endsWith('.disabled')) {
                    gmaPath = path.join(baseDir, entry.name);
                }

                if (gmaPath && fs.existsSync(gmaPath)) {
                    try {
                        const header = parseGmaHeader(gmaPath);
                        if (header && header.maps) {
                            const matchingMap = header.maps.find(m => m.mapName.toLowerCase() === mapName.toLowerCase());
                            if (matchingMap) {
                                await extractMapToNative(gmodInfo, gmaPath, matchingMap.fullPath);
                                return true;
                            }
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }
    return false;
}

/**
 * Launch Garry's Mod directly into a specific map
 */
async function launchMap(gmodInfo, mapName, options = {}) {
    const {
        novid = true,
        noworkshop = false,
        fullscreen = true,
        windowed = false,
        width = null,
        height = null,
        gamemode = 'sandbox',
        extraArgs = ''
    } = options;

    // Auto-extract map from Workshop GMA if not yet present in garrysmod/maps
    try {
        await findAndExtractMapIfNeeded(gmodInfo, mapName);
    } catch (e) {
        console.warn('Auto-extraction check failed for map:', mapName, e);
    }

    const args = ['-condebug'];
    if (novid) args.push('-novid');
    if (noworkshop) args.push('-noworkshop');
    if (windowed) {
        args.push('-windowed', '-noborder');
        if (width && height) args.push('-w', String(width), '-h', String(height));
    } else {
        // Enforce Fullscreen DLDSR mode
        args.push('-fullscreen');
        if (width && height) args.push('-w', String(width), '-h', String(height));
    }
    if (gamemode) args.push('+gamemode', gamemode);
    args.push('+map', mapName);
    // Guarantee wireless controller is initialized on boot with modern layout
    args.push('+joystick', '1', '+joy_advanced', '1', '+exec', '360controller');

    if (extraArgs && extraArgs.trim()) {
        args.push(...extraArgs.trim().split(/\s+/));
    }

    // Primary: Launch via steam.exe -applaunch 4000 so Steam tracks process lifecycle,
    // keeping Steam Input and wireless controller hooks anchored across map changes and gamemode transitions
    const steamExePath = gmodInfo.steamPath ? path.join(gmodInfo.steamPath, 'steam.exe') : 'C:\\Program Files (x86)\\Steam\\steam.exe';
    if (fs.existsSync(steamExePath)) {
        try {
            const steamArgs = ['-applaunch', '4000', ...args];
            const proc = spawn(steamExePath, steamArgs, {
                detached: true,
                stdio: 'ignore'
            });
            proc.unref();
            return { success: true, method: 'steam_applaunch', executable: steamExePath, args: steamArgs };
        } catch (e) {
            console.warn('Failed to launch via steam.exe -applaunch, falling back to direct executable:', e);
        }
    }

    // Secondary fallback: Direct executable spawn
    if (gmodInfo.gmodExe && fs.existsSync(gmodInfo.gmodExe)) {
        const proc = spawn(gmodInfo.gmodExe, args, {
            cwd: path.dirname(gmodInfo.gmodExe),
            detached: true,
            stdio: 'ignore'
        });
        proc.unref();
        return { success: true, method: 'direct_executable', executable: gmodInfo.gmodExe, args };
    }

    // Tertiary fallback: Steam URL protocol
    const steamUrl = `steam://run/4000//${encodeURIComponent(args.join(' '))}`;
    exec(`start "" "${steamUrl}"`);
    return { success: true, method: 'steam_protocol', url: steamUrl, args };
}

/**
 * Injects a temporary self-executing Lua autopilot script into garrysmod/lua/autorun/server/
 * that automatically starts nav_generate as soon as the level loads with zero terminal commands needed.
 */
function injectNavmeshAutopilot(gmodInfo, mapName) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) return null;
    const autorunDir = path.join(gmodInfo.garrysmodDir, 'lua', 'autorun', 'server');
    if (!fs.existsSync(autorunDir)) fs.mkdirSync(autorunDir, { recursive: true });

    const luaScript = `-- Garry's Mod Map Manager: 1-Click Zero-Terminal NavMesh Generator
local hasTriggered = false
hook.Add("PlayerInitialSpawn", "AutoNavmeshAutopilot", function(ply)
    local curMap = string.lower(game.GetMap())
    if curMap == "${mapName.toLowerCase()}" then
        -- Check if .nav file exists (meaning generation is complete and level reloaded)
        if file.Exists("maps/" .. curMap .. ".nav", "GAME") then
            timer.Simple(1.5, function()
                if not IsValid(ply) then return end
                ply:SendLua([[
                    surface.PlaySound("garrysmod/save_load1.wav")
                    notification.AddLegacy("✅ NavMesh Complete! Nextbots can now navigate this map.", NOTIFY_GENERIC, 8)
                ]])
                PrintMessage(HUD_PRINTCENTER, "✅ NavMesh Generated Successfully! Have fun!")
            end)
            return
        end

        if hasTriggered then return end
        hasTriggered = true

        timer.Simple(2.5, function()
            if not IsValid(ply) then return end
            PrintMessage(HUD_PRINTCENTER, "AutoNav: Generating Fast NavMesh... Please wait ~3s!")
            
            -- Ensure player is grounded and add walkable seed (essential for maps without info_player_start)
            pcall(function() ply:DropToFloor() end)
            local pPos = ply:GetPos()
            local tr = util.TraceLine({
                start = pPos + Vector(0, 0, 60),
                endpos = pPos - Vector(0, 0, 100000),
                filter = ply
            })
            local seedPos = tr.Hit and tr.HitPos or pPos
            local seedNormal = tr.Hit and tr.HitNormal or Vector(0, 0, 1)

            if navmesh and navmesh.AddWalkableSeed then
                pcall(function()
                    navmesh.ClearWalkableSeeds()
                    navmesh.AddWalkableSeed(seedPos, seedNormal)
                end)
            end

            ply:SendLua([[
                surface.PlaySound("buttons/bell1.wav")
                notification.AddLegacy("AutoNav: Fast NavMesh calculation starting...", NOTIFY_HINT, 5)
                RunConsoleCommand("nav_quicksave", "1")
                RunConsoleCommand("nav_max_view_distance", "1")
                RunConsoleCommand("nav_mark_walkable")
            ]])
            game.ConsoleCommand("nav_quicksave 1\\n")
            game.ConsoleCommand("nav_max_view_distance 1\\n")

            timer.Simple(0.5, function()
                if navmesh and navmesh.BeginGeneration then
                    local ok = pcall(function() navmesh.BeginGeneration() end)
                    if not ok then game.ConsoleCommand("nav_generate\\n") end
                else
                    game.ConsoleCommand("nav_generate\\n")
                end
            end)
        end)
    end
end)
`;
    const scriptPath = path.join(autorunDir, 'zzz_nav_autopilot.lua');
    fs.writeFileSync(scriptPath, luaScript, 'utf8');

    // Auto-clean up script after 4 minutes
    setTimeout(() => {
        try {
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
        } catch (_) {}
    }, 240000);

    return scriptPath;
}

module.exports = {
    classifyMap,
    scanAllMaps,
    extractMapToNative,
    findAndExtractMapIfNeeded,
    launchMap,
    injectNavmeshAutopilot
};
