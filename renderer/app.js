// Application State
const state = {
    gmodInfo: null,
    maps: [],
    addons: [],
    subscribedWorkshopIds: [],
    presets: [],
    storage: null,
    currentTab: 'maps',
    searchQuery: '',
    mapFilter: 'all',
    onlyNavMesh: false,
    mapSort: 'name',
    addonFilter: 'all',
    addonSort: 'name',
    selectedGma: null,
    gmaModalFiles: [],
    wsMode: 'browse',
    wsLoaded: false,
    wsItems: [],
    wsPage: 1,
    wsHasMore: true,
    wsLoadingMore: false,
    isZenMode: false,
    publishedNavmeshes: {},
    collapsedAddonSections: {}
};

// Helpers
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function updateNavmeshLiveProgress({ mapName, percent, phase }) {
    let banner = document.getElementById('navmeshLiveBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'navmeshLiveBanner';
        banner.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #111827;
            border: 1px solid #38bdf8;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6), 0 0 15px rgba(56, 189, 248, 0.3);
            border-radius: 10px;
            padding: 14px 18px;
            color: #f3f4f6;
            z-index: 10000;
            min-width: 320px;
            max-width: 420px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            transition: all 0.3s ease;
        `;
        document.body.appendChild(banner);
    }

    const isComplete = percent >= 100;
    const accentColor = isComplete ? '#34d399' : '#38bdf8';
    if (isComplete) {
        banner.style.borderColor = '#34d399';
        banner.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.6), 0 0 15px rgba(52, 211, 153, 0.3)';
    }

    banner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: ${accentColor};">
                ${isComplete ? '<span>✅</span>' : '<span class="spinner" style="width: 14px; height: 14px; border: 2px solid #38bdf8; border-top-color: transparent; border-radius: 50%; display: inline-block;"></span>'}
                <span>${isComplete ? 'NavMesh Generation Complete' : 'Generating NavMesh in GMod'}</span>
            </div>
            <span style="font-size: 0.85rem; font-weight: 700; color: ${accentColor};">${percent}%</span>
        </div>
        <div style="font-size: 0.85rem; color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            Map: <strong style="color: #f3f4f6;">${mapName}</strong>
        </div>
        <div style="font-size: 0.8rem; color: #d1d5db;">
            ${phase || 'Working in background...'}
        </div>
        <div style="width: 100%; height: 6px; background: #374151; border-radius: 3px; overflow: hidden; margin-top: 2px;">
            <div style="width: ${percent}%; height: 100%; background: ${isComplete ? '#34d399' : 'linear-gradient(90deg, #38bdf8, #818cf8)'}; transition: width 0.3s ease;"></div>
        </div>
    `;

    if (isComplete) {
        setTimeout(() => {
            const b = document.getElementById('navmeshLiveBanner');
            if (b) {
                b.style.opacity = '0';
                b.style.transform = 'translateY(10px)';
                setTimeout(() => b.remove(), 400);
            }
        }, 5000);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    setupTabNavigation();
    setupEventHandlers();

    if (window.api.onNavmeshProgress) {
        window.api.onNavmeshProgress((data) => {
            updateNavmeshLiveProgress(data);
        });
    }

    if (window.api.onNavmeshCompleted) {
        window.api.onNavmeshCompleted(async (mapName) => {
            updateNavmeshLiveProgress({ mapName, percent: 100, phase: '✅ Complete! Saved to garrysmod/maps/' });
            showToast(`🎉 NavMesh Complete! ${mapName}.nav generated and permanently saved.`, 'success');
            await Promise.all([refreshMaps(), refreshDiagnostics()]);
        });
    }

    // Auto-refresh maps and diagnostics whenever the user switches back to the app window (debounced)
    let lastFocusRefresh = 0;
    window.addEventListener('focus', async () => {
        if (Date.now() - lastFocusRefresh < 10000) return;
        lastFocusRefresh = Date.now();
        if (state.gmodInfo && state.gmodInfo.gmodRoot) {
            await Promise.all([refreshMaps(), refreshDiagnostics()]);
        }
    });

    await loadInitialData();
});

async function loadInitialData() {
    try {
        state.gmodInfo = await window.api.getGmodInfo();
        updateGmodStatus();

        if (state.gmodInfo && state.gmodInfo.gmodRoot) {
            // High-speed parallel startup: Maps, Addons, Subscribed IDs, Published NavMeshes, Diagnostics, Presets
            const [maps, addons, subIds, pubNavs] = await Promise.all([
                refreshMaps(),
                refreshAddons(),
                window.api.getSubscribedWorkshopIds ? window.api.getSubscribedWorkshopIds().catch(() => []) : Promise.resolve([]),
                window.api.getPublishedNavmeshes ? window.api.getPublishedNavmeshes().catch(() => ({})) : Promise.resolve({}),
                refreshDiagnostics(),
                refreshPresets()
            ]);
            if (Array.isArray(subIds) && subIds.length > 0) {
                state.subscribedWorkshopIds = subIds;
            }
            if (pubNavs && typeof pubNavs === 'object') {
                state.publishedNavmeshes = pubNavs;
                renderMapsGrid(state.maps);
            }

            // Background pre-fetch of workshop (non-blocking)
            setTimeout(() => {
                executeWorkshopSearch().catch(() => {});
            }, 150);
        }
    } catch (err) {
        console.error('Initialization error:', err);
        showToast('Error loading GMod data: ' + err.message, 'error');
    }
}

function updateGmodStatus() {
    const pill = document.getElementById('gmodStatusPill');
    const dot = pill.querySelector('.status-dot');
    const text = pill.querySelector('.status-text');

    if (state.gmodInfo && state.gmodInfo.gmodRoot) {
        dot.classList.add('active');
        const is64 = state.gmodInfo.gmodExe && state.gmodInfo.gmodExe.includes('win64');
        text.textContent = `GMod Found (${is64 ? '64-bit' : 'Standard'})`;

        // Update settings inputs
        document.getElementById('settingGmodPath').value = state.gmodInfo.gmodRoot || '';
        document.getElementById('settingWorkshopPath').value = state.gmodInfo.workshopDir || 'Not found';
        document.getElementById('settingGmadPath').value = state.gmodInfo.gmadExe || 'Not found';
    } else {
        dot.classList.remove('active');
        text.textContent = 'GMod Not Detected';
    }
}

// Tab Switching
function setupTabNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            const pane = document.getElementById(`pane-${targetTab}`);
            if (pane) pane.classList.add('active');

            state.currentTab = targetTab;

            if (targetTab === 'workshop') {
                if (state.wsMode === 'browse') {
                    if (!state.wsLoaded || state.wsItems.length === 0) {
                        executeWorkshopSearch();
                    } else {
                        renderWorkshopGrid(state.wsItems);
                    }
                } else if (state.wsMode === 'subscribed') {
                    renderSubscribedWorkshopItems();
                }
            } else if (targetTab === 'doctor') {
                if (!diagnosticResults) {
                    refreshDiagnostics();
                } else {
                    renderDiagnostics();
                }
            } else if (targetTab === 'storage') {
                if (!state.storageStats) {
                    refreshStorage();
                }
            }
        });
    });
}

// Global Event Handlers
function setupEventHandlers() {
    // Global Search
    const searchInput = document.getElementById('globalSearchInput');
    const clearBtn = document.getElementById('btnClearSearch');

    searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        clearBtn.style.display = state.searchQuery ? 'block' : 'none';
        if (state.currentTab === 'maps') renderMaps();
        else if (state.currentTab === 'addons') renderAddons();
        else if (state.currentTab === 'workshop') {
            const wsIn = document.getElementById('wsSearchInput');
            if (wsIn) {
                wsIn.value = e.target.value;
                const clearWs = document.getElementById('btnWsClearSearch');
                if (clearWs) clearWs.style.display = wsIn.value ? 'block' : 'none';
            }
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && state.currentTab === 'workshop') {
            const wsIn = document.getElementById('wsSearchInput');
            if (wsIn) wsIn.value = searchInput.value;
            executeWorkshopSearch();
        }
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        clearBtn.style.display = 'none';
        if (state.currentTab === 'maps') renderMaps();
        else if (state.currentTab === 'addons') renderAddons();
        else if (state.currentTab === 'workshop') {
            const wsIn = document.getElementById('wsSearchInput');
            if (wsIn) {
                wsIn.value = '';
                const clearWs = document.getElementById('btnWsClearSearch');
                if (clearWs) clearWs.style.display = 'none';
            }
            executeWorkshopSearch();
        }
    });

    // Refresh button
    document.getElementById('btnRefresh').addEventListener('click', async () => {
        showToast('Refreshing data...', 'info');
        await Promise.all([
            refreshMaps(), 
            refreshAddons(), 
            refreshStorage(), 
            refreshDiagnostics(),
            window.api.getPublishedNavmeshes ? window.api.getPublishedNavmeshes().then(p => { if (p) { state.publishedNavmeshes = p; renderMapsGrid(state.maps); } }).catch(() => {}) : Promise.resolve()
        ]);
        if (state.currentTab === 'workshop' && state.wsItems && state.wsItems.length > 0) {
            renderWorkshopGrid(state.wsItems);
        }
        showToast('Data refreshed successfully', 'success');
    });

    // Run Doctor button
    const btnRunDoctor = document.getElementById('btnRunDoctor');
    if (btnRunDoctor) {
        btnRunDoctor.addEventListener('click', async () => {
            btnRunDoctor.disabled = true;
            btnRunDoctor.innerHTML = `
                <svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
                <span>Scanning...</span>
            `;
            showToast('Refreshing maps & running diagnostic scan...', 'info');
            try {
                await Promise.all([refreshMaps(), refreshDiagnostics()]);
                const totalMaps = (state.maps || []).length;
                const unmeshed = (diagnosticResults && diagnosticResults.counts) ? (diagnosticResults.counts.noNav || 0) : 0;
                const exempt = (diagnosticResults && diagnosticResults.counts) ? (diagnosticResults.counts.dismissedNav || 0) : 0;
                const meshed = Math.max(0, totalMaps - unmeshed);
                if (unmeshed === 0) {
                    showToast(`Scan complete: All systems 100% Healthy! (${exempt} rogue maps exempt)`, 'success');
                } else {
                    showToast(`Scan complete: ${meshed} of ${totalMaps} maps meshed (${unmeshed} remaining, ${exempt} exempt)`, 'success');
                }
            } catch (err) {
                showToast(`Scan error: ${err.message}`, 'error');
            } finally {
                btnRunDoctor.disabled = false;
                btnRunDoctor.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    <span>Run Scan</span>
                `;
            }
        });
    }

    // Zen Mode Fullscreen (controlled solely via the header box icon #btnToggleZen or F11 / Esc)
    const setZenMode = async (enable) => {
        state.isZenMode = Boolean(enable);
        const layout = document.querySelector('.app-layout');
        const btnZen = document.getElementById('btnToggleZen');

        if (state.isZenMode) {
            if (layout) layout.classList.add('zen-mode');
            if (btnZen) {
                btnZen.classList.add('active');
                btnZen.title = 'Exit Fullscreen Zen Mode (F11 / Esc)';
            }
        } else {
            if (layout) layout.classList.remove('zen-mode');
            if (btnZen) {
                btnZen.classList.remove('active');
                btnZen.title = 'Toggle Fullscreen Zen Mode (F11)';
            }
        }

        try {
            if (window.api.setFullScreen) {
                await window.api.setFullScreen(state.isZenMode);
            } else {
                await window.api.toggleFullScreen();
            }
        } catch (_) {}
    };

    const toggleZenMode = () => setZenMode(!state.isZenMode);
    const exitZenMode = () => setZenMode(false);

    document.getElementById('btnToggleZen')?.addEventListener('click', toggleZenMode);

    // Keyboard Shortcuts (F11 to toggle, Esc to exit)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            toggleZenMode();
        } else if (e.key === 'Escape') {
            const layout = document.querySelector('.app-layout');
            if (state.isZenMode || layout?.classList.contains('zen-mode')) {
                e.preventDefault();
                exitZenMode();
            }
        }
    });

    // Open GMod folder
    document.getElementById('btnOpenGmodFolder').addEventListener('click', () => {
        if (state.gmodInfo && state.gmodInfo.garrysmodDir) {
            window.api.revealInExplorer(state.gmodInfo.garrysmodDir);
        }
    });

    // Sidebar Quick Launch
    document.getElementById('btnSidebarQuickLaunch').addEventListener('click', () => {
        launchSelectedMap('gm_construct');
    });

    // Map filters & sorting
    document.querySelectorAll('#mapGamemodeFilters .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#mapGamemodeFilters .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.mapFilter = chip.getAttribute('data-filter');
            renderMaps();
        });
    });

    document.getElementById('chkOnlyNavMesh').addEventListener('change', (e) => {
        state.onlyNavMesh = e.target.checked;
        renderMaps();
    });

    document.getElementById('selMapSort').addEventListener('change', (e) => {
        state.mapSort = e.target.value;
        renderMaps();
    });

    // Addon filters & sorting
    document.querySelectorAll('#addonCategoryFilters .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#addonCategoryFilters .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.addonFilter = chip.getAttribute('data-filter');
            renderAddons();
        });
    });

    document.getElementById('selAddonSort').addEventListener('change', (e) => {
        state.addonSort = e.target.value;
        renderAddons();
    });

    document.getElementById('btnEnableAllAddons').addEventListener('click', () => bulkToggleAddons(true));
    document.getElementById('btnDisableAllAddons').addEventListener('click', () => bulkToggleAddons(false));

    // Workshop search & modes
    function updateActiveChipFromSelects() {
        const currentTag = document.getElementById('wsTagSelect').value;
        const currentSort = document.getElementById('wsSortSelect').value;
        document.querySelectorAll('#wsQuickFilterChips .chip').forEach(c => {
            const cTag = c.getAttribute('data-wstag');
            const cSort = c.getAttribute('data-wssort');
            if (cTag === currentTag && cSort === currentSort) {
                c.classList.add('active');
            } else {
                c.classList.remove('active');
            }
        });
    }

    document.getElementById('btnWsSearch').addEventListener('click', () => executeWorkshopSearch());

    const wsSearchInput = document.getElementById('wsSearchInput');
    const btnWsClearSearch = document.getElementById('btnWsClearSearch');
    if (wsSearchInput) {
        wsSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeWorkshopSearch();
        });
        wsSearchInput.addEventListener('input', () => {
            if (btnWsClearSearch) {
                btnWsClearSearch.style.display = wsSearchInput.value ? 'block' : 'none';
            }
            if (searchInput && state.currentTab === 'workshop') {
                searchInput.value = wsSearchInput.value;
                state.searchQuery = wsSearchInput.value.toLowerCase().trim();
                clearBtn.style.display = state.searchQuery ? 'block' : 'none';
            }
        });
    }

    if (btnWsClearSearch) {
        btnWsClearSearch.addEventListener('click', () => {
            if (wsSearchInput) wsSearchInput.value = '';
            if (searchInput) searchInput.value = '';
            btnWsClearSearch.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            executeWorkshopSearch();
        });
    }

    document.getElementById('wsTagSelect').addEventListener('change', () => {
        updateActiveChipFromSelects();
        executeWorkshopSearch();
    });

    document.getElementById('wsSortSelect').addEventListener('change', () => {
        updateActiveChipFromSelects();
        executeWorkshopSearch();
    });

    document.getElementById('btnWsModeBrowse').addEventListener('click', () => {
        document.getElementById('btnWsModeBrowse').classList.add('active');
        document.getElementById('btnWsModeSubscribed').classList.remove('active');
        document.getElementById('wsBrowseControls').style.display = 'flex';
        state.wsMode = 'browse';
        if (!state.wsLoaded || state.wsItems.length === 0) {
            executeWorkshopSearch();
        } else {
            renderWorkshopGrid(state.wsItems);
        }
    });

    document.getElementById('btnWsModeSubscribed').addEventListener('click', () => {
        document.getElementById('btnWsModeBrowse').classList.remove('active');
        document.getElementById('btnWsModeSubscribed').classList.add('active');
        document.getElementById('wsBrowseControls').style.display = 'none';
        state.wsMode = 'subscribed';
        renderSubscribedWorkshopItems();
    });

    document.getElementById('btnOpenSteamHub').addEventListener('click', () => {
        window.api.openSteamWorkshopHub();
        showToast("Opening Garry's Mod Workshop in Steam client...", 'info');
    });

    document.querySelectorAll('#wsQuickFilterChips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#wsQuickFilterChips .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const tag = chip.getAttribute('data-wstag');
            const sort = chip.getAttribute('data-wssort');
            document.getElementById('wsTagSelect').value = tag;
            document.getElementById('wsSortSelect').value = sort;
            // Preserves whatever search query was entered rather than resetting to empty string!
            executeWorkshopSearch();
        });
    });

    const btnWsLoadMore = document.getElementById('btnWsLoadMore');
    if (btnWsLoadMore) {
        btnWsLoadMore.addEventListener('click', () => {
            executeWorkshopSearch(true);
        });
    }

    // Workshop Hide Subscribed Toggle
    const chkHideWs = document.getElementById('chkHideSubscribedWs');
    if (chkHideWs) {
        chkHideWs.checked = localStorage.getItem('gmod_ws_hide_subscribed') !== 'false';
        chkHideWs.addEventListener('change', () => {
            localStorage.setItem('gmod_ws_hide_subscribed', chkHideWs.checked.toString());
            if (state.wsItems && state.wsItems.length > 0) {
                renderWorkshopGrid(state.wsItems);
            }
        });
    }

    // Wireless Controller / Gamepad Tuning
    const rngControllerSpeed = document.getElementById('rngControllerSpeed');
    const chkControllerSmoothing = document.getElementById('chkControllerSmoothing');
    const btnController = document.getElementById('btnApplyControllerTuning');
    const controllerQuickChips = document.getElementById('controllerQuickChips');

    function updateControllerTuningUI(speed) {
        const descriptions = {
            1: '1 / 10 (Ultra Slow Precision)',
            2: '2 / 10 (Very Slow)',
            3: '3 / 10 (Slow Precision)',
            4: '4 / 10 (Precision / Posing)',
            5: '5 / 10 (Cinematic Smooth)',
            6: '6 / 10 (Balanced Tactical)',
            7: '7 / 10 (Snappy Tactical)',
            8: '8 / 10 (Fast Twitch)',
            9: '9 / 10 (Very Fast)',
            10: '10 / 10 (Twitch Spin)'
        };
        const lblSpeed = document.getElementById('lblControllerSpeed');
        if (lblSpeed) {
            lblSpeed.textContent = descriptions[speed] || `${speed} / 10`;
        }

        const steamSens = Math.round(25 + (speed * 12));
        const yawSens = (-0.45 - (speed * 0.09)).toFixed(2);
        const mouseSens = (1.20 + (speed * 0.12)).toFixed(2);

        const lblSteamSensVal = document.getElementById('lblSteamSensVal');
        const lblYawVal = document.getElementById('lblYawVal');
        const lblMouseSensVal = document.getElementById('lblMouseSensVal');
        if (lblSteamSensVal) lblSteamSensVal.textContent = steamSens;
        if (lblYawVal) lblYawVal.textContent = yawSens;
        if (lblMouseSensVal) lblMouseSensVal.textContent = mouseSens;

        const chips = document.querySelectorAll('#controllerQuickChips .chip');
        chips.forEach(chip => {
            const chipSpeed = parseInt(chip.getAttribute('data-speed'), 10);
            if (chipSpeed === speed) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        });
    }

    if (rngControllerSpeed && btnController) {
        const savedSpeed = parseInt(localStorage.getItem('gmod_controller_speed') || '7', 10);
        const savedSmoothing = localStorage.getItem('gmod_controller_smoothing') !== 'false';
        
        rngControllerSpeed.value = savedSpeed;
        if (chkControllerSmoothing) chkControllerSmoothing.checked = savedSmoothing;
        updateControllerTuningUI(savedSpeed);

        rngControllerSpeed.addEventListener('input', () => {
            const currentSpeed = parseInt(rngControllerSpeed.value, 10);
            updateControllerTuningUI(currentSpeed);
        });

        if (controllerQuickChips) {
            controllerQuickChips.addEventListener('click', (e) => {
                const chip = e.target.closest('.chip');
                if (chip && chip.dataset.speed) {
                    const presetSpeed = parseInt(chip.dataset.speed, 10);
                    rngControllerSpeed.value = presetSpeed;
                    updateControllerTuningUI(presetSpeed);
                }
            });
        }

        btnController.addEventListener('click', async () => {
            const speed = parseInt(rngControllerSpeed.value, 10);
            const smoothing = chkControllerSmoothing ? chkControllerSmoothing.checked : true;
            btnController.disabled = true;
            btnController.innerHTML = `<span>Applying Tuning...</span>`;
            try {
                const res = await window.api.applyControllerTuning({ speed, smoothing });
                if (res.success) {
                    localStorage.setItem('gmod_controller_speed', speed.toString());
                    localStorage.setItem('gmod_controller_smoothing', smoothing.toString());
                    showToast(`🎮 Wireless controller tuned (${speed}/10)! Steam: ${res.steamMouseSens}, Yaw: ${res.yawSens}, Mouse Sens: ${res.mouseSens}`, 'success');
                    const badge = document.getElementById('controllerStatusBadge');
                    if (badge) {
                        badge.textContent = `Active (${speed}/10)`;
                        badge.style.color = '#38bdf8';
                        badge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                    }
                } else {
                    showToast(`Failed: ${res.error}`, 'error');
                }
            } catch (err) {
                showToast(`Tuning error: ${err.message}`, 'error');
            } finally {
                btnController.disabled = false;
                btnController.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    <span>Save & Apply Controller Tuning</span>
                `;
            }
        });
    }

    // Storage Purge
    document.getElementById('btnCleanAllCache').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clean the server download cache and temporary files? This is safe and will reclaim disk space.')) {
            try {
                const res = await window.api.cleanStorage('cleanAllCache');
                showToast(`Cleaned ${res.deletedFiles} files and reclaimed ${formatBytes(res.reclaimedBytes)}!`, 'success');
                await refreshStorage();
            } catch (e) {
                showToast('Clean error: ' + e.message, 'error');
            }
        }
    });

    // Presets
    document.getElementById('btnCreatePreset').addEventListener('click', openCreatePresetModal);
    document.getElementById('btnClosePresetModal').addEventListener('click', closeCreatePresetModal);
    document.getElementById('btnCancelPreset').addEventListener('click', closeCreatePresetModal);
    document.getElementById('btnSavePreset').addEventListener('click', saveNewPreset);

    // GMA Inspector Modal
    document.getElementById('btnCloseGmaModal').addEventListener('click', closeGmaModal);
    document.getElementById('btnModalClose').addEventListener('click', closeGmaModal);
    document.getElementById('modalFileSearch').addEventListener('input', filterGmaFiles);
    document.getElementById('btnModalUnpackGmad').addEventListener('click', unpackCurrentGma);

    // Publish NavMesh Modal
    document.getElementById('btnClosePublishNavModal').addEventListener('click', closePublishNavModal);
    document.getElementById('btnCancelPublishNav').addEventListener('click', closePublishNavModal);
    document.getElementById('btnConfirmPublishNav').addEventListener('click', executePublishNavmesh);

    // Settings browse
    document.getElementById('btnBrowseGmodPath').addEventListener('click', async () => {
        const folder = await window.api.selectFolderDialog();
        if (folder) {
            state.gmodInfo = await window.api.setCustomGmodPath(folder);
            updateGmodStatus();
            await refreshMaps();
            await refreshAddons();
            showToast('GMod path updated', 'success');
        }
    });

    // Pack folder
    document.getElementById('btnBrowsePackFolder').addEventListener('click', async () => {
        const folder = await window.api.selectFolderDialog();
        if (folder) {
            document.getElementById('packSourceFolder').value = folder;
        }
    });

    document.getElementById('btnExecutePack').addEventListener('click', async () => {
        const folder = document.getElementById('packSourceFolder').value;
        if (!folder) {
            return showToast('Please select a folder first', 'error');
        }
        try {
            showToast('Packing folder to .gma...', 'info');
            const res = await window.api.packAddon(folder, null);
            showToast('Addon successfully packed into .gma!', 'success');
            await refreshAddons();
        } catch (e) {
            showToast('Packing error: ' + e.message, 'error');
        }
    });

    // Restore and persist resolution preference
    try {
        const savedRes = localStorage.getItem('gmod_preferred_res');
        const resEl = document.getElementById('optResolution');
        if (savedRes && resEl) {
            resEl.value = savedRes;
        }
        if (resEl) {
            resEl.addEventListener('change', () => {
                localStorage.setItem('gmod_preferred_res', resEl.value);
            });
        }
    } catch (_) {}

    // Couch / TV 'Q' Menu Zoom Controls
    const syncQMenuZoomUI = (settings) => {
        if (!settings) return;
        const scaleStr = String(settings.scale || 2);
        const quickSel = document.getElementById('selQuickQMenuZoom');
        if (quickSel) quickSel.value = scaleStr;

        document.querySelectorAll('#qmenuZoomChips .chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-qzoom') === scaleStr);
        });

        const chkMag = document.getElementById('chkQMenuMagnifier');
        if (chkMag && settings.magnifier !== undefined) chkMag.checked = Boolean(settings.magnifier);

        const chkTog = document.getElementById('chkQMenuToggle');
        if (chkTog && settings.toggleMode !== undefined) chkTog.checked = Boolean(settings.toggleMode);

        const badge = document.getElementById('qmenuZoomStatusBadge');
        if (badge) {
            const pct = Math.round((Number(settings.scale) || 2) * 100);
            badge.textContent = `${pct}% Zoom Active`;
        }
    };

    const saveAndApplyQMenuZoom = async (scaleOverride = null) => {
        let scale = scaleOverride;
        if (scale === null) {
            const activeChip = document.querySelector('#qmenuZoomChips .chip.active');
            scale = activeChip ? Number(activeChip.getAttribute('data-qzoom')) : 2.0;
        }
        const magnifier = document.getElementById('chkQMenuMagnifier') ? document.getElementById('chkQMenuMagnifier').checked : true;
        const toggleMode = document.getElementById('chkQMenuToggle') ? document.getElementById('chkQMenuToggle').checked : true;

        if (window.api.applyQMenuZoom) {
            try {
                const res = await window.api.applyQMenuZoom({ scale, magnifier, toggleMode });
                syncQMenuZoomUI(res);
                const pct = Math.round((res.scale || scale) * 100);
                showToast(`🔍 'Q' Menu Couch Zoom set to ${pct}% (${magnifier ? 'Hover Magnifier ON' : 'Magnifier OFF'})!`, 'success');
            } catch (err) {
                showToast('Failed to apply Q-Menu zoom: ' + err.message, 'error');
            }
        }
    };

    if (window.api.getQMenuZoom) {
        window.api.getQMenuZoom().then(syncQMenuZoomUI).catch(() => {});
    }

    const selQuickQMenuZoom = document.getElementById('selQuickQMenuZoom');
    if (selQuickQMenuZoom) {
        selQuickQMenuZoom.addEventListener('change', (e) => {
            saveAndApplyQMenuZoom(Number(e.target.value));
        });
    }

    document.querySelectorAll('#qmenuZoomChips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = Number(chip.getAttribute('data-qzoom'));
            saveAndApplyQMenuZoom(val);
        });
    });

    document.getElementById('chkQMenuMagnifier')?.addEventListener('change', () => saveAndApplyQMenuZoom(null));
    document.getElementById('chkQMenuToggle')?.addEventListener('change', () => saveAndApplyQMenuZoom(null));
    document.getElementById('btnApplyQMenuZoom')?.addEventListener('click', () => saveAndApplyQMenuZoom(null));
}

