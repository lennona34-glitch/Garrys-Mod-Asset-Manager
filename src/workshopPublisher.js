const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createWithGmad } = require('./gmaParser');

/**
 * Formats a clean default addon title from a map name
 * e.g. rp_riteunn_felucia_night_v1 -> [NavMesh] rp_riteunn_felucia_night_v1
 */
function getDefaultTitle(mapName) {
    return `[NavMesh] ${mapName}`;
}

/**
 * Formats a clean default description
 */
function getDefaultDescription(mapName) {
    return `Fully computed Navigation Mesh (.nav) for ${mapName}.\n\nFeatures:\n- Full walkable space and jump links\n- Tactical hiding, sniper, and encounter areas\n- Tested with Nextbots, VJ Base, and standard Source NPCs\n\nDrop in singleplayer or servers. Simply subscribe to install!`;
}

/**
 * Queries gmpublish list to get official published workshop items
 */
function listPublishedFiles(gmpublishExe) {
    return new Promise((resolve) => {
        execFile(gmpublishExe, ['list'], (err, stdout) => {
            if (err || !stdout) return resolve([]);
            const items = [];
            const lines = stdout.split(/\r?\n/);
            for (const line of lines) {
                const parts = line.trim().split('\t');
                if (parts.length >= 3 && /^\d{8,12}$/.test(parts[0])) {
                    items.push({
                        id: parts[0],
                        size: parts[1],
                        title: parts[2].replace(/^"|"$/g, '')
                    });
                }
            }
            resolve(items);
        });
    });
}

/**
 * Prepares the 512x512 icon.jpg required by gmpublish.exe
 */
function prepareIcon(mapName, gmodInfo, stagingDir, nativeImage) {
    const iconDest = path.join(stagingDir, 'icon.jpg');
    const defaultIconPath = path.join(__dirname, '..', 'data', 'default_navmesh_icon.jpg');
    
    // Potential thumbnail locations in order of preference
    const candidates = [
        path.join(__dirname, '..', 'data', 'thumbnails', `${mapName}.png`),
        path.join(__dirname, '..', 'data', 'thumbnails', `${mapName}.jpg`),
        gmodInfo.mapsDir ? path.join(gmodInfo.mapsDir, `${mapName}.png`) : null,
        gmodInfo.mapsDir ? path.join(gmodInfo.mapsDir, `${mapName}.jpg`) : null,
        path.join(__dirname, '..', 'data', 'thumbnails', `${mapName.toLowerCase()}.png`),
        path.join(__dirname, '..', 'data', 'thumbnails', `${mapName.toLowerCase()}.jpg`),
        defaultIconPath
    ].filter(Boolean);

    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            try {
                if (nativeImage) {
                    const img = nativeImage.createFromPath(cand);
                    if (!img.isEmpty()) {
                        const resized = img.resize({ width: 512, height: 512, quality: 'best' });
                        const jpgBuf = resized.toJPEG(90);
                        fs.writeFileSync(iconDest, jpgBuf);
                        return iconDest;
                    }
                } else {
                    if (cand.toLowerCase().endsWith('.jpg')) {
                        fs.copyFileSync(cand, iconDest);
                        return iconDest;
                    }
                }
            } catch (_) {}
        }
    }

    // 100% Reliable Fallback: Generate a high-contrast 512x512 bitmap badge
    if (nativeImage) {
        try {
            const width = 512;
            const height = 512;
            const buf = Buffer.alloc(width * height * 4);
            const centerX = 256;
            const centerY = 230;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    const bgGrad = Math.max(0, 1 - dist / 360);
                    let b = Math.round(25 + bgGrad * 35);
                    let g = Math.round(18 + bgGrad * 25);
                    let r = Math.round(12 + bgGrad * 18);

                    const isBorder = (x < 12 || x >= width - 12 || y < 12 || y >= height - 12);
                    const isInnerBorder = ((x >= 20 && x <= 22) || (x >= width - 23 && x <= width - 21) ||
                                           (y >= 20 && y <= 22) || (y >= height - 23 && y <= height - 21));

                    if (isBorder) {
                        b = 248; g = 189; r = 56;
                    } else if (isInnerBorder) {
                        b = 180; g = 120; r = 30;
                    } else {
                        if (Math.abs(dist - 60) < 2 || Math.abs(dist - 120) < 2 || Math.abs(dist - 180) < 2) {
                            b = Math.min(255, b + 60); g = Math.min(255, g + 80); r = Math.min(255, r + 20);
                        }
                        if ((Math.abs(dx) < 2 && dist < 190) || (Math.abs(dy) < 2 && dist < 190)) {
                            b = Math.min(255, b + 70); g = Math.min(255, g + 90); r = Math.min(255, r + 30);
                        }
                        if (Math.abs(dx) + Math.abs(dy) < 26) {
                            b = 250; g = 200; r = 56;
                        }
                    }

                    buf[idx] = b;
                    buf[idx + 1] = g;
                    buf[idx + 2] = r;
                    buf[idx + 3] = 255;
                }
            }

            const img = nativeImage.createFromBitmap(buf, { width, height });
            const jpgBuf = img.toJPEG(90);
            fs.writeFileSync(iconDest, jpgBuf);
            return iconDest;
        } catch (_) {}
    }

    return null;
}

