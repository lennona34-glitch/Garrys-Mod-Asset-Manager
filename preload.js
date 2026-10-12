const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getGmodInfo: () => ipcRenderer.invoke('get-gmod-info'),
    setCustomGmodPath: (path) => ipcRenderer.invoke('set-custom-gmod-path', path),
    selectFolderDialog: () => ipcRenderer.invoke('select-folder-dialog'),
    toggleFullScreen: () => ipcRenderer.invoke('toggle-fullscreen'),
    isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
    
    // Maps
    scanMaps: () => ipcRenderer.invoke('scan-maps'),
    launchMap: (mapName, options) => ipcRenderer.invoke('launch-map', { mapName, options }),
    extractMap: (gmaPath, internalMapPath) => ipcRenderer.invoke('extract-map', { gmaPath, internalMapPath }),
    
    // Addons
    scanAddons: () => ipcRenderer.invoke('scan-addons'),
    toggleAddon: (filePath, enable) => ipcRenderer.invoke('toggle-addon', { filePath, enable }),
    inspectGma: (filePath) => ipcRenderer.invoke('inspect-gma', filePath),
    unpackAddon: (gmaFilePath, customOutputDir) => ipcRenderer.invoke('unpack-addon', { gmaFilePath, customOutputDir }),
    packAddon: (folderPath, outGmaPath) => ipcRenderer.invoke('pack-addon', { folderPath, outGmaPath }),
    deleteAddon: (filePath) => ipcRenderer.invoke('delete-addon', filePath),
    
    // Storage
    analyzeStorage: () => ipcRenderer.invoke('analyze-storage'),
    cleanStorage: (target) => ipcRenderer.invoke('clean-storage', target),
    
    // Workshop
    searchWorkshop: (options) => ipcRenderer.invoke('search-workshop', options),
    getSubscribedWorkshopIds: () => ipcRenderer.invoke('get-subscribed-workshop-ids'),
    openSteamClient: (workshopId) => ipcRenderer.invoke('open-steam-client', workshopId),
    openSteamWorkshopHub: () => ipcRenderer.invoke('open-steam-workshop-hub'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
    
    // Presets
    loadPresets: () => ipcRenderer.invoke('load-presets'),
    createPreset: (name, description, addonIds) => ipcRenderer.invoke('create-preset', { name, description, addonIds }),
    deletePreset: (presetId) => ipcRenderer.invoke('delete-preset', presetId),
    applyPreset: (presetId) => ipcRenderer.invoke('apply-preset', presetId),
    
    // Diagnostics / Doctor
    runDiagnostics: () => ipcRenderer.invoke('run-diagnostics'),
    getDismissedNavState: () => ipcRenderer.invoke('get-dismissed-nav-state'),
    dismissNavMap: (mapName) => ipcRenderer.invoke('dismiss-nav-map', mapName),
    dismissAllNavMaps: (allMapNames) => ipcRenderer.invoke('dismiss-all-nav-maps', allMapNames),
    restoreNavMaps: () => ipcRenderer.invoke('restore-nav-maps'),
    fixAddonConflict: (conflictKey) => ipcRenderer.invoke('fix-addon-conflict', conflictKey),
    undoAddonConflict: (conflictKey) => ipcRenderer.invoke('undo-addon-conflict', conflictKey),
    generateMapNavmesh: (mapName) => ipcRenderer.invoke('generate-map-navmesh', mapName),
    subscribeMissingBases: (workshopIds) => ipcRenderer.invoke('subscribe-missing-bases', workshopIds),
    getPublishNavmeshMeta: (mapName) => ipcRenderer.invoke('get-publish-navmesh-meta', mapName),
    publishNavmesh: (options) => ipcRenderer.invoke('publish-navmesh', options),
    getPublishedNavmeshes: () => ipcRenderer.invoke('get-published-navmeshes'),
    applyControllerTuning: (preset) => ipcRenderer.invoke('apply-controller-tuning', preset),
    onNavmeshCompleted: (callback) => ipcRenderer.on('navmesh-completed', (_event, mapName) => callback(mapName)),
    onNavmeshProgress: (callback) => ipcRenderer.on('navmesh-progress', (_event, data) => callback(data))
});
