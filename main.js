const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');

const { detectGmodPaths } = require('./src/steamDetector');
const { scanAllMaps, launchMap, extractMapToNative, injectNavmeshAutopilot } = require('./src/mapManager');
const { scanAllAddons, toggleAddonState, inspectGma, unpackAddon, packAddonFolder, deleteAddon } = require('./src/addonManager');
const { analyzeStorage, cleanTarget } = require('./src/storageCleaner');
const { fetchPublishedFileDetails, searchWorkshop, openInSteamClient, openInBrowser, openSteamWorkshopHub, openSteamUrl } = require('./src/workshopService');
const { loadPresets, createPreset, deletePreset, applyPreset } = require('./src/presetsManager');
const { runDiagnostics, fixAddonConflict, undoAddonConflict } = require('./src/diagnosticsManager');
const { getDefaultTitle, getDefaultDescription, publishNavmeshToWorkshop } = require('./src/workshopPublisher');

let mainWindow = null;
let currentGmodInfo = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1300,
        height: 850,
        minWidth: 1050,
        minHeight: 650,
        backgroundColor: '#0f141c',
        title: "Garry's Mod Map & Asset Manager",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        autoHideMenuBar: true
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    currentGmodInfo = detectGmodPaths();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers

ipcMain.handle('toggle-fullscreen', async () => {
    if (mainWindow) {
        const next = !mainWindow.isFullScreen();
        mainWindow.setFullScreen(next);
        return next;
    }
    return false;
});

ipcMain.handle('is-fullscreen', async () => {
    return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('get-gmod-info', async () => {
    if (!currentGmodInfo) {
        currentGmodInfo = detectGmodPaths();
    }
    return currentGmodInfo;
});

ipcMain.handle('set-custom-gmod-path', async (event, customPath) => {
    currentGmodInfo = detectGmodPaths(customPath);
    return currentGmodInfo;
});

ipcMain.handle('select-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('scan-maps', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    const maps = await scanAllMaps(currentGmodInfo);

    // Enrich workshop maps with cached thumbnails
    const workshopIds = [...new Set(maps.filter(m => m.workshopId).map(m => m.workshopId))];
    if (workshopIds.length > 0) {
        const details = await fetchPublishedFileDetails(workshopIds);
        maps.forEach(m => {
            if (m.workshopId && details[m.workshopId]) {
                if (!m.thumbnail && details[m.workshopId].previewUrl) {
                    m.thumbnail = details[m.workshopId].previewUrl;
                }
            }
        });
    }

    return maps;
});

ipcMain.handle('launch-map', async (event, { mapName, options }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await launchMap(currentGmodInfo, mapName, options);
});

ipcMain.handle('extract-map', async (event, { gmaPath, internalMapPath }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await extractMapToNative(currentGmodInfo, gmaPath, internalMapPath);
});

ipcMain.handle('scan-addons', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    const addons = await scanAllAddons(currentGmodInfo);

    // Enrich workshop addons with details (batch)
    const workshopIds = [...new Set(addons.filter(a => a.workshopId).map(a => a.workshopId))];
    if (workshopIds.length > 0) {
        const details = await fetchPublishedFileDetails(workshopIds);
        addons.forEach(a => {
            if (a.workshopId && details[a.workshopId]) {
                a.previewUrl = details[a.workshopId].previewUrl;
                if (!a.description) a.description = details[a.workshopId].description;
                a.subscriptions = details[a.workshopId].subscriptions;
                a.views = details[a.workshopId].views;
            }
        });
    }

    return addons;
});

ipcMain.handle('toggle-addon', async (event, { filePath, enable }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return toggleAddonState(filePath, enable, currentGmodInfo);
});

ipcMain.handle('inspect-gma', async (event, filePath) => {
    return inspectGma(filePath);
});

ipcMain.handle('unpack-addon', async (event, { gmaFilePath, customOutputDir }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await unpackAddon(currentGmodInfo, gmaFilePath, customOutputDir);
});

ipcMain.handle('pack-addon', async (event, { folderPath, outGmaPath }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await packAddonFolder(currentGmodInfo, folderPath, outGmaPath);
});

ipcMain.handle('delete-addon', async (event, filePath) => {
    return deleteAddon(filePath);
});

ipcMain.handle('analyze-storage', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return analyzeStorage(currentGmodInfo);
});

ipcMain.handle('clean-storage', async (event, target) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return cleanTarget(currentGmodInfo, target);
});

ipcMain.handle('search-workshop', async (event, options) => {
    return await searchWorkshop(options);
});

ipcMain.handle('open-steam-client', async (event, workshopId) => {
    return openInSteamClient(workshopId);
});

ipcMain.handle('open-steam-workshop-hub', async () => {
    return openSteamWorkshopHub();
});

