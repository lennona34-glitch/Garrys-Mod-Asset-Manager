const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');

const { detectGmodPaths, getAllSubscribedWorkshopIds } = require('./src/steamDetector');
const { scanAllMaps, launchMap, connectToServer, getLocalNetworkInfo, scanLanGames, extractMapToNative, injectNavmeshAutopilot } = require('./src/mapManager');
const { scanAllAddons, classifyAddonSection, toggleAddonState, bulkToggleAddonStates, inspectGma, unpackAddon, packAddonFolder, deleteAddon } = require('./src/addonManager');
const { analyzeStorage, cleanTarget } = require('./src/storageCleaner');
const { fetchPublishedFileDetails, searchWorkshop, openInSteamClient, openInBrowser, openSteamWorkshopHub, openSteamUrl } = require('./src/workshopService');
const { loadPresets, createPreset, deletePreset, applyPreset } = require('./src/presetsManager');
const { runDiagnostics, fixAddonConflict, undoAddonConflict, getDismissedNavState, dismissNavMap, dismissAllNavMaps, restoreNavMaps } = require('./src/diagnosticsManager');
const { getDefaultTitle, getDefaultDescription, publishNavmeshToWorkshop, getPublishedNavmeshes, recordPublishedNavmesh } = require('./src/workshopPublisher');
const { extractSingleFile } = require('./src/gmaParser');
const { scanEditableCharacters, loadCharacterForEditing, saveEditedCharacter, publishCharacterToWorkshop, saveRecordedAudio } = require('./src/assetEditor');

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

    mainWindow.webContents.on('did-finish-load', () => {
        try {
            mainWindow.webContents.setZoomFactor(1.0);
        } catch (_) {}
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    currentGmodInfo = detectGmodPaths();
    try {
        installQMenuCouchZoom(currentGmodInfo);
    } catch (e) {
        console.warn('Q-Menu Couch Zoom auto-install warning:', e);
    }
    try {
        installVoicemodLanVoiceAutopilot(currentGmodInfo);
    } catch (e) {
        console.warn('Voicemod LAN Voice Autopilot auto-install warning:', e);
    }
    try {
        applyControllerTuning(currentGmodInfo);
    } catch (e) {
        console.warn('Controller tuning auto-install warning:', e);
    }
    try {
        const { session } = require('electron');
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'media' || permission === 'audioCapture') {
                return callback(true);
            }
            callback(false);
        });
    } catch (_) {}
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

ipcMain.handle('set-fullscreen', async (event, enable) => {
    if (mainWindow) {
        mainWindow.setFullScreen(Boolean(enable));
        return mainWindow.isFullScreen();
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
    try {
        installVoicemodLanVoiceAutopilot(currentGmodInfo);
        const mode = (options && (options.hostMode || options.mode)) || 'singleplayer';
        if ((mode === 'lan' || mode === 'p2p') && (!options || options.autoVoicemod !== false)) {
            await activateVoicemodForGmod({ launchApp: true });
        } else {
            const st = getVoicemodStatus();
            if (st.running) {
                await activateVoicemodForGmod({ launchApp: false });
            }
        }
    } catch (_) {}
    return await launchMap(currentGmodInfo, mapName, options);
});

ipcMain.handle('connect-to-server', async (event, payload) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    try {
        installVoicemodLanVoiceAutopilot(currentGmodInfo);
        if (!payload || payload.autoVoicemod !== false) {
            await activateVoicemodForGmod({ launchApp: true });
        }
    } catch (_) {}
    return await connectToServer(currentGmodInfo, payload);
});

ipcMain.handle('get-local-network-info', async () => {
    return getLocalNetworkInfo();
});

ipcMain.handle('scan-lan-games', async () => {
    return await scanLanGames();
});

ipcMain.handle('extract-map', async (event, { gmaPath, internalMapPath }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await extractMapToNative(currentGmodInfo, gmaPath, internalMapPath);
});

ipcMain.handle('scan-addons', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    const addons = await scanAllAddons(currentGmodInfo);

    // Enrich workshop addons with details (batch) and classify every addon into its Section
    const workshopIds = [...new Set(addons.filter(a => a.workshopId).map(a => a.workshopId))];
    const details = workshopIds.length > 0 ? await fetchPublishedFileDetails(workshopIds) : {};

    addons.forEach(a => {
        const wsDetail = a.workshopId ? details[a.workshopId] : null;
        if (wsDetail) {
            if (!a.previewUrl && wsDetail.previewUrl) a.previewUrl = wsDetail.previewUrl;
            if ((!a.name || a.name === a.workshopId) && wsDetail.title) a.name = wsDetail.title;
            if (!a.description && wsDetail.description) a.description = wsDetail.description;
            if (Array.isArray(wsDetail.tags) && (!a.tags || a.tags.length === 0)) a.tags = wsDetail.tags;
            a.subscriptions = wsDetail.subscriptions;
            a.views = wsDetail.views;
        }
        a.category = classifyAddonSection(a, wsDetail);
    });

    return addons;
});

ipcMain.handle('toggle-addon', async (event, { filePath, enable }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return toggleAddonState(filePath, enable, currentGmodInfo);
});

ipcMain.handle('bulk-toggle-addons', async (event, { filePaths, enable }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return bulkToggleAddonStates(filePaths, enable, currentGmodInfo);
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

ipcMain.handle('get-dismissed-nav-state', async () => {
    return getDismissedNavState();
});

ipcMain.handle('dismiss-nav-map', async (event, mapName) => {
    return dismissNavMap(mapName);
});

ipcMain.handle('dismiss-all-nav-maps', async (event, allMapNames) => {
    return dismissAllNavMaps(allMapNames);
});

ipcMain.handle('restore-nav-maps', async () => {
    return restoreNavMaps();
});

ipcMain.handle('get-subscribed-workshop-ids', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return getAllSubscribedWorkshopIds(currentGmodInfo);
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
    let isBundled = false;

    if (navPath && fs.existsSync(navPath)) {
        navSize = fs.statSync(navPath).size;
    }

    // If loose nav is missing on disk, check if map has a bundled .nav in its workshop GMA
    if ((!navSize || navSize === 0) && currentGmodInfo.mapsDir) {
        try {
            const allMaps = await scanAllMaps(currentGmodInfo);
            const targetMap = allMaps.find(m => m.mapName.toLowerCase() === mapName.toLowerCase());
            if (targetMap && targetMap.source === 'workshop_gma' && targetMap.hasBundledNav && navPath) {
                const internalNavPath = `maps/${mapName}.nav`;
                extractSingleFile(targetMap.filePath, internalNavPath, navPath);
                if (fs.existsSync(navPath)) {
                    navSize = fs.statSync(navPath).size;
                    isBundled = true;
                }
            }
        } catch (_) {}
    }

    let thumbUrl = null;
    const defaultIcon = path.join(__dirname, 'data', 'default_navmesh_icon.jpg');
    const thumbCandidates = [
        path.join(__dirname, 'data', 'thumbnails', `${mapName}.png`),
        path.join(__dirname, 'data', 'thumbnails', `${mapName}.jpg`),
        currentGmodInfo.mapsDir ? path.join(currentGmodInfo.mapsDir, `${mapName}.png`) : null,
        currentGmodInfo.mapsDir ? path.join(currentGmodInfo.mapsDir, `${mapName}.jpg`) : null,
        defaultIcon
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
        thumbUrl,
        isBundled
    };
});

ipcMain.handle('get-published-navmeshes', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await getPublishedNavmeshes(currentGmodInfo);
});

ipcMain.handle('publish-navmesh', async (event, { mapName, title, description, tags }) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    const res = await publishNavmeshToWorkshop(currentGmodInfo, { mapName, title, description, tags }, nativeImage);
    if (res && res.success) {
        recordPublishedNavmesh(mapName, res);
    }
    return res;
});

