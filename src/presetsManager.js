const fs = require('fs');
const path = require('path');
const { scanAllAddons, toggleAddonState } = require('./addonManager');

const PRESETS_FILE = path.join(__dirname, '..', 'data', 'presets.json');

function ensureDataDir() {
    const dir = path.dirname(PRESETS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadPresets() {
    ensureDataDir();
    if (fs.existsSync(PRESETS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
        } catch (_) {}
    }

    // Default presets
    const defaults = [
        {
            id: 'all_enabled',
            name: 'All Addons Enabled',
            description: 'Enables every installed addon for full sandbox fun.',
            addonIds: ['*'],
            created: new Date().toISOString()
        },
        {
            id: 'vanilla',
            name: 'Pure Vanilla (Clean)',
            description: 'Disables all addons for clean gameplay and maximum performance.',
            addonIds: [],
            created: new Date().toISOString()
        }
    ];
    savePresets(defaults);
    return defaults;
}

function savePresets(presets) {
    ensureDataDir();
    try {
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save presets:', e);
    }
}

function createPreset(name, description, addonIds) {
    const presets = loadPresets();
    const newPreset = {
        id: 'preset_' + Date.now(),
        name,
        description,
        addonIds: addonIds || [],
        created: new Date().toISOString()
    };
    presets.push(newPreset);
    savePresets(presets);
    return newPreset;
}

function deletePreset(presetId) {
    let presets = loadPresets();
    presets = presets.filter(p => p.id !== presetId);
    savePresets(presets);
    return presets;
}

async function applyPreset(presetId, gmodInfo) {
    const presets = loadPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) throw new Error(`Preset ${presetId} not found`);

    const addons = await scanAllAddons(gmodInfo);
    let enabledCount = 0;
    let disabledCount = 0;

    const enableAll = preset.addonIds.includes('*');

    for (const addon of addons) {
        if (!addon.filePath) continue;

        const shouldBeEnabled = enableAll || preset.addonIds.includes(addon.workshopId) || preset.addonIds.includes(addon.id);

        if (shouldBeEnabled && !addon.isEnabled) {
            try {
                toggleAddonState(addon.filePath, true);
                enabledCount++;
            } catch (_) {}
        } else if (!shouldBeEnabled && addon.isEnabled) {
            try {
                toggleAddonState(addon.filePath, false);
                disabledCount++;
            } catch (_) {}
        }
    }

    return {
        preset: preset.name,
        enabledCount,
        disabledCount,
        totalProcessed: addons.length
    };
}

module.exports = {
    loadPresets,
    savePresets,
    createPreset,
    deletePreset,
    applyPreset
};