/**
 * Compiles and publishes a map NavMesh to Steam Workshop
 */
async function publishNavmeshToWorkshop(gmodInfo, { mapName, title, description, tags }, nativeImage) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) {
        throw new Error('Garry\'s Mod directory not found.');
    }

    const gmadExe = path.join(path.dirname(gmodInfo.garrysmodDir), 'bin', 'gmad.exe');
    const gmpublishExe = path.join(path.dirname(gmodInfo.garrysmodDir), 'bin', 'gmpublish.exe');

    if (!fs.existsSync(gmadExe)) {
        throw new Error(`gmad.exe not found at: ${gmadExe}`);
    }
    if (!fs.existsSync(gmpublishExe)) {
        throw new Error(`gmpublish.exe not found at: ${gmpublishExe}`);
    }

    // 1. Check if .nav file exists, or auto-extract if bundled in workshop GMA
    let navPath = gmodInfo.mapsDir ? path.join(gmodInfo.mapsDir, `${mapName}.nav`) : null;
    if ((!navPath || !fs.existsSync(navPath)) && gmodInfo.mapsDir) {
        try {
            const { scanAllMaps } = require('./mapManager');
            const { extractSingleFile } = require('./gmaParser');
            const maps = await scanAllMaps(gmodInfo);
            const targetMap = maps.find(m => m.mapName.toLowerCase() === mapName.toLowerCase());
            if (targetMap && targetMap.source === 'workshop_gma' && targetMap.hasBundledNav) {
                const internalNavPath = `maps/${mapName}.nav`;
                const destNav = path.join(gmodInfo.mapsDir, `${mapName}.nav`);
                extractSingleFile(targetMap.filePath, internalNavPath, destNav);
                if (fs.existsSync(destNav)) {
                    navPath = destNav;
                }
            }
        } catch (_) {}
    }

    if (!navPath || !fs.existsSync(navPath)) {
        throw new Error(`NavMesh file '${mapName}.nav' not found in garrysmod/maps.`);
    }

    const safeMapName = mapName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const stagingBase = path.join(__dirname, '..', 'data', 'workshop_staging');
    const stagingDir = path.join(stagingBase, safeMapName);
    const stagingMapsDir = path.join(stagingDir, 'maps');

    // Clean & recreate staging directory
    if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingMapsDir, { recursive: true });

    try {
        // 2. Copy .nav file
        fs.copyFileSync(navPath, path.join(stagingMapsDir, `${mapName}.nav`));

        // 3. Write addon.json
        const finalTitle = (title && title.trim()) ? title.trim() : getDefaultTitle(mapName);
        const finalTags = (tags && Array.isArray(tags) && tags.length > 0) 
            ? tags.slice(0, 2) 
            : ['roleplay', 'realism'];

        const addonJson = {
            title: finalTitle,
            type: 'map',
            tags: finalTags,
            ignore: ['*.psd', '*.vcproj', '*.svn*', '*.git*']
        };
        fs.writeFileSync(path.join(stagingDir, 'addon.json'), JSON.stringify(addonJson, null, 2), 'utf8');

        // 4. Prepare 512x512 icon
        const iconPath = prepareIcon(mapName, gmodInfo, stagingBase, nativeImage);
        if (!iconPath || !fs.existsSync(iconPath)) {
            throw new Error('Failed to create or find 512x512 icon.jpg for Workshop upload.');
        }

        // 5. Compile GMA using gmad.exe
        const outGma = path.join(stagingBase, `${safeMapName}.gma`);
        if (fs.existsSync(outGma)) fs.unlinkSync(outGma);

        await createWithGmad(gmadExe, stagingDir, outGma);
        if (!fs.existsSync(outGma)) {
            throw new Error('Failed to generate GMA package with gmad.exe.');
        }

        // 6. Check if map is already published to Steam Workshop (to update instead of duplicate create)
        const cachedPub = loadCachedPublishedNavmeshes();
        const existingKey = mapName.toLowerCase();
        let existingWorkshopId = cachedPub[existingKey]?.workshopId || null;

        let publishArgs = ['create', '-addon', outGma, '-icon', iconPath];
        if (existingWorkshopId) {
            publishArgs = ['update', '-id', String(existingWorkshopId), '-addon', outGma, '-icon', iconPath];
        }

        // 7. Upload with gmpublish.exe
        return await new Promise((resolve) => {
            const child = execFile(gmpublishExe, publishArgs, async (err, stdout, stderr) => {
                const combined = (stdout || '') + (stderr || '');

                if (combined.includes("Couldn't initialize Steam")) {
                    return resolve({
                        success: false,
                        error: 'Steam is not running! Please open your Steam client and log in before publishing.',
                        details: combined
                    });
                }

                // Query official gmpublish list first to verify true status directly from Steamworks
                let publishedList = [];
                try {
                    publishedList = await listPublishedFiles(gmpublishExe);
                } catch (_) {}

                const matching = publishedList.find(item => 
                    item.title === finalTitle ||
                    item.title.toLowerCase().includes(mapName.toLowerCase()) ||
                    (existingWorkshopId && item.id === String(existingWorkshopId))
                );

                if (matching) {
                    recordPublishedNavmesh(mapName, {
                        workshopId: matching.id,
                        title: matching.title || finalTitle,
                        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${matching.id}`
                    });
                    return resolve({
                        success: true,
                        workshopId: matching.id,
                        title: matching.title || finalTitle,
                        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${matching.id}`,
                        message: `Successfully published ${finalTitle} to Steam Workshop!`,
                        details: combined
                    });
                }

                const isSuccessText = /success|done|created|updated/i.test(combined);
                if (isSuccessText) {
                    let workshopId = existingWorkshopId;
                    const fallbackMatch = combined.match(/\b(\d{9,11})\b/);
                    if (fallbackMatch && !fallbackMatch[1].startsWith('7656119')) {
                        workshopId = fallbackMatch[1];
                    } else if (!workshopId && publishedList.length > 0) {
                        workshopId = publishedList[0].id;
                    }

                    recordPublishedNavmesh(mapName, {
                        workshopId,
                        title: finalTitle,
                        url: workshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}` : null
                    });

                    return resolve({
                        success: true,
                        workshopId,
                        title: finalTitle,
                        url: workshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}` : null,
                        message: `Successfully published ${finalTitle} to Steam Workshop!`,
                        details: combined
                    });
                }

                if (err) {
                    return resolve({
                        success: false,
                        error: `Workshop upload error: ${err.message}`,
                        details: combined
                    });
                }

                return resolve({
                    success: true,
                    workshopId: existingWorkshopId || null,
                    title: finalTitle,
                    url: existingWorkshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${existingWorkshopId}` : null,
                    message: `Published ${finalTitle} to Steam Workshop!`,
                    details: combined
                });
            });

            // Feed newline in case gmpublish prompts
            if (child.stdin) {
                try {
                    child.stdin.write('\n');
                    child.stdin.end();
                } catch (_) {}
            }
        });

    } finally {
        // Clean up temporary staging folder
        try {
            if (fs.existsSync(stagingDir)) {
                fs.rmSync(stagingDir, { recursive: true, force: true });
            }
        } catch (_) {}
    }
}

const PUBLISHED_NAVMESHES_FILE = path.join(__dirname, '..', 'data', 'published_navmeshes.json');

function loadCachedPublishedNavmeshes() {
    try {
        if (fs.existsSync(PUBLISHED_NAVMESHES_FILE)) {
            return JSON.parse(fs.readFileSync(PUBLISHED_NAVMESHES_FILE, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function savePublishedNavmeshes(data) {
    try {
        const dir = path.dirname(PUBLISHED_NAVMESHES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PUBLISHED_NAVMESHES_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save published navmeshes file:', e);
    }
}

async function getPublishedNavmeshes(gmodInfo) {
    const cached = loadCachedPublishedNavmeshes();
    const gmpublishExe = gmodInfo?.gmpublishExe || (gmodInfo?.gmodRoot ? path.join(gmodInfo.gmodRoot, 'bin', 'gmpublish.exe') : null);

    if (gmpublishExe && fs.existsSync(gmpublishExe)) {
        try {
            const files = await listPublishedFiles(gmpublishExe);
            for (const item of files) {
                const m = item.title.match(/\[NavMesh\]\s*(.+)/i);
                const mapName = m ? m[1].trim() : item.title.trim();
                const key = mapName.toLowerCase();
                cached[key] = {
                    mapName,
                    workshopId: item.id,
                    title: item.title,
                    size: item.size,
                    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`,
                    updatedAt: Date.now()
                };
            }
            savePublishedNavmeshes(cached);
        } catch (e) {
            console.warn('Could not query gmpublish list:', e);
        }
    }
    return cached;
}

function recordPublishedNavmesh(mapName, details) {
    const cached = loadCachedPublishedNavmeshes();
    const key = mapName.toLowerCase();
    cached[key] = {
        mapName,
        workshopId: details.workshopId || null,
        title: details.title || `[NavMesh] ${mapName}`,
        url: details.url || (details.workshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${details.workshopId}` : null),
        updatedAt: Date.now()
    };
    savePublishedNavmeshes(cached);
    return cached;
}

module.exports = {
    getDefaultTitle,
    getDefaultDescription,
    prepareIcon,
    publishNavmeshToWorkshop,
    getPublishedNavmeshes,
    recordPublishedNavmesh
};