// ---------------- MAPS HUB ----------------
async function refreshMaps() {
    try {
        state.maps = await window.api.scanMaps();
        document.getElementById('mapsCountBadge').textContent = state.maps.length;
        renderMaps();
    } catch (err) {
        console.error('Failed to scan maps:', err);
    }
}

function renderMaps() {
    const grid = document.getElementById('mapsGrid');
    grid.innerHTML = '';

    let filtered = state.maps.filter(map => {
        // Gamemode filter
        if (state.mapFilter !== 'all' && map.classification.id !== state.mapFilter) {
            return false;
        }
        // NavMesh filter
        if (state.onlyNavMesh && !map.hasNav) {
            return false;
        }
        // Search filter
        if (state.searchQuery) {
            const q = state.searchQuery;
            const matchName = map.mapName.toLowerCase().includes(q);
            const matchParent = map.parentAddon && map.parentAddon.name.toLowerCase().includes(q);
            const matchGame = map.classification.label.toLowerCase().includes(q);
            if (!matchName && !matchParent && !matchGame) return false;
        }
        return true;
    });

    // Sorting
    filtered.sort((a, b) => {
        if (state.mapSort === 'name') return a.mapName.localeCompare(b.mapName);
        if (state.mapSort === 'size_desc') return b.fileSize - a.fileSize;
        if (state.mapSort === 'size_asc') return a.fileSize - b.fileSize;
        if (state.mapSort === 'source') return a.source.localeCompare(b.source);
        return 0;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/></svg>
                <h3>No maps match your filter</h3>
                <p>Try clearing your search query or selecting a different category filter.</p>
            </div>
        `;
        return;
    }

    filtered.forEach(map => {
        const card = document.createElement('div');
        card.className = 'map-card';

        const thumbHtml = map.thumbnail
            ? `<img src="${map.thumbnail}" alt="${map.mapName}" onerror="this.parentElement.innerHTML='<div class=\\'map-card-thumb-placeholder\\'>🗺️<span>No Preview</span></div>'">`
            : `<div class="map-card-thumb-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/></svg><span>${map.mapName}</span></div>`;

        const isNative = map.source === 'loose';
        const pubInfo = state.publishedNavmeshes ? state.publishedNavmeshes[map.mapName.toLowerCase()] : null;
        const isPublished = Boolean(pubInfo);

        card.innerHTML = `
            <div class="map-card-thumb">
                ${thumbHtml}
                <span class="badge-gamemode" style="border-left-color: ${map.classification.color};">${map.classification.label}</span>
                <span class="badge-source">${isNative ? 'Native .BSP' : 'Workshop GMA'}</span>
            </div>
            <div class="map-card-body">
                <div class="map-card-title" title="${map.mapName}">${map.mapName}</div>
                <div class="map-card-subtitle" title="${map.parentAddon ? map.parentAddon.name : 'Garry\'s Mod Built-in'}">
                    ${map.parentAddon ? map.parentAddon.name : 'Built-in / Loose Map'}
                </div>
                <div class="map-meta-row">
                    <span>${formatBytes(map.fileSize)}</span>
                    ${isPublished ? `
                    <span class="pill-nav pill-uploaded" title="Live on Steam Workshop (ID: ${pubInfo.workshopId || ''})">
                        ☁️ Uploaded
                    </span>` : map.hasNativeNav ? `
                    <span class="pill-nav pill-ready" title="Custom Navigation Mesh ready (.nav file on disk)">
                        ● NavMesh Ready
                    </span>` : map.hasBundledNav ? `
                    <span class="pill-nav pill-bundled" style="background: rgba(14, 165, 233, 0.15); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.3);" title="Official built-in NavMesh provided inside Workshop addon">
                        ● Built-in NavMesh
                    </span>` : `
                    <span class="pill-nav none" data-action="gen-nav" data-map="${map.mapName}" style="cursor: pointer;" title="Click to automatically generate a NavMesh (.nav) for Nextbots & NPCs!">
                        ⚡ Create NavMesh
                    </span>`}
                </div>
            </div>
            <div class="map-card-footer">
                <button class="btn btn-card-launch" data-map="${map.mapName}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    <span>Launch</span>
                </button>
                ${!map.hasNav ? `
                <button class="btn btn-secondary btn-sm" data-action="gen-nav" data-map="${map.mapName}" title="1-Click Autopilot: Launch Garry's Mod and automatically calculate a NavMesh (.nav) for Nextbots & NPCs" style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.4); padding: 6px 10px; font-size: 12px; font-weight: 600; white-space: nowrap;">
                    ⚡ NavMesh
                </button>` : `
                <button class="btn btn-secondary btn-icon" data-action="gen-nav" data-map="${map.mapName}" title="Rebuild / Regenerate NavMesh (.nav) with 1-Click Autopilot" style="color: #94a3b8;">
                    ⚡
                </button>`}
                ${(map.hasNativeNav || isPublished) ? `
                <button class="btn btn-secondary btn-icon btn-nav-cloud" 
                    title="${isPublished ? `NavMesh Uploaded to Steam Workshop! (${pubInfo.title || map.mapName}) - Click to manage or view on Workshop` : 'Publish NavMesh to Steam Workshop'}" 
                    data-action="publish-nav" 
                    data-map="${map.mapName}" 
                    style="${isPublished ? 'color: #34d399; background: rgba(52, 211, 153, 0.14); border: none;' : 'color: #38bdf8;'}">
                    ${isPublished ? `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><polyline points="9 11 12 14 20 6"/></svg>
                    ` : `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
                    `}
                </button>` : ''}
                ${!isNative ? `
                <button class="btn btn-secondary btn-icon" title="Extract loose .bsp to garrysmod/maps" data-action="extract" data-gma="${map.filePath}" data-internal="${map.internalMapPath}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>` : ''}
                <button class="btn btn-secondary btn-icon" title="Reveal in File Explorer" data-action="reveal" data-path="${map.filePath}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
                ${map.workshopId ? `
                <button class="btn btn-secondary btn-icon" title="Open in Steam Client" data-action="steam" data-wsid="${map.workshopId}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                </button>` : ''}
            </div>
        `;

        // Card button actions
        card.querySelector('.btn-card-launch').addEventListener('click', () => {
            launchSelectedMap(map.mapName);
        });

        card.querySelectorAll('[data-action="gen-nav"]').forEach(btnGen => {
            btnGen.addEventListener('click', async (e) => {
                e.stopPropagation();
                btnGen.disabled = true;
                const origHtml = btnGen.innerHTML;
                btnGen.innerHTML = `⏳...`;
                showToast(`Launching ${map.mapName} with NavMesh Autopilot... GMod will compute and save ${map.mapName}.nav automatically!`, 'info');
                try {
                    await window.api.generateMapNavmesh(map.mapName);
                } catch (err) {
                    showToast('Failed to start NavMesh Autopilot: ' + err.message, 'error');
                    btnGen.disabled = false;
                    btnGen.innerHTML = origHtml;
                }
            });
        });

        const btnPublishNav = card.querySelector('[data-action="publish-nav"]');
        if (btnPublishNav) {
            btnPublishNav.addEventListener('click', () => {
                openPublishNavModal(map.mapName);
            });
        }

        const btnExtract = card.querySelector('[data-action="extract"]');
        if (btnExtract) {
            btnExtract.addEventListener('click', async () => {
                try {
                    showToast(`Extracting ${map.mapName}.bsp into garrysmod/maps...`, 'info');
                    await window.api.extractMap(map.filePath, map.internalMapPath);
                    showToast(`Successfully extracted ${map.mapName}.bsp to maps folder!`, 'success');
                    await refreshMaps();
                } catch (e) {
                    showToast('Extraction failed: ' + e.message, 'error');
                }
            });
        }

        const btnReveal = card.querySelector('[data-action="reveal"]');
        if (btnReveal) {
            btnReveal.addEventListener('click', () => {
                window.api.revealInExplorer(map.filePath);
            });
        }

        const btnSteam = card.querySelector('[data-action="steam"]');
        if (btnSteam) {
            btnSteam.addEventListener('click', () => {
                window.api.openSteamClient(map.workshopId);
            });
        }

        grid.appendChild(card);
    });
}

function launchSelectedMap(mapName) {
    const novid = document.getElementById('optNoVid').checked;
    const noworkshop = document.getElementById('optNoWorkshop').checked;
    const windowed = document.getElementById('optWindowed').checked;
    const gamemode = document.getElementById('optDefaultGamemode').value || 'sandbox';
    const extraArgs = document.getElementById('optExtraArgs').value || '';
    const resEl = document.getElementById('optResolution');
    const resVal = resEl ? resEl.value : 'native';

    if (resEl) {
        try { localStorage.setItem('gmod_preferred_res', resVal); } catch (_) {}
    }

    let width = null;
    let height = null;
    if (resVal === '3840x2160') { width = 3840; height = 2160; }
    else if (resVal === '2560x1440') { width = 2560; height = 1440; }
    else if (resVal === '1920x1080') { width = 1920; height = 1080; }

    const resLabel = (resVal === 'native' || !width) ? 'Native / DLDSR Fullscreen' : `${width}x${height}`;
    showToast(`Launching Garry's Mod directly into ${mapName} (${resLabel})...`, 'info');
    window.api.launchMap(mapName, { novid, noworkshop, fullscreen: !windowed, windowed, width, height, gamemode, extraArgs })
        .then(() => showToast(`Garry's Mod launched with map: ${mapName}!`, 'success'))
        .catch(err => showToast(`Launch failed: ${err.message}`, 'error'));
}

// ---------------- ASSETS & ADDONS ----------------
async function refreshAddons() {
    try {
        state.addons = await window.api.scanAddons();
        if (window.api.getSubscribedWorkshopIds) {
            try {
                const subIds = await window.api.getSubscribedWorkshopIds();
                if (Array.isArray(subIds)) {
                    state.subscribedWorkshopIds = subIds;
                }
            } catch (_) {}
        }
        document.getElementById('addonsCountBadge').textContent = state.addons.length;
        const subCountEl = document.getElementById('wsSubscribedCount');
        if (subCountEl) {
            const totalSubscribed = Math.max(
                state.addons.filter(a => a.isWorkshop).length,
                (state.subscribedWorkshopIds || []).length
            );
            subCountEl.textContent = totalSubscribed;
        }
        renderAddons();
    } catch (err) {
        console.error('Failed to scan addons:', err);
    }
}

const ADDON_SECTION_ORDER = [
    '2D Studio Characters',
    'Gamemodes',
    'NPCs & NextBots',
    'Weapons',
    'Vehicles',
    'Models & Playermodels',
    'Effects & Realism',
    'Tools & Utilities',
    'Maps & NavMeshes'
];

const ADDON_SECTION_META = {
    '2D Studio Characters': { icon: '🎨', chipLabel: '2D Studio' },
    'Gamemodes':            { icon: '🎮', chipLabel: 'Gamemodes' },
    'NPCs & NextBots':      { icon: '🤖', chipLabel: 'NPCs & NextBots' },
    'Weapons':              { icon: '🔫', chipLabel: 'Weapons' },
    'Vehicles':             { icon: '🚗', chipLabel: 'Vehicles' },
    'Models & Playermodels':{ icon: '🧍', chipLabel: 'Models & Props' },
    'Effects & Realism':    { icon: '✨', chipLabel: 'Effects & Realism' },
    'Tools & Utilities':    { icon: '🛠️', chipLabel: 'Tools & Utilities' },
    'Maps & NavMeshes':     { icon: '🗺️', chipLabel: 'Maps & NavMeshes' }
};

function updateAddonFilterBarUI() {
    document.querySelectorAll('#addonCategoryFilters .chip').forEach(chip => {
        const filterVal = chip.getAttribute('data-filter');
        if (filterVal === 'all') {
            const enabledAll = state.addons.filter(a => a.isEnabled).length;
            chip.textContent = `All Sections (${enabledAll}/${state.addons.length})`;
        } else {
            const meta = ADDON_SECTION_META[filterVal] || { icon: '📦', chipLabel: filterVal };
            const inSec = state.addons.filter(a => a.category === filterVal);
            const enabledSec = inSec.filter(a => a.isEnabled).length;
            chip.textContent = `${meta.icon} ${meta.chipLabel} (${enabledSec}/${inSec.length})`;
        }
    });

    const btnEnable = document.getElementById('btnEnableAllAddons');
    const btnDisable = document.getElementById('btnDisableAllAddons');
    if (btnEnable && btnDisable) {
        if (state.addonFilter === 'all') {
            btnEnable.textContent = 'Enable All';
            btnDisable.textContent = 'Disable All';
        } else {
            const meta = ADDON_SECTION_META[state.addonFilter] || { chipLabel: state.addonFilter };
            btnEnable.textContent = `Enable ${meta.chipLabel}`;
            btnDisable.textContent = `Disable ${meta.chipLabel}`;
        }
    }
}

function createAddonRowElement(addon, onToggled) {
    const row = document.createElement('div');
    row.className = `addon-row ${addon.isEnabled ? '' : 'disabled'}`;

    const thumbHtml = addon.previewUrl
        ? `<img src="${addon.previewUrl}" alt="${addon.name}" onerror="this.parentElement.innerHTML='📦'">`
        : `<span>📦</span>`;

    row.innerHTML = `
        <label class="toggle-switch">
            <input type="checkbox" ${addon.isEnabled ? 'checked' : ''} data-file="${addon.filePath}">
            <span class="toggle-slider"></span>
        </label>
        <div class="addon-thumb">${thumbHtml}</div>
        <div class="addon-info">
            <div class="addon-title" title="${addon.name}">${addon.name}</div>
            <div class="addon-details">
                <span class="addon-tag">${addon.category}</span>
                <span>${formatBytes(addon.fileSize)}</span>
                <span>By: ${addon.author || 'Unknown'}</span>
                ${addon.filesCount > 0 ? `<span>${addon.filesCount} internal files</span>` : ''}
            </div>
        </div>
        <div class="addon-actions">
            ${!addon.isFolder ? `
            <button class="btn btn-secondary btn-sm" data-action="inspect" title="Inspect GMA internal files">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span>Inspect</span>
            </button>` : ''}
            <button class="btn btn-secondary btn-icon" data-action="reveal" title="Reveal in File Explorer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </button>
            ${addon.workshopId ? `
            <button class="btn btn-secondary btn-icon" data-action="steam" title="Open in Steam Client">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
            </button>` : ''}
        </div>
    `;

    // Toggle switch
    const toggleInput = row.querySelector('.toggle-switch input');
    toggleInput.addEventListener('change', async (e) => {
        const enable = e.target.checked;
        try {
            const res = await window.api.toggleAddon(addon.filePath, enable);
            addon.filePath = res.newPath;
            addon.isEnabled = enable;
            row.classList.toggle('disabled', !enable);
            updateAddonFilterBarUI();
            if (typeof onToggled === 'function') onToggled();
            showToast(`${addon.name} ${enable ? 'enabled' : 'disabled'}`, 'info');
            await refreshMaps();
        } catch (err) {
            e.target.checked = !enable;
            showToast('Toggle failed: ' + err.message, 'error');
        }
    });

    // Inspect button
    const btnInspect = row.querySelector('[data-action="inspect"]');
    if (btnInspect) {
        btnInspect.addEventListener('click', () => openGmaInspector(addon));
    }

    // Reveal button
    row.querySelector('[data-action="reveal"]').addEventListener('click', () => {
        window.api.revealInExplorer(addon.filePath);
    });

    // Steam client button
    const btnSteam = row.querySelector('[data-action="steam"]');
    if (btnSteam) {
        btnSteam.addEventListener('click', () => {
            window.api.openSteamClient(addon.workshopId);
        });
    }

    return row;
}

function renderAddons() {
    const list = document.getElementById('addonsList');
    list.innerHTML = '';

    updateAddonFilterBarUI();

    let filtered = state.addons.filter(addon => {
        if (state.addonFilter !== 'all' && addon.category !== state.addonFilter) {
            return false;
        }

        if (state.searchQuery) {
            const q = state.searchQuery;
            const matchName = (addon.name || '').toLowerCase().includes(q);
            const matchAuthor = (addon.author || '').toLowerCase().includes(q);
            const matchCat = (addon.category || '').toLowerCase().includes(q);
            if (!matchName && !matchAuthor && !matchCat) return false;
        }
        return true;
    });

    // Sorting within each section
    filtered.sort((a, b) => {
        if (state.addonSort === 'name') return a.name.localeCompare(b.name);
        if (state.addonSort === 'size_desc') return b.fileSize - a.fileSize;
        if (state.addonSort === 'size_asc') return a.fileSize - b.fileSize;
        if (state.addonSort === 'status') return (b.isEnabled ? 1 : 0) - (a.isEnabled ? 1 : 0);
        return 0;
    });

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                <h3>No addons found</h3>
                <p>Try modifying your search or selecting a different section.</p>
            </div>
        `;
        return;
    }

    // Group filtered addons by section
    const groups = new Map();
    for (const sec of ADDON_SECTION_ORDER) {
        groups.set(sec, []);
    }
    for (const addon of filtered) {
        const sec = addon.category || 'Models & Playermodels';
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec).push(addon);
    }

    for (const [sectionName, sectionAddons] of groups.entries()) {
        if (sectionAddons.length === 0) continue;

        const meta = ADDON_SECTION_META[sectionName] || { icon: '📦', chipLabel: sectionName };
        const isCollapsed = Boolean(state.collapsedAddonSections[sectionName]);
        const sectionEl = document.createElement('div');
        sectionEl.className = `addon-section-group ${isCollapsed ? 'collapsed' : ''}`;

        const totalBytes = sectionAddons.reduce((sum, a) => sum + (a.fileSize || 0), 0);

        const headerEl = document.createElement('div');
        headerEl.className = 'addon-section-header';

        const updateSectionStats = () => {
            const enabledCount = sectionAddons.filter(a => a.isEnabled).length;
            const badgeEl = headerEl.querySelector('.addon-section-badge');
            if (badgeEl) {
                badgeEl.textContent = `${enabledCount} / ${sectionAddons.length} Enabled`;
                badgeEl.classList.toggle('none-enabled', enabledCount === 0);
            }
            const btnEn = headerEl.querySelector('[data-sec-action="enable"]');
            const btnDis = headerEl.querySelector('[data-sec-action="disable"]');
            if (btnEn) btnEn.disabled = enabledCount === sectionAddons.length;
            if (btnDis) btnDis.disabled = enabledCount === 0;
        };

        const initialEnabled = sectionAddons.filter(a => a.isEnabled).length;

        headerEl.innerHTML = `
            <div class="addon-section-left" title="Click to expand/collapse ${sectionName}">
                <span class="addon-section-chevron">▼</span>
                <div class="addon-section-title">
                    <span>${meta.icon}</span>
                    <span>${sectionName}</span>
                </div>
                <span class="addon-section-badge ${initialEnabled === 0 ? 'none-enabled' : ''}">${initialEnabled} / ${sectionAddons.length} Enabled</span>
                <span class="addon-section-size">${formatBytes(totalBytes)}</span>
            </div>
            <div class="addon-section-actions">
                <button class="btn btn-secondary btn-sm" data-sec-action="enable" ${initialEnabled === sectionAddons.length ? 'disabled' : ''} title="Enable all ${sectionAddons.length} addons in ${sectionName}">
                    ✓ Enable Section
                </button>
                <button class="btn btn-secondary btn-sm" data-sec-action="disable" ${initialEnabled === 0 ? 'disabled' : ''} title="Disable all ${sectionAddons.length} addons in ${sectionName}">
                    ✕ Disable Section
                </button>
            </div>
        `;

        headerEl.addEventListener('click', (e) => {
            if (e.target.closest('.addon-section-actions')) return;
            const nowCollapsed = !sectionEl.classList.contains('collapsed');
            sectionEl.classList.toggle('collapsed', nowCollapsed);
            state.collapsedAddonSections[sectionName] = nowCollapsed;
        });

        headerEl.querySelector('[data-sec-action="enable"]').addEventListener('click', (e) => {
            e.stopPropagation();
            bulkToggleSectionAddons(sectionAddons, true, sectionName);
        });

        headerEl.querySelector('[data-sec-action="disable"]').addEventListener('click', (e) => {
            e.stopPropagation();
            bulkToggleSectionAddons(sectionAddons, false, sectionName);
        });

        const bodyEl = document.createElement('div');
        bodyEl.className = 'addon-section-body';

        for (const addon of sectionAddons) {
            bodyEl.appendChild(createAddonRowElement(addon, updateSectionStats));
        }

        sectionEl.appendChild(headerEl);
        sectionEl.appendChild(bodyEl);
        list.appendChild(sectionEl);
    }
}

async function bulkToggleSectionAddons(addonsSubset, enable, label = 'Selected') {
    const toChange = addonsSubset.filter(a => a.isEnabled !== enable);
    if (toChange.length === 0) {
        showToast(`${label}: all addons are already ${enable ? 'enabled' : 'disabled'}.`, 'info');
        return;
    }

    showToast(`${enable ? 'Enabling' : 'Disabling'} ${toChange.length} addons in ${label}...`, 'info');
    try {
        const filePaths = toChange.map(a => a.filePath);
        if (window.api.bulkToggleAddons) {
            await window.api.bulkToggleAddons(filePaths, enable);
        } else {
            for (const addon of toChange) {
                await window.api.toggleAddon(addon.filePath, enable);
            }
        }
        await refreshAddons();
        await refreshMaps();
        showToast(`${label}: ${toChange.length} addons ${enable ? 'enabled' : 'disabled'}!`, 'success');
    } catch (err) {
        showToast(`Failed to toggle ${label}: ` + err.message, 'error');
    }
}

async function bulkToggleAddons(enable) {
    // If a specific section chip is selected, only toggle that section
    if (state.addonFilter !== 'all') {
        const sectionSubset = state.addons.filter(a => a.category === state.addonFilter);
        return bulkToggleSectionAddons(sectionSubset, enable, state.addonFilter);
    }

    const toChange = state.addons.filter(a => a.isEnabled !== enable);
    if (toChange.length === 0) return;

    if (enable && toChange.length > 50) {
        const totalSize = state.addons.reduce((sum, a) => sum + (a.fileSize || 0), 0);
        const ok = confirm(
            `Enable ALL ${state.addons.length} addons (${formatBytes(totalSize)}) at once?\n\n` +
            `Tip: Loading every addon simultaneously can cause long Garry's Mod startup times or graphics lag. ` +
            `You can use the "✓ Enable Section" buttons on individual sections (like Gamemodes, NPCs & NextBots, or Weapons) for peak graphics performance.\n\n` +
            `Click OK to enable all anyway, or Cancel to choose specific sections.`
        );
        if (!ok) return;
    }

    return bulkToggleSectionAddons(state.addons, enable, 'All Sections');
}

