const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'workshop_details_cache.json');

function ensureCacheDir() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadCache() {
    ensureCacheDir();
    if (fs.existsSync(CACHE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        } catch (_) {}
    }
    return {};
}

function saveCache(cache) {
    ensureCacheDir();
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (_) {}
}

/**
 * Fetch published file details in batch from Steam Web API
 */
async function fetchPublishedFileDetails(ids) {
    if (!ids || ids.length === 0) return {};

    const cache = loadCache();
    const missingIds = [];
    const results = {};

    for (const id of ids) {
        if (cache[id]) {
            results[id] = cache[id];
        } else {
            missingIds.push(id);
        }
    }

    if (missingIds.length === 0) {
        return results;
    }

    // Batch query in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < missingIds.length; i += chunkSize) {
        const chunk = missingIds.slice(i, i + chunkSize);
        const params = new URLSearchParams();
        params.append('itemcount', chunk.length.toString());
        chunk.forEach((id, idx) => {
            params.append(`publishedfileids[${idx}]`, id);
        });

        try {
            const res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            if (res.ok) {
                const data = await res.json();
                if (data.response && Array.isArray(data.response.publishedfiledetails)) {
                    for (const item of data.response.publishedfiledetails) {
                        if (item.result === 1) {
                            const details = {
                                id: item.publishedfileid,
                                title: item.title,
                                description: item.description,
                                previewUrl: item.preview_url,
                                fileSize: Number(item.file_size || 0),
                                subscriptions: Number(item.subscriptions || 0),
                                views: Number(item.views || 0),
                                favorited: Number(item.favorited || 0),
                                timeUpdated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : null,
                                tags: Array.isArray(item.tags) ? item.tags.map(t => t.tag) : []
                            };
                            cache[item.publishedfileid] = details;
                            results[item.publishedfileid] = details;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching workshop details chunk:', e);
        }
    }

    saveCache(cache);
    return results;
}

/**
 * Search Garry's Mod Steam Workshop
 */
async function searchWorkshop(options = {}) {
    const {
        query = '',
        tag = '',
        sort = 'trend', // 'trend', 'mostrecent', 'totaluniquesubscribers'
        page = 1,
        pagesToFetch = 2
    } = options;

    const pageCount = Math.max(1, Math.min(Number(pagesToFetch) || 2, 4));
    const pageNumbers = [];
    for (let i = 0; i < pageCount; i++) {
        pageNumbers.push(page + i);
    }

    const fetchSinglePageIds = async (p) => {
        let url = `https://steamcommunity.com/workshop/browse/?appid=4000&browsesort=${sort}&section=readytouseitems&p=${p}`;
        if (query && query.trim()) {
            url += `&searchtext=${encodeURIComponent(query.trim())}`;
        }
        if (tag && tag.trim()) {
            url += `&requiredtags[0]=${encodeURIComponent(tag.trim())}`;
        }

        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!res.ok) return [];

            const html = await res.text();
            const re = /sharedfiles\/filedetails\/\?id=(\d+)/g;
            const ids = [];
            let m;
            while ((m = re.exec(html)) !== null) {
                if (!ids.includes(m[1])) {
                    ids.push(m[1]);
                }
            }
            return ids;
        } catch (err) {
            console.error(`Error searching workshop page ${p}:`, err);
            return [];
        }
    };

    try {
        const pageResults = await Promise.all(pageNumbers.map(p => fetchSinglePageIds(p)));
        const allIds = [];
        for (const ids of pageResults) {
            for (const id of ids) {
                if (!allIds.includes(id)) {
                    allIds.push(id);
                }
            }
        }

        if (allIds.length === 0) {
            return [];
        }

        // Fetch details for found items
        const detailsMap = await fetchPublishedFileDetails(allIds);
        return allIds.map(id => detailsMap[id]).filter(Boolean);
    } catch (err) {
        console.error('Error searching workshop:', err);
        return [];
    }
}

/**
 * Open Workshop Item in Steam Desktop Client
 */
function openInSteamClient(workshopId) {
    const steamUrl = `steam://url/CommunityFilePage/${workshopId}`;
    exec(`start "" "${steamUrl}"`);
    return steamUrl;
}

/**
 * Open Workshop Item in Default Browser
 */
function openInBrowser(workshopId) {
    const webUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
    exec(`start "" "${webUrl}"`);
    return webUrl;
}

function openSteamWorkshopHub() {
    const steamUrl = 'steam://openurl/https://steamcommunity.com/app/4000/workshop/';
    exec(`start "" "${steamUrl}"`);
    return steamUrl;
}

/**
 * Opens any Steam URL directly inside the logged-in Steam Desktop Client
 */
function openSteamUrl(url) {
    let target = url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
        target = `steam://openurl/${url}`;
    }
    exec(`start "" "${target}"`);
    return target;
}

module.exports = {
    fetchPublishedFileDetails,
    searchWorkshop,
    openInSteamClient,
    openInBrowser,
    openSteamWorkshopHub,
    openSteamUrl
};

