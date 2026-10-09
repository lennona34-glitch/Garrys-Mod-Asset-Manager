const fs = require('fs');
const path = require('path');
const { parseGmaHeader, extractWithGmad, createWithGmad } = require('./gmaParser');

/**
 * Scan all installed addons (Workshop + Local)
 */
async function scanAllAddons(gmodInfo) {
    const addons = [];
    if (!gmodInfo) return addons;

    // 1. Scan Workshop Addons (steamapps/workshop/content/4000)
    if (gmodInfo.workshopDir && fs.existsSync(gmodInfo.workshopDir)) {
        try {
            const itemFolders = fs.readdirSync(gmodInfo.workshopDir, { withFileTypes: true });
            for (const itemFolder of itemFolders) {
                if (!itemFolder.isDirectory()) continue;
                const folderPath = path.join(gmodInfo.workshopDir, itemFolder.name);
                const files = fs.readdirSync(folderPath);

                for (const file of files) {
                    const lower = file.toLowerCase();
                    if (lower.endsWith('.gma') || lower.endsWith('.gma.disabled')) {
                        const fullPath = path.join(folderPath, file);
                        const isEnabled = !lower.endsWith('.disabled');
                        const stats = fs.statSync(fullPath);

                        try {
                            const header = parseGmaHeader(fullPath);
                            if (header) {
                                addons.push({
                                    id: `workshop_${itemFolder.name}`,
                                    workshopId: itemFolder.name,
                                    name: header.name || itemFolder.name,
                                    author: header.author,
                                    description: header.description,
                                    category: header.category,
                                    tags: header.tags,
                                    filePath: fullPath,
                                    fileSize: stats.size,
                                    filesCount: header.filesCount,
                                    modified: stats.mtime,
                                    isEnabled,
                                    isWorkshop: true,
                                    mapsCount: header.maps.length,
                                    previewUrl: null // will be enriched
                                });
                            }
                        } catch (err) {
                            // GMA parsing error fallback
                            addons.push({
                                id: `workshop_${itemFolder.name}`,
                                workshopId: itemFolder.name,
                                name: itemFolder.name,
                                author: 'Unknown',
                                description: '',
                                category: 'Unknown',
                                tags: [],
                                filePath: fullPath,
                                fileSize: stats.size,
                                filesCount: 0,
                                modified: stats.mtime,
                                isEnabled,
                                isWorkshop: true,
                                mapsCount: 0,
                                previewUrl: null
                            });
                        }
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
                    // Legacy unpacked addon folder
                    const isEnabled = !lower.endsWith('.disabled') && !lower.startsWith('_disabled_');
                    const stats = fs.statSync(fullPath);
                    let addonTitle = entry.name;
                    let author = 'Unknown';
                    let desc = '';

                    const jsonPath = path.join(fullPath, 'addon.json');
                    if (fs.existsSync(jsonPath)) {
                        try {
                            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                            if (data.title) addonTitle = data.title;
                            if (data.author_name) author = data.author_name;
                            if (data.description) desc = data.description;
                        } catch (_) {}
                    }

                    addons.push({
                        id: `local_dir_${entry.name}`,
                        workshopId: null,
                        name: addonTitle,
                        author,
                        description: desc,
                        category: 'Unpacked Addon Folder',
                        tags: ['legacy'],
                        filePath: fullPath,
                        fileSize: stats.size,
                        filesCount: -1,
                        modified: stats.mtime,
                        isEnabled,
                        isWorkshop: false,
                        isFolder: true,
                        mapsCount: 0,
                        previewUrl: null
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
 * Toggle addon enabled / disabled state
 */
function toggleAddonState(addonFilePath, enable) {
    if (!fs.existsSync(addonFilePath)) {
        throw new Error(`File does not exist: ${addonFilePath}`);
    }

    const isCurrentlyDisabled = addonFilePath.toLowerCase().endsWith('.disabled');
    let newPath = addonFilePath;

    if (enable && isCurrentlyDisabled) {
        newPath = addonFilePath.replace(/\.disabled$/i, '');
        fs.renameSync(addonFilePath, newPath);
    } else if (!enable && !isCurrentlyDisabled) {
        newPath = `${addonFilePath}.disabled`;
        fs.renameSync(addonFilePath, newPath);
    }

    return {
        previousPath: addonFilePath,
        newPath,
        isEnabled: enable
    };
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
    toggleAddonState,
    inspectGma,
    unpackAddon,
    packAddonFolder,
    deleteAddon
};
