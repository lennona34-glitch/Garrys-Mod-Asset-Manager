const fs = require('fs');
const path = require('path');

function getDirectorySize(dirPath) {
    if (!fs.existsSync(dirPath)) return { size: 0, count: 0 };
    let totalSize = 0;
    let fileCount = 0;

    function walk(current) {
        try {
            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (entry.isFile()) {
                    try {
                        const stats = fs.statSync(full);
                        totalSize += stats.size;
                        fileCount++;
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }

    walk(dirPath);
    return { size: totalSize, count: fileCount };
}

function analyzeStorage(gmodInfo) {
    if (!gmodInfo) return null;

    const gmodDir = gmodInfo.garrysmodDir;

    const downloadInfo = getDirectorySize(path.join(gmodDir, 'download'));
    const downloadListsInfo = getDirectorySize(path.join(gmodDir, 'downloadlists'));
    const cacheInfo = getDirectorySize(path.join(gmodDir, 'cache'));
    const screenshotsInfo = getDirectorySize(path.join(gmodDir, 'screenshots'));
    const dupesInfo = getDirectorySize(path.join(gmodDir, 'dupes'));
    const demosInfo = getDirectorySize(path.join(gmodDir, 'demos'));
    const workshopInfo = gmodInfo.workshopDir ? getDirectorySize(gmodInfo.workshopDir) : { size: 0, count: 0 };
    const mapsInfo = gmodInfo.mapsDir ? getDirectorySize(gmodInfo.mapsDir) : { size: 0, count: 0 };
    const addonsInfo = gmodInfo.addonsDir ? getDirectorySize(gmodInfo.addonsDir) : { size: 0, count: 0 };

    const cleanableTotal = downloadInfo.size + downloadListsInfo.size + cacheInfo.size;

    return {
        download: { ...downloadInfo, path: path.join(gmodDir, 'download') },
        downloadLists: { ...downloadListsInfo, path: path.join(gmodDir, 'downloadlists') },
        cache: { ...cacheInfo, path: path.join(gmodDir, 'cache') },
        screenshots: { ...screenshotsInfo, path: path.join(gmodDir, 'screenshots') },
        dupes: { ...dupesInfo, path: path.join(gmodDir, 'dupes') },
        demos: { ...demosInfo, path: path.join(gmodDir, 'demos') },
        workshop: { ...workshopInfo, path: gmodInfo.workshopDir },
        maps: { ...mapsInfo, path: gmodInfo.mapsDir },
        addons: { ...addonsInfo, path: gmodInfo.addonsDir },
        cleanableTotalBytes: cleanableTotal,
        totalGmodBytes: downloadInfo.size + downloadListsInfo.size + cacheInfo.size + screenshotsInfo.size + dupesInfo.size + demosInfo.size + workshopInfo.size + mapsInfo.size + addonsInfo.size
    };
}

function clearDirectoryContents(dirPath) {
    if (!fs.existsSync(dirPath)) return { deletedFiles: 0, reclaimedBytes: 0 };

    let deletedFiles = 0;
    let reclaimedBytes = 0;

    function removeRecursive(current) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                removeRecursive(full);
                try { fs.rmdirSync(full); } catch (_) {}
            } else if (entry.isFile()) {
                try {
                    const stats = fs.statSync(full);
                    reclaimedBytes += stats.size;
                    fs.unlinkSync(full);
                    deletedFiles++;
                } catch (_) {}
            }
        }
    }

    try {
        removeRecursive(dirPath);
    } catch (e) {
        console.error(`Failed clearing ${dirPath}:`, e);
    }

    return { deletedFiles, reclaimedBytes };
}

function cleanTarget(gmodInfo, targetName) {
    const gmodDir = gmodInfo.garrysmodDir;
    let targetPath = null;

    if (targetName === 'download') {
        targetPath = path.join(gmodDir, 'download');
    } else if (targetName === 'downloadlists') {
        targetPath = path.join(gmodDir, 'downloadlists');
    } else if (targetName === 'cache') {
        targetPath = path.join(gmodDir, 'cache');
    } else if (targetName === 'screenshots') {
        targetPath = path.join(gmodDir, 'screenshots');
    } else if (targetName === 'demos') {
        targetPath = path.join(gmodDir, 'demos');
    } else if (targetName === 'cleanAllCache') {
        const res1 = clearDirectoryContents(path.join(gmodDir, 'download'));
        const res2 = clearDirectoryContents(path.join(gmodDir, 'downloadlists'));
        const res3 = clearDirectoryContents(path.join(gmodDir, 'cache'));
        return {
            deletedFiles: res1.deletedFiles + res2.deletedFiles + res3.deletedFiles,
            reclaimedBytes: res1.reclaimedBytes + res2.reclaimedBytes + res3.reclaimedBytes
        };
    } else {
        throw new Error(`Unknown clean target: ${targetName}`);
    }

    return clearDirectoryContents(targetPath);
}

module.exports = {
    analyzeStorage,
    cleanTarget
};
