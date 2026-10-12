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
    publishedNavmeshes: {}
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

    // Zen Mode Fullscreen
    const toggleZenMode = async () => {
        state.isZenMode = !state.isZenMode;
        await window.api.toggleFullScreen();
        const layout = document.querySelector('.app-layout');
        const btnZen = document.getElementById('btnToggleZen');

        if (state.isZenMode) {
            layout.classList.add('zen-mode');
            if (btnZen) {
                btnZen.classList.add('active');
                btnZen.title = 'Exit Fullscreen Zen Mode (F11 / Esc)';
            }
            showToast('Zen Mode active — Full screen immersion (F11 / Esc to exit)', 'info');
        } else {
            layout.classList.remove('zen-mode');
            if (btnZen) {
                btnZen.classList.remove('active');
                btnZen.title = 'Toggle Fullscreen Zen Mode (F11)';
            }
            showToast('Exited Zen Mode', 'info');
        }
    };

    document.getElementById('btnToggleZen').addEventListener('click', toggleZenMode);
    document.getElementById('btnFloatingExitZen').addEventListener('click', toggleZenMode);

    // Keyboard Shortcuts (F11, Z, Esc)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            toggleZenMode();
        } else if (e.key === 'Escape' && state.isZenMode) {
            e.preventDefault();
            toggleZenMode();
        } else if ((e.key === 'z' || e.key === 'Z') && !e.target.matches('input, textarea')) {
            e.preventDefault();
            toggleZenMode();
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
                    <span class="pill-nav ${map.hasNav ? '' : 'none'}">
                        ${map.hasNav ? '● NavMesh Ready' : '○ No NavMesh'}
                    </span>
                    ${isPublished ? `
                    <span class="pill-nav pill-uploaded" title="Live on Steam Workshop (ID: ${pubInfo.workshopId || ''})">
                        ☁️ Uploaded
                    </span>` : ''}
                </div>
            </div>
            <div class="map-card-footer">
                <button class="btn btn-card-launch" data-map="${map.mapName}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    <span>Launch</span>
                </button>
                ${map.hasNav ? `
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

function renderAddons() {
    const list = document.getElementById('addonsList');
    list.innerHTML = '';

    let filtered = state.addons.filter(addon => {
        if (state.addonFilter !== 'all') {
            if (state.addonFilter === 'Map' && addon.category !== 'Map') return false;
            if (state.addonFilter !== 'Map' && addon.category !== state.addonFilter) return false;
        }

        if (state.searchQuery) {
            const q = state.searchQuery;
            const matchName = addon.name.toLowerCase().includes(q);
            const matchAuthor = addon.author.toLowerCase().includes(q);
            const matchCat = addon.category.toLowerCase().includes(q);
            if (!matchName && !matchAuthor && !matchCat) return false;
        }
        return true;
    });

    // Sorting
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
                <p>Try modifying your search or selecting a different category.</p>
            </div>
        `;
        return;
    }

    filtered.forEach(addon => {
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

        list.appendChild(row);
    });
}

async function bulkToggleAddons(enable) {
    const toChange = state.addons.filter(a => a.isEnabled !== enable);
    if (toChange.length === 0) return;

    showToast(`${enable ? 'Enabling' : 'Disabling'} ${toChange.length} addons...`, 'info');
    for (const addon of toChange) {
        try {
            const res = await window.api.toggleAddon(addon.filePath, enable);
            addon.filePath = res.newPath;
            addon.isEnabled = enable;
        } catch (_) {}
    }
    await refreshAddons();
    await refreshMaps();
    showToast(`All addons ${enable ? 'enabled' : 'disabled'}!`, 'success');
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

        if (!meta.navSize || meta.navSize === 0) {
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
