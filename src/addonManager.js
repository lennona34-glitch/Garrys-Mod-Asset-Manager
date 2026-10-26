const fs = require('fs');
const path = require('path');
const { parseGmaHeader, extractWithGmad, createWithGmad } = require('./gmaParser');

// Permanently banned / deleted intrusive addons ("The Broken End [nextbot] (REMIX)" 3819314523 & "TBS Entity Base" 3732561347)
const PERMANENTLY_BANNED_WORKSHOP_IDS = new Set(['3819314523', '3732561347']);
// Redundant duplicate/crash packs kept unmounted during bulk "Enable" operations
const CONFLICT_REDUNDANT_WORKSHOP_IDS = new Set(['2957323514', '2988753442', '2995239904', '3483718453', '3727245204']);
// Essential texture/base content kept mounted during bulk "Disable" operations
const ESSENTIAL_MOUNTED_WORKSHOP_IDS = new Set(['3540392343', '3414484452', '3066445274']);

/**
 * Scan all installed addons (Workshop + Local)
 */
async function scanAllAddons(gmodInfo) {
    const addons = [];
    if (!gmodInfo) return addons;

    let noMountSet = new Set();
    let noMountPath = null;
    if (gmodInfo.garrysmodDir) {
        noMountPath = path.join(gmodInfo.garrysmodDir, 'cfg', 'addonnomount.txt');
        if (fs.existsSync(noMountPath)) {
            try {
                const content = fs.readFileSync(noMountPath, 'utf8');
                const matches = [...content.matchAll(/"\d+"\s+"([^"]+)"/g)];
                noMountSet = new Set(matches.map(m => m[1]));
            } catch (_) {}
        }
        // Always ensure banned addons are in addonnomount.txt
        let bannedAdded = false;
        for (const bannedId of PERMANENTLY_BANNED_WORKSHOP_IDS) {
            if (!noMountSet.has(bannedId)) {
                noMountSet.add(bannedId);
                bannedAdded = true;
            }
        }
        if (bannedAdded && noMountPath) {
            try {
                const ids = [...noMountSet];
                let out = '"addonnomount"\n{\n';
                ids.forEach((id, idx) => { out += `\t"${idx + 1}"\t\t"${id}"\n`; });
                out += '}\n';
                fs.mkdirSync(path.dirname(noMountPath), { recursive: true });
                fs.writeFileSync(noMountPath, out, 'utf8');
            } catch (_) {}
        }
    }

    // 1. Scan Workshop Addons (steamapps/workshop/content/4000)
    if (gmodInfo.workshopDir && fs.existsSync(gmodInfo.workshopDir)) {
        try {
            const itemFolders = fs.readdirSync(gmodInfo.workshopDir, { withFileTypes: true });
            for (const itemFolder of itemFolders) {
                if (!itemFolder.isDirectory()) continue;
                const folderPath = path.join(gmodInfo.workshopDir, itemFolder.name);

                // Permanently purge "The Broken End" (3819314523) & "TBS Entity Base" (3732561347) if present on disk
                if (PERMANENTLY_BANNED_WORKSHOP_IDS.has(itemFolder.name)) {
                    try {
                        fs.rmSync(folderPath, { recursive: true, force: true });
                    } catch (_) {}
                    continue;
                }

                const files = fs.readdirSync(folderPath);

                for (const file of files) {
                    const lower = file.toLowerCase();
                    if (lower.endsWith('.gma') || lower.endsWith('.gma.disabled') || lower.endsWith('.bin')) {
                        const fullPath = path.join(folderPath, file);
                        const isEnabled = !lower.endsWith('.disabled') && !noMountSet.has(itemFolder.name);
                        const stats = fs.statSync(fullPath);

                        let header = null;
                        try {
                            header = parseGmaHeader(fullPath);
                        } catch (_) {}

                        addons.push({
                            id: `workshop_${itemFolder.name}`,
                            workshopId: itemFolder.name,
                            name: (header && header.name) ? header.name : itemFolder.name,
                            author: (header && header.author) ? header.author : 'Steam Workshop',
                            description: (header && header.description) ? header.description : '',
                            category: (header && header.category) ? header.category : (header && header.maps && header.maps.length > 0 ? 'Map' : 'Addon'),
                            tags: (header && header.tags) ? header.tags : [],
                            filePath: fullPath,
                            fileSize: stats.size,
                            filesCount: (header && header.filesCount) ? header.filesCount : 1,
                            modified: stats.mtime,
                            isEnabled,
                            isWorkshop: true,
                            mapsCount: (header && header.maps) ? header.maps.length : 0,
                            previewUrl: null // will be enriched
                        });
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Error scanning workshop addons:', e);
        }
    }

    // 2. Scan Local / Legacy Addons (garrysmod/addons)
    if (gmodInfo.addonsDir && fs.existsSync(gmodInfo.addonsDir)) {
        try {
            const entries = fs.readdirSync(gmodInfo.addonsDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(gmodInfo.addonsDir, entry.name);
                const lower = entry.name.toLowerCase();

                if (entry.isFile() && (lower.endsWith('.gma') || lower.endsWith('.gma.disabled'))) {
                    const isEnabled = !lower.endsWith('.disabled');
                    const stats = fs.statSync(fullPath);
                    try {
                        const header = parseGmaHeader(fullPath);
                        if (header) {
                            addons.push({
                                id: `local_gma_${entry.name}`,
                                workshopId: null,
                                name: header.name || entry.name,
                                author: header.author,
                                description: header.description,
                                category: header.category,
                                tags: header.tags,
                                filePath: fullPath,
                                fileSize: stats.size,
                                filesCount: header.filesCount,
                                modified: stats.mtime,
                                isEnabled,
                                isWorkshop: false,
                                mapsCount: header.maps.length,
                                previewUrl: null
                            });
                        }
                    } catch (e) {
                        // ignore
                    }
                } else if (entry.isDirectory()) {
                    // Legacy unpacked addon folder or 2D Studio Custom Character
                    const hasDisabledLua = fs.existsSync(path.join(fullPath, '_disabled_lua'));
                    const isEnabled = !lower.endsWith('.disabled') && !lower.startsWith('_disabled_') && !hasDisabledLua;
                    const stats = fs.statSync(fullPath);
                    let addonTitle = entry.name.replace(/\.disabled$/i, '');
                    let author = 'Local Addon';
                    let desc = '';
                    let isStudio2D = lower.startsWith('studio_2d_');

                    const jsonPath = path.join(fullPath, 'addon.json');
                    if (fs.existsSync(jsonPath)) {
                        try {
                            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                            if (data.title) addonTitle = data.title;
                            if (data.author_name) author = data.author_name;
                            if (data.description) desc = data.description;
                            if (data.studioRemix) isStudio2D = true;
                        } catch (_) {}
                    }

                    // Calculate real folder size and find local entity icon if present
                    let dirSize = 0;
                    let fileCount = 0;
                    let localPreviewUrl = null;
                    const walkLocal = (dir) => {
                        if (!fs.existsSync(dir)) return;
                        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
                            const p = path.join(dir, item.name);
                            if (item.isDirectory()) {
                                walkLocal(p);
                            } else {
                                fileCount++;
                                try { dirSize += fs.statSync(p).size; } catch (_) {}
                                if (!localPreviewUrl && p.toLowerCase().includes('materials') && /\.(png|jpg)$/i.test(item.name)) {
                                    localPreviewUrl = 'file:///' + p.replace(/\\/g, '/');
                                }
                            }
                        }
                    };
                    try { walkLocal(fullPath); } catch (_) {}

                    addons.push({
                        id: `local_dir_${entry.name}`,
                        workshopId: null,
                        name: addonTitle,
                        author: isStudio2D ? '2D Asset Studio' : author,
                        description: desc,
                        category: isStudio2D ? '2D Studio Characters' : 'Unpacked Addon Folder',
                        tags: isStudio2D ? ['studio_2d', 'npc'] : ['legacy'],
                        filePath: fullPath,
                        fileSize: dirSize || stats.size,
                        filesCount: fileCount,
                        modified: stats.mtime,
                        isEnabled,
                        isWorkshop: false,
                        isFolder: true,
                        mapsCount: 0,
                        previewUrl: localPreviewUrl
                    });
                }
            }
        } catch (e) {
            console.error('Error scanning local addons:', e);
        }
    }

    return addons;
}

/**
 * Classifies an addon into a clean, user-friendly Section using GMA metadata, file paths, and Steam Workshop tags/title
 */
function classifyAddonSection(addon, wsDetail = null) {
    if (addon.category === '2D Studio Characters' || (addon.isFolder && addon.filePath && addon.filePath.toLowerCase().includes('studio_2d_'))) {
        return '2D Studio Characters';
    }

    const title = (wsDetail && wsDetail.title && (!addon.name || addon.name === addon.workshopId))
        ? wsDetail.title
        : (addon.name || '');
    const lowerTitle = title.toLowerCase();
    const rawCat = (addon.category || '').toLowerCase();
    const tags = [
        ...(Array.isArray(addon.tags) ? addon.tags : []),
        ...(wsDetail && Array.isArray(wsDetail.tags) ? wsDetail.tags : [])
    ].map(t => String(t).toLowerCase());

    if (
        rawCat === 'map' ||
        addon.mapsCount > 0 ||
        tags.includes('map') ||
        /^\[navmesh\]|\bnavmesh\b|^gm_|^rp_|^ttt_|^zs_|^ph_|^jb_/i.test(title)
    ) {
        return 'Maps & NavMeshes';
    }

    if (
        rawCat === 'gamemode' ||
        tags.includes('gamemode') ||
        /\bgamemode\b/i.test(lowerTitle)
    ) {
        return 'Gamemodes';
    }

    if (
        rawCat === 'npcs & nextbots' ||
        rawCat === 'npc' ||
        tags.includes('npc') ||
        /\b(nextbot|nextboat|snpc|npc|drgbase|vj base)\b/i.test(lowerTitle)
    ) {
        return 'NPCs & NextBots';
    }

    if (
        rawCat === 'weapon' ||
        tags.includes('weapon') ||
        /\b(swep|weapon|m9k|tfa|arccw|arc9|cw 2\.0|guns?|rifles?|pistols?)\b/i.test(lowerTitle)
    ) {
        return 'Weapons';
    }

    if (
        rawCat === 'vehicle' ||
        tags.includes('vehicle') ||
        /\b(simfphys|vehicle|lvs|glide|scars|car pack|cars|wac|lfs)\b/i.test(lowerTitle)
    ) {
        return 'Vehicles';
    }

    if (
        rawCat === 'tool' ||
        tags.includes('tool')
    ) {
        return 'Tools & Utilities';
    }

    if (
        rawCat === 'effects & realism' ||
        rawCat === 'effects' ||
        tags.includes('effects') ||
        /\b(reshade|realism|hud|fx|effect|shader|blood|gore|lighting|graphic)\b/i.test(lowerTitle)
    ) {
        return 'Effects & Realism';
    }

    if (
        rawCat === 'model / playermodel' ||
        rawCat === 'model' ||
        tags.includes('model') ||
        /\b(playermodel|pm|ragdoll|model|prop)\b/i.test(lowerTitle)
    ) {
        return 'Models & Playermodels';
    }

    return 'Tools & Utilities';
}

/**
 * Helper to toggle a single local file/folder on disk
 */
function toggleLocalAddonPath(addonFilePath, enable) {
    if (!fs.existsSync(addonFilePath)) return addonFilePath;
    const stats = fs.statSync(addonFilePath);
    const isCurrentlyDisabled = addonFilePath.toLowerCase().endsWith('.disabled');
    let newPath = addonFilePath;

    if (stats.isDirectory()) {
        const luaDir = path.join(addonFilePath, 'lua');
        const disabledLuaDir = path.join(addonFilePath, '_disabled_lua');
        if (enable && fs.existsSync(disabledLuaDir) && !fs.existsSync(luaDir)) {
            try { fs.renameSync(disabledLuaDir, luaDir); } catch (_) {}
        } else if (!enable && fs.existsSync(luaDir) && !fs.existsSync(disabledLuaDir)) {
            try { fs.renameSync(luaDir, disabledLuaDir); } catch (_) {}
        }
    }

    if (enable && isCurrentlyDisabled) {
        newPath = addonFilePath.replace(/\.disabled$/i, '');
        try { fs.renameSync(addonFilePath, newPath); } catch (_) { newPath = addonFilePath; }
    } else if (!enable && !isCurrentlyDisabled) {
        newPath = `${addonFilePath}.disabled`;
        try { fs.renameSync(addonFilePath, newPath); } catch (_) { newPath = addonFilePath; }
    }
    return newPath;
}

/**
 * Toggle addon enabled / disabled state
 */
function toggleAddonState(addonFilePath, enable, gmodInfo = null) {
    if (!fs.existsSync(addonFilePath)) {
        throw new Error(`File does not exist: ${addonFilePath}`);
    }

    const parentDir = path.basename(path.dirname(addonFilePath));
    const isWorkshopItem = /^\d+$/.test(parentDir);

    if (isWorkshopItem && gmodInfo && gmodInfo.garrysmodDir) {
        const noMountPath = path.join(gmodInfo.garrysmodDir, 'cfg', 'addonnomount.txt');
        let ids = [];
        if (fs.existsSync(noMountPath)) {
            try {
                const content = fs.readFileSync(noMountPath, 'utf8');
                ids = [...content.matchAll(/"\d+"\s+"([^"]+)"/g)].map(m => m[1]);
            } catch (_) {}
        }
        if (enable) {
            ids = ids.filter(id => id !== parentDir);
        } else {
            ids.push(parentDir);
        }
        ids = [...new Set(ids)];
        let out = '"addonnomount"\n{\n';
        ids.forEach((id, idx) => {
            out += `\t"${idx + 1}"\t\t"${id}"\n`;
        });
        out += '}\n';
        fs.writeFileSync(noMountPath, out, 'utf8');

        // Ensure file is not named .disabled so Steam never tries to redownload
        if (addonFilePath.toLowerCase().endsWith('.disabled')) {
            const normalPath = addonFilePath.replace(/\.disabled$/i, '');
            try { fs.renameSync(addonFilePath, normalPath); } catch (_) {}
            addonFilePath = normalPath;
        }

        return {
            previousPath: addonFilePath,
            newPath: addonFilePath,
            isEnabled: enable
        };
    }

    const newPath = toggleLocalAddonPath(addonFilePath, enable);

    return {
        previousPath: addonFilePath,
        newPath,
        isEnabled: enable
    };
}

/**
 * High-speed batch toggle for a section or multiple addons (updates addonnomount.txt in a single write)
 */
function bulkToggleAddonStates(addonFilePaths, enable, gmodInfo = null) {
    if (!Array.isArray(addonFilePaths) || addonFilePaths.length === 0) {
        return { count: 0 };
    }

    const noMountPath = (gmodInfo && gmodInfo.garrysmodDir)
        ? path.join(gmodInfo.garrysmodDir, 'cfg', 'addonnomount.txt')
        : null;

    let noMountSet = new Set();
    if (noMountPath && fs.existsSync(noMountPath)) {
        try {
            const content = fs.readFileSync(noMountPath, 'utf8');
            const matches = [...content.matchAll(/"\d+"\s+"([^"]+)"/g)].map(m => m[1]);
            noMountSet = new Set(matches);
        } catch (_) {}
    }

    let workshopChanged = false;
    let count = 0;

    for (const filePath of addonFilePaths) {
        if (!filePath || !fs.existsSync(filePath)) continue;
        const parentDir = path.basename(path.dirname(filePath));
        const isWorkshopItem = /^\d+$/.test(parentDir);

        if (isWorkshopItem && noMountPath) {
            if (PERMANENTLY_BANNED_WORKSHOP_IDS.has(parentDir)) {
                noMountSet.add(parentDir);
                workshopChanged = true;
                continue;
            }
            if (enable) {
                // Do not bulk-enable known redundant duplicate / crash-conflicting packs
                if (CONFLICT_REDUNDANT_WORKSHOP_IDS.has(parentDir)) {
                    noMountSet.add(parentDir);
                    workshopChanged = true;
                    continue;
                }
                noMountSet.delete(parentDir);
            } else {
                // Keep essential CS:S texture fixes mounted even during bulk disable
                if (ESSENTIAL_MOUNTED_WORKSHOP_IDS.has(parentDir)) {
                    noMountSet.delete(parentDir);
                    workshopChanged = true;
                    continue;
                }
                noMountSet.add(parentDir);
            }
            workshopChanged = true;
            if (filePath.toLowerCase().endsWith('.disabled')) {
                const normalPath = filePath.replace(/\.disabled$/i, '');
                try { fs.renameSync(filePath, normalPath); } catch (_) {}
            }
            count++;
        } else {
            toggleLocalAddonPath(filePath, enable);
            count++;
        }
    }

    if (workshopChanged && noMountPath) {
        const ids = [...noMountSet];
        let out = '"addonnomount"\n{\n';
        ids.forEach((id, idx) => {
            out += `\t"${idx + 1}"\t\t"${id}"\n`;
        });
        out += '}\n';
        fs.mkdirSync(path.dirname(noMountPath), { recursive: true });
        fs.writeFileSync(noMountPath, out, 'utf8');
    }

    return { count, isEnabled: enable };
}

/**
 * Inspect contents of a GMA file
 */
function inspectGma(gmaFilePath) {
    return parseGmaHeader(gmaFilePath);
}

/**
 * Unpack a GMA file into garrysmod/addons/<addonName>
 */
async function unpackAddon(gmodInfo, gmaFilePath, customOutputDir = null) {
    const header = parseGmaHeader(gmaFilePath);
    const safeName = (header && header.name ? header.name : path.basename(gmaFilePath, '.gma'))
        .replace(/[^a-zA-Z0-9_\- ]/g, '_')
        .trim();

    const outputDir = customOutputDir || path.join(gmodInfo.addonsDir, safeName);
    return await extractWithGmad(gmodInfo.gmadExe, gmaFilePath, outputDir);
}

/**
 * Pack a folder into a GMA file
 */
async function packAddonFolder(gmodInfo, folderPath, outGmaPath) {
    return await createWithGmad(gmodInfo.gmadExe, folderPath, outGmaPath);
}

/**
 * Delete an addon file
 */
function deleteAddon(addonFilePath) {
    if (fs.existsSync(addonFilePath)) {
        const stats = fs.statSync(addonFilePath);
        if (stats.isDirectory()) {
            fs.rmSync(addonFilePath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(addonFilePath);
        }
        return true;
    }
    return false;
}

module.exports = {
    scanAllAddons,
    classifyAddonSection,
    toggleAddonState,
    bulkToggleAddonStates,
    inspectGma,
    unpackAddon,
    packAddonFolder,
    deleteAddon
};