function applyControllerTuning(gmodInfo, options = 7) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) return { success: false, error: 'GMod path not found' };
    const cfgDir = path.join(gmodInfo.garrysmodDir, 'cfg');
    if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });

    let speed = 7;
    let enableSmoothing = true;

    if (typeof options === 'object' && options !== null) {
        if (options.speed !== undefined) speed = Number(options.speed) || 7;
        if (options.smoothing !== undefined) enableSmoothing = Boolean(options.smoothing);
    } else if (typeof options === 'number') {
        speed = options;
    } else if (typeof options === 'string') {
        if (/^\d+$/.test(options)) {
            speed = parseInt(options, 10);
        } else if (options === 'cinematic') {
            speed = 4;
        } else if (options === 'smooth') {
            speed = 6;
        } else if (options === 'snappy') {
            speed = 7;
        } else if (options === 'arcade') {
            speed = 8;
        }
    }

    speed = Math.max(1, Math.min(10, Math.round(speed)));

    // Look Sensitivity & Accel calibrated dynamically around user's 1-10 scale
    const steamMouseSens = String(Math.round(25 + (speed * 12)));
    const yawSens = (-0.45 - (speed * 0.09)).toFixed(2);
    const pitchSens = (0.35 + (speed * 0.06)).toFixed(2);
    const mouseSens = (1.20 + (speed * 0.12)).toFixed(2);
    const accelScale = (0.35 + (speed * 0.02)).toFixed(2);
    const accelMax = (0.85 + (speed * 0.04)).toFixed(2);
    const steamSmoothingAmount = enableSmoothing ? '20' : '0';
    const steamCurveExponent = enableSmoothing ? '112' : '100';

    const autoexecPath = path.join(cfgDir, 'autoexec.cfg');
    const configPath = path.join(cfgDir, 'config.cfg');
    const controller360Path = path.join(cfgDir, '360controller.cfg');
    const joystickPath = path.join(cfgDir, 'joystick.cfg');

    const controllerBlock = `// --- Modern Tactical Wireless Controller / Gamepad Tuning ---
sc_enable "0"
joystick "1"
joy_advanced "1"
joy_name "Xbox360 controller"

// Axis Mapping (Standard XInput / DirectInput mapping)
// NOTE: joy_advaxisr and joy_advaxisu are set to 0 so native joystick look does NOT
// fight Steam Input mouse emulation, eliminating aim jitter/stutter.
joy_advaxisx "3"
joy_advaxisy "1"
joy_advaxisz "0"
joy_advaxisr "0"
joy_advaxisu "0"
joy_advaxisv "0"
joy_movement_stick "0"
joy_movement_stick_default "0"
joy_inverty "0"

// Movement Sensitivity (Forward / Strafe)
joy_forwardsensitivity "-1.0"
joy_sidesensitivity "1.0"
joy_forwardthreshold "0.15"
joy_sidethreshold "0.15"
joy_response_move "1"

// Look Sensitivity & Acceleration (Calibrated 6/10 Buttery Smooth Aiming)
joy_pitchsensitivity "${pitchSens}"
joy_yawsensitivity "${yawSens}"
joy_pitchthreshold "0.08"
joy_yawthreshold "0.08"
joy_accelscale "${accelScale}"
joy_accelmax "${accelMax}"
joy_response_look "1"
joy_lowend "0.65"
joy_lowmap "0.65"
joy_autoaimdampen "0.5"
joy_autoaimdampenrange "0.85"
sensitivity "${mouseSens}"
m_customaccel "0"
m_rawinput "1"
m_filter "0"

// ADS / Iron Sights Hold-To-Aim ConVars (Prevents tap-to-aim toggle)
arc9_toggleads "0"
cl_tfa_ironsights_toggle "0"
arccw_toggleads "0"
tacrp_toggleaim "0"

joyadvancedupdate

// Toggle sprint alias (Click R3 once to run continuously without holding)
alias sprint_toggle "sprint_on"
alias sprint_on "+speed; alias sprint_toggle sprint_off"
alias sprint_off "-speed; alias sprint_toggle sprint_on"

// Primary & Secondary Attack (Triggers)
bind "R_TRIGGER" "+attack"
bind "L_TRIGGER" "+attack2"
bind "Z AXIS NEG" "+attack"
bind "Z AXIS POS" "+attack2"

// Face Buttons & Bumpers
bind "A_BUTTON" "+jump"
bind "B_BUTTON" "+duck"
bind "X_BUTTON" "+use"
bind "Y_BUTTON" "+reload"
bind "L_SHOULDER" "invprev"
bind "R_SHOULDER" "+duck"

// Stick Clicks (L3 = Chat, R3 = Toggle Constant Run)
bind "STICK1" "messagemode"
bind "STICK2" "sprint_toggle"

// Menu & Scoreboard
bind "START" "pause"
bind "BACK" "+showscores"

// D-Pad Quick Actions
bind "POV_UP" "undo"
bind "POV_DOWN" "noclip"
bind "POV_RIGHT" "gmod_toggle_openmic"
bind "POV_LEFT" "+menu"

// Legacy DirectInput Fallbacks (JOY1 - JOY10)
bind "JOY1" "+jump"
bind "JOY2" "+duck"
bind "JOY3" "+use"
bind "JOY4" "+reload"
bind "JOY5" "invprev"
bind "JOY6" "+duck"
bind "JOY7" "+showscores"
bind "JOY8" "pause"
bind "JOY9" "messagemode"
bind "JOY10" "sprint_toggle"

// Native Source Engine Open Mic Latch (Works on ANY LAN server without Lua RunConsoleCommand block!)
alias vm_mic_keepalive "+voicerecord"
alias voice_openmic_on "alias vm_mic_keepalive +voicerecord; +voicerecord; alias gmod_toggle_openmic voice_openmic_off; play buttons/button14.wav"
alias voice_openmic_off "alias vm_mic_keepalive -voicerecord; -voicerecord; alias gmod_toggle_openmic voice_openmic_on; play buttons/button10.wav"
alias gmod_toggle_openmic "voice_openmic_off"

// Movement + Automatic Open Mic Latch (First step on any server latches mic ON in native C++!)
bind "w" "+forward; vm_mic_keepalive"
bind "a" "+moveleft; vm_mic_keepalive"
bind "s" "+back; vm_mic_keepalive"
bind "d" "+moveright; vm_mic_keepalive"

// Keyboard fallbacks
bind "b" "+duck"
bind "x" "gmod_toggle_openmic"
+voicerecord
// --- END CONTROLLER BLOCK ---`;

    // 1. Update autoexec.cfg
    let autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
    if (autoexecContent.includes('// --- Modern Tactical Wireless Controller') || autoexecContent.includes('// --- Smooth Wireless Controller')) {
        autoexecContent = autoexecContent.replace(/\/\/\s*---\s*(Modern Tactical Wireless|Smooth Wireless) Controller[\s\S]*?(?=\n\s*echo "====|$)/, controllerBlock.trim() + '\n');
    } else {
        autoexecContent += `\n\n${controllerBlock}\n`;
    }
    fs.writeFileSync(autoexecPath, autoexecContent, 'utf8');

    // 2. Update 360controller.cfg & joystick.cfg
    fs.writeFileSync(controller360Path, controllerBlock, 'utf8');
    fs.writeFileSync(joystickPath, controllerBlock, 'utf8');

    // 3. Keep joystick 1 in undo360controller.cfg
    const undoPath = path.join(cfgDir, 'undo360controller.cfg');
    if (fs.existsSync(undoPath)) {
        try {
            let undoContent = fs.readFileSync(undoPath, 'utf8');
            undoContent = undoContent.replace(/joystick\s+0/g, 'joystick 1');
            fs.writeFileSync(undoPath, undoContent, 'utf8');
        } catch (_) {}
    }

    // 4. Update config.cfg if present
    if (fs.existsSync(configPath)) {
        try {
            let configContent = fs.readFileSync(configPath, 'utf8');
            configContent = configContent.replace(/joy_yawsensitivity "[^"]*"/, `joy_yawsensitivity "${yawSens}"`);
            configContent = configContent.replace(/joy_pitchsensitivity "[^"]*"/, `joy_pitchsensitivity "${pitchSens}"`);
            configContent = configContent.replace(/joy_accelscale "[^"]*"/, `joy_accelscale "${accelScale}"`);
            configContent = configContent.replace(/joy_accelmax "[^"]*"/, `joy_accelmax "${accelMax}"`);
            configContent = configContent.replace(/sensitivity "[^"]*"/, `sensitivity "${mouseSens}"`);
            configContent = configContent.replace(/bind "w" "[^"]*"/, `bind "w" "+forward; vm_mic_keepalive"`);
            configContent = configContent.replace(/bind "a" "[^"]*"/, `bind "a" "+moveleft; vm_mic_keepalive"`);
            configContent = configContent.replace(/bind "s" "[^"]*"/, `bind "s" "+back; vm_mic_keepalive"`);
            configContent = configContent.replace(/bind "d" "[^"]*"/, `bind "d" "+moveright; vm_mic_keepalive"`);
            configContent = configContent.replace(/bind "b" "[^"]*"/, `bind "b" "+duck"`);
            configContent = configContent.replace(/bind "x" "[^"]*"/, `bind "x" "gmod_toggle_openmic"`);
            configContent = configContent.replace(/bind "RIGHT" "[^"]*"/, `bind "RIGHT" "gmod_toggle_openmic"`);
            if (!configContent.includes('spawnmenu_border')) {
                configContent = configContent.replace(/\+jlook/, `spawnmenu_border "0.015"\nspawnmenu_toggle "1"\n+jlook`);
            } else {
                configContent = configContent.replace(/spawnmenu_border "[^"]*"/, `spawnmenu_border "0.015"`);
            }
            if (!configContent.includes('+voicerecord')) {
                configContent = configContent.trimEnd() + '\n+voicerecord\n';
            }
            fs.writeFileSync(configPath, configContent, 'utf8');
        } catch (_) {}
    }

    // 5. Ensure client autorun keepalive Lua hook is in place
    try {
        const clientAutorun = path.join(gmodInfo.garrysmodDir, 'lua', 'autorun', 'client');
        if (!fs.existsSync(clientAutorun)) fs.mkdirSync(clientAutorun, { recursive: true });
        const keepalivePath = path.join(clientAutorun, 'zz_controller_keepalive.lua');
        const keepaliveLua = `-- Modern Wireless Controller Keepalive & Layout Enforcement
local function EnsureController()
    RunConsoleCommand("joystick", "1")
    RunConsoleCommand("joy_advanced", "1")
    RunConsoleCommand("joy_advaxisx", "3")
    RunConsoleCommand("joy_advaxisy", "1")
    RunConsoleCommand("joy_advaxisr", "0")
    RunConsoleCommand("joy_advaxisu", "0")
    RunConsoleCommand("joyadvancedupdate")
end
hook.Add("InitPostEntity", "ControllerKeepalive_InitPostEntity", function()
    timer.Simple(0.5, EnsureController)
    timer.Simple(2.5, EnsureController)
end)
hook.Add("OnScreenSizeChanged", "ControllerKeepalive_ScreenSize", function()
    EnsureController()
end)
timer.Create("ControllerKeepalive_Heartbeat", 8, 0, function()
    local joy = GetConVar("joystick")
    if joy and joy:GetInt() == 0 then
        EnsureController()
    end
end)
`;
        fs.writeFileSync(keepalivePath, keepaliveLua, 'utf8');
    } catch (_) {}

    // 6. Update Steam Input Workshop Profiles and configsets
    try {
        const profileFiles = [
            'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\241100\\923095811\\838078270046996915_legacy.bin',
            'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\241100\\2789459698\\1813269674151993644_legacy.bin'
        ];

        for (const pFile of profileFiles) {
            if (fs.existsSync(pFile)) {
                let binContent = fs.readFileSync(pFile, 'utf8');
                binContent = binContent.replace(/\"button_B\"[\s\S]*?\"binding\"\s+\"[^\"]*\"/gi, '"button_B"\n\t\t\t{\n\t\t\t\t"activators"\n\t\t\t\t{\n\t\t\t\t\t"Full_Press"\n\t\t\t\t\t{\n\t\t\t\t\t\t"bindings"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"binding"\t\t"key_press LEFT_CONTROL, Crouch"');
                binContent = binContent.replace(/\"right_bumper\"[\s\S]*?\"binding\"\s+\"[^\"]*\"/gi, '"right_bumper"\n\t\t\t{\n\t\t\t\t"activators"\n\t\t\t\t{\n\t\t\t\t\t"Full_Press"\n\t\t\t\t\t{\n\t\t\t\t\t\t"bindings"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"binding"\t\t"key_press LEFT_CONTROL, Crouch"');

                // D-Pad (Group 2) - Add Long_Press on dpad_east (D-Pad Right) to Toggle Voice Mic (X), while keeping Short Press as Next Weapon
                const group2Block = `"group"
	{
		"id"		"2"
		"mode"		"dpad"
		"inputs"
		{
			"dpad_north"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"		"key_press F, Flashlight"
						}
						"settings"
						{
							"haptic_intensity"		"1"
						}
					}
				}
			}
			"dpad_south"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"		"key_press V, Noclip"
						}
						"settings"
						{
							"haptic_intensity"		"1"
						}
					}
				}
			}
			"dpad_east"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"		"mouse_wheel SCROLL_DOWN, Next Weapon"
						}
						"settings"
						{
							"haptic_intensity"		"1"
							"interruptable"		"1"
						}
					}
					"Long_Press"
					{
						"bindings"
						{
							"binding"		"key_press X, Toggle Voice Mic"
						}
						"settings"
						{
							"haptic_intensity"		"2"
						}
					}
				}
			}
			"dpad_west"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"		"mouse_wheel SCROLL_UP, Prev Weapon"
						}
						"settings"
						{
							"haptic_intensity"		"1"
						}
					}
				}
			}
		}
	}`;
                binContent = binContent.replace(/"group"\s*\{\s*"id"\s*"2"[\s\S]*?\n\t\}/, group2Block);

                // Left Trigger (Group 4) - Hold to Aim Down Sights (ADS)
                const group4Block = `"group"
	{
		"id"\t\t"4"
		"mode"\t\t"trigger"
		"inputs"
		{
			"edge"
			{
				"activators"
				{
					"Soft_Press"
					{
						"bindings"
						{
							"binding"\t\t"mouse_button RIGHT, Hold to Aim Down Sights"
						}
					}
				}
			}
			"click"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"\t\t"mouse_button RIGHT, Hold to Aim Down Sights"
						}
					}
				}
			}
		}
		"settings"
		{
			"output_trigger"\t\t"1"
			"edge_binding_trigger_point"\t\t"1000"
		}
	}`;
                binContent = binContent.replace(/"group"\s*\{\s*"id"\s*"4"[\s\S]*?\n\t\}/, group4Block);

                // Right Trigger (Group 5) - Primary Attack / Fire
                const group5Block = `"group"
	{
		"id"\t\t"5"
		"mode"\t\t"trigger"
		"inputs"
		{
			"edge"
			{
				"activators"
				{
					"Soft_Press"
					{
						"bindings"
						{
							"binding"\t\t"mouse_button LEFT, Primary Attack"
						}
					}
				}
			}
			"click"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"\t\t"mouse_button LEFT, Primary Attack"
						}
					}
				}
			}
		}
		"settings"
		{
			"output_trigger"\t\t"2"
			"edge_binding_trigger_point"\t\t"1000"
		}
	}`;
                binContent = binContent.replace(/"group"\s*\{\s*"id"\s*"5"[\s\S]*?\n\t\}/, group5Block);

                // Update right stick mouse settings (group 7 or 9)
                const groupMatch = binContent.match(/"group"\s*\{\s*"id"\s*"(7|9)"[\s\S]*?\n\t\}/);
                if (groupMatch) {
                    const groupId = groupMatch[1];
                    const groupBlock = `"group"
	{
		"id"		"${groupId}"
		"mode"		"joystick_mouse"
		"inputs"
		{
			"click"
			{
				"activators"
				{
					"Full_Press"
					{
						"bindings"
						{
							"binding"		"key_press LEFT_SHIFT, Toggle Constant Run"
						}
						"settings"
						{
							"toggle"		"1"
							"haptic_intensity"		"1"
						}
					}
				}
			}
		}
		"settings"
		{
			"output_joystick"		"2"
			"sensitivity"		"${steamMouseSens}"
			"sensitivity_vert_scale"		"85"
			"mouse_smoothing"		"${steamSmoothingAmount}"
			"deadzone"		"1200"
			"anti_deadzone"		"0"
			"custom_curve_exponent"		"${steamCurveExponent}"
		}
	}`;
                    binContent = binContent.replace(/"group"\s*\{\s*"id"\s*"(7|9)"[\s\S]*?\n\t\}/, groupBlock);
                }
                fs.writeFileSync(pFile, binContent, 'utf8');
            }
        }

        // 4000-x86-64 controller config
        const x64Cfg = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Steam Controller Configs\\459479298\\config\\4000-x86-64\\controller_xbox360.vdf';
        if (fs.existsSync(x64Cfg)) {
            try {
                let content = fs.readFileSync(x64Cfg, 'utf8');
                content = content.replace(/\"button_b\"[\s\S]*?\"binding\"\s+\"[^\"]*\"/gi, '"button_b"\n\t\t\t{\n\t\t\t\t"activators"\n\t\t\t\t{\n\t\t\t\t\t"Full_Press"\n\t\t\t\t\t{\n\t\t\t\t\t\t"bindings"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"binding"\t\t"key_press LEFT_CONTROL, Crouch"');
                content = content.replace(/\"right_bumper\"[\s\S]*?\"binding\"\s+\"[^\"]*\"/gi, '"right_bumper"\n\t\t\t{\n\t\t\t\t"activators"\n\t\t\t\t{\n\t\t\t\t\t"Full_Press"\n\t\t\t\t\t{\n\t\t\t\t\t\t"bindings"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"binding"\t\t"key_press LEFT_CONTROL, Crouch"');
                content = content.replace(/"progenitor"\s+"[^"]*"/, '"progenitor"\t\t"workshop://923095811"');
                fs.writeFileSync(x64Cfg, content, 'utf8');
            } catch (_) {}
        }

        // Ensure ALL Steam Controller ConfigSet files link AppID 4000 and 4000-x86-64 to workshop 923095811
        const configDirs = [
            'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Steam Controller Configs\\865848147\\config',
            'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Steam Controller Configs\\459479298\\config'
        ];
        for (const dir of configDirs) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir).filter(f => f.startsWith('configset_') && f.endsWith('.vdf'));
            for (const f of files) {
                const cfgPath = path.join(dir, f);
                let content = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '"controller_config"\n{\n}\n';
                let modified = false;

                if (content.includes('2789459698')) {
                    content = content.replace(/\"2789459698\"/g, '"923095811"');
                    modified = true;
                }

                if (!content.includes('"4000"')) {
                    const lastBrace = content.lastIndexOf('}');
                    if (lastBrace !== -1) {
                        content = content.slice(0, lastBrace) + '\t"4000"\n\t{\n\t\t"workshop"\t\t"923095811"\n\t}\n' + content.slice(lastBrace);
                        modified = true;
                    }
                }

                if (!content.includes('"4000-x86-64"')) {
                    const lastBrace = content.lastIndexOf('}');
                    if (lastBrace !== -1) {
                        content = content.slice(0, lastBrace) + '\t"4000-x86-64"\n\t{\n\t\t"workshop"\t\t"923095811"\n\t}\n' + content.slice(lastBrace);
                        modified = true;
                    }
                }

                if (modified) {
                    fs.writeFileSync(cfgPath, content, 'utf8');
                }
            }
        }
    } catch (e) {
        console.warn('Steam Input profile synchronization warning:', e);
    }

    return { success: true, speed, smoothing: enableSmoothing, steamMouseSens, yawSens, pitchSens, mouseSens };
}

ipcMain.handle('apply-controller-tuning', async (event, options = 7) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return applyControllerTuning(currentGmodInfo, options);
});

const QMENU_ZOOM_SETTINGS_PATH = path.join(__dirname, 'data', 'qmenu_zoom_settings.json');

function computeAppZoomFromCouchScale() {
    return 1.0;
}

function applyElectronWindowCouchZoom() {
    try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.setZoomFactor(1.0);
        }
    } catch (_) {}
}

function loadQMenuZoomSettings() {
    try {
        if (fs.existsSync(QMENU_ZOOM_SETTINGS_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(QMENU_ZOOM_SETTINGS_PATH, 'utf8'));
            let scale = Number(parsed.scale) || 2.5;
            if (scale <= 1.05 && parsed.userExplicitlyChose100 !== true) {
                scale = 2.5;
            }
            return {
                scale,
                appZoom: 1.0,
                magnifier: Boolean(parsed.magnifier === true && parsed.userExplicitlyEnabledMagnifier === true),
                toggleMode: parsed.toggleMode !== false
            };
        }
    } catch (_) {}
    return { scale: 2.5, appZoom: 1.0, magnifier: false, toggleMode: true };
}

function saveQMenuZoomSettings(settings) {
    try {
        const dir = path.dirname(QMENU_ZOOM_SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(QMENU_ZOOM_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    } catch (_) {}
}

function installQMenuCouchZoom(gmodInfo, customOptions = null) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) {
        return { success: false, error: 'Garry\'s Mod directory not found' };
    }

    const saved = loadQMenuZoomSettings();
    const scale = customOptions && customOptions.scale !== undefined ? Number(customOptions.scale) : saved.scale;
    const magnifier = customOptions && customOptions.magnifier !== undefined ? Boolean(customOptions.magnifier) : saved.magnifier;
    const toggleMode = customOptions && customOptions.toggleMode !== undefined ? Boolean(customOptions.toggleMode) : saved.toggleMode;

    const cleanScale = Math.max(1.0, Math.min(2.5, Number(scale.toFixed(2))));
    saveQMenuZoomSettings({
        scale: cleanScale,
        appZoom: 1.0,
        magnifier,
        toggleMode,
        userExplicitlyChose100: Boolean(customOptions && Number(customOptions.scale) === 1),
        userExplicitlyEnabledMagnifier: Boolean(customOptions && customOptions.magnifier === true)
    });
    applyElectronWindowCouchZoom();

    const autorunDir = path.join(gmodInfo.garrysmodDir, 'lua', 'autorun');
    const clientAutorunDir = path.join(autorunDir, 'client');
    if (!fs.existsSync(clientAutorunDir)) {
        fs.mkdirSync(clientAutorunDir, { recursive: true });
    }

    // 1. Write aa_qmenu_couch_zoom_shared.lua in lua/autorun/ (starts with aa_ so it runs FIRST on the server in LAN/Multiplayer!)
    const sharedAutorunPath = path.join(autorunDir, 'aa_qmenu_couch_zoom_shared.lua');
    const sharedAutorunCode = `-- ============================================================================
-- Garry's Mod Asset Manager: Early Multiplayer/LAN CS Lua Registration for 250% Q-Menu
-- ============================================================================
if SERVER then
    AddCSLuaFile()
    AddCSLuaFile("autorun/client/zz_qmenu_couch_zoom.lua")
    RunConsoleCommand("sv_allowcslua", "1")
else
    include("autorun/client/zz_qmenu_couch_zoom.lua")
end
`;
    try {
        fs.writeFileSync(sharedAutorunPath, sharedAutorunCode, 'utf8');
    } catch (_) {}

    const luaPath = path.join(clientAutorunDir, 'zz_qmenu_couch_zoom.lua');
    const luaCode = `-- ============================================================================
-- Garry's Mod Asset Manager: Couch / 40"+ TV Big-Screen 'Q' Menu (Spawnmenu) Zoom
-- Scales ContentIcons (Weapons, NPCs, NextBots, Entities, Vehicles),
-- SpawnIcons (Props), Left Category Tree, Right-Side Tool & Options Panel,
-- and Fonts at 250% across Singleplayer, LAN, and Online!
-- ============================================================================
if SERVER then
    AddCSLuaFile()
    return
end

if _G.GModManager_QMenuCouchZoom_Loaded then return end
_G.GModManager_QMenuCouchZoom_Loaded = true

local cvarZoom = CreateClientConVar("gmod_qmenu_zoom", "${cleanScale.toFixed(2)}", true, false, "Q-Menu Couch Zoom Scale (1.0 to 2.5)")
local cvarMag  = CreateClientConVar("gmod_qmenu_magnifier", "${magnifier ? '1' : '0'}", true, false, "Show Giant Hover Magnifier Card in Q-Menu")

local DEFAULT_ZOOM_SCALE = ${cleanScale.toFixed(2)}
local DEFAULT_MAGNIFIER  = ${magnifier ? '1' : '0'}
local DEFAULT_TOGGLE_Q   = ${toggleMode ? '1' : '0'}

-- Protect against buggy third-party Workshop hooks (e.g. thirdperson_injected_1.51.lua nil index spam)
-- so they never throw top-left Lua error banners across NPCs / Weapons / Vehicles!
local function GuardBrokenAddonHooks()
    if not hook or not hook.GetTable or not debug or not debug.getinfo then return end
    local tbl = hook.GetTable()
    if not istable(tbl) then return end
    for eventName, eventHooks in pairs(tbl) do
        if istable(eventHooks) then
            for hookId, fn in pairs(eventHooks) do
                if isfunction(fn) then
                    local info = debug.getinfo(fn, "S")
                    local src = info and info.short_src or ""
                    if string.find(src, "thirdperson_injected", 1, true) and not rawget(eventHooks, "_guarded_" .. tostring(hookId)) then
                        local origFn = fn
                        eventHooks[hookId] = function(...)
                            local ok, a, b, c, d = pcall(origFn, ...)
                            if ok then return a, b, c, d end
                        end
                    end
                end
            end
        end
    end
end
GuardBrokenAddonHooks()
timer.Simple(1.0, GuardBrokenAddonHooks)
timer.Simple(4.0, GuardBrokenAddonHooks)

local GModQMenu_HoveredIcon = nil
local matOverlay_Normal = Material("gui/ContentIcon-normal.png")
local matOverlay_Hovered = Material("gui/ContentIcon-hovered.png")
local matOverlay_AdminOnly = Material("icon16/shield.png")
local matOverlay_NPCWeapon = Material("icon16/monkey.png")
local matOverlay_NPCWeaponSelected = Material("icon16/monkey_tick.png")

local function GetActiveZoomScale()
    local val = cvarZoom and cvarZoom:GetFloat() or DEFAULT_ZOOM_SCALE
    if val <= 1.05 and DEFAULT_ZOOM_SCALE >= 2.0 then
        val = DEFAULT_ZOOM_SCALE
    end
    return math.Clamp(val, 1.0, 2.5)
end

local lastFontScale = 0
local function UpdateQMenuFonts(scale)
    scale = scale or GetActiveZoomScale()
    lastFontScale = scale

    local uiFontSize = math.Round(13 * math.Clamp(scale * 0.88, 1.0, 2.1))
    local tileFontSize = math.Round(13 * math.Clamp(scale * 0.94, 1.0, 2.25))

    surface.CreateFont("DermaDefault", {
        font = "Tahoma",
        size = uiFontSize,
        weight = scale > 1.1 and 650 or 500,
        antialias = true,
        extended = true
    })

    surface.CreateFont("DermaDefaultBold", {
        font = "Tahoma",
        size = uiFontSize + 1,
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("TabLarge", {
        font = "Tahoma",
        size = uiFontSize + 1,
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("DermaLarge", {
        font = "Tahoma",
        size = math.Round(24 * math.Clamp(scale * 0.85, 1.0, 1.95)),
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModToolName", {
        font = "Tahoma",
        size = math.Round(24 * math.Clamp(scale * 0.85, 1.0, 1.9)),
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModToolSubtitle", {
        font = "Tahoma",
        size = math.Round(15 * math.Clamp(scale * 0.88, 1.0, 1.95)),
        weight = 650,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModToolHelp", {
        font = "Tahoma",
        size = math.Round(14 * math.Clamp(scale * 0.90, 1.0, 2.0)),
        weight = 550,
        antialias = true,
        extended = true
    })

    surface.CreateFont("ContentHeader", {
        font = "Tahoma",
        size = math.Round(34 * math.Clamp(scale * 0.85, 1.0, 1.95)),
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModQMenu_TileFont", {
        font = "Tahoma",
        size = tileFontSize,
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModQMenu_TopBarFont", {
        font = "Tahoma",
        size = 18,
        weight = 800,
        antialias = true,
        extended = true
    })
end

local function CustomContentIconPaint(self, w, h)
    if self.Depressed and not self.Dragging then
        if self.Border ~= 8 then
            self.Border = 8
            if self.OnDepressionChanged then self:OnDepressionChanged(true) end
        end
    else
        if self.Border ~= 0 then
            self.Border = 0
            if self.OnDepressionChanged then self:OnDepressionChanged(false) end
        end
    end

    local b = self.Border or 0
    local isHov = not dragndrop.IsDragging() and (self:IsHovered() or self.Depressed or self:IsChildHovered())
    if isHov then
        GModQMenu_HoveredIcon = self
    end

    render.PushFilterMag(TEXFILTER.ANISOTROPIC)
    render.PushFilterMin(TEXFILTER.ANISOTROPIC)
    if IsValid(self.Image) then
        -- Paint across the FULL zoomed width & height (fixes GMod's hardcoded 128-8 bug)
        self.Image:PaintAt(3 + b, 3 + b, w - 6 - b * 2, h - 6 - b * 2)
    end
    render.PopFilterMin()
    render.PopFilterMag()

    surface.SetDrawColor(255, 255, 255, 255)
    if isHov then
        surface.SetMaterial(matOverlay_Hovered)
    else
        surface.SetMaterial(matOverlay_Normal)
    end
    surface.DrawTexturedRect(b, b, w - b * 2, h - b * 2)

    if self.GetAdminOnly and self:GetAdminOnly() then
        surface.SetMaterial(matOverlay_AdminOnly)
        surface.DrawTexturedRect(b + 8, b + 8, 20, 20)
    end

    if self.GetIsNPCWeapon and self:GetIsNPCWeapon() then
        surface.SetMaterial(matOverlay_NPCWeapon)
        if self.GetSpawnName and self:GetSpawnName() == GetConVarString("gmod_npcweapon") then
            surface.SetMaterial(matOverlay_NPCWeaponSelected)
        end
        surface.DrawTexturedRect(w - b - 28, b + 8, 20, 20)
    end

    if self.ScanForNPCWeapons then
        self:ScanForNPCWeapons()
    end

    local niceName = self.m_NiceName or (self.GetSpawnName and self:GetSpawnName()) or ""
    if niceName ~= "" then
        local scale = GetActiveZoomScale()
        local fontName = scale > 1.05 and "GModQMenu_TileFont" or "DermaDefault"
        surface.SetFont(fontName)
        local tW, tH = surface.GetTextSize(niceName)

        local pillPadY = math.Round(4 * math.Clamp(scale, 1, 2))
        local pillH = tH + pillPadY * 2
        local pillY = h - pillH - b - 5
        draw.RoundedBox(6, b + 5, pillY, w - (b + 5) * 2, pillH, Color(10, 15, 25, isHov and 235 or 200))

        local buffere = b + 10
        local px, py = self:LocalToScreen(buffere, 0)
        local pw, ph = self:LocalToScreen(w - buffere, h)
        render.SetScissorRect(px, py, pw, ph, true)

        local x = w / 2 - tW / 2
        if tW > (w - buffere * 2) then
            local mx = self:ScreenToLocal(input.GetCursorPos())
            local diff = tW - w + buffere * 2
            x = buffere + math.Remap(math.Clamp(mx, 0, w), 0, w, 0, -diff)
        end

        local textY = pillY + pillPadY
        draw.SimpleText(niceName, fontName, x + 1, textY + 1, Color(0, 0, 0, 240))
        draw.SimpleText(niceName, fontName, x, textY, isHov and Color(56, 189, 248) or color_white)
        render.SetScissorRect(0, 0, 0, 0, false)
    end
end

local function PatchSpawnMenuVGUI()
    local scale = GetActiveZoomScale()
    UpdateQMenuFonts(scale)

    local contentTbl = vgui.GetControlTable("ContentIcon")
    if contentTbl then
        if not contentTbl._OrigCouchInit then
            contentTbl._OrigCouchInit = contentTbl.Init
        end
        contentTbl.Init = function(self, ...)
            contentTbl._OrigCouchInit(self, ...)
            local s = GetActiveZoomScale()
            local sz = math.Round(128 * s)
            self:SetSize(sz, sz)
            if IsValid(self.Image) then
                self.Image:SetSize(sz - 6, sz - 6)
            end
        end
        contentTbl.Paint = CustomContentIconPaint
    end

    local spawnTbl = vgui.GetControlTable("SpawnIcon")
    if spawnTbl then
        if not spawnTbl._OrigCouchInit then
            spawnTbl._OrigCouchInit = spawnTbl.Init
        end
        spawnTbl.Init = function(self, ...)
            spawnTbl._OrigCouchInit(self, ...)
            local s = GetActiveZoomScale()
            if s > 1.05 then
                local sz = math.Round(64 * math.max(1.0, s * 1.2))
                self:SetSize(sz, sz)
            end
        end
    end

    local treeTbl = vgui.GetControlTable("DTree")
    if treeTbl then
        if not treeTbl._OrigCouchInit then
            treeTbl._OrigCouchInit = treeTbl.Init
        end
        treeTbl.Init = function(self, ...)
            treeTbl._OrigCouchInit(self, ...)
            local s = GetActiveZoomScale()
            self:SetLineHeight(math.Round(18 * math.Clamp(s * 0.92, 1.0, 2.25)))
        end
    end
end

local function WalkAndResizePanel(pnl, scale)
    if not IsValid(pnl) then return end
    local cname = pnl:GetName() or ""

    if cname == "ContentIcon" then
        local sz = math.Round(128 * scale)
        pnl:SetSize(sz, sz)
        if IsValid(pnl.Image) then
            pnl.Image:SetSize(sz - 6, sz - 6)
        end
        pnl.Paint = CustomContentIconPaint
    elseif cname == "SpawnIcon" then
        local sz = scale > 1.05 and math.Round(64 * math.max(1.0, scale * 1.2)) or 64
        pnl:SetSize(sz, sz)
    elseif cname == "DTree" then
        if pnl.SetLineHeight then
            pnl:SetLineHeight(math.Round(18 * math.Clamp(scale * 0.92, 1.0, 2.25)))
        end
        if pnl.LayoutTree then pnl:LayoutTree() end
    elseif cname == "ContentSidebar" then
        local parent = pnl:GetParent()
        if IsValid(parent) and parent.SetLeftWidth then
            local targetW = math.Round(195 * math.Clamp(scale * 0.88, 1.0, 2.05))
            parent:SetLeftMin(targetW)
            parent:SetLeftWidth(targetW)
            parent:InvalidateLayout(true)
        end
    elseif cname == "SpawnMenu" then
        -- Widen the Right-Side Tool & Options Panel so options are big & clear on 40"+ TVs
        if IsValid(pnl.HorizontalDivider) then
            local rightMinW = math.Round(460 * math.Clamp(scale * 0.78, 1.0, 1.75))
            pnl.HorizontalDivider:SetRightMin(rightMinW)
            local totalW = pnl.HorizontalDivider:GetWide()
            if totalW > rightMinW + 300 then
                pnl.HorizontalDivider:SetLeftWidth(totalW - rightMinW)
            end
            pnl.HorizontalDivider:InvalidateLayout(true)
        end
    elseif cname == "ToolPanel" then
        if IsValid(pnl.HorizontalDivider) then
            local toolListW = math.Round(145 * math.Clamp(scale * 0.85, 1.0, 1.9))
            pnl.HorizontalDivider:SetLeftMin(toolListW)
            pnl.HorizontalDivider:SetLeftWidth(toolListW)
            pnl.HorizontalDivider:InvalidateLayout(true)
        end
    elseif cname == "DCategoryCollapse" or cname == "DCollapsibleCategory" then
        if IsValid(pnl.Header) then
            pnl.Header:SetTall(math.Round(22 * math.Clamp(scale * 0.85, 1.0, 1.9)))
        end
    end

    for _, child in ipairs(pnl:GetChildren()) do
        WalkAndResizePanel(child, scale)
    end

    if cname == "DTileLayout" or cname == "ContentContainer" or cname == "DCategoryList" then
        if pnl.Layout then pnl:Layout() end
        pnl:InvalidateLayout(true)
    end
end

local function EnsureZoomBarOnSpawnMenu()
    if not IsValid(g_SpawnMenu) then return end
    if IsValid(g_SpawnMenu.CouchZoomBar) then
        g_SpawnMenu.CouchZoomBar:MoveToFront()
        return
    end

    local bar = vgui.Create("DPanel", g_SpawnMenu)
    g_SpawnMenu.CouchZoomBar = bar
    bar:SetSize(875, 40)
    bar:SetPos(math.max(12, ScrW() / 2 - 437), 4)
    bar:SetZPos(32000)

    bar.Paint = function(self, w, h)
        draw.RoundedBox(10, 0, 0, w, h, Color(15, 23, 42, 242))
        surface.SetDrawColor(56, 189, 248, 190)
        surface.DrawOutlinedRect(0, 0, w, h, 2)
        draw.SimpleText("🔍 Q-Menu Zoom:", "GModQMenu_TopBarFont", 14, h / 2, Color(56, 189, 248), TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER)
    end

    local presets = {
        { label = "100%", val = 1.0, x = 175, w = 74 },
        { label = "150%", val = 1.5, x = 255, w = 74 },
        { label = "200%", val = 2.0, x = 335, w = 74 },
        { label = "225%", val = 2.25, x = 415, w = 74 },
        { label = "250% Max", val = 2.5, x = 495, w = 112 }
    }

    for _, p in ipairs(presets) do
        local btn = vgui.Create("DButton", bar)
        btn:SetText("")
        btn:SetPos(p.x, 5)
        btn:SetSize(p.w, 30)
        btn.Paint = function(self, w, h)
            local active = math.abs(GetActiveZoomScale() - p.val) < 0.08
            local bg = active and Color(14, 165, 233, 255) or (self:IsHovered() and Color(51, 65, 85, 255) or Color(30, 41, 59, 230))
            draw.RoundedBox(6, 0, 0, w, h, bg)
            draw.SimpleText(p.label, "GModQMenu_TopBarFont", w / 2, h / 2, color_white, TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
        end
        btn.DoClick = function()
            RunConsoleCommand("gmod_qmenu_zoom", tostring(p.val))
            surface.PlaySound("ui/buttonclickrelease.wav")
            timer.Simple(0.03, function()
                local s = GetActiveZoomScale()
                PatchSpawnMenuVGUI()
                if IsValid(g_SpawnMenu) then
                    WalkAndResizePanel(g_SpawnMenu, s)
                end
            end)
        end
    end

    -- Voicemod Hands-Free Open Mic Toggle Button right on the Q-Menu bar!
    local micBtn = vgui.Create("DButton", bar)
    micBtn:SetText("")
    micBtn:SetPos(617, 5)
    micBtn:SetSize(244, 30)
    micBtn.Paint = function(self, w, h)
        local cv = GetConVar("gmod_openmic_enabled")
        local on = not cv or cv:GetBool()
        local bg = on and Color(16, 185, 129, 235) or Color(220, 38, 38, 220)
        draw.RoundedBox(6, 0, 0, w, h, bg)
        draw.SimpleText(on and "🎙️ Voicemod Mic: LIVE (Open)" or "🔇 Voicemod Mic: MUTED", "GModQMenu_TopBarFont", w / 2, h / 2, color_white, TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
    end
    micBtn.DoClick = function()
        RunConsoleCommand("gmod_toggle_openmic")
    end
end

local function ApplyCouchQMenuSettings()
    RunConsoleCommand("spawnmenu_border", "0.015")
    if DEFAULT_TOGGLE_Q == 1 then
        RunConsoleCommand("spawnmenu_toggle", "1")
    end
    local s = GetActiveZoomScale()
    PatchSpawnMenuVGUI()
    if IsValid(g_SpawnMenu) then
        WalkAndResizePanel(g_SpawnMenu, s)
        EnsureZoomBarOnSpawnMenu()
    end
end

hook.Add("PostGamemodeLoaded", "GModManager_QMenuCouchZoom_PostGM", function()
    timer.Simple(0, ApplyCouchQMenuSettings)
end)

hook.Add("InitPostEntity", "GModManager_QMenuCouchZoom_Init", function()
    timer.Simple(0.2, function()
        RunConsoleCommand("gmod_qmenu_zoom", tostring(DEFAULT_ZOOM_SCALE))
        RunConsoleCommand("gmod_qmenu_magnifier", tostring(DEFAULT_MAGNIFIER))
        ApplyCouchQMenuSettings()
        GuardBrokenAddonHooks()
    end)
    timer.Simple(2.0, ApplyCouchQMenuSettings)
end)

hook.Add("SpawnMenuCreated", "GModManager_QMenuCouchZoom_Created", function(sm)
    timer.Simple(0.05, function()
        PatchSpawnMenuVGUI()
        if IsValid(sm) then
            WalkAndResizePanel(sm, GetActiveZoomScale())
            EnsureZoomBarOnSpawnMenu()
        end
    end)
end)

hook.Add("SpawnMenuOpened", "GModManager_QMenuCouchZoom_Opened", function()
    local s = GetActiveZoomScale()
    PatchSpawnMenuVGUI()
    if IsValid(g_SpawnMenu) then
        WalkAndResizePanel(g_SpawnMenu, s)
        EnsureZoomBarOnSpawnMenu()
    end
end)

hook.Add("ContentSidebarSelection", "GModManager_QMenuCouchZoom_NodeSelect", function(pnlContent, node)
    timer.Simple(0.02, function()
        local s = GetActiveZoomScale()
        if IsValid(pnlContent) then
            WalkAndResizePanel(pnlContent, s)
        end
    end)
end)

PatchSpawnMenuVGUI()
ApplyCouchQMenuSettings()
`;

    fs.writeFileSync(luaPath, luaCode, 'utf8');

    // 2. Embed directly into garrysmod/gamemodes/sandbox/gamemode/spawnmenu/spawnmenu.lua
    // AND garrysmod/lua/derma/init.lua so 250% Q-Menu Zoom is part of the core Sandbox Spawnmenu on LAN/Multiplayer!
    try {
        const spawnmenuLuaPath = path.join(gmodInfo.garrysmodDir, 'gamemodes', 'sandbox', 'gamemode', 'spawnmenu', 'spawnmenu.lua');
        if (fs.existsSync(spawnmenuLuaPath)) {
            let smContent = fs.readFileSync(spawnmenuLuaPath, 'utf8');
            const marker = '-- === GMOD ASSET MANAGER: COUCH Q-MENU ZOOM ===';
            if (smContent.includes(marker)) {
                smContent = smContent.split(marker)[0].trimEnd();
            }
            const embeddedBlock = `\n\n${marker}\n_G.GModManager_QMenuCouchZoom_Loaded = false\n${luaCode}\n`;
            fs.writeFileSync(spawnmenuLuaPath, smContent + embeddedBlock, 'utf8');
        }
    } catch (err) {
        console.warn('Could not embed into spawnmenu.lua:', err);
    }

    // 3. Install garrysmod/lua/menu/couch_tv_menu.lua (Menu State Lua!) + silence top-left Lua error popups in garrysmod/lua/menu/errors.lua
    // Menu State Lua runs 100% locally on EVERY LAN & Online server (even when sv_allowcslua is 0)!
    try {
        const menuDir = path.join(gmodInfo.garrysmodDir, 'lua', 'menu');
        if (fs.existsSync(menuDir)) {
            // Patch errors.lua so top-left yellow/white error boxes never cut across NPCs / Weapons / Vehicles
            const errorsLuaPath = path.join(menuDir, 'errors.lua');
            if (fs.existsSync(errorsLuaPath)) {
                let errContent = fs.readFileSync(errorsLuaPath, 'utf8');
                if (!errContent.includes('-- GMOD_ASSET_MANAGER_SUPPRESS_TOPLEFT_ERRORS')) {
                    errContent = errContent.replace(
                        'hook.Add( "DrawOverlay", "MenuDrawLuaErrors", function()',
                        'hook.Add( "DrawOverlay", "MenuDrawLuaErrors", function()\n\t-- GMOD_ASSET_MANAGER_SUPPRESS_TOPLEFT_ERRORS\n\tif ( true ) then return end'
                    );
                    fs.writeFileSync(errorsLuaPath, errContent, 'utf8');
                }
            }

            const couchMenuLuaPath = path.join(menuDir, 'couch_tv_menu.lua');
            const couchMenuLua = `-- ============================================================================
-- Garry's Mod Asset Manager: Menu-State 250% Couch Q-Menu Zoom & LAN/Online Persistence
-- Runs in the local MENU state on 100% of LAN & Online servers, keeping 250%
-- Fonts, Fullscreen Q-Menu Border, Tool Panel Widths, and suppressing Top-Left
-- Lua Error Boxes that cut across NPCs / Weapons / Vehicles!
-- ============================================================================

local COUCH_SCALE = ${cleanScale.toFixed(2)}

-- Remove top-left Lua Error overlay boxes so they never cut across NPCs, Weapons, Vehicles
local function SuppressTopLeftErrorPopups()
    if hook and hook.Remove then
        hook.Remove("DrawOverlay", "MenuDrawLuaErrors")
        hook.Remove("OnLuaError", "MenuErrorHandler")
        hook.Remove("OnProblemReceived", "FireProblemNotification")
    end
end
SuppressTopLeftErrorPopups()

local function ApplyMenuStateCouchFonts()
    local uiFontSize = math.Round(13 * math.Clamp(COUCH_SCALE * 0.88, 1.0, 2.1))
    surface.CreateFont("DermaDefault", {
        font = "Tahoma",
        size = uiFontSize,
        weight = COUCH_SCALE > 1.1 and 650 or 500,
        antialias = true,
        extended = true
    })
    surface.CreateFont("DermaDefaultBold", {
        font = "Tahoma",
        size = uiFontSize + 1,
        weight = 800,
        antialias = true,
        extended = true
    })
    surface.CreateFont("TabLarge", {
        font = "Tahoma",
        size = uiFontSize + 1,
        weight = 800,
        antialias = true,
        extended = true
    })
    surface.CreateFont("DermaLarge", {
        font = "Tahoma",
        size = math.Round(24 * math.Clamp(COUCH_SCALE * 0.85, 1.0, 1.95)),
        weight = 800,
        antialias = true,
        extended = true
    })
    surface.CreateFont("GModToolName", {
        font = "Tahoma",
        size = math.Round(24 * math.Clamp(COUCH_SCALE * 0.85, 1.0, 1.9)),
        weight = 800,
        antialias = true,
        extended = true
    })
    surface.CreateFont("GModToolSubtitle", {
        font = "Tahoma",
        size = math.Round(15 * math.Clamp(COUCH_SCALE * 0.88, 1.0, 1.95)),
        weight = 650,
        antialias = true,
        extended = true
    })
    surface.CreateFont("GModToolHelp", {
        font = "Tahoma",
        size = math.Round(14 * math.Clamp(COUCH_SCALE * 0.90, 1.0, 2.0)),
        weight = 550,
        antialias = true,
        extended = true
    })
    surface.CreateFont("ContentHeader", {
        font = "Tahoma",
        size = math.Round(34 * math.Clamp(COUCH_SCALE * 0.85, 1.0, 1.95)),
        weight = 800,
        antialias = true,
        extended = true
    })
end

local lastInGame = false
local function EnforceCouchMenuAndLanState()
    SuppressTopLeftErrorPopups()
    ApplyMenuStateCouchFonts()
    RunConsoleCommand("spawnmenu_border", "0.015")
    RunConsoleCommand("spawnmenu_toggle", "${toggleMode ? '1' : '0'}")

    if cookie and cookie.Set and ScrW() >= 1600 then
        local rightMinW = math.Round(460 * math.Clamp(COUCH_SCALE * 0.78, 1.0, 1.75))
        cookie.Set("SpawnMenuDiv.LeftWidth", tostring(math.max(600, ScrW() - rightMinW - 60)))
        cookie.Set("SpawnMenuToolMenuDiv.LeftWidth", tostring(math.Round(145 * math.Clamp(COUCH_SCALE * 0.85, 1.0, 1.9))))
    end

    local inGameNow = IsInGame and IsInGame() or false
    if inGameNow and not lastInGame then
        lastInGame = true
        for _, delay in ipairs({ 0.5, 1.5, 3.5, 6.5 }) do
            timer.Simple(delay, function()
                SuppressTopLeftErrorPopups()
                ApplyMenuStateCouchFonts()
                RunConsoleCommand("spawnmenu_border", "0.015")
                RunConsoleCommand("lua_openscript_cl", "autorun/client/zz_qmenu_couch_zoom.lua")
                RunConsoleCommand("lua_openscript_cl", "autorun/zz_voicemod_lan_voice.lua")
            end)
        end
    elseif not inGameNow then
        lastInGame = false
    end
end

ApplyMenuStateCouchFonts()
timer.Create("GModManager_MenuStateCouchKeeper", 1.0, 0, EnforceCouchMenuAndLanState)
`;
            fs.writeFileSync(couchMenuLuaPath, couchMenuLua, 'utf8');

            const mainMenuLuaPath = path.join(menuDir, 'menu.lua');
            if (fs.existsSync(mainMenuLuaPath)) {
                let menuContent = fs.readFileSync(mainMenuLuaPath, 'utf8');
                if (!menuContent.includes('couch_tv_menu.lua')) {
                    menuContent = menuContent.trimEnd() + '\ninclude( "couch_tv_menu.lua" )\n';
                    fs.writeFileSync(mainMenuLuaPath, menuContent, 'utf8');
                }
            }
        }
    } catch (err) {
        console.warn('Could not write couch_tv_menu.lua:', err);
    }

    // Also persist spawnmenu_border, developer 0, con_notifytime 0, and gmod_qmenu_zoom in autoexec.cfg & config.cfg
    try {
        const cfgDir = path.join(gmodInfo.garrysmodDir, 'cfg');
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
        const autoexecPath = path.join(cfgDir, 'autoexec.cfg');
        let autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
        const qmenuCfgBlock = `// --- Couch Q-Menu Zoom & Fullscreen Spawnmenu ---
developer "0"
con_notifytime "0"
spawnmenu_border "0.015"
spawnmenu_toggle "${toggleMode ? '1' : '0'}"
gmod_qmenu_zoom "${cleanScale.toFixed(2)}"
gmod_qmenu_magnifier "${magnifier ? '1' : '0'}"`;

        if (autoexecContent.includes('// --- Couch Q-Menu Zoom')) {
            autoexecContent = autoexecContent.replace(/\/\/ --- Couch Q-Menu Zoom[\s\S]*?gmod_qmenu_magnifier "[^"]*"/, qmenuCfgBlock);
        } else {
            autoexecContent += `\n\n${qmenuCfgBlock}\n`;
        }
        fs.writeFileSync(autoexecPath, autoexecContent, 'utf8');
    } catch (_) {}

    return {
        success: true,
        scale: cleanScale,
        appZoom: 1.0,
        magnifier,
        toggleMode,
        luaPath
    };
}

ipcMain.handle('get-qmenu-zoom', async () => {
    return loadQMenuZoomSettings();
});

ipcMain.handle('apply-qmenu-zoom', async (event, options) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return installQMenuCouchZoom(currentGmodInfo, options);
});

