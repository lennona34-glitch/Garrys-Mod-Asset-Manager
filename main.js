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
    return await launchMap(currentGmodInfo, mapName, options);
});

ipcMain.handle('connect-to-server', async (event, payload) => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
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
bind "POV_RIGHT" "+voicerecord"
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

// Keyboard fallbacks
bind "b" "+duck"`;

    // 1. Update autoexec.cfg
    let autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
    if (autoexecContent.includes('// --- Modern Tactical Wireless Controller') || autoexecContent.includes('// --- Smooth Wireless Controller')) {
        autoexecContent = autoexecContent.replace(/\/\/\s*---\s*(Modern Tactical Wireless|Smooth Wireless) Controller[\s\S]*?bind "b" "\+duck"/, controllerBlock.trim());
        if (!autoexecContent.includes('bind "b" "+duck"')) {
            autoexecContent = autoexecContent.replace(/\/\/\s*---\s*(Modern Tactical Wireless|Smooth Wireless) Controller[\s\S]*?bind "POV_LEFT" "\+menu"/, controllerBlock.trim());
        }
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
            configContent = configContent.replace(/bind "b" "[^"]*"/, `bind "b" "+duck"`);
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

function loadQMenuZoomSettings() {
    try {
        if (fs.existsSync(QMENU_ZOOM_SETTINGS_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(QMENU_ZOOM_SETTINGS_PATH, 'utf8'));
            return {
                scale: Number(parsed.scale) || 2.0,
                magnifier: parsed.magnifier !== false,
                toggleMode: parsed.toggleMode !== false
            };
        }
    } catch (_) {}
    return { scale: 2.0, magnifier: true, toggleMode: true };
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
    saveQMenuZoomSettings({ scale: cleanScale, magnifier, toggleMode });

    const clientAutorunDir = path.join(gmodInfo.garrysmodDir, 'lua', 'autorun', 'client');
    if (!fs.existsSync(clientAutorunDir)) {
        fs.mkdirSync(clientAutorunDir, { recursive: true });
    }

    const luaPath = path.join(clientAutorunDir, 'zz_qmenu_couch_zoom.lua');
    const luaCode = `-- ============================================================================
-- Garry's Mod Asset Manager: Couch / TV Big-Screen 'Q' Menu (Spawnmenu) Zoom
-- Scales ContentIcons (Weapons, NPCs, NextBots, Entities, Vehicles),
-- SpawnIcons (Props), Left Category Tree, Fonts, and adds a live Top Zoom Bar
-- + Giant Hover Magnifier Card so you can read & browse from across the room!
-- ============================================================================
if SERVER then return end

local cvarZoom = CreateClientConVar("gmod_qmenu_zoom", "${cleanScale.toFixed(2)}", true, false, "Q-Menu Couch Zoom Scale (1.0 to 2.5)")
local cvarMag  = CreateClientConVar("gmod_qmenu_magnifier", "${magnifier ? '1' : '0'}", true, false, "Show Giant Hover Magnifier Card in Q-Menu")

local DEFAULT_ZOOM_SCALE = ${cleanScale.toFixed(2)}
local DEFAULT_MAGNIFIER  = ${magnifier ? '1' : '0'}
local DEFAULT_TOGGLE_Q   = ${toggleMode ? '1' : '0'}

local GModQMenu_HoveredIcon = nil
local matOverlay_Normal = Material("gui/ContentIcon-normal.png")
local matOverlay_Hovered = Material("gui/ContentIcon-hovered.png")
local matOverlay_AdminOnly = Material("icon16/shield.png")
local matOverlay_NPCWeapon = Material("icon16/monkey.png")
local matOverlay_NPCWeaponSelected = Material("icon16/monkey_tick.png")

local function GetActiveZoomScale()
    local val = cvarZoom and cvarZoom:GetFloat() or DEFAULT_ZOOM_SCALE
    return math.Clamp(val, 1.0, 2.5)
end

local lastFontScale = 0
local function UpdateQMenuFonts(scale)
    scale = scale or GetActiveZoomScale()
    if math.abs(scale - lastFontScale) < 0.02 then return end
    lastFontScale = scale

    local uiFontSize = math.Round(13 * math.Clamp(scale * 0.85, 1.0, 2.0))
    local tileFontSize = math.Round(13 * math.Clamp(scale * 0.92, 1.0, 2.2))

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

    surface.CreateFont("GModQMenu_MagTitle", {
        font = "Tahoma",
        size = 28,
        weight = 900,
        antialias = true,
        extended = true
    })

    surface.CreateFont("GModQMenu_MagSub", {
        font = "Tahoma",
        size = 19,
        weight = 600,
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
        if not spawnTbl._OrigCouchThink then
            spawnTbl._OrigCouchThink = spawnTbl.Think
        end
        spawnTbl.Think = function(self, ...)
            if spawnTbl._OrigCouchThink then spawnTbl._OrigCouchThink(self, ...) end
            if self:IsHovered() then
                GModQMenu_HoveredIcon = self
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
            self:SetLineHeight(math.Round(18 * math.Clamp(s * 0.9, 1.0, 2.2)))
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
            pnl:SetLineHeight(math.Round(18 * math.Clamp(scale * 0.9, 1.0, 2.2)))
        end
        if pnl.LayoutTree then pnl:LayoutTree() end
    elseif cname == "ContentSidebar" then
        local parent = pnl:GetParent()
        if IsValid(parent) and parent.SetLeftWidth then
            local targetW = math.Round(192 * math.Clamp(scale * 0.85, 1.0, 2.0))
            parent:SetLeftMin(targetW)
            parent:SetLeftWidth(targetW)
            parent:InvalidateLayout(true)
        end
    end

    for _, child in ipairs(pnl:GetChildren()) do
        WalkAndResizePanel(child, scale)
    end

    if cname == "DTileLayout" or cname == "ContentContainer" then
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
    bar:SetSize(780, 42)
    bar:SetPos(math.max(16, ScrW() / 2 - 390), 4)
    bar:SetZPos(32000)

    bar.Paint = function(self, w, h)
        draw.RoundedBox(10, 0, 0, w, h, Color(15, 23, 42, 240))
        surface.SetDrawColor(56, 189, 248, 180)
        surface.DrawOutlinedRect(0, 0, w, h, 2)
        draw.SimpleText("🔍 Couch Q-Menu Zoom:", "GModQMenu_TopBarFont", 14, h / 2, Color(56, 189, 248), TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER)
    end

    local presets = {
        { label = "100%", val = 1.0, x = 215, w = 78 },
        { label = "150%", val = 1.5, x = 300, w = 78 },
        { label = "200% TV", val = 2.0, x = 385, w = 105 },
        { label = "250% Huge", val = 2.5, x = 497, w = 115 }
    }

    for _, p in ipairs(presets) do
        local btn = vgui.Create("DButton", bar)
        btn:SetText("")
        btn:SetPos(p.x, 6)
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

    local magBtn = vgui.Create("DButton", bar)
    magBtn:SetText("")
    magBtn:SetPos(620, 6)
    magBtn:SetSize(150, 30)
    magBtn.Paint = function(self, w, h)
        local on = cvarMag and cvarMag:GetBool()
        local bg = on and Color(16, 185, 129, 230) or Color(51, 65, 85, 220)
        draw.RoundedBox(6, 0, 0, w, h, bg)
        draw.SimpleText(on and "🔎 Big Preview: ON" or "🔎 Preview: OFF", "GModQMenu_TopBarFont", w / 2, h / 2, color_white, TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
    end
    magBtn.DoClick = function()
        local now = not (cvarMag and cvarMag:GetBool())
        RunConsoleCommand("gmod_qmenu_magnifier", now and "1" or "0")
        surface.PlaySound("ui/buttonclickrelease.wav")
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
    end)
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

-- Giant Couch Hover Magnifier Card drawn on top of Q-Menu when hovering an item
hook.Add("DrawOverlay", "GModManager_QMenuCouchMagnifier", function()
    if not IsValid(g_SpawnMenu) or not g_SpawnMenu:IsVisible() then
        GModQMenu_HoveredIcon = nil
        return
    end
    if not cvarMag or not cvarMag:GetBool() then return end

    local icon = GModQMenu_HoveredIcon
    if not IsValid(icon) or not icon:IsVisible() then return end
    if not icon:IsHovered() and not (icon.IsChildHovered and icon:IsChildHovered()) then
        GModQMenu_HoveredIcon = nil
        return
    end

    local title = icon.m_NiceName or (icon.GetModelName and icon:GetModelName()) or (icon.GetSpawnName and icon:GetSpawnName()) or ""
    if title == "" then return end

    local ctype = (icon.GetContentType and icon:GetContentType()) or (icon:GetName() == "SpawnIcon" and "3D Model / Prop" or "Item")
    local cardW, cardH = 340, 390
    local cardX = ScrW() - cardW - 28
    local cardY = ScrH() - cardH - 28

    -- If cursor is in bottom-right corner, move magnifier card to bottom-left so it never blocks clicking
    local mx, my = input.GetCursorPos()
    if mx > cardX - 40 and my > cardY - 40 then
        cardX = 28
    end

    draw.RoundedBox(14, cardX, cardY, cardW, cardH, Color(15, 23, 42, 248))
    surface.SetDrawColor(56, 189, 248, 230)
    surface.DrawOutlinedRect(cardX, cardY, cardW, cardH, 3)

    if IsValid(icon.Image) and icon.Image.GetMaterial and icon.Image:GetMaterial() then
        surface.SetDrawColor(255, 255, 255, 255)
        surface.SetMaterial(icon.Image:GetMaterial())
        surface.DrawTexturedRect(cardX + 20, cardY + 16, 300, 290)
    else
        draw.RoundedBox(10, cardX + 20, cardY + 16, 300, 290, Color(30, 41, 59, 255))
        draw.SimpleText("📦", "GModQMenu_MagTitle", cardX + cardW / 2, cardY + 160, Color(56, 189, 248), TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
    end

    draw.SimpleText(string.upper(tostring(ctype)), "GModQMenu_MagSub", cardX + cardW / 2, cardY + 322, Color(56, 189, 248), TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)

    -- Truncate or fit title cleanly
    surface.SetFont("GModQMenu_MagTitle")
    local dispTitle = tostring(title)
    if #dispTitle > 22 then
        dispTitle = string.sub(dispTitle, 1, 21) .. "…"
    end
    draw.SimpleText(dispTitle, "GModQMenu_MagTitle", cardX + cardW / 2, cardY + 356, color_white, TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
end)

PatchSpawnMenuVGUI()
`;

    fs.writeFileSync(luaPath, luaCode, 'utf8');

    // Also persist spawnmenu_border and gmod_qmenu_zoom in autoexec.cfg so it applies on every boot
    try {
        const cfgDir = path.join(gmodInfo.garrysmodDir, 'cfg');
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
        const autoexecPath = path.join(cfgDir, 'autoexec.cfg');
        let autoexecContent = fs.existsSync(autoexecPath) ? fs.readFileSync(autoexecPath, 'utf8') : '';
        const qmenuCfgBlock = `// --- Couch Q-Menu Zoom & Fullscreen Spawnmenu ---
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