ipcMain.handle('open-external-url', async (event, url) => {
    if (url && (url.includes('steamcommunity.com') || url.includes('steampowered.com'))) {
        return openSteamUrl(url);
    }
    await shell.openExternal(url);
    return true;
});

ipcMain.handle('reveal-in-explorer', async (event, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
});

ipcMain.handle('load-presets', async () => {
    return loadPresets();
});

ipcMain.handle('create-preset', async (event, { name, description, addonIds }) => {
    return createPreset(name, description, addonIds);
});

ipcMain.handle('delete-preset', async (event, presetId) => {
    return deletePreset(presetId);
});

ipcMain.handle('apply-preset', async (event, presetId) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await applyPreset(presetId, currentGmodInfo);
});

ipcMain.handle('run-diagnostics', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await runDiagnostics(currentGmodInfo);
});

ipcMain.handle('fix-addon-conflict', async (event, conflictKey) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return fixAddonConflict(currentGmodInfo, conflictKey);
});

ipcMain.handle('generate-map-navmesh', async (event, mapName) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    injectNavmeshAutopilot(currentGmodInfo, mapName);

    // Watch for .nav creation and stream live percentage progress from console.log
    if (currentGmodInfo.mapsDir) {
        const targetNav = path.join(currentGmodInfo.mapsDir, `${mapName}.nav`);
        const logPath = currentGmodInfo.garrysmodDir ? path.join(currentGmodInfo.garrysmodDir, 'console.log') : null;
        let lastPercent = null;
        let lastPhase = null;
        const startTime = Date.now();

        const checkInterval = setInterval(() => {
            // Check if .nav file exists
            if (fs.existsSync(targetNav)) {
                clearInterval(checkInterval);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('navmesh-progress', {
                        mapName,
                        percent: 100,
                        phase: 'Complete! NavMesh saved successfully.'
                    });
                    mainWindow.webContents.send('navmesh-completed', mapName);
                }
                return;
            }

            // Tail console.log for percentage
            if (logPath && fs.existsSync(logPath)) {
                try {
                    const fd = fs.openSync(logPath, 'r');
                    const stats = fs.fstatSync(fd);
                    const readLen = Math.min(stats.size, 3072);
                    const buf = Buffer.alloc(readLen);
                    fs.readSync(fd, buf, 0, readLen, Math.max(0, stats.size - readLen));
                    fs.closeSync(fd);
                    const text = buf.toString('utf8');

                    const matchPercent = text.match(/Computing mesh visibility\.\.\.\s*(\d+)%/g);
                    if (matchPercent && matchPercent.length > 0) {
                        const lastMatch = matchPercent[matchPercent.length - 1];
                        const pNum = lastMatch.match(/(\d+)%/);
                        if (pNum && pNum[1] !== lastPercent) {
                            lastPercent = pNum[1];
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('navmesh-progress', {
                                    mapName,
                                    percent: parseInt(lastPercent, 10),
                                    phase: `Computing visibility... ${lastPercent}%`
                                });
                            }
                        }
                    } else if (text.includes('Sampling walkable space') && lastPhase !== 'sampling') {
                        lastPhase = 'sampling';
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('navmesh-progress', {
                                mapName,
                                percent: 5,
                                phase: 'Sampling walkable space...'
                            });
                        }
                    } else if ((text.includes('Generation complete') || text.includes('Optimizing mesh visibility')) && lastPhase !== 'finalizing') {
                        lastPhase = 'finalizing';
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('navmesh-progress', {
                                mapName,
                                percent: 99,
                                phase: 'Finalizing mesh & saving...'
                            });
                        }
                    }
                } catch (_) {}
            }

            if (Date.now() - startTime > 450000) {
                clearInterval(checkInterval);
            }
        }, 1200);
    }

    return await launchMap(currentGmodInfo, mapName, { extraArgs: '+sv_cheats 1 +nav_quicksave 1 +nav_max_view_distance 1' });
});

ipcMain.handle('subscribe-missing-bases', async (event, workshopIds) => {
    if (Array.isArray(workshopIds)) {
        for (const id of workshopIds) {
            openInSteamClient(id);
        }
    }
    return true;
});

ipcMain.handle('undo-addon-conflict', async (event, conflictKey) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return undoAddonConflict(currentGmodInfo, conflictKey);
});