// ---------------- GMA INSPECTOR MODAL ----------------
async function openGmaInspector(addon) {
    state.selectedGma = addon;
    document.getElementById('modalGmaTitle').textContent = addon.name;
    document.getElementById('modalGmaAuthor').textContent = `Author: ${addon.author || 'Unknown'} | Type: ${addon.category}`;

    const modal = document.getElementById('gmaInspectorModal');
    const tbody = document.getElementById('modalGmaFilesBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Reading GMA header...</td></tr>';
    modal.classList.add('active');

    try {
        const header = await window.api.inspectGma(addon.filePath);
        if (header && header.files) {
            state.gmaModalFiles = header.files;
            document.getElementById('modalGmaStats').textContent = `Total Files: ${header.files.length} | Size: ${formatBytes(header.totalContentSize)}`;
            renderGmaFilesTable(header.files);
        } else {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Could not read GMA archive</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--accent-red);">${e.message}</td></tr>`;
    }
}

function renderGmaFilesTable(files) {
    const tbody = document.getElementById('modalGmaFilesBody');
    tbody.innerHTML = '';
    files.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f.name}</td>
            <td>${formatBytes(f.size)}</td>
            <td>${f.crc}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterGmaFiles(e) {
    const q = e.target.value.toLowerCase();
    const filtered = state.gmaModalFiles.filter(f => f.name.toLowerCase().includes(q));
    renderGmaFilesTable(filtered);
}

function closeGmaModal() {
    document.getElementById('gmaInspectorModal').classList.remove('active');
    document.getElementById('modalFileSearch').value = '';
    state.selectedGma = null;
    state.gmaModalFiles = [];
}

async function unpackCurrentGma() {
    if (!state.selectedGma) return;
    try {
        showToast(`Unpacking ${state.selectedGma.name} with GMAD...`, 'info');
        const outDir = await window.api.unpackAddon(state.selectedGma.filePath, null);
        showToast(`Unpacked successfully to: ${outDir}`, 'success');
        closeGmaModal();
        await refreshAddons();
    } catch (e) {
        showToast('Unpack error: ' + e.message, 'error');
    }
}

// ---------------- PRESETS & LOADOUTS ----------------
async function refreshPresets() {
    try {
        state.presets = await window.api.loadPresets();
        renderPresets();
    } catch (e) {
        console.error('Failed to load presets:', e);
    }
}

function renderPresets() {
    const grid = document.getElementById('presetsGrid');
    grid.innerHTML = '';

    state.presets.forEach(preset => {
        const card = document.createElement('div');
        card.className = 'preset-card';

        const isDefault = preset.id === 'all_enabled' || preset.id === 'vanilla';
        const countText = preset.addonIds.includes('*')
            ? 'All Addons'
            : (preset.addonIds.length === 0 ? '0 Addons (Vanilla)' : `${preset.addonIds.length} Addons`);

        card.innerHTML = `
            <div>
                <div class="preset-card-header">
                    <div class="preset-card-title">${preset.name}</div>
                    <span class="badge">${countText}</span>
                </div>
                <p class="preset-card-desc">${preset.description || 'No description provided.'}</p>
            </div>
            <div class="preset-card-actions">
                <button class="btn btn-primary btn-sm btn-apply-preset">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Apply Preset</span>
                </button>
                ${!isDefault ? `
                <button class="btn btn-danger btn-sm btn-delete-preset">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                </button>` : ''}
            </div>
        `;

        card.querySelector('.btn-apply-preset').addEventListener('click', async () => {
            try {
                showToast(`Applying preset: ${preset.name}...`, 'info');
                const res = await window.api.applyPreset(preset.id);
                showToast(`Preset "${preset.name}" applied! (${res.enabledCount} enabled, ${res.disabledCount} disabled)`, 'success');
                await refreshAddons();
                await refreshMaps();
            } catch (err) {
                showToast('Failed to apply preset: ' + err.message, 'error');
            }
        });

        const btnDelete = card.querySelector('.btn-delete-preset');
        if (btnDelete) {
            btnDelete.addEventListener('click', async () => {
                if (confirm(`Delete preset "${preset.name}"?`)) {
                    await window.api.deletePreset(preset.id);
                    await refreshPresets();
                    showToast('Preset deleted', 'info');
                }
            });
        }

        grid.appendChild(card);
    });
}

function openCreatePresetModal() {
    const activeAddons = state.addons.filter(a => a.isEnabled);
    document.getElementById('presetActiveCountNote').textContent =
        `This will save your current active setup (${activeAddons.length} addons enabled).`;
    document.getElementById('presetNameInput').value = '';
    document.getElementById('presetDescInput').value = '';
    document.getElementById('presetModal').classList.add('active');
}

function closeCreatePresetModal() {
    document.getElementById('presetModal').classList.remove('active');
}

async function saveNewPreset() {
    const name = document.getElementById('presetNameInput').value.trim();
    const desc = document.getElementById('presetDescInput').value.trim();
    if (!name) return showToast('Please enter a preset name', 'error');

    const activeIds = state.addons
        .filter(a => a.isEnabled)
        .map(a => a.workshopId || a.id);

    try {
        await window.api.createPreset(name, desc, activeIds);
        closeCreatePresetModal();
        await refreshPresets();
        showToast(`Preset "${name}" created!`, 'success');
    } catch (e) {
        showToast('Error saving preset: ' + e.message, 'error');
    }
}

// ---------------- WORKSHOP NAVMESH PUBLISHER MODAL ----------------
let currentPublishingMap = null;

async function openPublishNavModal(mapName) {
    currentPublishingMap = mapName;
    const modal = document.getElementById('publishNavmeshModal');
    const targetLabel = document.getElementById('pubNavMapTarget');
    const sizeLabel = document.getElementById('pubNavFileSize');
    const iconPreview = document.getElementById('pubNavIconPreview');
    const titleInput = document.getElementById('pubNavTitleInput');
    const descInput = document.getElementById('pubNavDescInput');
    const statusAlert = document.getElementById('pubNavStatusAlert');
    const btnConfirm = document.getElementById('btnConfirmPublishNav');
    const btnCancel = document.getElementById('btnCancelPublishNav');

    if (btnCancel) btnCancel.textContent = 'Cancel';
    btnConfirm.disabled = false;
    btnConfirm.dataset.completed = 'false';

    const pubInfo = state.publishedNavmeshes ? state.publishedNavmeshes[mapName.toLowerCase()] : null;
    const isAlreadyPublished = Boolean(pubInfo);

    if (isAlreadyPublished) {
        statusAlert.style.display = 'block';
        statusAlert.style.background = 'rgba(52, 211, 153, 0.15)';
        statusAlert.style.color = '#34d399';
        statusAlert.style.border = '1px solid rgba(52, 211, 153, 0.3)';
        statusAlert.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                    <strong>☁️ Already Uploaded:</strong> Live on Steam Workshop (ID: ${pubInfo.workshopId || 'Active'})
                </div>
                ${pubInfo.workshopId ? `
                <button class="btn btn-secondary btn-xs" id="btnViewLiveWsItem" style="padding: 2px 8px; font-size: 11px;">
                    View on Workshop ↗
                </button>` : ''}
            </div>
        `;
        setTimeout(() => {
            const btnView = document.getElementById('btnViewLiveWsItem');
            if (btnView && pubInfo.workshopId) {
                btnView.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.api.openSteamClient(pubInfo.workshopId);
                });
            }
        }, 10);
        btnConfirm.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
            <span>Update on Steam Workshop</span>
        `;
    } else {
        statusAlert.style.display = 'none';
        statusAlert.innerHTML = '';
        btnConfirm.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
            <span>Upload to Steam Workshop</span>
        `;
    }

    targetLabel.textContent = mapName;
    sizeLabel.textContent = 'Loading details...';
    modal.classList.add('active');

    try {
        const meta = await window.api.getPublishNavmeshMeta(mapName);
        titleInput.value = meta.title || `[NavMesh] ${mapName}`;
        descInput.value = meta.description || '';
        sizeLabel.textContent = `NavMesh Size: ${formatBytes(meta.navSize)}`;
        if (meta.thumbUrl) {
            iconPreview.src = meta.thumbUrl;
        } else {
            iconPreview.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect width="72" height="72" fill="%231e293b"/><text x="36" y="42" font-family="sans-serif" font-weight="bold" font-size="10" fill="%2338bdf8" text-anchor="middle">NAVMESH</text></svg>';
        }

        if (meta.isBundled) {
            statusAlert.style.display = 'block';
            statusAlert.style.background = 'rgba(14, 165, 233, 0.15)';
            statusAlert.style.color = '#38bdf8';
            statusAlert.style.border = '1px solid rgba(14, 165, 233, 0.3)';
            statusAlert.innerHTML = `ℹ️ This map includes an official built-in NavMesh (${formatBytes(meta.navSize)}). It has been extracted to garrysmod/maps so Nextbots and singleplayer work immediately!`;
        } else if (!meta.navSize || meta.navSize === 0) {
            btnConfirm.disabled = true;
            statusAlert.style.display = 'block';
            statusAlert.style.background = 'rgba(239, 68, 68, 0.15)';
            statusAlert.style.color = '#f87171';
            statusAlert.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            statusAlert.innerHTML = `⚠️ NavMesh file '${mapName}.nav' not detected in garrysmod/maps yet. Please run <strong>⚡ Auto-Fix</strong> on this map first so GMod can calculate it!`;
        }
    } catch (err) {
        showToast('Failed to load map metadata: ' + err.message, 'error');
    }
}

function closePublishNavModal() {
    const modal = document.getElementById('publishNavmeshModal');
    if (modal) modal.classList.remove('active');
    currentPublishingMap = null;
}

async function executePublishNavmesh() {
    if (!currentPublishingMap) return;
    const btnConfirm = document.getElementById('btnConfirmPublishNav');
    if (btnConfirm && btnConfirm.dataset.completed === 'true') {
        closePublishNavModal();
        return;
    }
    const statusAlert = document.getElementById('pubNavStatusAlert');
    const titleInput = document.getElementById('pubNavTitleInput');
    const descInput = document.getElementById('pubNavDescInput');
    const checkboxes = document.querySelectorAll('#pubNavTagsContainer input[type="checkbox"]:checked');
    const tags = Array.from(checkboxes).map(cb => cb.value);

    btnConfirm.disabled = true;
    btnConfirm.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; display: inline-block;"></span> Packing GMA & Publishing to Steam...`;
    statusAlert.style.display = 'block';
    statusAlert.style.background = 'rgba(56, 189, 248, 0.15)';
    statusAlert.style.color = '#38bdf8';
    statusAlert.style.border = '1px solid rgba(56, 189, 248, 0.3)';
    statusAlert.innerHTML = `Packaging .nav into GMA and communicating with Steamworks publisher... Please wait!`;

    try {
        const res = await window.api.publishNavmesh({
            mapName: currentPublishingMap,
            title: titleInput.value,
            description: descInput.value,
            tags
        });

        if (res.success) {
            // Update state.publishedNavmeshes immediately!
            if (!state.publishedNavmeshes) state.publishedNavmeshes = {};
            state.publishedNavmeshes[currentPublishingMap.toLowerCase()] = {
                mapName: currentPublishingMap,
                workshopId: res.workshopId,
                title: res.title,
                url: res.url,
                updatedAt: Date.now()
            };

            // Re-render the map grid right away so the cloud icon turns green with checkmark!
            renderMapsGrid(state.maps);

            statusAlert.style.background = 'rgba(34, 197, 94, 0.15)';
            statusAlert.style.color = '#4ade80';
            statusAlert.style.border = '1px solid rgba(34, 197, 94, 0.3)';
            statusAlert.innerHTML = `
                <div style="font-weight: 700; margin-bottom: 4px;">🎉 Successfully Published to Steam Workshop!</div>
                <div><strong>${res.title}</strong> is now live on your Steam Workshop profile.</div>
                ${res.url ? `<div style="margin-top: 8px;"><a href="#" id="lnkViewWorkshopItem" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Open Workshop Item ↗</a></div>` : ''}
            `;
            if (res.url) {
                const link = document.getElementById('lnkViewWorkshopItem');
                if (link) {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (res.workshopId) window.api.openSteamClient(res.workshopId);
                        else window.api.openExternalUrl(res.url);
                    });
                }
            }
            btnConfirm.disabled = false;
            btnConfirm.dataset.completed = 'true';
            btnConfirm.innerHTML = `✓ Upload Complete`;
            const btnCancel = document.getElementById('btnCancelPublishNav');
            if (btnCancel) btnCancel.textContent = 'Close';

            showToast(`Published [NavMesh] ${currentPublishingMap} to Steam Workshop!`, 'success');
        } else {
            statusAlert.style.background = 'rgba(239, 68, 68, 0.15)';
            statusAlert.style.color = '#f87171';
            statusAlert.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            statusAlert.innerHTML = `⚠️ ${res.error || 'Upload failed'}`;
            btnConfirm.disabled = false;
            btnConfirm.dataset.completed = 'false';
            btnConfirm.innerHTML = `Retry Upload`;
        }
    } catch (err) {
        statusAlert.style.display = 'block';
        statusAlert.style.background = 'rgba(239, 68, 68, 0.15)';
        statusAlert.style.color = '#f87171';
        statusAlert.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusAlert.innerHTML = `⚠️ Error: ${err.message}`;
        btnConfirm.disabled = false;
        btnConfirm.dataset.completed = 'false';
        btnConfirm.innerHTML = `Retry Upload`;
    }
}

