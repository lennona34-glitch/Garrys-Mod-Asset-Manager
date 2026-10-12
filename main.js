const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');

const { detectGmodPaths, getAllSubscribedWorkshopIds } = require('./src/steamDetector');
const { scanAllMaps, launchMap, extractMapToNative, injectNavmeshAutopilot } = require('./src/mapManager');
const { scanAllAddons, toggleAddonState, inspectGma, unpackAddon, packAddonFolder, deleteAddon } = require('./src/addonManager');
const { analyzeStorage, cleanTarget } = require('./src/storageCleaner');
const { fetchPublishedFileDetails, searchWorkshop, openInSteamClient, openInBrowser, openSteamWorkshopHub, openSteamUrl } = require('./src/workshopService');
const { loadPresets, createPreset, deletePreset, applyPreset } = require('./src/presetsManager');
const { runDiagnostics, fixAddonConflict, undoAddonConflict, getDismissedNavState, dismissNavMap, dismissAllNavMaps, restoreNavMaps } = require('./src/diagnosticsManager');
const { getDefaultTitle, getDefaultDescription, publishNavmeshToWorkshop, getPublishedNavmeshes, recordPublishedNavmesh } = require('./src/workshopPublisher');

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

function applyControllerTuning(gmodInfo, preset = 'smooth') {
    if (!gmodInfo || !gmodInfo.garrysmodDir) return { success: false, error: 'GMod path not found' };
    const cfgDir = path.join(gmodInfo.garrysmodDir, 'cfg');
    if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });

    let yawSens = '-0.90';
    let pitchSens = '0.65';
    let accelScale = '0.45';
    let accelMax = '1.10';
    let mouseSens = '1.85';

    if (preset === 'cinematic') {
        yawSens = '-0.65';
        pitchSens = '0.50';
        accelScale = '0.35';
        accelMax = '0.85';
        mouseSens = '1.50';
    } else if (preset === 'arcade') {
        yawSens = '-1.25';
        pitchSens = '0.85';
        accelScale = '0.65';
        accelMax = '1.35';
        mouseSens = '2.40';
    }

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
joy_advaxisx "3"
joy_advaxisy "1"
joy_advaxisz "0"
joy_advaxisr "2"
joy_advaxisu "4"
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
m_filter "1"

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
    RunConsoleCommand("exec", "joystick.cfg")
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

    // 6. Update Steam Input Workshop Profile 923095811 and configset bindings
    try {
        let steamMouseSens = '58';
        if (preset === 'cinematic') steamMouseSens = '45';
        else if (preset === 'arcade') steamMouseSens = '75';

        const legacyBinPath = 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\241100\\923095811\\838078270046996915_legacy.bin';
        if (fs.existsSync(legacyBinPath)) {
            let binContent = fs.readFileSync(legacyBinPath, 'utf8');
            binContent = binContent.replace(/\"button_B\"[\s\S]*?\"binding\"\s+\"[^\"]*\"/g, '"button_B"\n\t\t\t{\n\t\t\t\t"activators"\n\t\t\t\t{\n\t\t\t\t\t"Full_Press"\n\t\t\t\t\t{\n\t\t\t\t\t\t"bindings"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"binding"\t\t"key_press LEFT_CONTROL, Crouch"');
            binContent = binContent.replace(/\"right_bumper\"[\s\S]*?\"binding\"\s+\"[^\"]*\"/g, '"right_bumper"\n\t\t\t{\n\t\t\t\t"activators"\n\t\t\t\t{\n\t\t\t\t\t"Full_Press"\n\t\t\t\t\t{\n\t\t\t\t\t\t"bindings"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"binding"\t\t"key_press LEFT_CONTROL, Crouch"');

            // Apply buttery smooth low-pass mouse smoothing, anti-deadzone, and progressive curve
            const group7Block = `"group"
	{
		"id"		"7"
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
			"mouse_smoothing"		"28"
			"deadzone"		"2000"
			"anti_deadzone"		"2000"
			"custom_curve_exponent"		"130"
		}
	}`;
            binContent = binContent.replace(/"group"\s*\{\s*"id"\s*"7"[\s\S]*?\n\t\}/, group7Block);
            fs.writeFileSync(legacyBinPath, binContent, 'utf8');
        }

        // Ensure all Steam Controller ConfigSet files link AppID 4000 to workshop 923095811
        const configDirs = [
            'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Steam Controller Configs\\865848147\\config',
            'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Steam Controller Configs\\459479298\\config'
        ];
        const targetFiles = [
            'configset_3537-1040-339bcb53.vdf',
            'configset_3537-1040-339bcb53g.vdf',
            'configset_controller_xbox360.vdf',
            'configset_controller_xboxone.vdf',
            'configset_controller_generic.vdf'
        ];
        for (const dir of configDirs) {
            if (!fs.existsSync(dir)) continue;
            for (const f of targetFiles) {
                const cfgPath = path.join(dir, f);
                let content = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '"controller_config"\n{\n}\n';
                if (!content.includes('"4000"')) {
                    const lastBrace = content.lastIndexOf('}');
                    if (lastBrace !== -1) {
                        content = content.slice(0, lastBrace) + '\t"4000"\n\t{\n\t\t"workshop"\t\t"923095811"\n\t}\n' + content.slice(lastBrace);
                        fs.writeFileSync(cfgPath, content, 'utf8');
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Steam Input profile synchronization warning:', e);
    }

    return { success: true, preset, yawSens, pitchSens, mouseSens };
}

ipcMain.handle('apply-controller-tuning', async (event, preset = 'smooth') => {
    if (!currentGmodInfo) currentGmodInfo = detectGmodPaths();
    return applyControllerTuning(currentGmodInfo, preset);
});