ipcMain.handle('get-publish-navmesh-meta', async (event, mapName) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    const navPath = currentGmodInfo.mapsDir ? path.join(currentGmodInfo.mapsDir, `${mapName}.nav`) : null;
    let navSize = 0;
    if (navPath && fs.existsSync(navPath)) {
        navSize = fs.statSync(navPath).size;
    }

    let thumbUrl = null;
    const thumbCandidates = [
        path.join(__dirname, 'data', 'thumbnails', `${mapName}.png`),
        path.join(__dirname, 'data', 'thumbnails', `${mapName}.jpg`),
        currentGmodInfo.mapsDir ? path.join(currentGmodInfo.mapsDir, `${mapName}.png`) : null,
        currentGmodInfo.mapsDir ? path.join(currentGmodInfo.mapsDir, `${mapName}.jpg`) : null,
    ].filter(Boolean);

    for (const cand of thumbCandidates) {
        if (fs.existsSync(cand)) {
            thumbUrl = 'file://' + cand.replace(/\\/g, '/');
            break;
        }
    }

    return {
        mapName,
        title: getDefaultTitle(mapName),
        description: getDefaultDescription(mapName),
        navSize,
        thumbUrl
    };
});

ipcMain.handle('publish-navmesh', async (event, { mapName, title, description, tags }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await publishNavmeshToWorkshop(currentGmodInfo, { mapName, title, description, tags }, nativeImage);
});

function applyControllerTuning(gmodInfo, preset = 'smooth') {
    if (!gmodInfo || !gmodInfo.garrysmodDir) return { success: false, error: 'GMod path not found' };
    const cfgDir = path.join(gmodInfo.garrysmodDir, 'cfg');
    if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });

    let yawSens = '-0.55';
    let pitchSens = '0.45';
    let accelScale = '0.5';
    let accelMax = '1.0';
    let mouseSens = '2.2';

    if (preset === 'cinematic') {
        yawSens = '-0.35';
        pitchSens = '0.30';
        accelScale = '0.3';
        accelMax = '0.8';
        mouseSens = '1.6';
    } else if (preset === 'arcade') {
        yawSens = '-0.85';
        pitchSens = '0.65';
        accelScale = '0.8';
        accelMax = '1.4';
        mouseSens = '3.0';
    }

    const autoexecPath = path.join(cfgDir, 'autoexec.cfg');
    const configPath = path.join(cfgDir, 'config.cfg');

    const controllerBlock = `// --- Smooth Wireless Controller / Gamepad Tuning ---
// Fixes wild spinning, eliminates 2.0x acceleration spikes, adds comfortable deadzones
joystick "1"
joy_advanced "1"
joy_name "Xbox360 controller"

// Look Sensitivity (Yaw / Pitch) - Smooth, controllable aiming
joy_yawsensitivity "${yawSens}"
joy_pitchsensitivity "${pitchSens}"
joy_yawthreshold "0.15"
joy_pitchthreshold "0.15"

// Look Acceleration Curve - Eliminates the wild 2.0x sudden spin
joy_accelscale "${accelScale}"
joy_accelmax "${accelMax}"
joy_response_look "1"
joy_lowend "0.65"
joy_lowmap "0.15"
joy_autoaimdampen "0.5"
joy_autoaimdampenrange "0.85"

// Movement Sensitivity (Forward / Strafe) - Smooth walking to running
joy_forwardsensitivity "-0.85"
joy_sidesensitivity "0.85"
joy_forwardthreshold "0.15"
joy_sidethreshold "0.15"
joy_response_move "1"

// Mouse Sensitivity Fallback (For Steam Input Mouse Emulation)
sensitivity "${mouseSens}"
m_customaccel "0"`;

    // 1. Update autoexec.cfg
    let autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
    if (autoexecContent.includes('// --- Smooth Wireless Controller')) {
        autoexecContent = autoexecContent.replace(/\/\/ --- Smooth Wireless Controller[\s\S]*?m_customaccel "0"/, controllerBlock.trim());
    } else {
        autoexecContent += `\n\n${controllerBlock}\n`;
    }
    fs.writeFileSync(autoexecPath, autoexecContent, 'utf8');

    // 2. Update config.cfg if present
    if (fs.existsSync(configPath)) {
        try {
            let configContent = fs.readFileSync(configPath, 'utf8');
            configContent = configContent.replace(/joy_yawsensitivity "[^"]*"/, `joy_yawsensitivity "${yawSens}"`);
            configContent = configContent.replace(/joy_pitchsensitivity "[^"]*"/, `joy_pitchsensitivity "${pitchSens}"`);
            configContent = configContent.replace(/joy_accelscale "[^"]*"/, `joy_accelscale "${accelScale}"`);
            configContent = configContent.replace(/joy_accelmax "[^"]*"/, `joy_accelmax "${accelMax}"`);
            configContent = configContent.replace(/sensitivity "[^"]*"/, `sensitivity "${mouseSens}"`);
            fs.writeFileSync(configPath, configContent, 'utf8');
        } catch (_) {}
    }

    return { success: true, preset, yawSens, pitchSens, mouseSens };
}

ipcMain.handle('apply-controller-tuning', async (event, preset = 'smooth') => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return applyControllerTuning(currentGmodInfo, preset);
});


