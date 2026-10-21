const fs = require('fs');
const path = require('path');
const { parseGmaHeader } = require('./gmaParser');

function readAddonNoMount(gmodInfo) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) return [];
    const cfgPath = path.join(gmodInfo.garrysmodDir, 'cfg', 'addonnomount.txt');
    if (!fs.existsSync(cfgPath)) return [];
    try {
        const content = fs.readFileSync(cfgPath, 'utf8');
        const matches = [...content.matchAll(/"\d+"\s+"([^"]+)"/g)];
        return matches.map(m => m[1]);
    } catch (_) {
        return [];
    }
}

function writeAddonNoMount(gmodInfo, ids) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) return;
    const cfgPath = path.join(gmodInfo.garrysmodDir, 'cfg', 'addonnomount.txt');
    const unique = [...new Set(ids)];
    let out = '"addonnomount"\n{\n';
    unique.forEach((id, idx) => {
        out += `\t"${idx + 1}"\t\t"${id}"\n`;
    });
    out += '}\n';
    fs.writeFileSync(cfgPath, out, 'utf8');
}

const DISMISSED_NAV_FILE = path.join(__dirname, '..', 'data', 'dismissed_nav_maps.json');

const DEFAULT_ROGUE_MAPS = [
    'slender_spongebob_v1b',
    'gm_bikinibottom_map',
    'gm_bikinibottom_night',
    'gm_bikinibottom_winter',
    'lestnicha3',
    'gm_ssne_arena',
    'foggy_road'
];

function loadDismissedNavState() {
    try {
        if (fs.existsSync(DISMISSED_NAV_FILE)) {
            const data = JSON.parse(fs.readFileSync(DISMISSED_NAV_FILE, 'utf8'));
            return {
                silenceAll: data.silenceAll !== false,
                dismissedMaps: Array.isArray(data.dismissedMaps) ? data.dismissedMaps : DEFAULT_ROGUE_MAPS,
                rogueMaps: Array.isArray(data.rogueMaps) ? data.rogueMaps : DEFAULT_ROGUE_MAPS
            };
        }
    } catch (_) {}

    const defaultState = {
        silenceAll: true,
        dismissedMaps: [...DEFAULT_ROGUE_MAPS],
        rogueMaps: [...DEFAULT_ROGUE_MAPS]
    };
    saveDismissedNavState(defaultState);
    return defaultState;
}