// ---------------- STEAM WORKSHOP BROWSER ----------------
async function executeWorkshopSearch(isLoadMore = false) {
    const query = document.getElementById('wsSearchInput').value.trim();
    const tag = document.getElementById('wsTagSelect').value;
    const sort = document.getElementById('wsSortSelect').value;
    const grid = document.getElementById('workshopGrid');
    const btnLoadMore = document.getElementById('btnWsLoadMore');

    if (isLoadMore) {
        if (state.wsLoadingMore || !state.wsHasMore) return;
        state.wsLoadingMore = true;
        if (btnLoadMore) {
            btnLoadMore.disabled = true;
            btnLoadMore.innerHTML = `
                <span class="spinner" style="width: 14px; height: 14px; border: 2px solid var(--accent-blue); border-top-color: transparent; border-radius: 50%; display: inline-block;"></span>
                <span>Loading more items...</span>
            `;
        }

        try {
            const nextPage = (state.wsPage || 1) + 2;
            const newItems = await window.api.searchWorkshop({ query, tag, sort, page: nextPage, pagesToFetch: 2 });
            state.wsPage = nextPage;
            state.wsLoadingMore = false;

            if (!newItems || newItems.length === 0) {
                state.wsHasMore = false;
                if (btnLoadMore) {
                    btnLoadMore.style.display = 'none';
                    showToast('All available Workshop items loaded', 'info');
                }
                return;
            }

            const existingIds = new Set((state.wsItems || []).map(i => String(i.id)));
            const uniqueNew = newItems.filter(i => !existingIds.has(String(i.id)));
            if (uniqueNew.length === 0 || newItems.length < 10) {
                state.wsHasMore = false;
            }
            state.wsItems = (state.wsItems || []).concat(uniqueNew);
            renderWorkshopGrid(state.wsItems);
            showToast(`Loaded ${uniqueNew.length} additional workshop items`, 'info');
        } catch (err) {
            state.wsLoadingMore = false;
            if (btnLoadMore) {
                btnLoadMore.disabled = false;
                btnLoadMore.innerHTML = `<span>Retry Loading More</span>`;
            }
            showToast('Failed to load more items: ' + err.message, 'error');
        }
        return;
    }

    // Fresh search or category/sort change
    state.wsPage = 1;
    state.wsHasMore = true;
    state.wsLoadingMore = false;
    if (btnLoadMore) btnLoadMore.style.display = 'none';

    grid.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Searching Steam Workshop for "${query || tag || 'Trending items'}"...</p>
        </div>
    `;

    try {
        if (!state.subscribedWorkshopIds || state.subscribedWorkshopIds.length === 0) {
            try {
                if (window.api.getSubscribedWorkshopIds) {
                    const ids = await window.api.getSubscribedWorkshopIds();
                    if (Array.isArray(ids)) state.subscribedWorkshopIds = ids;
                }
            } catch (_) {}
        }

        // Fetch 2 pages concurrently by default (60+ items)
        const items = await window.api.searchWorkshop({ query, tag, sort, page: 1, pagesToFetch: 2 });
        state.wsItems = items || [];
        state.wsLoaded = true;

        if (!items || items.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    <h3>No workshop items found</h3>
                    <p>Try searching for a different keyword or category.</p>
                </div>
            `;
            if (btnLoadMore) btnLoadMore.style.display = 'none';
            return;
        }

        if (items.length < 15) {
            state.wsHasMore = false;
        }

        renderWorkshopGrid(items);
    } catch (e) {
        grid.innerHTML = `
            <div class="empty-state">
                <h3>Search Error</h3>
                <p>${e.message}</p>
            </div>
        `;
        if (btnLoadMore) btnLoadMore.style.display = 'none';
    }
}