// ---------------- ASSET STUDIO / 2D CHARACTER EDITOR ----------------

ipcMain.handle('scan-editable-characters', async () => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await scanEditableCharacters(currentGmodInfo);
});

ipcMain.handle('load-character-editor', async (event, characterId) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await loadCharacterForEditing(currentGmodInfo, characterId);
});

ipcMain.handle('select-image-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose Character Photo (.jpg, .png, .webp)',
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }
        ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const img = nativeImage.createFromPath(filePath);
    let dataUrl = null;
    if (!img.isEmpty()) {
        dataUrl = img.toDataURL();
    } else {
        const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        dataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    }
    return {
        filePath,
        fileName: path.basename(filePath),
        dataUrl
    };
});

ipcMain.handle('select-audio-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose Character Music or Sound Effect (.mp3, .wav)',
        properties: ['openFile'],
        filters: [
            { name: 'Audio Files (MP3, WAV, OGG)', extensions: ['mp3', 'wav', 'ogg'] }
        ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    return {
        filePath,
        fileName: path.basename(filePath),
        fileSize: stats.size
    };
});

ipcMain.handle('save-edited-character', async (event, payload) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await saveEditedCharacter(currentGmodInfo, payload, nativeImage);
});

ipcMain.handle('publish-edited-character', async (event, payload) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return await publishCharacterToWorkshop(currentGmodInfo, payload, nativeImage);
});