function saveDismissedNavState(state) {
    try {
        const dir = path.dirname(DISMISSED_NAV_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DISMISSED_NAV_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save dismissed nav state:', e);
    }
}

function getDismissedNavState() {
    return loadDismissedNavState();
}

function dismissNavMap(mapName) {
    if (!mapName) return loadDismissedNavState();
    const state = loadDismissedNavState();
    if (!state.dismissedMaps.includes(mapName)) {
        state.dismissedMaps.push(mapName);
    }
    saveDismissedNavState(state);
    return state;
}

function dismissAllNavMaps(allMapNames = null) {
    const state = loadDismissedNavState();
    state.silenceAll = true;
    if (Array.isArray(allMapNames) && allMapNames.length > 0) {
        const set = new Set([...state.dismissedMaps, ...allMapNames]);
        state.dismissedMaps = Array.from(set);
    }
    saveDismissedNavState(state);
    return state;
}

function restoreNavMaps() {
    const state = {
        silenceAll: false,
        dismissedMaps: [],
        rogueMaps: [...DEFAULT_ROGUE_MAPS]
    };
    saveDismissedNavState(state);
    return state;
}

// Known base addons required by popular GMod community content
const KNOWN_BASES = {
    'simfphys': {
        name: '[simfphys] - LUA Vehicles - Base',
        workshopId: '771487490',
        description: 'Required by custom drivable vehicles and chase minigames (e.g. G-PAKO)',
        keywords: ['simfphys'],
        searchQuery: '[simfphys]',
        searchTag: 'Vehicle',
        recommendedPacks: [
            { title: '[simfphys] - Armed Vehicles', workshopId: '831680603', desc: 'Drivable tanks, APCs, armed jeeps with firing cannons & turrets' },
            { title: '[simfphys] Left 4 Dead 2 Vehicles', workshopId: '1945909088', desc: 'Police cruisers, pickup trucks, ambulances, and sedans' },
            { title: '[simfphys] WW2 German Tank Pack', workshopId: '1947110087', desc: 'Fully functional drivable Tiger, Panzer, and heavy tanks' }
        ]
    },
    'vj_base': {
        name: 'VJ Base',
        workshopId: '131759821',
        description: 'Required by VJ SNPCs, monster packs, and custom creature entities',
        keywords: ['vj_base', 'npc_vj_'],
        searchQuery: 'VJ Base',
        searchTag: 'NPC',
        recommendedPacks: [
            { title: 'Metropolice Pack (VJ Base)', workshopId: '104491619', desc: 'Tactical Combine police with voice lines, squad AI, and stun batons' }
        ]
    },
    'tfa': {
        name: 'TFA Base',
        workshopId: '2840031720',
        description: 'Required by TFA weapons, firearms, and SWEPs',
        keywords: ['tfa_gun_base'],
        searchQuery: 'TFA',
        searchTag: 'Weapon',
        recommendedPacks: [
            { title: '[TFA] Fallout Weapons Collection', workshopId: '2111702789', desc: 'Custom wasteland rifles, pistols, and laser weapons' },
            { title: '[TFA][AT] MG34 Heavy Machinegun', workshopId: '2736932602', desc: 'Tactical machinegun with custom animations and inspect' },
            { title: '[TFA][AT] Blitz Sight Pack', workshopId: '1387617320', desc: 'Holographic, red dot, and sniper optics for TFA weapons' }
        ]
    },
    'arc9': {
        name: 'ARC9 Weapon Base',
        workshopId: '2910505837',
        description: 'Required by ARC9 tactical customizable firearms',
        keywords: ['arc9_'],
        searchQuery: 'ARC9',
        searchTag: 'Weapon',
        recommendedPacks: [
            { title: '[ARC9] Urban Coalition Port', workshopId: '3812993432', desc: 'Modern tactical combat rifles and submachine guns' },
            { title: '[ARC9] Far Cry 4 Custom Glock', workshopId: '3814742051', desc: 'Customizable sidearm with deep attachment options' },
            { title: '[ARC9] BO6 - XM4 Assault Rifle', workshopId: '3813969735', desc: 'High-detail assault rifle with custom reload audio' }
        ]
    },
    'lvs': {
        name: 'LVS - Framework',
        workshopId: '2912816023',
        description: 'Required by modern LVS land, air, and sea vehicles',
        keywords: ['lvs_base', 'lvs_framework'],
        searchQuery: 'LVS',
        searchTag: 'Vehicle',
        recommendedPacks: [
            { title: '[LVS] Spider Tank', workshopId: '3816018921', desc: 'Six-legged functional walking combat tank' },
            { title: '[LVS] Oblivion Drone', workshopId: '3813741872', desc: 'Autonomous patrol aerial vehicle' }
        ]
    }
};

/**
 * Runs a comprehensive diagnostic check of Garry's Mod installation
 */
async function runDiagnostics(gmodInfo) {
    const issues = [];
    const recommendations = [];
    const resolved = [];

    if (!gmodInfo || !gmodInfo.workshopDir) {
        return { issues: [], resolved: [], recommendations: [], summary: 'GMod not found', counts: { missingContent: 0, missingBases: 0, conflicts: 0, noNav: 0, resolvedCount: 0 } };
    }

    // 1. Scan installed addons to identify active workshop items and headers
    const noMountIds = readAddonNoMount(gmodInfo);
    const noMountSet = new Set(noMountIds);
    const installedWorkshopIds = new Set();
    const installedGmaHeaders = [];

    try {
        const items = fs.readdirSync(gmodInfo.workshopDir, { withFileTypes: true });
        for (const item of items) {
            if (!item.isDirectory()) continue;
            const folder = path.join(gmodInfo.workshopDir, item.name);
            const files = fs.readdirSync(folder);
            for (const f of files) {
                const lower = f.toLowerCase();
                // Only consider active, non-disabled, and non-unmounted GMAs
                if (lower.endsWith('.gma') && !lower.endsWith('.disabled') && !noMountSet.has(item.name)) {
                    installedWorkshopIds.add(item.name);
                    try {
                        const h = parseGmaHeader(path.join(folder, f));
                        if (h) {
                            h.workshopId = item.name;
                            installedGmaHeaders.push(h);
                        }
                    } catch (_) {}
                }
            }
        }
    } catch (e) {
        console.error('Diagnostic scan error:', e);
    }

    // Also scan loose addons in garrysmod/addons
    let hasLocalCssPack = false;
    if (gmodInfo.addonsDir && fs.existsSync(gmodInfo.addonsDir)) {
        try {
            const localEntries = fs.readdirSync(gmodInfo.addonsDir);
            for (const entry of localEntries) {
                const lower = entry.toLowerCase();
                if (lower.includes('css') || lower.includes('cstrike')) {
                    hasLocalCssPack = true;
                }
            }
        } catch (_) {}
    }

    // 2. Check for Counter-Strike: Source (standalone game mount OR workshop content pack)
    let hasCss = false;
    let cssSource = null;

    // Check standalone game
    if (gmodInfo.steamPath) {
        const potentialCssPaths = [
            path.join(gmodInfo.steamPath, 'steamapps', 'common', 'Counter-Strike Source', 'cstrike'),
            path.join('D:\\SteamLibrary', 'steamapps', 'common', 'Counter-Strike Source', 'cstrike'),
            path.join('E:\\SteamLibrary', 'steamapps', 'common', 'Counter-Strike Source', 'cstrike')
        ];
        if (potentialCssPaths.some(p => fs.existsSync(p))) {
            hasCss = true;
            cssSource = 'Counter-Strike: Source (Game Mounted)';
        }
    }

    // Check workshop addons or local addons
    if (!hasCss) {
        if (hasLocalCssPack) {
            hasCss = true;
            cssSource = 'Local CS:S Addon Pack (garrysmod/addons)';
        } else {
            // Check installed workshop headers for known CS:S packs
            for (const h of installedGmaHeaders) {
                const nameLower = h.name.toLowerCase();
                if (
                    h.workshopId === '3540392343' ||
                    h.workshopId === '3414484452' ||
                    h.workshopId === '3066445274' ||
                    nameLower.includes('css content') ||
                    nameLower.includes('counter-strike content') ||
                    nameLower.includes('cstrike content') ||
                    h.files.some(f => f.name.toLowerCase().startsWith('materials/cstrike') || f.name.toLowerCase().startsWith('models/props_cstrike'))
                ) {
                    hasCss = true;
                    cssSource = `Workshop Pack: ${h.name}`;
                    break;
                }
            }
        }
    }

    if (hasCss) {
        resolved.push({
            key: 'css_content',
            title: 'Counter-Strike: Source Content: Active & Mounted',
            detail: `CS:S textures and models are active (${cssSource}). Flashing purple checkerboards and red ERROR signs are resolved!`,
            isHealthy: true
        });
    } else {
        issues.push({
            type: 'missing_game_content',
            severity: 'high',
            category: 'Mounted Game Content',
            title: 'Counter-Strike: Source (CS:S) Not Mounted',
            message: 'CS:S is not installed or mounted in GMod. 80%+ of all community maps and props use CS:S textures and models. Without it, you will see flashing purple/black checkerboards (missing textures) and giant red 3D "ERROR" models everywhere.',
            fixAction: 'install_css',
            actionText: 'Subscribe to CS:S Content Fix (Steam)',
            workshopId: '3540392343',
            steamUrl: 'steam://url/CommunityFilePage/3540392343'
        });
    }

    // 3. Check which base frameworks are referenced in Lua files
    const baseUsage = {};
    for (const h of installedGmaHeaders) {
        const luaFiles = h.files.filter(f => f.name.toLowerCase().endsWith('.lua') && f.size < 400000);
        if (luaFiles.length === 0) continue;

        try {
            const fd = fs.openSync(h.filePath, 'r');
            for (const f of luaFiles) {
                const buf = Buffer.alloc(f.size);
                fs.readSync(fd, buf, 0, f.size, f.offset);
                const code = buf.toString('utf8').toLowerCase();

                for (const [baseKey, baseDef] of Object.entries(KNOWN_BASES)) {
                    // Do not check the base addon against itself
                    if (h.workshopId === baseDef.workshopId || h.name.toLowerCase().includes(baseDef.name.toLowerCase())) continue;

                    const matches = baseDef.keywords.some(kw => code.includes(kw));
                    if (matches) {
                        baseUsage[baseKey] = baseUsage[baseKey] || [];
                        baseUsage[baseKey].push({
                            addonName: h.name,
                            workshopId: h.workshopId
                        });
                    }
                }
            }
            fs.closeSync(fd);
        } catch (_) {}
    }

    // Evaluate missing vs installed bases
    let missingBasesCount = 0;
    for (const [baseKey, usingAddons] of Object.entries(baseUsage)) {
        const baseDef = KNOWN_BASES[baseKey];
        if (!baseDef) continue;

        const isBaseInstalled = installedWorkshopIds.has(baseDef.workshopId) ||
            installedGmaHeaders.some(h => h.name.toLowerCase().includes(baseDef.name.toLowerCase()));
        if (!isBaseInstalled) {
            missingBasesCount++;
            const uniqueAddonNames = [...new Set(usingAddons.map(a => a.addonName))];
            issues.push({
                type: 'missing_base_addon',
                baseKey,
                severity: 'high',
                category: 'Missing Framework / Base',
                title: `Missing Required Base: ${baseDef.name}`,
                workshopId: baseDef.workshopId,
                message: `You have addons installed that require "${baseDef.name}" to function, but the base is not installed. Running them will cause Lua script errors in console, missing vehicle physics, or failure to spawn.`,
                affectedCount: uniqueAddonNames.length,
                affectedSample: uniqueAddonNames.slice(0, 3).join(', ') + (uniqueAddonNames.length > 3 ? ` (+${uniqueAddonNames.length - 3} more)` : ''),
                actionText: `Subscribe to ${baseDef.name} on Steam`,
                steamUrl: `steam://url/CommunityFilePage/${baseDef.workshopId}`,
                webUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${baseDef.workshopId}`
            });
        }
    }

    // 4. Detect duplicate / colliding addon packs
    const duplicatePacks = [];
    // Check Alphabet Lore duplicate pack
    const hasAlphabetAll = installedWorkshopIds.has('3762707132'); // all packs A-Z
    const hasAlphabetSingle = installedWorkshopIds.has('2957323514') || installedWorkshopIds.has('2988753442') || installedWorkshopIds.has('2995239904');
    if (hasAlphabetAll && hasAlphabetSingle) {
        duplicatePacks.push({
            key: 'alphabet_lore',
            title: 'Alphabet Lore Duplicate Packs Conflict',
            detail: 'You have both "Alphabet Lore All Packs A-Z" (3762707132) AND individual packs (A-Z, n-s, t-z) installed simultaneously. This creates over 3,500 file conflicts and duplicate Lua entity registrations.',
            fix: 'Disable the individual single packs and keep the all-in-one pack.',
            redundantCount: 3,
            fixButtonText: 'Fix Now (Disable 3 Redundant Packs)'
        });
    }

    // Check Italian Brainrot duplicates
    const hasBrainrotReupload = installedWorkshopIds.has('3483718453');
    const hasBrainrotOriginal = installedWorkshopIds.has('3465056080');
    if (hasBrainrotReupload && hasBrainrotOriginal) {
        duplicatePacks.push({
            key: 'italian_brainrot',
            title: 'Italian Brainrot Re-upload Conflict',
            detail: 'You have both "Italian Brainrot pack (NEXTBOTS)" (3465056080) and "Italian Brainrot pack (reupload)" (3483718453) installed. These contain identical entities and collide with each other.',
            fix: 'Disable or delete the duplicate re-upload version.',
            redundantCount: 1,
            fixButtonText: 'Fix Now (Disable Duplicate Re-upload)'
        });
    }

    // Check GCAL (Garry's Mod Compliant Armature Layer) vs. VManip Patch conflict
    const hasGcal = installedWorkshopIds.has('3727245204');
    const hasVmanip = installedWorkshopIds.has('3262499127') || installedWorkshopIds.has('2155366756') || installedWorkshopIds.has('3080114310');
    if (hasGcal && hasVmanip) {
        duplicatePacks.push({
            key: 'gcal_vmanip',
            title: 'GCAL vs. VManip Armature & Model Crash Conflict',
            detail: 'You have both "Garry\'s Mod Compliant Armature Layer (GCAL)" (3727245204) and "Chen\'s VManip Patch" (3262499127) enabled. Both overwrite global VManip/VMLegs hooks and bundle 24+ conflicting c_vmanip.mdl vertex files, causing fullscreen conflict popups and C++ bone/model crashes on spawn.',
            fix: 'Unmount GCAL (3727245204) and keep Chen\'s VManip Patch active for your MW Base & ARC9 weapons.',
            redundantCount: 1,
            fixButtonText: 'Fix Now (Unmount GCAL 3727245204)'
        });
    }

    if (duplicatePacks.length > 0) {
        issues.push({
            type: 'duplicate_addon_conflict',
            severity: 'medium',
            category: 'Addon Conflicts',
            title: 'Duplicate / Overlapping Addon Packs Detected',
            message: `${duplicatePacks.length} major pack conflicts found. When multiple addons register the exact same entity or model names, Garry's Mod triggers Lua errors or overrides files unpredictably.`,
            duplicates: duplicatePacks
        });
    }

    // 5. Scan maps that lack a NavMesh (.nav)
    const mapsWithoutNav = [];
    for (const h of installedGmaHeaders) {
        for (const f of h.files) {
            if (f.name.toLowerCase().endsWith('.bsp')) {
                const bspBase = path.basename(f.name, path.extname(f.name));
                // Check if .nav is inside the same GMA
                const hasInternalNav = h.files.some(f2 => f2.name.toLowerCase().endsWith(`${bspBase.toLowerCase()}.nav`));
                // Check if .nav exists loose in garrysmod/maps
                const looseNav = gmodInfo.mapsDir ? path.join(gmodInfo.mapsDir, `${bspBase}.nav`) : null;
                const hasLooseNav = looseNav && fs.existsSync(looseNav);

                if (!hasInternalNav && !hasLooseNav) {
                    mapsWithoutNav.push({
                        mapName: bspBase,
                        addonName: h.name,
                        workshopId: h.workshopId
                    });
                }
            }
        }
    }

    // Also check loose maps in garrysmod/maps
    if (gmodInfo.mapsDir && fs.existsSync(gmodInfo.mapsDir)) {
        try {
            const looseFiles = fs.readdirSync(gmodInfo.mapsDir);
            for (const f of looseFiles) {
                if (f.toLowerCase().endsWith('.bsp')) {
                    const bspBase = path.basename(f, '.bsp');
                    const navPath = path.join(gmodInfo.mapsDir, `${bspBase}.nav`);
                    if (!fs.existsSync(navPath) && !mapsWithoutNav.some(m => m.mapName.toLowerCase() === bspBase.toLowerCase())) {
                        mapsWithoutNav.push({
                            mapName: bspBase,
                            addonName: 'Native / Loose Map',
                            workshopId: null
                        });
                    }
                }
            }
        } catch (_) {}
    }

    // Nextbot notice
    const hasNextbots = installedGmaHeaders.some(h => 
        h.name.toLowerCase().includes('nextbot') || 
        h.name.toLowerCase().includes('sprunki') ||
        h.name.toLowerCase().includes('alphabet')
    );

    const navState = loadDismissedNavState();
    const dismissedSet = new Set((navState.dismissedMaps || []).map(m => m.toLowerCase()));

    const activeMapsWithoutNav = navState.silenceAll
        ? []
        : mapsWithoutNav.filter(m => !dismissedSet.has(m.mapName.toLowerCase()));

    const exemptMaps = mapsWithoutNav.filter(m => navState.silenceAll || dismissedSet.has(m.mapName.toLowerCase()));

    if (hasNextbots && activeMapsWithoutNav.length > 0) {
        recommendations.push({
            type: 'navmesh_notice',
            title: 'Nextbots Cannot Pathfind Without Map NavMeshes',
            message: `You have dozens of Nextbots installed (Sprunki, Spongebob, Bendy, Alphabet Lore), but ${activeMapsWithoutNav.length} of your maps lack a Navigation Mesh (.nav file).`,
            affectedMaps: activeMapsWithoutNav.map(m => m.mapName),
            tip: 'Nextbots freeze in place or flood console with pathfinding errors on maps without a .nav file. To fix a map, load it in singleplayer, open the console (~), and type: nav_generate (GMod will calculate the mesh and restart the map automatically). Or search Steam Workshop for "<map_name> navmesh"!'
        });
    }

    if (exemptMaps.length > 0) {
        const exemptNames = exemptMaps.map(m => m.mapName);
        resolved.push({
            key: 'exempt_nav_maps',
            title: `Rogue NavMesh Notices: Dismissed & Exempt (${exemptMaps.length} Maps)`,
            detail: `${exemptNames.slice(0, 4).join(', ')}${exemptNames.length > 4 ? ` and ${exemptNames.length - 4} more` : ''} are permanently exempted from Nextbot pathfinding checks. Serving as a lesson to future unmeshable files!`,
            isHealthy: true
        });
    }

    // 6. Track resolved issues & healthy status
    // Check if Alphabet Lore was resolved
    const singleAlphabetDirs = ['2957323514', '2988753442', '2995239904'];
    const alphabetSingleDisabled = singleAlphabetDirs.every(id => {
        if (noMountSet.has(id)) return true;
        const itemDir = path.join(gmodInfo.workshopDir, id);
        if (!fs.existsSync(itemDir)) return true;
        const files = fs.readdirSync(itemDir);
        return files.some(f => f.toLowerCase().endsWith('.disabled'));
    });
    if (hasAlphabetAll && alphabetSingleDisabled) {
        resolved.push({
            key: 'alphabet_lore',
            title: 'Alphabet Lore Conflict: Resolved',
            detail: '3 redundant individual single packs are unmounted via addonnomount. The all-in-one pack (A-Z) remains active, eliminating 3,500+ duplicate script collisions.',
            undoActionText: 'Re-enable Single Packs'
        });
    }

    // Check if Italian Brainrot was resolved
    const brainrotReuploadDisabled = noMountSet.has('3483718453') || (() => {
        const d = path.join(gmodInfo.workshopDir, '3483718453');
        if (!fs.existsSync(d)) return false;
        return fs.readdirSync(d).some(f => f.toLowerCase().endsWith('.disabled'));
    })();
    if (installedWorkshopIds.has('3465056080') && brainrotReuploadDisabled) {
        resolved.push({
            key: 'italian_brainrot',
            title: 'Italian Brainrot Conflict: Resolved',
            detail: 'Duplicate re-upload version is unmounted. The original pack remains active with zero collisions.',
            undoActionText: 'Re-enable Duplicate'
        });
    }

    // Check if GCAL vs VManip conflict was resolved
    const gcalDisabled = noMountSet.has('3727245204') || (() => {
        const d = path.join(gmodInfo.workshopDir, '3727245204');
        if (!fs.existsSync(d)) return false;
        return fs.readdirSync(d).some(f => f.toLowerCase().endsWith('.disabled'));
    })();
    if (installedWorkshopIds.has('3262499127') && gcalDisabled) {
        resolved.push({
            key: 'gcal_vmanip',
            title: 'GCAL vs. VManip Armature Crash Conflict: Resolved',
            detail: 'GCAL (3727245204) is safely unmounted via addonnomount.txt. Chen\'s VManip Patch (3262499127) remains active for MW Base & ARC9 without c_vmanip.mdl bone/vertex crashes.',
            undoActionText: 'Re-enable GCAL'
        });
    }

    // Check active bases
    for (const [baseKey, baseDef] of Object.entries(KNOWN_BASES)) {
        if (installedWorkshopIds.has(baseDef.workshopId)) {
            const uninstalledPacks = (baseDef.recommendedPacks || []).filter(
                p => !installedWorkshopIds.has(p.workshopId)
            );
            resolved.push({
                key: `base_${baseKey}`,
                title: `${baseDef.name}: Active & Healthy`,
                detail: `Installed and operational: ${baseDef.description}`,
                isBase: true,
                workshopId: baseDef.workshopId,
                searchQuery: baseDef.searchQuery || baseDef.name,
                searchTag: baseDef.searchTag || 'Weapon',
                recommendedPacks: uninstalledPacks
            });
        }
    }

    // Check DrGBase
    if (installedWorkshopIds.has('1560118657')) {
        resolved.push({
            key: 'drgbase',
            title: 'DrGBase | Nextbot Base: Active & Healthy',
            detail: 'DrGBase is active and powering your Nextbots (Sprunki, Bendy, Alphabet Lore, Nextbots).',
            isBase: true,
            workshopId: '1560118657',
            recommendedPacks: []
        });
    }

    // Check Wireless Controller / Gamepad Tuning
    if (gmodInfo && gmodInfo.garrysmodDir) {
        const autoexecPath = path.join(gmodInfo.garrysmodDir, 'cfg', 'autoexec.cfg');
        const configPath = path.join(gmodInfo.garrysmodDir, 'cfg', 'config.cfg');
        const autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
        const configContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';

        const isTuned = autoexecContent.includes('// --- Modern Tactical Wireless Controller') ||
                        autoexecContent.includes('// --- Smooth Wireless Controller') ||
                        autoexecContent.includes('joy_accelscale "0.35"') ||
                        autoexecContent.includes('joy_accelscale "0.5"');

        if (isTuned) {
            resolved.push({
                key: 'controller_tuning',
                title: '🎮 Modern Tactical Wireless Controller: Calibrated & Active',
                detail: 'R1/B = Crouch, R3 = Toggle Constant Run, L3 = Chat, and 6/10 smooth look speed (-0.40 / 0.32).'
            });
        } else {
            recommendations.push({
                type: 'controller_tuning',
                title: 'Gamepad & Wireless Controller Optimization Available',
                message: "Garry's Mod default 2004 controller settings cause sudden 2.0x acceleration spikes, high yaw sensitivity, and violent spinning on wireless Xbox/PlayStation controllers.",
                solution: 'Apply the built-in Smooth Aiming calibration to eliminate acceleration spikes, smooth camera turning, and add deadzones.',
                actionText: '⚡ Calibrate Controller (Smooth Aiming)'
            });
        }
    }

    return {
        issues,
        resolved,
        recommendations,
        totalAddonsScanned: installedGmaHeaders.length,
        hasCss,
        counts: {
            missingContent: hasCss ? 0 : 1,
            missingBases: missingBasesCount,
            conflicts: duplicatePacks.length,
            noNav: activeMapsWithoutNav.length,
            dismissedNav: exemptMaps.length,
            resolvedCount: resolved.length
        },
        mapsWithoutNav
    };
}

/**
 * Automatically fixes detected addon conflicts by disabling redundant/duplicate GMAs
 */
function fixAddonConflict(gmodInfo, conflictKey) {
    if (!gmodInfo || !gmodInfo.workshopDir) {
        throw new Error('GMod workshop directory not found');
    }

    const conflictsMap = {
        'alphabet_lore': ['2957323514', '2988753442', '2995239904'],
        'italian_brainrot': ['3483718453'],
        'gcal_vmanip': ['3727245204']
    };

    let targetWorkshopIds = [];
    if (conflictKey === 'all') {
        targetWorkshopIds = Object.values(conflictsMap).flat();
    } else if (conflictsMap[conflictKey]) {
        targetWorkshopIds = conflictsMap[conflictKey];
    } else {
        throw new Error(`Unknown conflict key: ${conflictKey}`);
    }

    const currentNoMount = readAddonNoMount(gmodInfo);
    const newNoMount = [...currentNoMount, ...targetWorkshopIds];
    writeAddonNoMount(gmodInfo, newNoMount);

    // Ensure GMA files are NOT renamed to .disabled so Steam never tries to redownload them
    for (const wsId of targetWorkshopIds) {
        const itemDir = path.join(gmodInfo.workshopDir, wsId);
        if (!fs.existsSync(itemDir)) continue;
        const files = fs.readdirSync(itemDir);
        for (const f of files) {
            if (f.toLowerCase().endsWith('.disabled')) {
                const srcPath = path.join(itemDir, f);
                const destPath = srcPath.replace(/\.disabled$/i, '');
                try { fs.renameSync(srcPath, destPath); } catch (_) {}
            }
        }
    }

    return {
        success: true,
        modifiedCount: targetWorkshopIds.length,
        actionsTaken: targetWorkshopIds.map(id => `Unmounted ${id} via addonnomount.txt (prevents redownload freeze)`)
    };
}

/**
 * Re-enables previously disabled conflicting packs (Undo)
 */
function undoAddonConflict(gmodInfo, conflictKey) {
    if (!gmodInfo || !gmodInfo.workshopDir) {
        throw new Error('GMod workshop directory not found');
    }

    const conflictsMap = {
        'alphabet_lore': ['2957323514', '2988753442', '2995239904'],
        'italian_brainrot': ['3483718453'],
        'gcal_vmanip': ['3727245204']
    };

    const targetWorkshopIds = conflictsMap[conflictKey] || [];
    const currentNoMount = readAddonNoMount(gmodInfo);
    const newNoMount = currentNoMount.filter(id => !targetWorkshopIds.includes(id));
    writeAddonNoMount(gmodInfo, newNoMount);

    return {
        success: true,
        modifiedCount: targetWorkshopIds.length
    };
}

module.exports = {
    runDiagnostics,
    fixAddonConflict,
    undoAddonConflict,
    getDismissedNavState,
    dismissNavMap,
    dismissAllNavMaps,
    restoreNavMaps
};