function renderWorkshopGrid(items) {
    const grid = document.getElementById('workshopGrid');
    const btnLoadMore = document.getElementById('btnWsLoadMore');
    grid.innerHTML = '';

    // Collect all installed workshop IDs from Steam UGC subscriptions, addons, and maps
    const installedIds = new Set((state.subscribedWorkshopIds || []).map(String));
    (state.addons || []).forEach(a => {
        if (a.workshopId) installedIds.add(String(a.workshopId));
    });
    (state.maps || []).forEach(m => {
        if (m.workshopId) installedIds.add(String(m.workshopId));
    });

    const hideSubscribed = localStorage.getItem('gmod_ws_hide_subscribed') !== 'false';
    const displayItems = hideSubscribed
        ? items.filter(item => !installedIds.has(String(item.id)))
        : items;
    const hiddenCount = items.length - displayItems.length;

    const statusEl = document.getElementById('wsDiscoveryStatus');
    if (statusEl) {
        if (hideSubscribed && hiddenCount > 0) {
            statusEl.textContent = `Showing ${displayItems.length} fresh discoveries (${hiddenCount} owned hidden)`;
        } else {
            statusEl.textContent = `Showing ${displayItems.length} items`;
        }
    }

    if (displayItems.length === 0) {
        if (btnLoadMore) btnLoadMore.style.display = 'none';
        grid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <h3>All ${items.length} items are already in your library!</h3>
                <p>You have already subscribed to every item in this query. Uncheck "Hide items I already have" to see them, or search for other keywords.</p>
                <button class="btn btn-secondary btn-sm" id="btnShowAllOwnedWs" style="margin-top: 12px;">Show Owned Items</button>
            </div>
        `;
        const btnShowOwned = document.getElementById('btnShowAllOwnedWs');
        if (btnShowOwned) {
            btnShowOwned.addEventListener('click', () => {
                const chk = document.getElementById('chkHideSubscribedWs');
                if (chk) {
                    chk.checked = false;
                    localStorage.setItem('gmod_ws_hide_subscribed', 'false');
                    renderWorkshopGrid(items);
                }
            });
        }
        return;
    }

    displayItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'ws-item-card';

        const thumb = item.previewUrl
            ? `<img src="${item.previewUrl}" alt="${item.title}">`
            : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;">No Image</div>`;

        const isSubscribedLocally = installedIds.has(String(item.id));

        card.innerHTML = `
            <div class="ws-item-thumb">
                ${thumb}
                ${isSubscribedLocally ? '<span class="badge" style="position:absolute;top:10px;right:10px;background:var(--accent-green);color:white;" title="Subscribed in Steam">✓ Subscribed</span>' : ''}
            </div>
            <div class="ws-item-body">
                <div class="ws-item-title" title="${item.title}">${item.title}</div>
                <div class="map-meta-row">
                    <span>${formatBytes(item.fileSize)}</span>
                    <span>⭐ ${Number(item.subscriptions || 0).toLocaleString()} subscribers</span>
                </div>
            </div>
            <div class="ws-item-footer">
                <button class="btn ${isSubscribedLocally ? 'btn-secondary' : 'btn-primary'} btn-sm btn-open-steam" style="flex:1;" title="${isSubscribedLocally ? 'Manage or view this item in your Steam client' : 'Open in your desktop Steam client to subscribe'}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                    <span>${isSubscribedLocally ? 'Manage in Steam' : 'Subscribe in Steam'}</span>
                </button>
                <button class="btn btn-secondary btn-icon btn-open-browser" title="View in Web Browser">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
            </div>
        `;

        card.querySelector('.btn-open-steam').addEventListener('click', () => {
            window.api.openSteamClient(item.id);
            showToast(`Opening "${item.title}" in Steam client...`, 'info');
            // Optimistically mark as subscribed so UI updates immediately
            if (!installedIds.has(String(item.id))) {
                if (!state.subscribedWorkshopIds) state.subscribedWorkshopIds = [];
                state.subscribedWorkshopIds.push(String(item.id));
                installedIds.add(String(item.id));
                const btn = card.querySelector('.btn-open-steam');
                if (btn) {
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-secondary');
                    const span = btn.querySelector('span');
                    if (span) span.textContent = 'Manage in Steam';
                    btn.title = 'Manage or view this item in your Steam client';
                }
                const thumbEl = card.querySelector('.ws-item-thumb');
                if (thumbEl && !thumbEl.querySelector('.badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.style.cssText = 'position:absolute;top:10px;right:10px;background:var(--accent-green);color:white;';
                    badge.title = 'Subscribed in Steam';
                    badge.textContent = '✓ Subscribed';
                    thumbEl.appendChild(badge);
                }
            }
        });

        card.querySelector('.btn-open-browser').addEventListener('click', () => {
            window.api.openExternalUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`);
        });

        grid.appendChild(card);
    });

    // Update Load More button
    if (btnLoadMore) {
        if (state.wsMode === 'browse' && state.wsHasMore) {
            btnLoadMore.style.display = 'inline-flex';
            btnLoadMore.disabled = false;
            btnLoadMore.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline></svg>
                <span>Load More Discoveries</span>
            `;
        } else {
            btnLoadMore.style.display = 'none';
        }
    }
}

function renderSubscribedWorkshopItems() {
    const btnLoadMore = document.getElementById('btnWsLoadMore');
    if (btnLoadMore) btnLoadMore.style.display = 'none';

    const grid = document.getElementById('workshopGrid');
    grid.innerHTML = '';

    const subscribedAddons = state.addons.filter(a => a.isWorkshop);

    if (subscribedAddons.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <h3>No Subscribed Workshop Items Detected</h3>
                <p>Subscribe to maps and addons on the Steam Workshop and they will show up here automatically.</p>
            </div>
        `;
        return;
    }

    subscribedAddons.forEach(addon => {
        const card = document.createElement('div');
        card.className = 'ws-item-card';

        const thumb = addon.previewUrl
            ? `<img src="${addon.previewUrl}" alt="${addon.name}" onerror="this.parentElement.innerHTML='📦'">`
            : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px;">📦</div>`;

        card.innerHTML = `
            <div class="ws-item-thumb">
                ${thumb}
                <span class="badge-gamemode" style="border-left-color: ${addon.isEnabled ? 'var(--accent-green)' : 'var(--accent-orange)'};">
                    ${addon.isEnabled ? 'Active' : 'Disabled'}
                </span>
                <span class="badge-source">${addon.category}</span>
            </div>
            <div class="ws-item-body">
                <div class="ws-item-title" title="${addon.name}">${addon.name}</div>
                <div class="map-meta-row">
                    <span>${formatBytes(addon.fileSize)}</span>
                    <span>By: ${addon.author || 'Unknown'}</span>
                </div>
            </div>
            <div class="ws-item-footer">
                <button class="btn btn-secondary btn-sm btn-open-steam" style="flex:1;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                    <span>Steam Page</span>
                </button>
                <button class="btn btn-secondary btn-icon" data-action="inspect" title="Inspect GMA files">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="2" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="btn btn-secondary btn-icon" data-action="reveal" title="Reveal in File Explorer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
            </div>
        `;

        card.querySelector('.btn-open-steam').addEventListener('click', () => {
            window.api.openSteamClient(addon.workshopId);
        });

        card.querySelector('[data-action="inspect"]').addEventListener('click', () => {
            openGmaInspector(addon);
        });

        card.querySelector('[data-action="reveal"]').addEventListener('click', () => {
            window.api.revealInExplorer(addon.filePath);
        });

        grid.appendChild(card);
    });
}

// ---------------- STORAGE & CACHE CLEANER ----------------
async function refreshStorage() {
    try {
        state.storage = await window.api.analyzeStorage();
        renderStorage();
    } catch (e) {
        console.error('Failed to analyze storage:', e);
    }
}

function renderStorage() {
    if (!state.storage) return;

    const s = state.storage;
    document.getElementById('cleanableBadge').textContent = formatBytes(s.cleanableTotalBytes);

    const grid = document.getElementById('storageMetricsGrid');
    grid.innerHTML = `
        <div class="storage-card">
            <div class="storage-card-header">
                <h3>Steam Workshop Content</h3>
                <span class="badge">Addons & Maps</span>
            </div>
            <div class="storage-size-highlight">${formatBytes(s.workshop.size)}</div>
            <div class="storage-card-details">
                ${s.workshop.count} GMA files subscribed through Steam Workshop.
            </div>
        </div>

        <div class="storage-card">
            <div class="storage-card-header">
                <h3>Native Loose Maps</h3>
                <span class="badge">.BSP</span>
            </div>
            <div class="storage-size-highlight">${formatBytes(s.maps.size)}</div>
            <div class="storage-card-details">
                ${s.maps.count} map files installed in garrysmod/maps.
            </div>
        </div>

        <div class="storage-card">
            <div class="storage-card-header">
                <h3>Server Download Cache</h3>
                <span class="badge badge-warning">Safe to Clean</span>
            </div>
            <div class="storage-size-highlight">${formatBytes(s.download.size)}</div>
            <div class="storage-card-details">
                ${s.download.count} models, sounds, and textures downloaded from multiplayer servers.
            </div>
            <button class="btn btn-secondary btn-sm" id="btnCleanDownloads" style="margin-top:auto;">Clean Server Downloads</button>
        </div>

        <div class="storage-card">
            <div class="storage-card-header">
                <h3>Temporary Cache</h3>
                <span class="badge badge-warning">Safe to Clean</span>
            </div>
            <div class="storage-size-highlight">${formatBytes(s.cache.size + s.downloadLists.size)}</div>
            <div class="storage-card-details">
                Cached download lists and internal workshop previews.
            </div>
            <button class="btn btn-secondary btn-sm" id="btnCleanCacheOnly" style="margin-top:auto;">Clean Cache</button>
        </div>

        <div class="storage-card">
            <div class="storage-card-header">
                <h3>Screenshots, Dupes & Demos</h3>
                <span class="badge">User Data</span>
            </div>
            <div class="storage-size-highlight">${formatBytes(s.screenshots.size + s.dupes.size + s.demos.size)}</div>
            <div class="storage-card-details">
                In-game screenshots, physics duplications, and recorded replay demos.
            </div>
        </div>
    `;

    document.getElementById('btnCleanDownloads').addEventListener('click', async () => {
        try {
            const res = await window.api.cleanStorage('download');
            showToast(`Cleaned ${res.deletedFiles} server files (${formatBytes(res.reclaimedBytes)})`, 'success');
            await refreshStorage();
        } catch (e) {
            showToast('Clean error: ' + e.message, 'error');
        }
    });

    document.getElementById('btnCleanCacheOnly').addEventListener('click', async () => {
        try {
            const res1 = await window.api.cleanStorage('cache');
            const res2 = await window.api.cleanStorage('downloadlists');
            const totalBytes = res1.reclaimedBytes + res2.reclaimedBytes;
            showToast(`Cache cleaned (${formatBytes(totalBytes)} freed)`, 'success');
            await refreshStorage();
        } catch (e) {
            showToast('Clean error: ' + e.message, 'error');
        }
    });
}

// ---------------- ADDON DOCTOR & DIAGNOSTICS ----------------
let diagnosticResults = null;

async function refreshDiagnostics() {
    const btn = document.getElementById('btnRunDoctor');
    if (btn) btn.disabled = true;

    try {
        diagnosticResults = await window.api.runDiagnostics();
        renderDiagnostics();
    } catch (e) {
        console.error('Failed to run diagnostics:', e);
        showToast('Diagnostics error: ' + e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function renderDiagnostics() {
    if (!diagnosticResults) return;

    const res = diagnosticResults;
    const badge = document.getElementById('doctorAlertBadge');
    const totalIssues = (res.counts.missingContent || 0) + (res.counts.missingBases || 0) + (res.counts.conflicts || 0);
    
    if (totalIssues > 0) {
        badge.textContent = totalIssues;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }

    // Dismissed / Silenced Navmesh state from backend
    const exemptNavCount = (res.counts && res.counts.dismissedNav) || 0;
    const activeNavCount = (res.counts && res.counts.noNav) || 0;

    // Filter out dismissed maps from nav recommendations
    const activeNavRecs = (res.recommendations || []).filter(r => r.type === 'navmesh_notice');

    // Update summary stat boxes
    const elMounted = document.getElementById('docStatMounted');
    const elBases = document.getElementById('docStatBases');
    const elConflicts = document.getElementById('docStatConflicts');
    const elNav = document.getElementById('docStatNav');
    const elFixed = document.getElementById('docStatFixed');

    if (elMounted) elMounted.textContent = res.counts.missingContent > 0 ? '1 Missing (CS:S)' : 'Mounted';
    if (elBases) elBases.textContent = res.counts.missingBases;
    if (elConflicts) elConflicts.textContent = res.counts.conflicts;
    if (elNav) {
        if (activeNavCount === 0 && exemptNavCount > 0) {
            elNav.textContent = `0 (${exemptNavCount} Exempt)`;
            elNav.title = `${exemptNavCount} rogue/non-Nextbot maps permanently exempted from NavMesh checks`;
        } else if (exemptNavCount > 0) {
            elNav.textContent = `${activeNavCount} (${exemptNavCount} Exempt)`;
        } else {
            elNav.textContent = activeNavCount;
        }
    }
    if (elFixed) elFixed.textContent = res.counts.resolvedCount || 0;

    const container = document.getElementById('doctorSectionsContainer');
    if (!container) return;
    container.innerHTML = '';

    const controllerRecs = (res.recommendations || []).filter(r => r.type === 'controller_tuning');
    const isAllClean = res.issues.length === 0 && activeNavRecs.length === 0 && controllerRecs.length === 0;

    if (isAllClean) {
        const cleanCard = document.createElement('div');
        cleanCard.className = 'doctor-all-clean';
        cleanCard.innerHTML = `
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <h3>All Systems Healthy! (100% Clean)</h3>
            <p>No missing base frameworks, content mounts, or script conflicts were detected. Everything is optimal!</p>
            ${exemptNavCount > 0 ? `
                <div style="margin-top: 14px; font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>🛡️ <strong>${exemptNavCount} rogue NavMesh notices</strong> permanently exempted & serving as a lesson.</span>
                    <button class="btn btn-secondary btn-xs" id="btnRestoreNavNotices" style="padding: 2px 8px;">Unhide</button>
                </div>
            ` : ''}
        `;
        container.appendChild(cleanCard);

        const btnRestore = cleanCard.querySelector('#btnRestoreNavNotices');
        if (btnRestore) {
            btnRestore.addEventListener('click', async () => {
                btnRestore.disabled = true;
                btnRestore.textContent = 'Restoring...';
                try {
                    await window.api.restoreNavMaps();
                    localStorage.removeItem('gmod_silence_all_nav_notices');
                    localStorage.removeItem('gmod_dismissed_nav_maps');
                    showToast('NavMesh recommendations restored.', 'info');
                    await refreshDiagnostics();
                } catch (e) {
                    showToast('Error restoring notices: ' + e.message, 'error');
                }
            });
        }
    }

    // 1. Missing Mounted Game Content (CS:S)
    const contentIssues = res.issues.filter(i => i.type === 'missing_game_content');
    if (contentIssues.length > 0) {
        const group = document.createElement('div');
        group.className = 'doctor-section-group';
        group.innerHTML = `
            <div class="doctor-section-group-title">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>Missing Game Content (Flashing Purple Checkers & Red ERROR Models)</span>
            </div>
        `;

        contentIssues.forEach(issue => {
            const card = document.createElement('div');
            card.className = 'doctor-card high-severity';
            card.innerHTML = `
                <div class="doctor-card-top">
                    <span class="doctor-card-title">${issue.title}</span>
                    <span class="doctor-card-badge high">Critical</span>
                </div>
                <div class="doctor-card-desc">${issue.message}</div>
                <div class="doctor-card-actions">
                    <button class="btn btn-primary btn-sm btn-doc-css-sub">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                        <span>⚡ 1-Click: Subscribe to CS:S Content Fix (Steam)</span>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-doc-css">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                        <span>View CS:S Game on Steam Store</span>
                    </button>
                </div>
            `;

            card.querySelector('.btn-doc-css-sub').addEventListener('click', () => {
                window.api.openSteamClient('3540392343');
                showToast('Opened CS:S Content Fix on Steam. Click "Subscribe" to fix pink textures!', 'info');
            });

            card.querySelector('.btn-doc-css').addEventListener('click', () => {
                window.api.openExternalUrl('https://store.steampowered.com/app/240/CounterStrike_Source/');
            });

            group.appendChild(card);
        });

        container.appendChild(group);
    }

    // 2. Missing Framework Bases
    const baseIssues = res.issues.filter(i => i.type === 'missing_base_addon');
    if (baseIssues.length > 0) {
        const group = document.createElement('div');
        group.className = 'doctor-section-group';
        group.innerHTML = `
            <div class="doctor-section-group-title" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Missing Framework / Base Addons (Causes Lua Script Errors & Broken Vehicles)</span>
                </div>
                <button class="btn btn-primary btn-sm btn-sub-all-bases">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    <span>⚡ 1-Click: Subscribe All Missing Bases in Steam</span>
                </button>
            </div>
        `;

        const btnSubAll = group.querySelector('.btn-sub-all-bases');
        if (btnSubAll) {
            btnSubAll.addEventListener('click', () => {
                const ids = baseIssues.map(b => b.workshopId);
                window.api.subscribeMissingBases(ids);
                showToast(`Opened all ${ids.length} missing bases in Steam. Click 'Subscribe' on each to install!`, 'info');
            });
        }

        baseIssues.forEach(issue => {
            const card = document.createElement('div');
            card.className = 'doctor-card high-severity';
            card.innerHTML = `
                <div class="doctor-card-top">
                    <span class="doctor-card-title">${issue.title}</span>
                    <span class="doctor-card-badge high">Missing Base</span>
                </div>
                <div class="doctor-card-desc">${issue.message}</div>
                <div class="doctor-card-affected">
                    <span>Used by ${issue.affectedCount} installed addon(s):</span>
                    <code>${issue.affectedSample}</code>
                </div>
                <div class="doctor-card-actions">
                    <button class="btn btn-primary btn-sm btn-doc-sub">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                        <span>⚡ Fix Now: ${issue.actionText}</span>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-doc-web">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                        <span>Open in Browser</span>
                    </button>
                </div>
            `;

            card.querySelector('.btn-doc-sub').addEventListener('click', () => {
                window.api.openSteamClient(issue.workshopId);
                showToast(`Opened ${issue.title} in Steam. Click 'Subscribe' to install it!`, 'info');
            });

            card.querySelector('.btn-doc-web').addEventListener('click', () => {
                window.api.openExternalUrl(issue.webUrl || `https://steamcommunity.com/sharedfiles/filedetails/?id=${issue.workshopId}`);
            });

            group.appendChild(card);
        });

        container.appendChild(group);
    }

    // 3. Duplicate Pack Conflicts
    const conflictIssues = res.issues.filter(i => i.type === 'duplicate_addon_conflict');
    if (conflictIssues.length > 0) {
        const group = document.createElement('div');
        group.className = 'doctor-section-group';
        group.innerHTML = `
            <div class="doctor-section-group-title">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                <span>Duplicate Addon Packs & Script Collisions</span>
            </div>
        `;

        conflictIssues.forEach(issue => {
            const card = document.createElement('div');
            card.className = 'doctor-card med-severity';
            
            let duplicatesHtml = '';
            if (issue.duplicates) {
                duplicatesHtml = `
                    <div class="doctor-conflict-list">
                        ${issue.duplicates.map(d => `
                            <div class="doctor-conflict-item">
                                <div class="doctor-conflict-name">⚠️ ${d.title}</div>
                                <div class="doctor-conflict-desc">${d.detail}</div>
                                <div class="doctor-conflict-action-row">
                                    <div class="doctor-conflict-fix">💡 ${d.fix}</div>
                                    <button class="btn btn-sm btn-fix-single-conflict" data-key="${d.key}">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                        <span>⚡ ${d.fixButtonText || 'Fix Now'}</span>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="doctor-card-top">
                    <span class="doctor-card-title">${issue.title}</span>
                    <span class="doctor-card-badge med">Conflict</span>
                </div>
                <div class="doctor-card-desc">${issue.message}</div>
                ${duplicatesHtml}
                <div class="doctor-card-actions" style="margin-top: 18px;">
                    <button class="btn btn-primary btn-sm btn-fix-all-conflicts">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                        <span>⚡ Fix All Conflicts (1-Click)</span>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-goto-addons">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        <span>View in Addons Tab</span>
                    </button>
                </div>
            `;

            // Bind single conflict fix buttons
            card.querySelectorAll('.btn-fix-single-conflict').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const key = btn.getAttribute('data-key');
                    btn.disabled = true;
                    btn.innerHTML = `<span>Fixing...</span>`;
                    try {
                        const r = await window.api.fixAddonConflict(key);
                        showToast(`Conflict resolved! Disabled ${r.modifiedCount} redundant pack(s).`, 'success');
                        await Promise.all([refreshAddons(), refreshDiagnostics()]);
                    } catch (err) {
                        showToast(`Error resolving conflict: ${err.message}`, 'error');
                        btn.disabled = false;
                    }
                });
            });

            // Bind Fix All Conflicts button
            const btnFixAll = card.querySelector('.btn-fix-all-conflicts');
            if (btnFixAll) {
                btnFixAll.addEventListener('click', async () => {
                    btnFixAll.disabled = true;
                    btnFixAll.innerHTML = `<span>Fixing All...</span>`;
                    try {
                        const r = await window.api.fixAddonConflict('all');
                        showToast(`All conflicts resolved! Disabled ${r.modifiedCount} redundant pack(s). 3,500+ collisions eliminated!`, 'success');
                        await Promise.all([refreshAddons(), refreshDiagnostics()]);
                    } catch (err) {
                        showToast(`Error resolving conflicts: ${err.message}`, 'error');
                        btnFixAll.disabled = false;
                    }
                });
            }

            card.querySelector('.btn-goto-addons').addEventListener('click', () => {
                const addonsTab = document.querySelector('.nav-item[data-tab="addons"]');
                if (addonsTab) addonsTab.click();
            });

            group.appendChild(card);
        });

        container.appendChild(group);
    }

    // 3.5 Wireless Controller / Gamepad Optimization
    if (controllerRecs.length > 0) {
        const group = document.createElement('div');
        group.className = 'doctor-section-group';
        group.innerHTML = `
            <div class="doctor-section-group-title">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span>Wireless Controller & Gamepad Optimization</span>
            </div>
        `;

        controllerRecs.forEach(rec => {
            const card = document.createElement('div');
            card.className = 'doctor-card info-severity';
            card.innerHTML = `
                <div class="doctor-card-top">
                    <span class="doctor-card-title">${rec.title}</span>
                    <span class="doctor-card-badge" style="background: rgba(56, 189, 248, 0.2); color: var(--accent-cyan); border: 1px solid rgba(56, 189, 248, 0.4);">Input Calibration</span>
                </div>
                <div class="doctor-card-desc">
                    ${rec.message}
                    <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary); background: rgba(0,0,0,0.25); padding: 8px 12px; border-radius: 4px; border-left: 3px solid var(--accent-cyan);">
                        💡 ${rec.solution}
                    </div>
                </div>
                <div class="doctor-card-actions" style="margin-top: 14px;">
                    <button class="btn btn-primary btn-sm btn-tune-controller">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                        <span>${rec.actionText || '⚡ Calibrate Controller'}</span>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-goto-controller-settings">
                        <span>Presets in Settings</span>
                    </button>
                </div>
            `;

            card.querySelector('.btn-tune-controller').addEventListener('click', async () => {
                const btn = card.querySelector('.btn-tune-controller');
                btn.disabled = true;
                btn.textContent = 'Applying Calibration...';
                try {
                    await window.api.applyControllerTuning('smooth');
                    showToast('🎮 Gamepad calibrated to Smooth Aiming! Acceleration spikes eliminated.', 'success');
                    await refreshDiagnostics();
                } catch (err) {
                    showToast('Failed to tune controller: ' + err.message, 'error');
                    btn.disabled = false;
                }
            });

            card.querySelector('.btn-goto-controller-settings').addEventListener('click', () => {
                const settingsTab = document.querySelector('.nav-item[data-tab="settings"]');
                if (settingsTab) settingsTab.click();
            });

            group.appendChild(card);
        });

        container.appendChild(group);
    }

    // 4. Nextbot & NavMesh Recommendations
    if (activeNavRecs.length > 0) {
        const group = document.createElement('div');
        group.className = 'doctor-section-group';
        group.innerHTML = `
            <div class="doctor-section-group-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/></svg>
                    <span>Nextbots & Map Navigation (NavMesh)</span>
                </div>
                <button class="btn btn-secondary btn-sm btn-dismiss-all-nav" title="Dismiss all NavMesh notices (Recommended if you don't play Nextbots on these maps)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>⚡ Dismiss All (Mark as Handled)</span>
                </button>
            </div>
        `;

        const btnDismissAll = group.querySelector('.btn-dismiss-all-nav');
        if (btnDismissAll) {
            btnDismissAll.addEventListener('click', async () => {
                btnDismissAll.disabled = true;
                btnDismissAll.textContent = 'Dismissing...';
                try {
                    const allMaps = activeNavRecs.flatMap(r => r.affectedMaps || []);
                    await window.api.dismissAllNavMaps(allMaps);
                    localStorage.setItem('gmod_silence_all_nav_notices', 'true');
                    showToast('All NavMesh recommendations permanently dismissed! System is 100% Healthy.', 'success');
                    await refreshDiagnostics();
                } catch (e) {
                    showToast('Error dismissing: ' + e.message, 'error');
                    btnDismissAll.disabled = false;
                }
            });
        }

        activeNavRecs.forEach(rec => {
            const card = document.createElement('div');
            card.className = 'doctor-card info-severity';
            
            let mapsChipsHtml = '';
            if (rec.affectedMaps && rec.affectedMaps.length > 0) {
                mapsChipsHtml = `
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 10px; margin-bottom: 8px;">Installed maps lacking a .nav mesh (${rec.affectedMaps.length}) — Click <strong>⚡ Auto-Fix</strong> or dismiss (<strong>✕</strong>) maps you don't use for Nextbots:</div>
                    <div class="doctor-maps-table" style="max-height: 260px; display: flex; flex-wrap: wrap; gap: 8px;">
                        ${rec.affectedMaps.map(m => `
                            <div class="doctor-map-nav-item">
                                <span class="doctor-map-name" title="${m}" style="font-family: var(--font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${m}</span>
                                <div style="display: flex; gap: 4px; align-items: center;">
                                    <button class="btn btn-primary btn-xs btn-gen-nav" data-map="${m}" title="1-Click Automated Autopilot: Launches GMod and automatically generates the Navmesh with zero typing!">
                                        ⚡ Auto-Fix
                                    </button>
                                    <button class="btn btn-secondary btn-xs btn-dismiss-map-nav" data-map="${m}" title="Dismiss notice for ${m}" style="padding: 2px 7px; color: var(--text-muted);">
                                        ✕
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="doctor-card-top">
                    <span class="doctor-card-title">${rec.title}</span>
                    <span class="doctor-card-badge" style="background: rgba(14, 165, 233, 0.2); color: var(--accent-blue); border: 1px solid rgba(14, 165, 233, 0.4);">Pathfinding Notice</span>
                </div>
                <div class="doctor-card-desc">
                    ${rec.message}
                    <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary); background: rgba(0,0,0,0.25); padding: 8px 12px; border-radius: 4px; border-left: 3px solid var(--accent-blue);">
                        💡 <strong>A map that doesn't seem to go away?</strong> Some maps (like Silent Escape story campaign, Slender Spongebob, and Lestnicha staircase) have custom scripted AI or lack player spawn entities, preventing GMod from auto-generating a mesh. Click the <strong>✕</strong> button next to any map to dismiss it, or click <strong>⚡ Dismiss All</strong> above to permanently clear your dashboard to 100% Healthy!
                    </div>
                </div>
                ${mapsChipsHtml}
                <div class="doctor-conflict-item" style="margin-top: 14px; border-left: 3px solid var(--accent-cyan);">
                    <div class="doctor-conflict-fix" style="color: var(--accent-cyan); font-weight: 600;">⚡ Automated Autopilot Generation:</div>
                    <div class="doctor-conflict-desc" style="margin-top: 6px; line-height: 1.6;">
                        If you ever do want a NavMesh for a specific map, click <strong>⚡ Auto-Fix</strong> next to it. GMod will load and calculate it automatically. Otherwise, click <strong>⚡ Dismiss All</strong> to silence the warning permanently.
                    </div>
                </div>
            `;

            // Bind map auto-generate buttons
            card.querySelectorAll('.btn-gen-nav').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const mapName = btn.getAttribute('data-map');
                    btn.disabled = true;
                    btn.innerHTML = `<span class="spinner" style="width: 10px; height: 10px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; display: inline-block;"></span> Generating...`;
                    showToast(`Launching ${mapName} with Autopilot... Please wait ~15s while GMod computes the mesh!`, 'info');
                    try {
                        await window.api.generateMapNavmesh(mapName);
                    } catch (err) {
                        showToast(`Failed to launch map: ${err.message}`, 'error');
                        btn.disabled = false;
                        btn.innerHTML = `⚡ Auto-Fix`;
                    }
                });
            });

            // Bind dismiss single map buttons
            card.querySelectorAll('.btn-dismiss-map-nav').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const mapName = btn.getAttribute('data-map');
                    btn.disabled = true;
                    try {
                        await window.api.dismissNavMap(mapName);
                        showToast(`Permanently dismissed NavMesh notice for ${mapName}`, 'info');
                        await refreshDiagnostics();
                    } catch (err) {
                        showToast(`Error dismissing: ${err.message}`, 'error');
                        btn.disabled = false;
                    }
                });
            });

            group.appendChild(card);
        });

        container.appendChild(group);
    }

    // 5. Resolved & Healthy Section
    if (res.resolved && res.resolved.length > 0) {
        const hidePacks = localStorage.getItem('gmod_hide_recommended_packs') !== 'false'; // default to hidden
        const hasAnyPacks = res.resolved.some(item => item.recommendedPacks && item.recommendedPacks.length > 0);

        const group = document.createElement('div');
        group.className = 'doctor-resolved-group';
        group.innerHTML = `
            <div class="doctor-section-group-title" style="color: #34d399; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Resolved & Healthy Status (${res.resolved.length})</span>
                </div>
                ${hasAnyPacks ? `
                    <button class="btn btn-secondary btn-xs btn-toggle-packs" style="font-size: 11px; padding: 3px 10px; color: var(--text-secondary);">
                        ${hidePacks ? '📦 Show Available Asset Packs' : '🙈 Hide Asset Packs'}
                    </button>
                ` : ''}
            </div>
            <div class="doctor-resolved-list">
                ${res.resolved.map(item => {
                    let packsHtml = '';
                    if (!hidePacks && item.recommendedPacks && item.recommendedPacks.length > 0) {
                        packsHtml = `
                            <div class="doctor-resolved-packs-section" style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                    <span style="font-size: 11px; font-weight: 700; color: var(--accent-cyan); text-transform: uppercase; letter-spacing: 0.5px;">
                                        ⚡ Available Weapon & Asset Packs for this Base:
                                    </span>
                                    ${item.searchQuery ? `
                                        <button class="btn btn-secondary btn-xs btn-browse-base-ws" data-search="${item.searchQuery}" data-tag="${item.searchTag || 'Weapon'}" style="padding: 2px 8px; font-size: 11px;">
                                            🔎 Browse All on Workshop
                                        </button>
                                    ` : ''}
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    ${item.recommendedPacks.map(p => `
                                        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.25); padding: 6px 10px; border-radius: 4px; gap: 10px;">
                                            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                <span style="font-weight: 600; font-size: 12px; color: var(--text-primary);">${p.title}</span>
                                                <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">— ${p.desc}</span>
                                            </div>
                                            <button class="btn btn-primary btn-xs btn-sub-pack" data-wsid="${p.workshopId}" style="white-space: nowrap; flex-shrink: 0;">
                                                ⚡ Subscribe (Steam)
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }

                    return `
                        <div class="doctor-resolved-item" style="flex-direction: column; align-items: stretch;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div class="doctor-resolved-info">
                                    <span class="doctor-resolved-title">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                        ${item.title}
                                    </span>
                                    <span class="doctor-resolved-desc">${item.detail}</span>
                                </div>
                                ${item.undoActionText ? `
                                    <button class="btn btn-secondary btn-xs btn-undo-conflict" data-key="${item.key}">
                                        ${item.undoActionText}
                                    </button>
                                ` : ''}
                            </div>
                            ${packsHtml}
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const btnTogglePacks = group.querySelector('.btn-toggle-packs');
        if (btnTogglePacks) {
            btnTogglePacks.addEventListener('click', () => {
                const nextState = !hidePacks;
                localStorage.setItem('gmod_hide_recommended_packs', nextState.toString());
                showToast(nextState ? 'Asset packs hidden' : 'Asset packs shown', 'info');
                renderDiagnostics();
            });
        }

        group.querySelectorAll('.btn-undo-conflict').forEach(btn => {
            btn.addEventListener('click', async () => {
                const key = btn.getAttribute('data-key');
                btn.disabled = true;
                btn.textContent = 'Restoring...';
                try {
                    await window.api.undoAddonConflict(key);
                    showToast('Addon pack re-enabled.', 'info');
                    await Promise.all([refreshAddons(), refreshDiagnostics()]);
                } catch (e) {
                    showToast('Undo error: ' + e.message, 'error');
                    btn.disabled = false;
                }
            });
        });

        group.querySelectorAll('.btn-sub-pack').forEach(btn => {
            btn.addEventListener('click', () => {
                const wsid = btn.getAttribute('data-wsid');
                window.api.openSteamClient(wsid);
                showToast('Opening pack on Steam. Click "Subscribe" to install!', 'info');
            });
        });

        group.querySelectorAll('.btn-browse-base-ws').forEach(btn => {
            btn.addEventListener('click', () => {
                const search = btn.getAttribute('data-search');
                const tag = btn.getAttribute('data-tag') || 'Weapon';
                const steamSearchUrl = `https://steamcommunity.com/workshop/browse/?appid=4000&searchtext=${encodeURIComponent(search)}&requiredtags%5B0%5D=${encodeURIComponent(tag)}`;
                window.api.openExternalUrl(steamSearchUrl);
                showToast(`Opening Garry's Mod Workshop for "${search}" in Steam client...`, 'info');
            });
        });

        container.appendChild(group);
    }
}


// ============================================================================
// 🎨 2D ASSET STUDIO (CHARACTER & NEXTBOT EDITOR)
// ============================================================================

const studioState = {
    initialized: false,
    characters: [],
    selectedCharId: null,
    loadedChar: null,
    photoImg: null,       // HTMLImageElement currently loaded on canvas
    zoom: 1.0,            // 0.2 to 3.5
    panX: 0,
    panY: 0,
    rotation: 0,          // 0, 90, 180, 270 degrees
    flipH: false,         // Horizontal mirror flip
    cropShape: 'square',  // 'square' | 'face_oval' | 'soft_vignette' | 'circle' | 'rounded'
    removeBg: false,
    bgTolerance: 38,
    customBgColors: [],   // Array of { r, g, b } clicked via Magic Wand
    magicWandMode: false,
    colorFilter: 'none',  // 'none' | 'bw_dramatic' | 'bw_noir'
    rawOffCanvas: null,   // Stores unmasked/unfiltered photo draw for eyedropper sampling
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    soundSwaps: {},       // { [relPath]: { mode?: 'custom'|'default'|'none', filePath, fileName, fileSize } }
    activeAudio: null,
    activeAudioBtn: null
};

async function refreshStudioCharacters() {
    if (!window.api.scanEditableCharacters) return [];
    try {
        const chars = await window.api.scanEditableCharacters();
        studioState.characters = chars || [];
        state.studioCharacters = studioState.characters;

        const badge = document.getElementById('studioCountBadge');
        if (badge && studioState.characters.length > 0) {
            badge.textContent = `${studioState.characters.length} Ready`;
        }

        renderStudioCharactersList();

        // Auto-load the first character if none selected yet
        if (!studioState.selectedCharId && studioState.characters.length > 0) {
            await selectStudioCharacter(studioState.characters[0].id);
        } else if (!studioState.selectedCharId) {
            await selectStudioCharacter('template_new');
        }
        return studioState.characters;
    } catch (err) {
        console.error('Error scanning studio characters:', err);
        return [];
    }
}

function renderStudioCharactersList() {
    const container = document.getElementById('studioCharactersList');
    if (!container) return;

    if (!studioState.characters || studioState.characters.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 18px 10px; color: #94a3b8; font-size: 12px;">
                No 2D characters detected yet. Click <strong>+ Create Blank 2D Character</strong> above to make your first one!
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    studioState.characters.forEach(ch => {
        const isSelected = studioState.selectedCharId === ch.id;
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s ease;
            background: ${isSelected ? 'rgba(168, 85, 247, 0.22)' : 'rgba(15, 23, 42, 0.6)'};
            border: 1px solid ${isSelected ? '#a855f7' : 'rgba(255, 255, 255, 0.07)'};
        `;

        const thumbHtml = ch.previewDataUrl
            ? `<img src="${ch.previewDataUrl}" style="width: 42px; height: 42px; border-radius: 6px; object-fit: cover; background: #090d16; border: 1px solid rgba(255,255,255,0.12); flex-shrink: 0;">`
            : `<div style="width: 42px; height: 42px; border-radius: 6px; background: #1e293b; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">🖼️</div>`;

        item.innerHTML = `
            ${thumbHtml}
            <div style="min-width: 0; flex: 1;">
                <div style="font-size: 12.5px; font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${ch.name}">
                    ${ch.name}
                </div>
                <div style="font-size: 10.5px; color: #94a3b8; display: flex; gap: 6px; align-items: center; margin-top: 2px;">
                    <span>${ch.isCustomRemix ? '✨ Custom Remix' : '📦 Workshop 2D'}</span>
                    <span>•</span>
                    <span>🎵 ${ch.soundsCount} audio</span>
                </div>
            </div>
        `;

        item.addEventListener('click', () => {
            selectStudioCharacter(ch.id);
        });

        container.appendChild(item);
    });
}

function stopStudioAudioPreview() {
    if (studioState.activeAudio) {
        studioState.activeAudio.pause();
        studioState.activeAudio.currentTime = 0;
        studioState.activeAudio = null;
    }
    if (studioState.activeAudioBtn) {
        studioState.activeAudioBtn.innerHTML = '▶ Play';
        studioState.activeAudioBtn = null;
    }
}

async function selectStudioCharacter(charId) {
    stopStudioAudioPreview();
    studioState.selectedCharId = charId;
    studioState.soundSwaps = {};
    renderStudioCharactersList();

    const banner = document.getElementById('studioSaveStatusBanner');
    if (banner) banner.style.display = 'none';

    try {
        const loaded = await window.api.loadCharacterEditor(charId);
        studioState.loadedChar = loaded;

        // Populate Name & Mode
        const inpName = document.getElementById('inpStudioCharName');
        const selMode = document.getElementById('selStudioSaveMode');
        if (inpName) {
            const cleanBaseName = (loaded.displayName || 'My Custom 2D Nextbot').replace(/(\s*\(Remix\))+$/i, '').trim();
            inpName.value = loaded.isNewTemplate
                ? 'My Custom 2D Nextbot'
                : (loaded.isCustomRemix ? loaded.displayName : `${cleanBaseName} (Remix)`);
        }
        if (selMode) {
            selMode.value = loaded.isCustomRemix ? 'override' : 'new_character';
            selMode.disabled = Boolean(loaded.isNewTemplate);
        }

        // Populate Sliders
        const rngSprite = document.getElementById('rngStudioSpriteSize');
        const lblSprite = document.getElementById('lblStudioSpriteSize');
        if (rngSprite && lblSprite) {
            rngSprite.value = loaded.spriteSize || 128;
            lblSprite.textContent = `${rngSprite.value} units`;
        }

        const rngSpeed = document.getElementById('rngStudioSpeed');
        const lblSpeed = document.getElementById('lblStudioSpeed');
        if (rngSpeed && lblSpeed) {
            rngSpeed.value = loaded.chaseSpeed || 650;
            lblSpeed.textContent = rngSpeed.value;
        }

        const rngJump = document.getElementById('rngStudioJump');
        const lblJump = document.getElementById('lblStudioJump');
        if (rngJump && lblJump) {
            rngJump.value = loaded.jumpHeight !== undefined ? loaded.jumpHeight : 300;
            lblJump.textContent = rngJump.value;
        }

        const rngForce = document.getElementById('rngStudioForce');
        const lblForce = document.getElementById('lblStudioForce');
        if (rngForce && lblForce) {
            rngForce.value = loaded.attackForce || 800;
            lblForce.textContent = rngForce.value;
        }

        const chkSmash = document.getElementById('chkStudioSmashProps');
        if (chkSmash) {
            chkSmash.checked = loaded.smashProps !== false;
        }

        // Load Photo into Interactive Canvas
        if (loaded.imageDataUrl) {
            loadPhotoIntoStudioCanvas(loaded.imageDataUrl, 'contain');
        } else {
            studioState.photoImg = null;
            drawStudioCanvas();
        }

        // Render Sound Slots
        renderStudioSoundsList();
    } catch (err) {
        showToast('Failed to load character into Studio: ' + err.message, 'error');
    }
}

function getStudioEffectivePhotoDims() {
    if (!studioState.photoImg) return { w: 512, h: 512 };
    const img = studioState.photoImg;
    const isRotated90 = (Math.abs(studioState.rotation || 0) % 180) !== 0;
    return {
        w: isRotated90 ? img.naturalHeight : img.naturalWidth,
        h: isRotated90 ? img.naturalWidth : img.naturalHeight
    };
}

function loadPhotoIntoStudioCanvas(dataUrl, initialFit = 'contain') {
    const img = new Image();
    img.onload = () => {
        studioState.photoImg = img;
        studioState.panX = 0;
        studioState.panY = 0;
        studioState.rotation = 0;
        studioState.flipH = false;

        const dimLabel = document.getElementById('studioPhotoDimensionsLabel');
        if (dimLabel) {
            dimLabel.textContent = `Photo: ${img.naturalWidth}×${img.naturalHeight} → 512×512`;
        }

        if (initialFit === 'cover') {
            fitStudioPhotoCover();
        } else {
            fitStudioPhotoContain();
        }
    };
    img.src = dataUrl;
}

function fitStudioPhotoContain() {
    if (!studioState.photoImg) return;
    const { w, h } = getStudioEffectivePhotoDims();
    const scale = Math.min(512 / w, 512 / h);
    studioState.zoom = scale;
    studioState.panX = 0;
    studioState.panY = 0;
    syncStudioZoomUI();
    drawStudioCanvas();
}

function fitStudioPhotoCover() {
    if (!studioState.photoImg) return;
    const { w, h } = getStudioEffectivePhotoDims();
    const scale = Math.max(512 / w, 512 / h);
    studioState.zoom = scale;
    studioState.panX = 0;
    studioState.panY = 0;
    syncStudioZoomUI();
    drawStudioCanvas();
}

function syncStudioZoomUI() {
    const rngZoom = document.getElementById('rngStudioZoom');
    const lblZoom = document.getElementById('lblStudioZoom');
    if (!studioState.photoImg) {
        if (rngZoom) rngZoom.value = 100;
        if (lblZoom) lblZoom.textContent = '100%';
        return;
    }
    const { w, h } = getStudioEffectivePhotoDims();
    const baseContain = Math.min(512 / w, 512 / h);
    const pct = Math.round((studioState.zoom / baseContain) * 100);
    const clampedPct = Math.max(20, Math.min(350, pct));
    if (rngZoom) rngZoom.value = clampedPct;
    if (lblZoom) lblZoom.textContent = `${clampedPct}%`;
}

function applyStudioPhotoEffectsAndCutout(ctx) {
    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;

    // 1. Background Removal (Corner/Border Flood-Fill + Color-Key + Feathered Alpha)
    if (studioState.removeBg || (studioState.customBgColors && studioState.customBgColors.length > 0)) {
        const tol = studioState.bgTolerance || 38;
        const seedColors = [...(studioState.customBgColors || [])];

        // Sample perimeter/corner pixels from the drawn image if removeBg is checked
        if (studioState.removeBg) {
            const sampleCoords = [
                [4, 4], [507, 4], [4, 507], [507, 507],
                [256, 4], [4, 256], [507, 256], [128, 4], [384, 4]
            ];
            for (const [sx, sy] of sampleCoords) {
                const idx = (sy * 512 + sx) * 4;
                if (data[idx + 3] > 32) {
                    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                    const exists = seedColors.some(c => Math.hypot(c.r - r, c.g - g, c.b - b) < 16);
                    if (!exists) {
                        seedColors.push({ r, g, b });
                    }
                }
            }
        }

        if (seedColors.length > 0) {
            const maxDist = tol * 2.15;
            const softStart = maxDist * 0.72;
            const softRange = Math.max(1, maxDist - softStart);

            const minColorDist = (r, g, b) => {
                let best = 9999;
                for (let i = 0; i < seedColors.length; i++) {
                    const sc = seedColors[i];
                    const dr = r - sc.r;
                    const dg = g - sc.g;
                    const db = b - sc.b;
                    const d = Math.sqrt(dr * dr + dg * dg + db * db);
                    if (d < best) best = d;
                }
                return best;
            };

            // Fast BFS flood fill from all 4 borders so connected background disappears cleanly
            const visited = new Uint8Array(512 * 512);
            const queue = new Int32Array(512 * 512);
            let qHead = 0, qTail = 0;

            const pushIfBg = (x, y) => {
                const pos = y * 512 + x;
                if (visited[pos]) return;
                const pIdx = pos * 4;
                if (data[pIdx + 3] === 0) {
                    visited[pos] = 1;
                    queue[qTail++] = pos;
                    return;
                }
                const d = minColorDist(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
                if (d <= maxDist) {
                    visited[pos] = 1;
                    queue[qTail++] = pos;
                }
            };

            for (let i = 0; i < 512; i++) {
                pushIfBg(i, 0);
                pushIfBg(i, 511);
                pushIfBg(0, i);
                pushIfBg(511, i);
            }

            while (qHead < qTail) {
                const pos = queue[qHead++];
                const x = pos % 512;
                const y = (pos / 512) | 0;
                const pIdx = pos * 4;
                const d = minColorDist(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
                if (d <= softStart) {
                    data[pIdx + 3] = 0;
                } else {
                    const alphaFactor = Math.min(1, Math.max(0, (d - softStart) / softRange));
                    data[pIdx + 3] = Math.round(data[pIdx + 3] * alphaFactor * 0.45);
                }

                if (x > 0) pushIfBg(x - 1, y);
                if (x < 511) pushIfBg(x + 1, y);
                if (y > 0) pushIfBg(x, y - 1);
                if (y < 511) pushIfBg(x, y + 1);
            }

            // Also key out interior background pockets matching custom-picked colors or strong background matches
            const interiorMaxDist = maxDist * 0.82;
            const interiorSoftStart = interiorMaxDist * 0.72;
            const interiorRange = Math.max(1, interiorMaxDist - interiorSoftStart);
            for (let pos = 0; pos < 512 * 512; pos++) {
                if (visited[pos]) continue;
                const pIdx = pos * 4;
                if (data[pIdx + 3] === 0) continue;
                const d = minColorDist(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
                if (d <= interiorSoftStart) {
                    data[pIdx + 3] = 0;
                } else if (d <= interiorMaxDist) {
                    const alphaFactor = (d - interiorSoftStart) / interiorRange;
                    data[pIdx + 3] = Math.round(data[pIdx + 3] * alphaFactor);
                }
            }
        }
    }

    // 2. Soft Face Vignette Alpha Feathering (if selected)
    if (studioState.cropShape === 'soft_vignette') {
        const cx = 256, cy = 256;
        const rx = 200, ry = 244;
        for (let y = 0; y < 512; y++) {
            const dy = (y - cy) / ry;
            const dy2 = dy * dy;
            for (let x = 0; x < 512; x++) {
                const dx = (x - cx) / rx;
                const normDist = Math.sqrt(dx * dx + dy2);
                const pIdx = (y * 512 + x) * 4;
                if (normDist >= 1.0) {
                    data[pIdx + 3] = 0;
                } else if (normDist > 0.74) {
                    const t = (1.0 - normDist) / 0.26;
                    const smooth = t * t * (3 - 2 * t);
                    data[pIdx + 3] = Math.round(data[pIdx + 3] * smooth);
                }
            }
        }
    }

    // 3. Dramatic Black & White / Horror Noir Filter
    if (studioState.colorFilter === 'bw_dramatic' || studioState.colorFilter === 'bw_noir') {
        const isNoir = studioState.colorFilter === 'bw_noir';
        const contrast = isNoir ? 1.95 : 1.38;
        const brightnessOffset = isNoir ? -12 : 4;

        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 512; x++) {
                const pIdx = (y * 512 + x) * 4;
                if (data[pIdx + 3] === 0) continue;

                const r = data[pIdx], g = data[pIdx + 1], b = data[pIdx + 2];
                // Perceptual luminance
                let lum = 0.299 * r + 0.587 * g + 0.114 * b;
                // Apply contrast around midpoint 128
                lum = (lum - 128) * contrast + 128 + brightnessOffset;

                if (isNoir) {
                    // Subtle analog horror radial darkening + fine grain
                    const dx = (x - 256) / 256;
                    const dy = (y - 256) / 256;
                    const vig = Math.max(0.58, 1 - (dx * dx + dy * dy) * 0.28);
                    const grain = (((x * 73856093) ^ (y * 19349663)) & 15) - 7;
                    lum = lum * vig + grain;
                }

                const v = Math.max(0, Math.min(255, Math.round(lum)));
                data[pIdx] = v;
                data[pIdx + 1] = v;
                data[pIdx + 2] = v;
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

function drawStudioCanvas() {
    const canvas = document.getElementById('studioPhotoCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);

    if (studioState.photoImg) {
        const img = studioState.photoImg;
        const rawW = img.naturalWidth * studioState.zoom;
        const rawH = img.naturalHeight * studioState.zoom;

        const drawTransformedPhoto = (targetCtx) => {
            targetCtx.save();
            targetCtx.translate(256 + studioState.panX, 256 + studioState.panY);
            if (studioState.rotation) {
                targetCtx.rotate((studioState.rotation * Math.PI) / 180);
            }
            if (studioState.flipH) {
                targetCtx.scale(-1, 1);
            }
            targetCtx.imageSmoothingEnabled = true;
            targetCtx.imageSmoothingQuality = 'high';
            targetCtx.drawImage(img, -rawW / 2, -rawH / 2, rawW, rawH);
            targetCtx.restore();
        };

        // Keep an unmasked copy for Magic Wand color sampling
        if (!studioState.rawOffCanvas) {
            studioState.rawOffCanvas = document.createElement('canvas');
            studioState.rawOffCanvas.width = 512;
            studioState.rawOffCanvas.height = 512;
        }
        const rawCtx = studioState.rawOffCanvas.getContext('2d');
        rawCtx.clearRect(0, 0, 512, 512);
        drawTransformedPhoto(rawCtx);

        ctx.save();
        if (studioState.cropShape === 'face_oval') {
            ctx.beginPath();
            ctx.ellipse(256, 256, 194, 242, 0, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
        } else if (studioState.cropShape === 'circle') {
            ctx.beginPath();
            ctx.arc(256, 256, 248, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
        } else if (studioState.cropShape === 'rounded') {
            const r = 48;
            ctx.beginPath();
            ctx.moveTo(r, 8);
            ctx.lineTo(512 - r, 8);
            ctx.quadraticCurveTo(504, 8, 504, r);
            ctx.lineTo(504, 512 - r);
            ctx.quadraticCurveTo(504, 504, 512 - r, 504);
            ctx.lineTo(r, 504);
            ctx.quadraticCurveTo(8, 504, 8, 512 - r);
            ctx.lineTo(8, r);
            ctx.quadraticCurveTo(8, 8, r, 8);
            ctx.closePath();
            ctx.clip();
        }

        drawTransformedPhoto(ctx);
        ctx.restore();

        // Apply Background Removal, Soft Vignette, and Dramatic B&W Filters
        if (
            studioState.removeBg ||
            (studioState.customBgColors && studioState.customBgColors.length > 0) ||
            studioState.cropShape === 'soft_vignette' ||
            studioState.colorFilter !== 'none'
        ) {
            applyStudioPhotoEffectsAndCutout(ctx);
        }
    } else {
        // Friendly empty state on canvas
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 26px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Click "Switch Photo (.jpg / .png)"', 256, 240);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '18px Segoe UI, sans-serif';
        ctx.fillText('to drop in any picture & zoom to fit!', 256, 278);
    }
}

function renderStudioSoundsList() {
    const container = document.getElementById('studioSoundsList');
    if (!container || !studioState.loadedChar) return;

    const sounds = studioState.loadedChar.sounds || [];
    container.innerHTML = '';

    // Also synchronize #selStudioRecordSlot options with current character's sound slots
    const selSlot = document.getElementById('selStudioRecordSlot');
    if (selSlot && sounds.length > 0) {
        const prevVal = selSlot.value;
        selSlot.innerHTML = sounds.map(s => `<option value="${s.relPath}">${s.label}</option>`).join('');
        if (sounds.some(s => s.relPath === prevVal)) {
            selSlot.value = prevVal;
        }
    }

    sounds.forEach(s => {
        const swapped = studioState.soundSwaps[s.relPath];
        const isMuted = swapped ? swapped.mode === 'none' : !s.hasFile;
        const isRestoredDefault = Boolean(swapped && swapped.mode === 'default');
        const isCustomSwap = Boolean(swapped && swapped.mode !== 'none' && swapped.mode !== 'default');

        let activeFilePath = null;
        if (swapped) {
            activeFilePath = swapped.mode === 'none' ? null : swapped.filePath;
        } else if (s.hasFile && s.fullPath) {
            activeFilePath = s.fullPath;
        }
        const hasAudioSource = Boolean(activeFilePath);

        let statusText = 'No audio selected yet';
        let statusColor = '#94a3b8';
        let rowBg = 'rgba(15, 23, 42, 0.55)';
        let rowBorder = 'rgba(255, 255, 255, 0.07)';

        if (isMuted) {
            statusText = '🔇 No Track (Muted / Silent)';
            statusColor = '#f87171';
            rowBg = 'rgba(239, 68, 68, 0.09)';
            rowBorder = 'rgba(239, 68, 68, 0.32)';
        } else if (isRestoredDefault) {
            statusText = `↺ Default Track (${swapped.fileName || 'Original'})`;
            statusColor = '#38bdf8';
            rowBg = 'rgba(56, 189, 248, 0.12)';
            rowBorder = 'rgba(56, 189, 248, 0.38)';
        } else if (isCustomSwap) {
            statusText = `✓ ${swapped.fileName}`;
            statusColor = '#34d399';
            rowBg = 'rgba(52, 211, 153, 0.12)';
            rowBorder = 'rgba(52, 211, 153, 0.4)';
        } else if (s.hasFile) {
            statusText = s.relPath;
        }

        const canRestoreDefault = Boolean(s.defaultFullPath || s.hasFile || swapped);

        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            padding: 7px 10px;
            border-radius: 6px;
            background: ${rowBg};
            border: 1px solid ${rowBorder};
        `;

        row.innerHTML = `
            <div style="min-width: 0; flex: 1;">
                <div style="font-size: 12px; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${s.label}
                </div>
                <div style="font-size: 11px; color: ${statusColor}; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${statusText}
                </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; flex-wrap: wrap;">
                ${hasAudioSource ? `
                <button class="btn btn-secondary btn-xs btn-studio-play-audio" title="Preview this audio track" style="padding: 4px 6px; font-size: 10px;">▶ Play</button>
                ` : ''}
                <button class="btn btn-secondary btn-xs btn-studio-record-slot" title="Record custom voice / Voicemod FX for this slot" style="padding: 4px 6px; font-size: 10px; border-color: rgba(244, 63, 94, 0.4); color: #fda4af;">
                    🎙️ Mic
                </button>
                <button class="btn btn-primary btn-xs btn-studio-swap-audio" title="Choose a custom .mp3 / .wav / .ogg file" style="padding: 4px 7px; font-size: 10px;">
                    🎵 File
                </button>
                ${canRestoreDefault ? `
                <button class="btn btn-secondary btn-xs btn-studio-default-audio" title="Restore original default audio track for this slot" style="padding: 4px 6px; font-size: 10px; border-color: rgba(56, 189, 248, 0.38); color: #7dd3fc;">
                    ↺ Default
                </button>
                ` : ''}
                ${!isMuted ? `
                <button class="btn btn-secondary btn-xs btn-studio-mute-audio" title="Set to No Track / Mute so this slot does not play any audio" style="padding: 4px 6px; font-size: 10px; border-color: rgba(248, 113, 113, 0.38); color: #fca5a5;">
                    🔇 No Track
                </button>
                ` : ''}
            </div>
        `;

        const btnPlay = row.querySelector('.btn-studio-play-audio');
        if (btnPlay && activeFilePath) {
            btnPlay.addEventListener('click', () => {
                if (studioState.activeAudioBtn === btnPlay) {
                    stopStudioAudioPreview();
                    return;
                }
                stopStudioAudioPreview();
                const fileUrl = 'file:///' + activeFilePath.replace(/\\/g, '/');
                const audio = new Audio(fileUrl);
                studioState.activeAudio = audio;
                studioState.activeAudioBtn = btnPlay;
                btnPlay.innerHTML = '⏹ Stop';
                audio.play().catch(err => {
                    showToast('Could not play audio preview: ' + err.message, 'error');
                    stopStudioAudioPreview();
                });
                audio.onended = () => {
                    stopStudioAudioPreview();
                };
            });
        }

        const btnRecordSlot = row.querySelector('.btn-studio-record-slot');
        if (btnRecordSlot) {
            btnRecordSlot.addEventListener('click', () => {
                const sel = document.getElementById('selStudioRecordSlot');
                if (sel) sel.value = s.relPath;
                const panel = document.getElementById('studioVoicemodPanel');
                if (panel) {
                    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    panel.style.boxShadow = '0 0 0 2px #f43f5e';
                    setTimeout(() => { panel.style.boxShadow = ''; }, 900);
                }
                showToast(`🎙️ Selected "${s.label}" in Voicemod Recorder! Pick a voice effect and click 🔴 Record Voice.`, 'info');
            });
        }

        const btnSwap = row.querySelector('.btn-studio-swap-audio');
        btnSwap.addEventListener('click', async () => {
            stopStudioAudioPreview();
            const picked = await window.api.selectAudioDialog();
            if (picked && picked.filePath) {
                studioState.soundSwaps[s.relPath] = { ...picked, mode: 'custom' };
                renderStudioSoundsList();
                showToast(`🎵 Loaded "${picked.fileName}" for ${s.label}!`, 'success');
            }
        });

        const btnDefault = row.querySelector('.btn-studio-default-audio');
        if (btnDefault) {
            btnDefault.addEventListener('click', () => {
                stopStudioAudioPreview();
                if (s.defaultFullPath) {
                    studioState.soundSwaps[s.relPath] = {
                        mode: 'default',
                        filePath: s.defaultFullPath,
                        fileName: s.defaultFileName || 'Default Track'
                    };
                    showToast(`↺ Restored default track (${s.defaultFileName || 'Original'}) for ${s.label}! Click Save to apply.`, 'info');
                } else {
                    delete studioState.soundSwaps[s.relPath];
                    showToast(`↺ Reverted ${s.label} to current character track.`, 'info');
                }
                renderStudioSoundsList();
            });
        }

        const btnMute = row.querySelector('.btn-studio-mute-audio');
        if (btnMute) {
            btnMute.addEventListener('click', () => {
                stopStudioAudioPreview();
                studioState.soundSwaps[s.relPath] = {
                    mode: 'none',
                    filePath: null,
                    fileName: 'No Track (Muted)'
                };
                renderStudioSoundsList();
                showToast(`🔇 Set "${s.label}" to No Track! Click "Save to My Garry's Mod" to apply.`, 'info');
            });
        }

        container.appendChild(row);
    });
}

function buildStudioSavePayload() {
    const canvas = document.getElementById('studioPhotoCanvas');
    const croppedImageDataUrl = (studioState.photoImg && canvas)
        ? canvas.toDataURL('image/png')
        : null;

    const soundSwapsMap = {};
    for (const [relPath, info] of Object.entries(studioState.soundSwaps)) {
        if (!info) continue;
        if (info.mode === 'none') {
            soundSwapsMap[relPath] = '__NONE__';
        } else if (info.mode === 'default') {
            soundSwapsMap[relPath] = info.filePath || '__DEFAULT__';
        } else if (info.filePath) {
            soundSwapsMap[relPath] = info.filePath;
        }
    }

    return {
        characterId: studioState.selectedCharId || 'template_new',
        saveMode: document.getElementById('selStudioSaveMode')?.value || 'new_character',
        displayName: (document.getElementById('inpStudioCharName')?.value || 'My Custom 2D Nextbot').trim(),
        category: 'Nextbot',
        croppedImageDataUrl,
        spriteSize: parseInt(document.getElementById('rngStudioSpriteSize')?.value || '128', 10),
        chaseSpeed: parseInt(document.getElementById('rngStudioSpeed')?.value || '650', 10),
        jumpHeight: parseInt(document.getElementById('rngStudioJump')?.value || '300', 10),
        attackForce: parseInt(document.getElementById('rngStudioForce')?.value || '800', 10),
        smashProps: document.getElementById('chkStudioSmashProps')?.checked !== false,
        soundSwaps: soundSwapsMap
    };
}

function openCharacterInStudio(charId) {
    const studioNavBtn = document.querySelector('.nav-item[data-tab="studio"]');
    if (studioNavBtn) studioNavBtn.click();
    selectStudioCharacter(charId);
}

function initStudioIfNeeded() {
    if (!studioState.initialized) {
        studioState.initialized = true;
        setupStudioControls();
    }
    if (!studioState.characters || studioState.characters.length === 0) {
        refreshStudioCharacters();
    }
}

function setupStudioControls() {
    const canvas = document.getElementById('studioPhotoCanvas');
    const rngZoom = document.getElementById('rngStudioZoom');

    // Drag to pan photo inside canvas (or sample background color when Magic Wand is active)
    if (canvas) {
        canvas.addEventListener('mousedown', (e) => {
            if (!studioState.photoImg) return;

            if (studioState.magicWandMode && studioState.rawOffCanvas) {
                const rect = canvas.getBoundingClientRect();
                const cx = Math.max(0, Math.min(511, Math.round(((e.clientX - rect.left) / rect.width) * 512)));
                const cy = Math.max(0, Math.min(511, Math.round(((e.clientY - rect.top) / rect.height) * 512)));
                const rawCtx = studioState.rawOffCanvas.getContext('2d');
                const px = rawCtx.getImageData(cx, cy, 1, 1).data;
                if (px[3] > 10) {
                    studioState.customBgColors.push({ r: px[0], g: px[1], b: px[2] });
                    studioState.removeBg = true;
                    const chkBg = document.getElementById('chkStudioRemoveBg');
                    if (chkBg) chkBg.checked = true;
                    const tolRow = document.getElementById('studioBgToleranceRow');
                    if (tolRow) tolRow.style.display = 'block';
                    const btnReset = document.getElementById('btnStudioResetBgColors');
                    if (btnReset) btnReset.style.display = 'inline-block';
                    drawStudioCanvas();
                    showToast(`🪄 Erased background color RGB(${px[0]}, ${px[1]}, ${px[2]})! Click another spot or turn off Magic Wand.`, 'success');
                }
                return;
            }

            studioState.isDragging = true;
            studioState.dragStartX = e.clientX - studioState.panX;
            studioState.dragStartY = e.clientY - studioState.panY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!studioState.isDragging) return;
            studioState.panX = e.clientX - studioState.dragStartX;
            studioState.panY = e.clientY - studioState.dragStartY;
            drawStudioCanvas();
        });

        window.addEventListener('mouseup', () => {
            studioState.isDragging = false;
        });

        // Mouse wheel zoom directly on canvas
        canvas.addEventListener('wheel', (e) => {
            if (!studioState.photoImg) return;
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.08 : 0.92;
            const { w, h } = getStudioEffectivePhotoDims();
            const baseContain = Math.min(512 / w, 512 / h);
            const minZoom = baseContain * 0.2;
            const maxZoom = baseContain * 3.5;
            studioState.zoom = Math.max(minZoom, Math.min(maxZoom, studioState.zoom * factor));
            syncStudioZoomUI();
            drawStudioCanvas();
        }, { passive: false });
    }

    if (rngZoom) {
        rngZoom.addEventListener('input', () => {
            if (!studioState.photoImg) return;
            const pct = parseInt(rngZoom.value, 10) || 100;
            const { w, h } = getStudioEffectivePhotoDims();
            const baseContain = Math.min(512 / w, 512 / h);
            studioState.zoom = baseContain * (pct / 100);
            const lblZoom = document.getElementById('lblStudioZoom');
            if (lblZoom) lblZoom.textContent = `${pct}%`;
            drawStudioCanvas();
        });
    }

    document.getElementById('btnStudioChoosePhoto')?.addEventListener('click', async () => {
        const picked = await window.api.selectImageDialog();
        if (picked && picked.dataUrl) {
            studioState.customBgColors = [];
            loadPhotoIntoStudioCanvas(picked.dataUrl, 'cover');
            showToast(`🖼️ Switched photo to "${picked.fileName}"! Drag, rotate, or scroll to adjust fit.`, 'success');
        }
    });

    document.getElementById('btnStudioRotateLeft')?.addEventListener('click', () => {
        if (!studioState.photoImg) return;
        studioState.rotation = ((studioState.rotation || 0) + 270) % 360;
        fitStudioPhotoContain();
    });

    document.getElementById('btnStudioRotateRight')?.addEventListener('click', () => {
        if (!studioState.photoImg) return;
        studioState.rotation = ((studioState.rotation || 0) + 90) % 360;
        fitStudioPhotoContain();
    });

    document.getElementById('btnStudioFlipH')?.addEventListener('click', () => {
        if (!studioState.photoImg) return;
        studioState.flipH = !studioState.flipH;
        drawStudioCanvas();
    });

    document.getElementById('btnStudioFitContain')?.addEventListener('click', () => fitStudioPhotoContain());
    document.getElementById('btnStudioFitCover')?.addEventListener('click', () => fitStudioPhotoCover());
    document.getElementById('btnStudioCenterPhoto')?.addEventListener('click', () => {
        studioState.panX = 0;
        studioState.panY = 0;
        drawStudioCanvas();
    });

    document.getElementById('selStudioCropShape')?.addEventListener('change', (e) => {
        studioState.cropShape = e.target.value;
        drawStudioCanvas();
    });

    // Background Removal & Dramatic Black/White Controls
    const chkRemoveBg = document.getElementById('chkStudioRemoveBg');
    const tolRow = document.getElementById('studioBgToleranceRow');
    const rngBgTol = document.getElementById('rngStudioBgTolerance');
    const lblBgTol = document.getElementById('lblStudioBgTolerance');
    const btnWand = document.getElementById('btnStudioMagicWand');
    const btnResetBg = document.getElementById('btnStudioResetBgColors');
    const selFilter = document.getElementById('selStudioColorFilter');

    if (chkRemoveBg) {
        chkRemoveBg.addEventListener('change', () => {
            studioState.removeBg = chkRemoveBg.checked;
            if (tolRow) tolRow.style.display = (studioState.removeBg || studioState.customBgColors.length > 0) ? 'block' : 'none';
            // If user enables Remove Background while still on Classic Square, suggest or keep cutout clean
            drawStudioCanvas();
        });
    }

    if (rngBgTol) {
        rngBgTol.addEventListener('input', () => {
            studioState.bgTolerance = parseInt(rngBgTol.value, 10) || 38;
            if (lblBgTol) lblBgTol.textContent = studioState.bgTolerance;
            drawStudioCanvas();
        });
    }

    if (btnWand) {
        btnWand.addEventListener('click', () => {
            studioState.magicWandMode = !studioState.magicWandMode;
            const wrap = document.getElementById('studioCanvasContainer');
            if (studioState.magicWandMode) {
                btnWand.style.background = 'rgba(168, 85, 247, 0.35)';
                btnWand.style.borderColor = '#c084fc';
                btnWand.textContent = '🪄 Click Photo Bg Now (Active)';
                if (wrap) wrap.style.cursor = 'crosshair';
                showToast('🪄 Click any background spot on the photo to erase that color!', 'info');
            } else {
                btnWand.style.background = '';
                btnWand.style.borderColor = '';
                btnWand.textContent = '🪄 Click Bg to Erase';
                if (wrap) wrap.style.cursor = 'grab';
            }
        });
    }

    if (btnResetBg) {
        btnResetBg.addEventListener('click', () => {
            studioState.customBgColors = [];
            studioState.magicWandMode = false;
            if (btnWand) {
                btnWand.style.background = '';
                btnWand.style.borderColor = '';
                btnWand.textContent = '🪄 Click Bg to Erase';
            }
            const wrap = document.getElementById('studioCanvasContainer');
            if (wrap) wrap.style.cursor = 'grab';
            btnResetBg.style.display = 'none';
            drawStudioCanvas();
            showToast('Cleared custom-clicked background colors.', 'info');
        });
    }

    if (selFilter) {
        selFilter.addEventListener('change', () => {
            studioState.colorFilter = selFilter.value || 'none';
            drawStudioCanvas();
        });
    }

    // Initialize Built-in Voicemod & Voice FX Recorder
    initStudioVoicemodRecorder();

    document.getElementById('btnStudioNewBlank')?.addEventListener('click', () => {
        selectStudioCharacter('template_new');
        showToast('✨ Started a Blank 2D Character! Choose a photo and music to begin.', 'info');
    });

    document.getElementById('btnRefreshStudioChars')?.addEventListener('click', () => {
        refreshStudioCharacters();
    });

    // Movement Sliders live labels
    const bindSliderLabel = (sliderId, labelId, suffix = '') => {
        const s = document.getElementById(sliderId);
        const l = document.getElementById(labelId);
        if (s && l) {
            s.addEventListener('input', () => {
                l.textContent = `${s.value}${suffix}`;
            });
        }
    };
    bindSliderLabel('rngStudioSpriteSize', 'lblStudioSpriteSize', ' units');
    bindSliderLabel('rngStudioSpeed', 'lblStudioSpeed', '');
    bindSliderLabel('rngStudioJump', 'lblStudioJump', '');
    bindSliderLabel('rngStudioForce', 'lblStudioForce', '');

    // Save Locally to Garry's Mod
    const btnSaveLocal = document.getElementById('btnStudioSaveLocal');
    if (btnSaveLocal) {
        btnSaveLocal.addEventListener('click', async () => {
            if (!studioState.photoImg) {
                return showToast('Please choose a character photo first!', 'error');
            }
            const payload = buildStudioSavePayload();
            btnSaveLocal.disabled = true;
            const origHtml = btnSaveLocal.innerHTML;
            btnSaveLocal.innerHTML = '<span>Saving to Garry\'s Mod...</span>';

            try {
                const res = await window.api.saveEditedCharacter(payload);
                if (res && res.success) {
                    showToast(`🎉 Saved "${res.displayName}" to Garry's Mod! Spawn it under Q-Menu → NPCs → Nextbot.`, 'success');
                    const banner = document.getElementById('studioSaveStatusBanner');
                    if (banner) {
                        banner.style.display = 'block';
                        banner.style.background = 'rgba(52, 211, 153, 0.15)';
                        banner.style.border = '1px solid rgba(52, 211, 153, 0.4)';
                        banner.style.color = '#34d399';
                        banner.innerHTML = `✅ <strong>Ready in Garry's Mod!</strong> Saved to <code>garrysmod/addons/${res.addonDir.split(/[\\/]/).pop()}</code>. Open GMod → press <strong>Q</strong> → <strong>NPCs</strong> → <strong>Nextbot</strong> → spawn <strong>${res.displayName}</strong>!`;
                    }
                    await Promise.all([refreshStudioCharacters(), refreshAddons()]);
                }
            } catch (err) {
                showToast('Save error: ' + err.message, 'error');
            } finally {
                btnSaveLocal.disabled = false;
                btnSaveLocal.innerHTML = origHtml;
            }
        });
    }

    // Publish to Steam Workshop
    const btnPublishWs = document.getElementById('btnStudioPublishWorkshop');
    if (btnPublishWs) {
        btnPublishWs.addEventListener('click', async () => {
            if (!studioState.photoImg) {
                return showToast('Please choose a character photo first!', 'error');
            }
            const payload = buildStudioSavePayload();
            if (!confirm(`Upload "${payload.displayName}" to Steam Workshop?\n\nTip: Original characters made from your own photos/sounds are great for public Workshop! If remixing another creator's addon, you can set visibility to Friends-Only/Private on Steam or credit the original creator.`)) {
                return;
            }

            btnPublishWs.disabled = true;
            const origHtml = btnPublishWs.innerHTML;
            btnPublishWs.innerHTML = '<span>Uploading to Steam...</span>';

            try {
                const res = await window.api.publishEditedCharacter(payload);
                const banner = document.getElementById('studioSaveStatusBanner');
                if (res && res.success) {
                    showToast(res.message || 'Uploaded to Steam Workshop!', 'success');
                    if (banner) {
                        banner.style.display = 'block';
                        banner.style.background = 'rgba(168, 85, 247, 0.18)';
                        banner.style.border = '1px solid rgba(168, 85, 247, 0.45)';
                        banner.style.color = '#e9d5ff';
                        banner.innerHTML = `☁️ <strong>Published to Steam Workshop!</strong> ${res.workshopId ? `(ID: ${res.workshopId})` : ''} ${res.url ? `<a href="#" id="lnkOpenStudioWsItem" style="color: #38bdf8; margin-left: 8px; text-decoration: underline;">Open in Steam ↗</a>` : ''}`;
                        if (res.workshopId) {
                            setTimeout(() => {
                                document.getElementById('lnkOpenStudioWsItem')?.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    window.api.openSteamClient(res.workshopId);
                                });
                            }, 20);
                        }
                    }
                    await Promise.all([refreshStudioCharacters(), refreshAddons()]);
                } else {
                    showToast('Workshop upload failed: ' + (res?.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                showToast('Workshop error: ' + err.message, 'error');
            } finally {
                btnPublishWs.disabled = false;
                btnPublishWs.innerHTML = origHtml;
            }
        });
    }
}

// =========================================================================
// 🎙️ VOICEMOD & CUSTOM VOICE FX STUDIO RECORDER
// =========================================================================

const voiceRecorderState = {
    isRecording: false,
    audioCtx: null,
    mediaStream: null,
    sourceNode: null,
    processorNode: null,
    recordedChunks: [],
    sampleRate: 44100,
    rawAudioBuffer: null,
    previewSource: null,
    startTime: 0,
    timerInterval: null
};

async function populateStudioMicDevices() {
    const selMic = document.getElementById('selStudioMicDevice');
    if (!selMic || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        if (audioInputs.length > 0) {
            let voicemodDeviceId = null;
            selMic.innerHTML = audioInputs.map((d, idx) => {
                const label = d.label || `Microphone ${idx + 1}`;
                const isVoicemod = /voicemod/i.test(label);
                if (isVoicemod && !voicemodDeviceId) voicemodDeviceId = d.deviceId;
                return `<option value="${d.deviceId}">${isVoicemod ? '🎭 ' : '🎙️ '}${label}</option>`;
            }).join('');
            if (voicemodDeviceId) {
                selMic.value = voicemodDeviceId;
            }
        }
    } catch (_) {}
}

function makeDistortionCurve(amount = 40) {
    const nSamples = 8192;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    for (let i = 0; i < nSamples; ++i) {
        const x = (i * 2) / nSamples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

async function renderVoiceFxBuffer(rawBuffer, fxPreset = 'normal') {
    if (!rawBuffer) return null;
    const targetRate = 44100;

    let rateRatio = 1.0;
    if (fxPreset === 'demon') rateRatio = 0.72;
    else if (fxPreset === 'gremlin') rateRatio = 1.42;

    const tailSeconds = (fxPreset === 'ghost' || fxPreset === 'demon') ? 0.65 : 0.1;
    const outDuration = (rawBuffer.duration / rateRatio) + tailSeconds;
    const outLength = Math.max(4096, Math.ceil(outDuration * targetRate));

    const offline = new OfflineAudioContext(1, outLength, targetRate);
    const src = offline.createBufferSource();
    src.buffer = rawBuffer;
    src.playbackRate.value = rateRatio;

    if (fxPreset === 'normal') {
        const comp = offline.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.ratio.value = 4;
        const gain = offline.createGain();
        gain.gain.value = 1.25;
        src.connect(comp);
        comp.connect(gain);
        gain.connect(offline.destination);
    } else if (fxPreset === 'demon') {
        // Deep pitch + sub-octave growl + warm saturation + bass shelf
        const subSrc = offline.createBufferSource();
        subSrc.buffer = rawBuffer;
        subSrc.playbackRate.value = 0.52;
        const subGain = offline.createGain();
        subGain.gain.value = 0.42;

        const lowShelf = offline.createBiquadFilter();
        lowShelf.type = 'lowshelf';
        lowShelf.frequency.value = 160;
        lowShelf.gain.value = 9;

        const shaper = offline.createWaveShaper();
        shaper.curve = makeDistortionCurve(35);

        const outGain = offline.createGain();
        outGain.gain.value = 1.15;

        src.connect(lowShelf);
        subSrc.connect(subGain);
        subGain.connect(lowShelf);
        lowShelf.connect(shaper);
        shaper.connect(outGain);
        outGain.connect(offline.destination);
        subSrc.start(0);
    } else if (fxPreset === 'gremlin') {
        const highPeak = offline.createBiquadFilter();
        highPeak.type = 'peaking';
        highPeak.frequency.value = 2100;
        highPeak.gain.value = 6;

        const outGain = offline.createGain();
        outGain.gain.value = 1.25;
        src.connect(highPeak);
        highPeak.connect(outGain);
        outGain.connect(offline.destination);
    } else if (fxPreset === 'robot') {
        // Ring Modulator (65Hz carrier) + short metallic comb delay
        const ringGain = offline.createGain();
        ringGain.gain.value = 0;

        const osc = offline.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 68;
        osc.connect(ringGain.gain);
        osc.start(0);

        const dryGain = offline.createGain();
        dryGain.gain.value = 0.55;

        const delay = offline.createDelay();
        delay.delayTime.value = 0.014;
        const fb = offline.createGain();
        fb.gain.value = 0.48;
        delay.connect(fb);
        fb.connect(delay);

        const outGain = offline.createGain();
        outGain.gain.value = 1.25;

        src.connect(ringGain);
        src.connect(dryGain);
        ringGain.connect(delay);
        dryGain.connect(delay);
        delay.connect(outGain);
        ringGain.connect(outGain);
        outGain.connect(offline.destination);
    } else if (fxPreset === 'vhs') {
        // Bandpass walkie/VHS filter + tape saturation + subtle pitch warble
        const bp = offline.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1150;
        bp.Q.value = 1.1;

        const lfo = offline.createOscillator();
        lfo.frequency.value = 4.8;
        const lfoGain = offline.createGain();
        lfoGain.gain.value = 0.03;
        lfo.connect(lfoGain);
        lfoGain.connect(src.playbackRate);
        lfo.start(0);

        const shaper = offline.createWaveShaper();
        shaper.curve = makeDistortionCurve(70);

        const outGain = offline.createGain();
        outGain.gain.value = 1.2;

        src.connect(bp);
        bp.connect(shaper);
        shaper.connect(outGain);
        outGain.connect(offline.destination);
    } else if (fxPreset === 'ghost') {
        // Haunted echo chamber (multi-tap feedback delay + highpass whisper sheen)
        const hp = offline.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 240;

        const delay1 = offline.createDelay(1.0);
        delay1.delayTime.value = 0.14;
        const fb1 = offline.createGain();
        fb1.gain.value = 0.52;
        delay1.connect(fb1);
        fb1.connect(delay1);

        const delay2 = offline.createDelay(1.0);
        delay2.delayTime.value = 0.27;
        const fb2 = offline.createGain();
        fb2.gain.value = 0.42;
        delay2.connect(fb2);
        fb2.connect(delay2);

        const outGain = offline.createGain();
        outGain.gain.value = 1.25;

        src.connect(hp);
        hp.connect(outGain);
        hp.connect(delay1);
        hp.connect(delay2);
        delay1.connect(outGain);
        delay2.connect(outGain);
        outGain.connect(offline.destination);
    }

    src.start(0);
    return await offline.startRendering();
}

function encodeAudioBufferToWavBase64(audioBuffer) {
    const samples = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate || 44100;

    // Normalize peak to 0.94 so recorded sound effects are loud & clear in GMod
    let maxPeak = 0.01;
    for (let i = 0; i < samples.length; i++) {
        const a = Math.abs(samples[i]);
        if (a > maxPeak) maxPeak = a;
    }
    const normGain = Math.min(4.0, 0.94 / maxPeak);

    const dataBytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);       // PCM chunk size
    view.setUint16(20, 1, true);        // PCM format = 1
    view.setUint16(22, 1, true);        // Mono = 1 channel (ideal for GMod spatial & looping sounds)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);       // 16-bit PCM
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i] * normGain));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function initStudioVoicemodRecorder() {
    populateStudioMicDevices();

    const btnRec = document.getElementById('btnStudioVoiceRecord');
    const btnPrev = document.getElementById('btnStudioVoicePreview');
    const btnApply = document.getElementById('btnStudioVoiceApply');
    const lblStatus = document.getElementById('lblStudioVoiceStatus');
    const meterBar = document.getElementById('studioVoiceMeterBar');

    const stopRecordingInternal = () => {
        if (!voiceRecorderState.isRecording) return;
        voiceRecorderState.isRecording = false;
        if (voiceRecorderState.timerInterval) {
            clearInterval(voiceRecorderState.timerInterval);
            voiceRecorderState.timerInterval = null;
        }
        if (voiceRecorderState.processorNode) {
            try { voiceRecorderState.processorNode.disconnect(); } catch (_) {}
            voiceRecorderState.processorNode = null;
        }
        if (voiceRecorderState.sourceNode) {
            try { voiceRecorderState.sourceNode.disconnect(); } catch (_) {}
            voiceRecorderState.sourceNode = null;
        }
        if (voiceRecorderState.mediaStream) {
            voiceRecorderState.mediaStream.getTracks().forEach(t => t.stop());
            voiceRecorderState.mediaStream = null;
        }
        if (meterBar) meterBar.style.width = '0%';

        // Assemble recorded chunks into an AudioBuffer
        const chunks = voiceRecorderState.recordedChunks || [];
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        if (totalLength > 1024 && voiceRecorderState.audioCtx) {
            const buf = voiceRecorderState.audioCtx.createBuffer(1, totalLength, voiceRecorderState.sampleRate);
            const chData = buf.getChannelData(0);
            let offset = 0;
            for (const c of chunks) {
                chData.set(c, offset);
                offset += c.length;
            }
            voiceRecorderState.rawAudioBuffer = buf;
            const durSec = (totalLength / voiceRecorderState.sampleRate).toFixed(1);
            if (lblStatus) {
                lblStatus.textContent = `Recorded ${durSec}s ✓`;
                lblStatus.style.color = '#34d399';
            }
            if (btnPrev) btnPrev.disabled = false;
            if (btnApply) btnApply.disabled = false;
            showToast(`🎙️ Captured ${durSec}s voice clip! Click ▶️ Preview FX or ✅ Use Recording.`, 'success');
        } else {
            if (lblStatus) lblStatus.textContent = 'Too short — try again';
        }

        if (btnRec) {
            btnRec.innerHTML = '🔴 Record Voice';
            btnRec.style.background = '';
        }
    };

    if (btnRec) {
        btnRec.addEventListener('click', async () => {
            stopStudioAudioPreview();
            if (voiceRecorderState.isRecording) {
                stopRecordingInternal();
                return;
            }

            try {
                const deviceId = document.getElementById('selStudioMicDevice')?.value;
                const audioConstraint = (deviceId && deviceId !== 'default')
                    ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: true }
                    : { echoCancellation: false, noiseSuppression: true };

                const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
                populateStudioMicDevices();

                if (!voiceRecorderState.audioCtx) {
                    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                    voiceRecorderState.audioCtx = new AudioContextClass();
                }
                if (voiceRecorderState.audioCtx.state === 'suspended') {
                    await voiceRecorderState.audioCtx.resume();
                }

                voiceRecorderState.sampleRate = voiceRecorderState.audioCtx.sampleRate || 44100;
                voiceRecorderState.recordedChunks = [];
                voiceRecorderState.mediaStream = stream;
                voiceRecorderState.sourceNode = voiceRecorderState.audioCtx.createMediaStreamSource(stream);
                voiceRecorderState.processorNode = voiceRecorderState.audioCtx.createScriptProcessor(4096, 1, 1);

                voiceRecorderState.processorNode.onaudioprocess = (e) => {
                    if (!voiceRecorderState.isRecording) return;
                    const input = e.inputBuffer.getChannelData(0);
                    voiceRecorderState.recordedChunks.push(new Float32Array(input));

                    // Update live meter bar
                    let peak = 0;
                    for (let i = 0; i < input.length; i += 4) {
                        const a = Math.abs(input[i]);
                        if (a > peak) peak = a;
                    }
                    if (meterBar) {
                        meterBar.style.width = `${Math.min(100, Math.round(peak * 220))}%`;
                    }
                };

                voiceRecorderState.sourceNode.connect(voiceRecorderState.processorNode);
                voiceRecorderState.processorNode.connect(voiceRecorderState.audioCtx.destination);

                voiceRecorderState.isRecording = true;
                voiceRecorderState.startTime = Date.now();
                btnRec.innerHTML = '⏹️ Stop Recording';
                btnRec.style.background = 'rgba(244, 63, 94, 0.28)';

                voiceRecorderState.timerInterval = setInterval(() => {
                    const elapsed = ((Date.now() - voiceRecorderState.startTime) / 1000).toFixed(1);
                    if (lblStatus) {
                        lblStatus.textContent = `🔴 Recording ${elapsed}s...`;
                        lblStatus.style.color = '#fda4af';
                    }
                }, 100);
            } catch (err) {
                showToast('Microphone access error: ' + err.message, 'error');
            }
        });
    }

    if (btnPrev) {
        btnPrev.addEventListener('click', async () => {
            if (!voiceRecorderState.rawAudioBuffer) return;
            stopStudioAudioPreview();
            if (voiceRecorderState.previewSource) {
                try { voiceRecorderState.previewSource.stop(); } catch (_) {}
                voiceRecorderState.previewSource = null;
                btnPrev.innerHTML = '▶️ Preview FX';
                return;
            }

            const fx = document.getElementById('selStudioVoiceFx')?.value || 'normal';
            btnPrev.disabled = true;
            btnPrev.innerHTML = '⏳ FX...';
            try {
                const processedBuf = await renderVoiceFxBuffer(voiceRecorderState.rawAudioBuffer, fx);
                if (!voiceRecorderState.audioCtx) {
                    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                    voiceRecorderState.audioCtx = new AudioContextClass();
                }
                const src = voiceRecorderState.audioCtx.createBufferSource();
                src.buffer = processedBuf;
                src.connect(voiceRecorderState.audioCtx.destination);
                voiceRecorderState.previewSource = src;
                btnPrev.disabled = false;
                btnPrev.innerHTML = '⏹️ Stop';
                src.onended = () => {
                    voiceRecorderState.previewSource = null;
                    btnPrev.innerHTML = '▶️ Preview FX';
                };
                src.start(0);
            } catch (err) {
                btnPrev.disabled = false;
                btnPrev.innerHTML = '▶️ Preview FX';
                showToast('Preview error: ' + err.message, 'error');
            }
        });
    }

    if (btnApply) {
        btnApply.addEventListener('click', async () => {
            if (!voiceRecorderState.rawAudioBuffer) return;
            const slotRelPath = document.getElementById('selStudioRecordSlot')?.value || '__Chase / Panic Music';
            const fx = document.getElementById('selStudioVoiceFx')?.value || 'normal';

            btnApply.disabled = true;
            const origText = btnApply.innerHTML;
            btnApply.innerHTML = '⏳ Saving WAV...';
            try {
                const processedBuf = await renderVoiceFxBuffer(voiceRecorderState.rawAudioBuffer, fx);
                const base64Wav = encodeAudioBufferToWavBase64(processedBuf);
                const saved = await window.api.saveRecordedAudio(base64Wav, `${slotRelPath}_${fx}`);
                if (saved && saved.filePath) {
                    studioState.soundSwaps[slotRelPath] = saved;
                    renderStudioSoundsList();
                    if (lblStatus) {
                        lblStatus.textContent = `Applied (${fx}) ✓`;
                        lblStatus.style.color = '#34d399';
                    }
                    showToast(`🎙️ Voicemod (${fx}) recording assigned to slot! Click "Save to My Garry's Mod" when ready.`, 'success');
                }
            } catch (err) {
                showToast('Failed to save voice recording: ' + err.message, 'error');
            } finally {
                btnApply.disabled = false;
                btnApply.innerHTML = origText;
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const studioTabBtn = document.querySelector('.nav-item[data-tab="studio"]');
    if (studioTabBtn) {
        studioTabBtn.addEventListener('click', () => {
            initStudioIfNeeded();
        });
    }
    setTimeout(() => {
        initStudioIfNeeded();
    }, 600);
});


// =========================================================================
// 🌐 HOST & JOIN PRIVATE / LOCAL MULTIPLAYER GAME LOGIC
// =========================================================================

// Override launchSelectedMap to support Quick Launch Mode (Singleplayer, Local LAN, Steam P2P)
// as well as custom host options from the Private Game Modal.
function launchSelectedMap(mapName, customHostOpts = null) {
    const novid = document.getElementById('optNoVid')?.checked ?? true;
    const noworkshop = document.getElementById('optNoWorkshop')?.checked ?? false;
    const windowed = document.getElementById('optWindowed')?.checked ?? false;
    const gamemode = document.getElementById('optDefaultGamemode')?.value || 'sandbox';
    const extraArgs = document.getElementById('optExtraArgs')?.value || '';
    const resEl = document.getElementById('optResolution');
    const resVal = resEl ? resEl.value : 'native';

    if (resEl) {
        try { localStorage.setItem('gmod_preferred_res', resVal); } catch (_) {}
    }

    let width = null;
    let height = null;
    if (resVal === '3840x2160') { width = 3840; height = 2160; }
    else if (resVal === '2560x1440') { width = 2560; height = 1440; }
    else if (resVal === '1920x1080') { width = 1920; height = 1080; }

    const quickModeEl = document.getElementById('selQuickHostMode');
    const quickMode = quickModeEl ? quickModeEl.value : 'singleplayer';

    const hostMode = (customHostOpts && customHostOpts.hostMode) ? customHostOpts.hostMode : quickMode;
    const maxPlayers = (customHostOpts && customHostOpts.maxPlayers)
        ? parseInt(customHostOpts.maxPlayers, 10)
        : (hostMode === 'singleplayer' ? 1 : 8);
    const serverName = (customHostOpts && customHostOpts.serverName)
        ? customHostOpts.serverName
        : 'Private GMod Party';
    const serverPassword = (customHostOpts && customHostOpts.serverPassword)
        ? customHostOpts.serverPassword
        : '';

    const resLabel = (resVal === 'native' || !width) ? 'Native / DLDSR Fullscreen' : `${width}x${height}`;
    let modeLabel = 'Solo Singleplayer';
    if (hostMode === 'lan') modeLabel = `Local LAN Server (${maxPlayers} Players)`;
    else if (hostMode === 'p2p') modeLabel = `Steam Friends P2P (${maxPlayers} Players)`;

    showToast(`Launching ${mapName} — ${modeLabel} (${resLabel})...`, 'info');
    window.api.launchMap(mapName, {
        novid,
        noworkshop,
        fullscreen: !windowed,
        windowed,
        width,
        height,
        gamemode,
        extraArgs,
        hostMode,
        maxPlayers,
        serverName,
        serverPassword
    })
        .then(() => {
            if (hostMode === 'lan') {
                showToast(`🏠 Local LAN Server started on ${mapName}! Other PCs on your Wi-Fi can scan or type connect <your-ip>:27015`, 'success');
            } else if (hostMode === 'p2p') {
                showToast(`🤝 Private Steam P2P Server started on ${mapName}! Friends can right-click your name in Steam -> Join Game.`, 'success');
            } else {
                showToast(`Garry's Mod launched with map: ${mapName}!`, 'success');
            }
        })
        .catch(err => showToast(`Launch failed: ${err.message}`, 'error'));
}

let cachedLocalLanIp = '127.0.0.1';

async function refreshPrivateGameModalInfo() {
    // 1. Populate Map Dropdown from state.maps
    const selMap = document.getElementById('selModalHostMap');
    if (selMap && Array.isArray(state.maps) && state.maps.length > 0) {
        const currentVal = selMap.value || 'gm_construct';
        const sortedMaps = [...state.maps].sort((a, b) => a.mapName.localeCompare(b.mapName));
        selMap.innerHTML = sortedMaps.map(m => {
            const label = m.addonTitle ? `${m.mapName} (${m.addonTitle})` : m.mapName;
            return `<option value="${m.mapName}">${label}</option>`;
        }).join('');
        if (sortedMaps.some(m => m.mapName === currentVal)) {
            selMap.value = currentVal;
        } else if (sortedMaps.some(m => m.mapName === 'gm_construct')) {
            selMap.value = 'gm_construct';
        }
    }

    // 2. Fetch Local Network IP
    const lblIp = document.getElementById('lblMyLocalLanIp');
    if (window.api.getLocalNetworkInfo) {
        try {
            const netInfo = await window.api.getLocalNetworkInfo();
            const resolvedIp = (netInfo && (netInfo.ip || netInfo.primaryIp)) || '127.0.0.1';
            const ifaceLabel = (netInfo && netInfo.interfaceName) || 'Local Network';
            cachedLocalLanIp = resolvedIp;
            if (lblIp) {
                lblIp.textContent = `${resolvedIp}:27015 (${ifaceLabel})`;
            }
        } catch (err) {
            if (lblIp) lblIp.textContent = '127.0.0.1:27015';
        }
    } else if (lblIp) {
        lblIp.textContent = '127.0.0.1:27015';
    }
}

async function runLanServerScan() {
    const box = document.getElementById('lanServersDiscoveryBox');
    const btn = document.getElementById('btnScanLanServers');
    if (!box) return;

    if (btn) {
        btn.disabled = true;
        btn.textContent = '📡 Scanning...';
    }
    box.innerHTML = `
        <div style="text-align: center; color: #38bdf8; font-size: 12px; padding: 24px 8px;">
            📡 Broadcasting UDP A2S_INFO discovery across local Wi-Fi / Ethernet (ports 27015–27020)...
        </div>
    `;

    try {
        const servers = await window.api.scanLanGames();
        if (!servers || servers.length === 0) {
            box.innerHTML = `
                <div style="text-align: center; color: #94a3b8; font-size: 11.5px; padding: 18px 10px; line-height: 1.5;">
                    No running Garry's Mod LAN servers responded on ports 27015–27020.<br>
                    <span style="font-size: 10.5px; color: #64748b;">Tip: Make sure the host PC has finished loading into the map with <strong>Local LAN</strong> mode enabled, or enter their IP address below.</span>
                </div>
            `;
        } else {
            box.innerHTML = servers.map(srv => `
                <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(52, 211, 153, 0.35); border-radius: 7px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                    <div style="min-width: 0;">
                        <div style="font-weight: 700; font-size: 12.5px; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${srv.passwordProtected ? '🔒 ' : '🟢 '}${srv.name || 'GMod LAN Server'}
                        </div>
                        <div style="font-size: 11px; color: #94a3b8; font-family: var(--font-mono);">
                            🗺️ ${srv.map} • 👥 ${srv.players}/${srv.maxPlayers} • ${srv.address}
                        </div>
                    </div>
                    <button class="btn btn-primary btn-xs btn-join-discovered-lan" data-address="${srv.address}" style="white-space: nowrap; flex-shrink: 0; background: #10b981; border: none;">
                        ⚡ Join
                    </button>
                </div>
            `).join('');

            box.querySelectorAll('.btn-join-discovered-lan').forEach(joinBtn => {
                joinBtn.addEventListener('click', () => {
                    const addr = joinBtn.getAttribute('data-address');
                    const inpAddr = document.getElementById('inpDirectConnectAddress');
                    if (inpAddr) inpAddr.value = addr;
                    triggerDirectConnect(addr);
                });
            });
        }
    } catch (err) {
        box.innerHTML = `<div style="text-align: center; color: #f87171; font-size: 11.5px; padding: 20px;">Scan failed: ${err.message}</div>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📡 Scan Wi-Fi / LAN';
        }
    }
}

function triggerDirectConnect(addressOverride = null) {
    const rawAddr = addressOverride || document.getElementById('inpDirectConnectAddress')?.value || '';
    const password = document.getElementById('inpDirectConnectPassword')?.value || '';
    const cleanAddr = rawAddr.replace(/^connect\s+/i, '').trim();

    if (!cleanAddr) {
        return showToast('Please enter a local IP address (e.g. 192.168.1.42:27015) or scan your LAN first.', 'error');
    }

    const novid = document.getElementById('optNoVid')?.checked ?? true;
    const windowed = document.getElementById('optWindowed')?.checked ?? false;
    const extraArgs = document.getElementById('optExtraArgs')?.value || '';
    const resEl = document.getElementById('optResolution');
    const resVal = resEl ? resEl.value : 'native';

    let width = null;
    let height = null;
    if (resVal === '3840x2160') { width = 3840; height = 2160; }
    else if (resVal === '2560x1440') { width = 2560; height = 1440; }
    else if (resVal === '1920x1080') { width = 1920; height = 1080; }

    showToast(`Launching Garry's Mod & connecting to ${cleanAddr}...`, 'info');
    window.api.connectToServer(cleanAddr, {
        password,
        novid,
        fullscreen: !windowed,
        windowed,
        width,
        height,
        extraArgs
    })
        .then(() => {
            showToast(`Connecting to server ${cleanAddr}!`, 'success');
            document.getElementById('privateGameModal')?.classList.remove('active');
        })
        .catch(err => showToast(`Connection launch failed: ${err.message}`, 'error'));
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('privateGameModal');
    const btnOpen = document.getElementById('btnOpenPrivateGameModal');
    const btnClose = document.getElementById('btnClosePrivateGameModal');

    if (btnOpen && modal) {
        btnOpen.addEventListener('click', async () => {
            modal.classList.add('active');
            await refreshPrivateGameModalInfo();
            runLanServerScan();
        });
    }

    if (btnClose && modal) {
        btnClose.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }

    const btnCopyIp = document.getElementById('btnCopyMyConnectCmd');
    if (btnCopyIp) {
        btnCopyIp.addEventListener('click', () => {
            const pw = document.getElementById('inpModalHostPassword')?.value?.trim();
            const cmd = pw
                ? `password "${pw}"; connect ${cachedLocalLanIp}:27015`
                : `connect ${cachedLocalLanIp}:27015`;
            navigator.clipboard.writeText(cmd);
            showToast(`Copied "${cmd}" to clipboard! Send this to anyone on your network.`, 'success');
        });
    }

    const btnHost = document.getElementById('btnConfirmHostPrivateGame');
    if (btnHost) {
        btnHost.addEventListener('click', () => {
            const mapName = document.getElementById('selModalHostMap')?.value || 'gm_construct';
            const hostMode = document.getElementById('selModalHostType')?.value || 'lan';
            const maxPlayers = parseInt(document.getElementById('selModalMaxPlayers')?.value || '8', 10);
            const serverName = document.getElementById('inpModalServerName')?.value || 'Private GMod Party';
            const serverPassword = document.getElementById('inpModalHostPassword')?.value || '';

            // Sync quick selector on Maps Hub too
            const quickSel = document.getElementById('selQuickHostMode');
            if (quickSel) quickSel.value = hostMode;

            modal?.classList.remove('active');
            launchSelectedMap(mapName, {
                hostMode,
                maxPlayers,
                serverName,
                serverPassword
            });
        });
    }

    const btnScan = document.getElementById('btnScanLanServers');
    if (btnScan) {
        btnScan.addEventListener('click', () => {
            runLanServerScan();
        });
    }

    const btnConnect = document.getElementById('btnConfirmDirectConnect');
    if (btnConnect) {
        btnConnect.addEventListener('click', () => {
            triggerDirectConnect();
        });
    }

    // Pre-resolve Local LAN IP on startup so it never sits at "Detecting IP..."
    setTimeout(() => {
        refreshPrivateGameModalInfo();
    }, 300);
});