ipcMain.handle('save-recorded-audio', async (event, { base64Wav, slotHint }) => {
    return saveRecordedAudio(base64Wav, slotHint);
});

// ---------------- VOICEMOD V3 & LAN HANDS-FREE VOICE AUTOPILOT ----------------

const VOICEMOD_EXE_PATH = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\adria\\AppData\\Local', 'VoicemodV3', 'app', 'last', 'Voicemod.exe');
const VOICEMOD_SETTINGS_INI = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\adria\\AppData\\Local', 'VoicemodV3', 'settings.ini');
const VOICEMOD_ENDPOINT_TOOL = 'C:\\Program Files\\Voicemod V3\\driver\\AudioEndPointTool.exe';
const VOICEMOD_MIC_ID = '{0.0.1.00000000}.{babac7f5-3e88-43a8-9547-ca1e8c243c67}';

function installVoicemodLanVoiceAutopilot(gmodInfo) {
    if (!gmodInfo || !gmodInfo.garrysmodDir) {
        return { success: false, error: 'Garry\'s Mod directory not found' };
    }

    const autorunDir = path.join(gmodInfo.garrysmodDir, 'lua', 'autorun');
    if (!fs.existsSync(autorunDir)) {
        fs.mkdirSync(autorunDir, { recursive: true });
    }

    const luaPath = path.join(autorunDir, 'zz_voicemod_lan_voice.lua');
    const luaCode = `-- ============================================================================
-- Garry's Mod Asset Manager: Voicemod V3 (Morgan Freeman / Celestial Narrator)
-- & 3-Way LAN Hands-Free Open Mic + Global All-Talk Broadcast Autopilot
-- ============================================================================

if SERVER then
    AddCSLuaFile()
    if file.Exists("autorun/client/zz_qmenu_couch_zoom.lua", "LUA") then
        AddCSLuaFile("autorun/client/zz_qmenu_couch_zoom.lua")
    end

    local function EnforceLanAllTalk()
        RunConsoleCommand("sv_allowcslua", "1")
        RunConsoleCommand("sv_voiceenable", "1")
        RunConsoleCommand("sv_alltalk", "3")
    end

    EnforceLanAllTalk()
    hook.Add("InitPostEntity", "GModManager_VoicemodLanAllTalk_Init", EnforceLanAllTalk)
    hook.Add("PlayerInitialSpawn", "GModManager_VoicemodLanAllTalk_Spawn", function()
        timer.Simple(0.5, EnforceLanAllTalk)
    end)

    -- Guarantee every player on the LAN hears your Morgan Freeman voice across
    -- the entire map at full clear 2D broadcast volume (no distance dropoff!)
    hook.Add("PlayerCanHearPlayersVoice", "GModManager_VoicemodLanAllTalk_Hook", function(listener, talker)
        return true, false
    end)
end

if CLIENT then
    local cvarOpenMic = CreateClientConVar("gmod_openmic_enabled", "1", true, false, "Hands-Free Open Mic for Voicemod (1 = Always Live, 0 = Muted)")
    local cvarVoiceHud = CreateClientConVar("gmod_voice_hud_enabled", "1", true, false, "Show Voicemod Live Mic HUD badge in bottom-right corner")

    surface.CreateFont("GModVoicemod_HUDFont", {
        font = "Tahoma",
        size = 19,
        weight = 800,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModVoicemod_HUDSub", {
        font = "Tahoma",
        size = 14,
        weight = 600,
        antialias = true,
        extended = true
    })

    local function SetNativeVoiceChatState(enable)
        -- NOTE: RunConsoleCommand("+voicerecord") and RunConsoleCommand("voice_*") are blocked by GMod C++!
        -- Use permissions.EnableVoiceChat (when available) + native .cfg aliases (+voicerecord in autoexec.cfg / 360controller.cfg)
        if permissions and permissions.EnableVoiceChat then
            pcall(permissions.EnableVoiceChat, enable and true or false)
        end
    end

    local function EnforceClientVoiceState()
        if cvarOpenMic and cvarOpenMic:GetBool() then
            SetNativeVoiceChatState(true)
        else
            SetNativeVoiceChatState(false)
        end
    end

    hook.Add("InitPostEntity", "GModManager_VoicemodClient_Init", function()
        timer.Simple(0.5, EnforceClientVoiceState)
        timer.Simple(2.5, EnforceClientVoiceState)
        timer.Simple(6.0, EnforceClientVoiceState)
    end)

    -- Keep Hands-Free Open Mic latched ON even after respawns, scoreboard, or menu closes
    timer.Create("GModManager_VoicemodOpenMicKeeper", 2.0, 0, function()
        if not IsValid(LocalPlayer()) then return end
        if cvarOpenMic and cvarOpenMic:GetBool() then
            SetNativeVoiceChatState(true)
        end
    end)

    concommand.Add("gmod_toggle_openmic", function()
        local now = not (cvarOpenMic and cvarOpenMic:GetBool())
        RunConsoleCommand("gmod_openmic_enabled", now and "1" or "0")
        if now then
            SetNativeVoiceChatState(true)
            surface.PlaySound("buttons/button14.wav")
            chat.AddText(Color(16, 185, 129), "[Voicemod LAN] ", Color(255, 255, 255), "🎙️ Hands-Free Open Mic: LIVE (Morgan Freeman Broadcast ON)")
        else
            SetNativeVoiceChatState(false)
            surface.PlaySound("buttons/button10.wav")
            chat.AddText(Color(245, 158, 11), "[Voicemod LAN] ", Color(255, 255, 255), "🔇 Microphone MUTED (Press X or Hold D-Pad Right to unmute)")
        end
    end)

    -- Sleek bottom-right HUD pill showing Live Open Mic status & voice level meter
    hook.Add("HUDPaint", "GModManager_VoicemodLiveHUD", function()
        if not cvarVoiceHud or not cvarVoiceHud:GetBool() then return end
        local ply = LocalPlayer()
        if not IsValid(ply) then return end

        local isOpen = cvarOpenMic and cvarOpenMic:GetBool()
        local vol = ply.VoiceVolume and ply:VoiceVolume() or 0
        local isSpeaking = (ply.IsSpeaking and ply:IsSpeaking()) or (vol > 0.01)

        local boxW, boxH = 295, 50
        local boxX = ScrW() - boxW - 22
        local boxY = ScrH() - boxH - 18

        local bgCol = isOpen and Color(15, 23, 42, 225) or Color(30, 20, 25, 215)
        local borderCol = isOpen and (isSpeaking and Color(52, 211, 153, 255) or Color(16, 185, 129, 195)) or Color(239, 68, 68, 190)

        draw.RoundedBox(10, boxX, boxY, boxW, boxH, bgCol)
        surface.SetDrawColor(borderCol)
        surface.DrawOutlinedRect(boxX, boxY, boxW, boxH, isSpeaking and 3 or 2)

        -- Status dot
        local dotCol = isOpen and (isSpeaking and Color(52, 211, 153) or Color(16, 185, 129)) or Color(239, 68, 68)
        draw.RoundedBox(7, boxX + 12, boxY + 11, 14, 14, dotCol)

        local titleTxt = isOpen and "🎙️ VOICEMOD: OPEN MIC" or "🔇 VOICEMOD: MIC MUTED"
        draw.SimpleText(titleTxt, "GModVoicemod_HUDFont", boxX + 32, boxY + 7, color_white, TEXT_ALIGN_LEFT, TEXT_ALIGN_TOP)

        local subTxt = isOpen and "Hold D-Pad Right or Press X to Mute" or "Hold D-Pad Right or Press X to Talk"
        draw.SimpleText(subTxt, "GModVoicemod_HUDSub", boxX + 32, boxY + 28, Color(148, 163, 184), TEXT_ALIGN_LEFT, TEXT_ALIGN_TOP)

        -- Live voice volume meter bar at bottom of pill
        if isOpen then
            local meterW = math.Clamp(vol * 3.5, isSpeaking and 0.18 or 0, 1) * (boxW - 20)
            if meterW > 2 then
                draw.RoundedBox(2, boxX + 10, boxY + boxH - 6, meterW, 4, Color(52, 211, 153, 245))
            end
        end
    end)
end
`;

    fs.writeFileSync(luaPath, luaCode, 'utf8');

    // Also update autoexec.cfg & config.cfg with LAN voice settings + native C++ Open Mic aliases
    try {
        const cfgDir = path.join(gmodInfo.garrysmodDir, 'cfg');
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
        const autoexecPath = path.join(cfgDir, 'autoexec.cfg');
        let autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
        const voiceCfgBlock = `// --- Voicemod V3 & LAN All-Talk Hands-Free Voice ---
sv_allowcslua "1"
sv_voiceenable "1"
sv_alltalk "3"
voice_enable "1"
voice_modenable "1"
voice_forcemicrecord "1"
voice_scale "1.0"
voice_loopback "0"
gmod_openmic_enabled "1"
alias vm_mic_keepalive "+voicerecord"
alias voice_openmic_on "+voicerecord; alias vm_mic_keepalive +voicerecord; alias gmod_toggle_openmic voice_openmic_off; gmod_openmic_enabled 1; play buttons/button14.wav"
alias voice_openmic_off "-voicerecord; alias vm_mic_keepalive; alias gmod_toggle_openmic voice_openmic_on; gmod_openmic_enabled 0; play buttons/button10.wav"
alias gmod_toggle_openmic "voice_openmic_off"
bind "x" "gmod_toggle_openmic"
+voicerecord
// --- END VOICEMOD VOICE BLOCK ---`;

        if (autoexecContent.includes('// --- Voicemod V3 & LAN All-Talk')) {
            autoexecContent = autoexecContent.replace(/\/\/ --- Voicemod V3 & LAN All-Talk[\s\S]*?$/, voiceCfgBlock + '\n');
        } else {
            autoexecContent += `\n\n${voiceCfgBlock}\n`;
        }
        fs.writeFileSync(autoexecPath, autoexecContent, 'utf8');
    } catch (_) {}

    return { success: true, luaPath };
}

function getVoicemodStatus() {
    const { execSync } = require('child_process');
    const installed = fs.existsSync(VOICEMOD_EXE_PATH);
    let running = false;
    try {
        const out = execSync('tasklist /FI "IMAGENAME eq Voicemod.exe" /NH', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        running = out.toLowerCase().includes('voicemod.exe');
    } catch (_) {}

    let inputDeviceName = 'BEHRINGER UMC 404HD / Headset Mic';
    try {
        if (fs.existsSync(VOICEMOD_SETTINGS_INI)) {
            const ini = fs.readFileSync(VOICEMOD_SETTINGS_INI, 'utf8');
            const m = ini.match(/"inputDevice":\{"deviceId":"[^"]+","deviceName":"([^"]+)"/);
            if (m && m[1]) inputDeviceName = m[1];
        }
    } catch (_) {}

    return {
        installed,
        running,
        exePath: VOICEMOD_EXE_PATH,
        voiceName: 'Celestial Narrator (Morgan Freeman)',
        voiceId: 'df9fc8a5-0ab5-424a-bccf-d12c7da191b6',
        inputDeviceName,
        openMicEnabled: true,
        allTalkEnabled: true
    };
}

async function activateVoicemodForGmod({ launchApp = true } = {}) {
    const { spawn, execFileSync } = require('child_process');
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    installVoicemodLanVoiceAutopilot(currentGmodInfo);

    let status = getVoicemodStatus();
    let launchedNow = false;

    if (launchApp && status.installed && !status.running) {
        try {
            const child = spawn(VOICEMOD_EXE_PATH, [], {
                cwd: path.dirname(VOICEMOD_EXE_PATH),
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            launchedNow = true;
            // Wait briefly for Voicemod to initialize its virtual audio cable
            await new Promise(r => setTimeout(r, 2200));
        } catch (err) {
            console.warn('Could not spawn Voicemod.exe:', err);
        }
    }

    // Use Voicemod's official AudioEndPointTool.exe to make Microphone (Voicemod) visible
    // and lock it as Windows Default Capture Device across all 3 roles (0=Console, 1=Multimedia, 2=Communications)
    let lockedDefaultMic = false;
    if (fs.existsSync(VOICEMOD_ENDPOINT_TOOL)) {
        try {
            execFileSync(VOICEMOD_ENDPOINT_TOOL, ['setvisibility', '--id', VOICEMOD_MIC_ID, '--visible', 'true'], { stdio: 'ignore' });
            execFileSync(VOICEMOD_ENDPOINT_TOOL, ['setdefault', '--id', VOICEMOD_MIC_ID, '--flow', '1', '--role', '0'], { stdio: 'ignore' });
            execFileSync(VOICEMOD_ENDPOINT_TOOL, ['setdefault', '--id', VOICEMOD_MIC_ID, '--flow', '1', '--role', '1'], { stdio: 'ignore' });
            execFileSync(VOICEMOD_ENDPOINT_TOOL, ['setdefault', '--id', VOICEMOD_MIC_ID, '--flow', '1', '--role', '2'], { stdio: 'ignore' });
            lockedDefaultMic = true;
        } catch (err) {
            console.warn('AudioEndPointTool warning:', err);
        }
    }

    status = getVoicemodStatus();
    return {
        success: true,
        ...status,
        launchedNow,
        lockedDefaultMic
    };
}

ipcMain.handle('get-voicemod-status', async () => {
    return getVoicemodStatus();
});

ipcMain.handle('activate-voicemod', async (event, options = {}) => {
    return await activateVoicemodForGmod(options);
});




