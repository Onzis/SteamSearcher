// ==UserScript==
// @name            SteamSearcher
// @description     Собирает игры без RU языка на странице поиска Steam и отображает их в удобной модалке. Проверяет наличие русификаторов на ZoneOfGames.ru. Быстрый способ найти все игры без русского языка в вашем регионе и узнать, есть ли для них фанатские переводы.
// @namespace       https://github.com/Onzis/
// @author          Onzi
// @license         GPL-3.0 license
// @version         3.3.0
// @homepageURL     https://github.com/Onzis/SteamSearcher
// @updateURL       https://github.com/Onzis/SteamSearcher/raw/refs/heads/main/SteamSearcher.user.js
// @downloadURL     https://github.com/Onzis/SteamSearcher/raw/refs/heads/main/SteamSearcher.user.js
// @grant           GM_xmlhttpRequest
// @connect         store.steampowered.com
// @connect         api.steampowered.com
// @connect         zoneofgames.ru
// @match           https://store.steampowered.com/search/*
// @match           https://store.steampowered.com/search*
// ==/UserScript==

(function() {
    'use strict';

    const DELAY_MS = 500;
    const ZOG_DELAY_MS = 2500;
    const ZOG_CLOUDFLARE_RETRY_MS = 8000;
    const ZOG_MAX_RETRIES = 2;
    const ZOG_CHECK_ENABLED = true;
    let isScanning = false;
    let processedAppIds = new Set();
    let foundCount = 0;
    let errorCount = 0;
    let zogFoundCount = 0;

    // Состояние фильтров (true = показывать, false = скрывать)
    const filters = {
        found: true,
        no_translations: true,
        not_found: true,
        error: true,
        checking: true
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const ICON = {
        search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
        stop: '<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect x="3" y="3" width="12" height="12" rx="2"/></svg>',
        play: '<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><polygon points="4,2 16,9 4,16"/></svg>',
        restart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2.5 11.5a10 10 0 0 1 18.4-4.5L21.5 8"/><path d="M21.5 12.5a10 10 0 0 1-18.4 4.5L2.5 16"/></svg>',
        close: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="4" x2="14" y2="14"/><line x1="14" y1="4" x2="4" y2="14"/></svg>',
        check: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>',
        warn: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="2" x2="6" y2="7"/><circle cx="6" cy="9.5" r="0.5" fill="currentColor"/></svg>',
        question: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4,4 A2,2 0 0,1 8,4 A2,2 0 0,1 4,4"/><circle cx="6" cy="9.5" r="0.5" fill="currentColor"/></svg>',
        error: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="9" y2="9"/><line x1="9" y1="3" x2="3" y2="9"/></svg>',
        loader: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6,2 A4,4 0 0,1 10,6"/></svg>',
    };

    // ===================== УТИЛИТЫ ДЛЯ ZOG =====================

    const alphabetMap = {
        'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5, 'f': 6, 'g': 7, 'h': 8, 'i': 9, 'j': 10,
        'k': 11, 'l': 12, 'm': 13, 'n': 14, 'o': 15, 'p': 16, 'q': 17, 'r': 18, 's': 19,
        't': 20, 'u': 21, 'v': 22, 'w': 23, 'x': 24, 'y': 25, 'z': 26, '#': 0
    };
    const russianAlphabetMap = {
        'а': 1, 'б': 2, 'в': 3, 'г': 4, 'д': 5, 'е': 6, 'ё': 6, 'ж': 7, 'з': 8, 'и': 9,
        'й': 9, 'к': 10, 'л': 11, 'м': 12, 'н': 13, 'о': 14, 'п': 15, 'р': 16, 'с': 17,
        'т': 18, 'у': 19, 'ф': 20, 'х': 21, 'ц': 22, 'ч': 23, 'ш': 24, 'щ': 25, 'э': 26,
        'ю': 27, 'я': 28
    };

    function levenshteinDistance(s1, s2) {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(newValue, lastValue, costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    function calculateSimilarity(str1, str2) {
        let longer = str1, shorter = str2;
        if (str1.length < str2.length) { longer = str2; shorter = str1; }
        if (longer.length === 0) return 100.0;
        return Math.round(((longer.length - levenshteinDistance(longer, shorter)) / longer.length) * 100);
    }

    function findPossibleMatches(gameName, data) {
        const cleanGameName = gameName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zа-яё0-9 _'\-!]/gi, '').toLowerCase();
        return data.map(item => {
                const cleanItemName = item.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zа-яё0-9 _'\-!]/gi, '').toLowerCase();
                return { item, percentage: calculateSimilarity(cleanGameName, cleanItemName), startsWith: cleanItemName.startsWith(cleanGameName) };
            })
            .filter(item => item.percentage > 45 || item.startsWith)
            .sort((a, b) => {
                if (a.startsWith && !b.startsWith) return -1;
                if (!a.startsWith && b.startsWith) return 1;
                return b.percentage - a.percentage;
            })
            .slice(0, 5);
    }

    async function getEnglishGameName(appId) {
        try {
            const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify({ ids: [{ appid: parseInt(appId) }], context: { language: "english", country_code: "US" }, data_request: { include_basic_info: true } }))}`;
            const response = await new Promise((resolve, reject) => GM_xmlhttpRequest({ method: "GET", url, onload: resolve, onerror: reject, ontimeout: reject }));
            if (response.status === 200) {
                const data = JSON.parse(response.responseText);
                return data?.response?.store_items?.[0]?.name || null;
            }
        } catch (e) {
            console.error('ZOG: Ошибка запроса английского названия:', e);
        }
        return null;
    }

    function isCloudflareResponse(responseText, statusCode) {
        if (statusCode === 403 || statusCode === 503) return true;
        if (responseText && (
            responseText.includes('cf-browser-verification') ||
            responseText.includes('cf_chl_opt') ||
            responseText.includes('Just a moment') ||
            responseText.includes('Checking your browser') ||
            responseText.includes('Attention Required') ||
            responseText.includes('Cloudflare')
        )) return true;
        return false;
    }

    async function fetchWithCloudflareRetry(url, retries = ZOG_MAX_RETRIES) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await new Promise((resolve, reject) => GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8' },
                    onload: resolve,
                    onerror: reject,
                    ontimeout: reject
                }));

                if (isCloudflareResponse(response.responseText, response.status)) {
                    console.warn(`ZOG: Cloudflare обнаружен (попытка ${attempt + 1}/${retries + 1}) для ${url}`);
                    if (attempt < retries) {
                        const waitTime = ZOG_CLOUDFLARE_RETRY_MS * (attempt + 1);
                        await sleep(waitTime);
                        continue;
                    }
                    return null;
                }

                return response;
            } catch (e) {
                console.error(`ZOG: Ошибка сети (попытка ${attempt + 1}/${retries + 1}) для ${url}:`, e);
                if (attempt < retries) {
                    await sleep(ZOG_CLOUDFLARE_RETRY_MS * (attempt + 1));
                    continue;
                }
                return null;
            }
        }
        return null;
    }

    async function findGamesOnZog(gameName) {
        const isRussian = /[а-яё]/i.test(gameName);
        const activeMap = isRussian ? russianAlphabetMap : alphabetMap;
        const articles = ['the', 'a', 'an'];
        const words = gameName.toLowerCase().split(' ');
        const searchLetters = new Set();

        if (!isRussian && articles.includes(words[0]) && words.length > 1) {
            searchLetters.add(words[0][0]);
            if (activeMap[words[1][0]]) searchLetters.add(words[1][0]);
        } else {
            let firstChar = gameName.toLowerCase().charAt(0);
            searchLetters.add(activeMap.hasOwnProperty(firstChar) ? firstChar : '#');
        }

        const allGamesFound = [];
        const uniquePaths = new Set();
        for (const letter of searchLetters) {
            const isNonAlpha = letter === '#';
            const pageNum = activeMap[letter];
            if (pageNum === undefined) continue;
            const baseUrl = isNonAlpha ? 'https://www.zoneofgames.ru/games/eng/' : (isRussian ? 'https://www.zoneofgames.ru/games/rus/' : 'https://www.zoneofgames.ru/games/eng/');
            const url = `${baseUrl}${pageNum}/`;
            const response = await fetchWithCloudflareRetry(url);
            if (!response) {
                console.error(`ZOG: Не удалось загрузить страницу '${url}' после повторных попыток`);
                continue;
            }
            try {
                const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
                doc.querySelectorAll('td.gameinfoblock a').forEach(link => {
                    const path = link.getAttribute('href');
                    if (path && !uniquePaths.has(path)) {
                        const rawTitle = link.textContent.trim();
                        const articleMatch = rawTitle.match(/,\s+(The|An|A)$/i);
                        let title = articleMatch ? `${articleMatch[1]} ${rawTitle.replace(articleMatch[0], '').trim()}` : rawTitle;
                        allGamesFound.push({ title, path });
                        uniquePaths.add(path);
                    }
                });
            } catch (e) { console.error(`Ошибка при разборе страницы '${url}':`, e); }
        }
        return allGamesFound;
    }

    async function fetchLocalizations(gamePath) {
        const fullUrl = `https://www.zoneofgames.ru${gamePath}`;
        const response = await fetchWithCloudflareRetry(fullUrl);
        if (!response) {
            console.error('ZOG: Не удалось загрузить страницу игры после повторных попыток');
            return null;
        }
        try {
            const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
            const localizations = [];
            const translationLabel = Array.from(doc.querySelectorAll('b')).find(b => b.textContent.trim() === 'Переводы:');
            if (translationLabel) {
                const table = translationLabel.closest('table');
                if (table) {
                    table.querySelectorAll('tr').forEach(row => {
                        const linkEl = row.querySelector('a');
                        if (linkEl?.getAttribute('href')) {
                            localizations.push({
                                name: linkEl.textContent.trim(),
                                size: row.querySelector('td:last-child')?.textContent.trim() || '',
                                link: `https://www.zoneofgames.ru${linkEl.getAttribute('href')}`
                            });
                        }
                    });
                }
            }
            const gameTitle = doc.querySelector('td.blockstyle > b > font')?.textContent.trim() || '';
            return { title: gameTitle, url: fullUrl, localizations };
        } catch (e) {
            console.error('ZOG: Ошибка получения страницы игры:', e);
            return null;
        }
    }

    async function checkZogLocalizer(appId, gameName) {
        if (!ZOG_CHECK_ENABLED) return null;

        const cacheKey = `zog_ru_v3_${appId}`;
        localStorage.removeItem(`zog_ru_v2_${appId}`);
        localStorage.removeItem(`zog_ru_v1_${appId}`);

        const cached = localStorage.getItem(cacheKey);
        if (cached !== null) {
            try { return JSON.parse(cached); } catch (e) { localStorage.removeItem(cacheKey); }
        }

        try {
            let searchName = await getEnglishGameName(appId);
            if (!searchName) searchName = gameName;

            console.log(`ZOG: Поиск русификатора для "${searchName}" (appId: ${appId})`);

            const allGames = await findGamesOnZog(searchName);
            if (!allGames || allGames.length === 0) {
                // Не кэшируем not_found — возможно Cloudflare блокировка
                const result = { status: 'not_found', localizations: [], url: null };
                return result;
            }

            const matches = findPossibleMatches(searchName, allGames);
            if (matches.length === 0) {
                // Не кэшируем not_found — возможно Cloudflare блокировка
                const result = { status: 'not_found', localizations: [], url: null };
                return result;
            }

            const bestMatch = matches[0];
            console.log(`ZOG: Лучшее совпадение: "${bestMatch.item.title}" (${bestMatch.percentage}%) -> ${bestMatch.item.path}`);

            const locData = await fetchLocalizations(bestMatch.item.path);

            if (!locData) {
                // Не кэшируем error — возможно Cloudflare блокировка
                return { status: 'error', localizations: [], url: `https://www.zoneofgames.ru${bestMatch.item.path}` };
            }

            if (locData.localizations && locData.localizations.length > 0) {
                const result = {
                    status: 'found',
                    localizations: locData.localizations,
                    url: locData.url,
                    zogTitle: locData.title || bestMatch.item.title,
                    matchPercent: bestMatch.percentage
                };
                console.log(`ZOG: Найдено ${locData.localizations.length} русификатор(ов) для "${bestMatch.item.title}"`);
                localStorage.setItem(cacheKey, JSON.stringify(result));
                return result;
            } else {
                const result = {
                    status: 'no_translations',
                    localizations: [],
                    url: locData.url,
                    zogTitle: locData.title || bestMatch.item.title,
                    matchPercent: bestMatch.percentage
                };
                console.log(`ZOG: Русификаторы не найдены для "${bestMatch.item.title}"`);
                localStorage.setItem(cacheKey, JSON.stringify(result));
                return result;
            }
        } catch (e) {
            console.error(`ZOG: Ошибка проверки русификатора для ${appId}:`, e);
            return { status: 'error', localizations: [], url: null };
        }
    }

    // ===================== ОСНОВНОЙ КОД =====================

    function injectStyles() {
        if (document.getElementById('no-ru-styles')) return;
        const style = document.createElement('style');
        style.id = 'no-ru-styles';
        style.innerHTML = `
            #no-ru-modal-content::-webkit-scrollbar { width: 10px !important; }
            #no-ru-modal-content::-webkit-scrollbar-track { background: #171a21 !important; border-radius: 0 0 8px 0 !important; }
            #no-ru-modal-content::-webkit-scrollbar-thumb { background: #3d4450 !important; border-radius: 5px !important; }
            #no-ru-modal-content::-webkit-scrollbar-thumb:hover { background: #66c0f4 !important; }
            body.no-ru-modal-open { overflow: hidden !important; }
            .no-ru-btn { border: none; color: #c6d4df; width: 38px; height: 38px; border-radius: 6px;
                background: rgba(255,255,255,0.08); cursor: pointer; transition: all 0.15s;
                display: flex; align-items: center; justify-content: center; }
            .no-ru-btn:hover { background: rgba(255,255,255,0.18); color: #fff; }
            .no-ru-btn:active { transform: scale(0.92); }
            .no-ru-fab { position: fixed; bottom: 30px; left: 30px; z-index: 9998;
                width: 52px; height: 52px; background: rgba(27,40,56,0.92); color: #66c0f4;
                border: 1px solid rgba(102,192,244,0.25); border-radius: 50%; cursor: pointer;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5); transition: all 0.15s;
                display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); }
            .no-ru-fab:hover { background: rgba(27,40,56,0.98); color: #fff; border-color: rgba(102,192,244,0.5);
                transform: scale(1.08); box-shadow: 0 6px 22px rgba(0,0,0,0.6); }
            .no-ru-fab:active { transform: scale(0.95); }
            .zog-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 7px; border-radius: 3px; margin-top: 6px; font-weight: bold; word-break: break-word; }
            .zog-badge svg { flex-shrink: 0; }
            .zog-badge.found { background: rgba(76, 175, 80, 0.15); color: #4CAF50; border: 1px solid rgba(76, 175, 80, 0.3); }
            .zog-badge.no-translations { background: rgba(255, 152, 0, 0.15); color: #FF9800; border: 1px solid rgba(255, 152, 0, 0.3); }
            .zog-badge.not-found { background: rgba(158, 158, 158, 0.15); color: #9e9e9e; border: 1px solid rgba(158, 158, 158, 0.25); }
            .zog-badge.error { background: rgba(244, 67, 54, 0.15); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.25); }
            .zog-badge.checking { background: rgba(102, 192, 244, 0.15); color: #66c0f4; border: 1px solid rgba(102, 192, 244, 0.25); }
            .zog-badge.checking svg { animation: spin 1s linear infinite; }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .zog-loc-list { margin-top: 6px; padding-left: 14px; }
            .zog-loc-list li { font-size: 11px; color: #c6d4df; margin-bottom: 3px; }
            .zog-loc-list a { color: #66c0f4; text-decoration: none; }
            .zog-loc-list a:hover { text-decoration: underline; }
            .no-ru-body-wrapper { display: flex; flex: 1; min-height: 0; overflow: hidden; }
            .no-ru-sidebar { width: 14%; min-width: 180px; flex-shrink: 0; background: #171a21; border-right: 1px solid #2a475e;
                display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #3d4450 #171a21; }
            .no-ru-sidebar-header { padding: 16px 16px 12px; color: #66c0f4; font-size: 14px; font-weight: bold;
                text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #2a475e; }
            .no-ru-filter-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer;
                transition: background 0.15s; user-select: none; }
            .no-ru-filter-item:hover { background: rgba(255,255,255,0.05); }
            .no-ru-filter-item.disabled { opacity: 0.4; }
            .no-ru-filter-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 2px solid; }
            .no-ru-filter-dot.found { background: rgba(76, 175, 80, 0.6); border-color: #4CAF50; }
            .no-ru-filter-dot.no-translations { background: rgba(255, 152, 0, 0.6); border-color: #FF9800; }
            .no-ru-filter-dot.not-found { background: rgba(158, 158, 158, 0.6); border-color: #9e9e9e; }
            .no-ru-filter-dot.error { background: rgba(244, 67, 54, 0.6); border-color: #f44336; }
            .no-ru-filter-dot.checking { background: rgba(102, 192, 244, 0.6); border-color: #66c0f4; }
            .no-ru-filter-dot.off { background: transparent !important; }
            .no-ru-filter-label { flex: 1; color: #c6d4df; font-size: 12px; line-height: 1.3; }
            .no-ru-filter-count { color: #8f98a0; font-size: 11px; font-weight: bold; min-width: 20px; text-align: right; }
            .no-ru-filter-toggle { width: 32px; height: 18px; border-radius: 9px; background: #3d4450; position: relative;
                transition: background 0.2s; flex-shrink: 0; }
            .no-ru-filter-toggle.on { background: #4CAF50; }
            .no-ru-filter-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
                border-radius: 50%; background: #fff; transition: transform 0.2s; }
            .no-ru-filter-toggle.on::after { transform: translateX(14px); }
            .no-ru-sidebar-divider { height: 1px; background: #2a475e; margin: 8px 16px; }
            .no-ru-sidebar-stats { padding: 12px 16px; color: #8f98a0; font-size: 11px; line-height: 1.6; }
            .no-ru-sidebar-stats span { color: #c6d4df; font-weight: bold; }
            .no-ru-hidden-card { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    async function checkLanguage(appId, retryCount = 0) {
        const cacheKey = `lang_ru_v5_${appId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached !== null) return cached === 'true';

        try {
            const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);

            if (response.status === 429) {
                if (retryCount < 2) {
                    await sleep(2500);
                    return await checkLanguage(appId, retryCount + 1);
                }
                return null;
            }

            if (!response.ok) return null;

            const data = await response.json();
            if (data && data[appId] && data[appId].success) {
                const languages = data[appId].data.supported_languages || '';
                const hasRussian = languages.toLowerCase().includes('russian') || languages.toLowerCase().includes('русский');
                localStorage.setItem(cacheKey, hasRussian);
                return hasRussian;
            }
        } catch (e) {
            console.error(`Ошибка сети ${appId}:`, e);
        }
        return null;
    }

    function createModalUI() {
        if (document.getElementById('no-ru-modal-overlay')) return;

        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = 'no-ru-modal-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.85); z-index: 99999; display: none;
            justify-content: center; align-items: center; font-family: "Motiva Sans", Arial, sans-serif;
            backdrop-filter: blur(4px);
        `;

        overlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            const contentBlock = document.getElementById('no-ru-modal-content');
            if (contentBlock) {
                contentBlock.scrollTop += e.deltaY;
            }
        }, { passive: true });

        const modal = document.createElement('div');
        modal.style.cssText = `
            width: 100%; max-width: 100%; height: 100%; background: #1b2838;
            border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,1);
            display: flex; flex-direction: column; overflow: hidden; border: 1px solid #3d4450;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            background: linear-gradient(90deg, #171a21 0%, #1b2838 100%); padding: 15px 20px; display: flex;
            justify-content: space-between; align-items: center; border-bottom: 1px solid #2a475e;
            flex-shrink: 0;
        `;

        const titleContainer = document.createElement('div');
        const title = document.createElement('h2');
        title.id = 'no-ru-modal-title';
        title.innerText = 'Подготовка к сканированию...';
        title.style.cssText = 'color: #66c0f4; margin: 0; font-size: 18px; text-shadow: 1px 1px 2px black;';

        const subtitle = document.createElement('div');
        subtitle.id = 'no-ru-modal-subtitle';
        subtitle.style.cssText = 'color: #8f98a0; font-size: 13px; margin-top: 5px;';
        subtitle.innerText = 'Идет поиск...';

        titleContainer.appendChild(title);
        titleContainer.appendChild(subtitle);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.style.cssText = 'display: flex; gap: 8px;';

        // Кнопка Стоп/Продолжить (переключается)
        const stopBtn = document.createElement('button');
        stopBtn.id = 'no-ru-stop-btn';
        stopBtn.className = 'no-ru-btn';
        stopBtn.innerHTML = ICON.stop;
        stopBtn.title = 'Остановить';
        stopBtn.onclick = () => {
            if (isScanning) {
                isScanning = false;
                stopBtn.innerHTML = ICON.play;
                stopBtn.title = 'Продолжить';
                title.innerText = `Поиск приостановлен. Найдено игр: ${foundCount}`;
                subtitle.innerText = `С русификатором: ${zogFoundCount}. Нажмите продолжить.`;
            } else {
                stopBtn.innerHTML = ICON.stop;
                stopBtn.title = 'Остановить';
                title.innerText = `Сканирование... Найдено игр: ${foundCount}`;
                startScanning();
            }
        };

        // Кнопка Перезапуск
        const restartBtn = document.createElement('button');
        restartBtn.id = 'no-ru-restart-btn';
        restartBtn.className = 'no-ru-btn';
        restartBtn.innerHTML = ICON.restart;
        restartBtn.title = 'Перепроверить неудачные';
        restartBtn.onclick = () => {
            isScanning = false;
            setTimeout(() => retryFailedZogChecks(), 100);
        };

        // Кнопка Закрыть
        const closeBtn = document.createElement('button');
        closeBtn.className = 'no-ru-btn';
        closeBtn.innerHTML = ICON.close;
        closeBtn.title = 'Закрыть';
        closeBtn.onclick = () => {
            isScanning = false;
            overlay.style.display = 'none';
            document.body.style.overflow = '';
        };

        buttonsDiv.appendChild(stopBtn);
        buttonsDiv.appendChild(restartBtn);
        buttonsDiv.appendChild(closeBtn);

        header.appendChild(titleContainer);
        header.appendChild(buttonsDiv);

        // Обёртка: сайдбар + контент
        const bodyWrapper = document.createElement('div');
        bodyWrapper.className = 'no-ru-body-wrapper';

        // ===== Сайдбар с фильтрами =====
        const sidebar = document.createElement('div');
        sidebar.className = 'no-ru-sidebar';

        const sidebarHeader = document.createElement('div');
        sidebarHeader.className = 'no-ru-sidebar-header';
        sidebarHeader.textContent = 'Фильтры';
        sidebar.appendChild(sidebarHeader);

        const filterConfigs = [
            { key: 'found', label: 'Русификатор есть', dotClass: 'found' },
            { key: 'no_translations', label: 'Нет русификатора', dotClass: 'no-translations' },
            { key: 'not_found', label: 'Не найдено на ZOG', dotClass: 'not-found' },
            { key: 'error', label: 'Ошибка загрузки', dotClass: 'error' },
            { key: 'checking', label: 'Проверка...', dotClass: 'checking' }
        ];

        filterConfigs.forEach(cfg => {
            const item = document.createElement('div');
            item.className = 'no-ru-filter-item' + (filters[cfg.key] ? '' : ' disabled');
            item.dataset.filterKey = cfg.key;

            const dot = document.createElement('div');
            dot.className = 'no-ru-filter-dot ' + cfg.dotClass + (filters[cfg.key] ? '' : ' off');
            dot.dataset.filterKey = cfg.key;

            const label = document.createElement('div');
            label.className = 'no-ru-filter-label';
            label.textContent = cfg.label;

            const count = document.createElement('div');
            count.className = 'no-ru-filter-count';
            count.id = 'filter-count-' + cfg.key;
            count.textContent = '0';

            const toggle = document.createElement('div');
            toggle.className = 'no-ru-filter-toggle' + (filters[cfg.key] ? ' on' : '');
            toggle.dataset.filterKey = cfg.key;

            item.appendChild(dot);
            item.appendChild(label);
            item.appendChild(count);
            item.appendChild(toggle);

            item.onclick = () => {
                filters[cfg.key] = !filters[cfg.key];
                toggle.classList.toggle('on', filters[cfg.key]);
                dot.classList.toggle('off', !filters[cfg.key]);
                item.classList.toggle('disabled', !filters[cfg.key]);
                applyFilters();
            };

            sidebar.appendChild(item);
        });

        // Разделитель и статистика
        const divider = document.createElement('div');
        divider.className = 'no-ru-sidebar-divider';
        sidebar.appendChild(divider);

        const stats = document.createElement('div');
        stats.className = 'no-ru-sidebar-stats';
        stats.id = 'no-ru-sidebar-stats';
        stats.innerHTML = 'Всего: <span id="stat-total">0</span><br>Показано: <span id="stat-visible">0</span><br>Скрыто: <span id="stat-hidden">0</span>';
        sidebar.appendChild(stats);

        // ===== Контентная область =====
        const content = document.createElement('div');
        content.id = 'no-ru-modal-content';
        content.style.cssText = `
            padding: 20px; overflow-y: scroll; flex: 1; min-height: 0;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            grid-auto-rows: max-content; gap: 20px; align-content: start; background: #171a21;
            overscroll-behavior: contain;
            scrollbar-width: thin; scrollbar-color: #3d4450 #171a21; scrollbar-gutter: stable;
        `;

        bodyWrapper.appendChild(sidebar);
        bodyWrapper.appendChild(content);

        modal.appendChild(header);
        modal.appendChild(bodyWrapper);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    function addGameToModal(gameData) {
        const content = document.getElementById('no-ru-modal-content');

        const gameItem = document.createElement('div');
        gameItem.className = 'no-ru-game-card';
        gameItem.style.cssText = `
            display: flex; flex-direction: column; background: #202d39; border: 1px solid #3d4450;
            border-radius: 4px; transition: transform 0.2s, box-shadow 0.2s;
            overflow: hidden; color: #c6d4df;
        `;
        gameItem.onmouseover = () => {
            gameItem.style.transform = 'translateY(-5px)';
            gameItem.style.boxShadow = '0 5px 15px rgba(0,0,0,0.5)';
            gameItem.style.borderColor = '#66c0f4';
        };
        gameItem.onmouseout = () => {
            gameItem.style.transform = 'translateY(0)';
            gameItem.style.boxShadow = 'none';
            gameItem.style.borderColor = '#3d4450';
        };

        const hqImg = gameData.img.replace('capsule_sm_120', 'capsule_231x87').replace('capsule_184x69', 'capsule_231x87');

        const imgLink = document.createElement('a');
        imgLink.href = gameData.link;
        imgLink.target = '_blank';
        const img = document.createElement('img');
        img.src = hqImg;
        img.style.cssText = 'width: 100%; aspect-ratio: 16/7; object-fit: cover; border-bottom: 1px solid #171a21; display: block;';
        imgLink.appendChild(img);
        gameItem.appendChild(imgLink);

        const innerDiv = document.createElement('div');
        innerDiv.style.cssText = 'padding: 12px; display: flex; flex-direction: column; flex: 1;';

        const nameLink = document.createElement('a');
        nameLink.href = gameData.link;
        nameLink.target = '_blank';
        nameLink.style.cssText = 'text-decoration: none; color: #c6d4df;';
        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold; font-size: 14px; margin-bottom: 8px; line-height: 1.3;';
        nameDiv.textContent = gameData.title;
        nameLink.appendChild(nameDiv);
        innerDiv.appendChild(nameLink);

        const priceDiv = document.createElement('div');
        priceDiv.style.cssText = 'align-self: flex-start; font-size: 13px; color: #a3cc40; background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 3px;';
        priceDiv.textContent = gameData.price || 'Не указана';
        innerDiv.appendChild(priceDiv);

        const zogBadge = document.createElement('div');
        zogBadge.className = 'zog-badge checking';
        zogBadge.dataset.appId = gameData.appId;
        zogBadge.innerHTML = ICON.loader + ' Проверка ZOG...';
        innerDiv.appendChild(zogBadge);

        const zogLocContainer = document.createElement('div');
        zogLocContainer.className = 'zog-loc-container';
        zogLocContainer.dataset.appId = gameData.appId;
        zogLocContainer.style.display = 'none';
        innerDiv.appendChild(zogLocContainer);

        gameItem.appendChild(innerDiv);
        content.appendChild(gameItem);

        // Обновить счётчики фильтров при добавлении новой карточки
        updateFilterCounts();
    }

    // ===================== ФИЛЬТРЫ =====================

    function getBadgeStatusKey(badge) {
        if (badge.classList.contains('found')) return 'found';
        if (badge.classList.contains('no-translations')) return 'no_translations';
        if (badge.classList.contains('not-found')) return 'not_found';
        if (badge.classList.contains('error')) return 'error';
        if (badge.classList.contains('checking')) return 'checking';
        return null;
    }

    function updateFilterCounts() {
        const counts = { found: 0, no_translations: 0, not_found: 0, error: 0, checking: 0 };
        const allBadges = document.querySelectorAll('.zog-badge[data-app-id]');
        allBadges.forEach(badge => {
            const key = getBadgeStatusKey(badge);
            if (key && counts.hasOwnProperty(key)) counts[key]++;
        });

        Object.keys(counts).forEach(key => {
            const el = document.getElementById('filter-count-' + key);
            if (el) el.textContent = counts[key];
        });

        const total = allBadges.length;
        const visible = document.querySelectorAll('.no-ru-game-card:not(.no-ru-hidden-card)').length;
        const hidden = total - visible;

        const statTotal = document.getElementById('stat-total');
        const statVisible = document.getElementById('stat-visible');
        const statHidden = document.getElementById('stat-hidden');
        if (statTotal) statTotal.textContent = total;
        if (statVisible) statVisible.textContent = visible;
        if (statHidden) statHidden.textContent = hidden;
    }

    function applyFilters() {
        const allCards = document.querySelectorAll('.no-ru-game-card');
        allCards.forEach(card => {
            const badge = card.querySelector('.zog-badge[data-app-id]');
            if (!badge) { card.classList.remove('no-ru-hidden-card'); return; }
            const statusKey = getBadgeStatusKey(badge);
            if (statusKey && filters.hasOwnProperty(statusKey) && !filters[statusKey]) {
                card.classList.add('no-ru-hidden-card');
            } else {
                card.classList.remove('no-ru-hidden-card');
            }
        });
        updateFilterCounts();
    }

    function updateZogBadge(appId, zogResult) {
        const badges = document.querySelectorAll(`.zog-badge[data-app-id="${appId}"]`);
        const containers = document.querySelectorAll(`.zog-loc-container[data-app-id="${appId}"]`);

        badges.forEach(badge => {
            badge.classList.remove('checking');
            switch (zogResult.status) {
                case 'found':
                    badge.classList.add('found');
                    badge.innerHTML = ICON.check + ' Русификатор есть' + (zogResult.matchPercent ? ` (${zogResult.matchPercent}%)` : '');
                    if (zogResult.url) {
                        badge.style.cursor = 'pointer';
                        badge.onclick = () => { window.open(zogResult.url, '_blank'); };
                    }
                    zogFoundCount++;
                    break;
                case 'no_translations':
                    badge.classList.add('no-translations');
                    badge.innerHTML = ICON.warn + ' Нет русификатора' + (zogResult.matchPercent ? ` (${zogResult.matchPercent}%)` : '');
                    if (zogResult.url) {
                        badge.style.cursor = 'pointer';
                        badge.onclick = () => { window.open(zogResult.url, '_blank'); };
                    }
                    break;
                case 'not_found':
                    badge.classList.add('not-found');
                    badge.innerHTML = ICON.question + ' Не найдено на ZOG';
                    break;
                case 'error':
                    badge.classList.add('error');
                    badge.innerHTML = ICON.error + ' Ошибка загрузки ZOG';
                    break;
            }
        });

        containers.forEach(container => {
            if (zogResult.status === 'found' && zogResult.localizations && zogResult.localizations.length > 0) {
                container.style.display = 'block';
                const list = document.createElement('ul');
                list.className = 'zog-loc-list';
                zogResult.localizations.forEach(loc => {
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.href = loc.link;
                    a.target = '_blank';
                    a.textContent = `${loc.name}${loc.size ? ' (' + loc.size + ')' : ''}`;
                    li.appendChild(a);
                    list.appendChild(li);
                });
                container.appendChild(list);
            } else if (zogResult.status === 'no_translations' && zogResult.url) {
                container.style.display = 'block';
                const link = document.createElement('a');
                link.href = zogResult.url;
                link.target = '_blank';
                link.style.cssText = 'font-size: 11px; color: #66c0f4; text-decoration: none; margin-top: 4px; display: inline-block;';
                link.textContent = 'Открыть на ZoneOfGames';
                container.appendChild(link);
            }
        });

        // Применить фильтры и обновить счётчики после изменения бейджа
        applyFilters();
    }

    async function retryFailedZogChecks() {
        const overlay = document.getElementById('no-ru-modal-overlay');
        const titleText = document.getElementById('no-ru-modal-title');
        const subtitleText = document.getElementById('no-ru-modal-subtitle');
        const stopBtn = document.getElementById('no-ru-stop-btn');

        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        stopBtn.innerHTML = ICON.stop;
        stopBtn.title = 'Остановить';
        stopBtn.style.display = 'flex';

        // Найти все бейджи с неудачными статусами
        const failedBadges = document.querySelectorAll('.zog-badge.not-found, .zog-badge.no-translations, .zog-badge.error');
        if (failedBadges.length === 0) {
            titleText.innerText = 'Нет игр для повторной проверки';
            subtitleText.innerText = 'Все игры уже проверены. Попробуйте полный перезапуск.';
            return;
        }

        isScanning = true;
        let rechecked = 0;
        let newFound = 0;

        titleText.innerText = `Повторная проверка ZOG: 0/${failedBadges.length}`;
        subtitleText.innerText = 'Проверяем игры с ошибками и без русификатора...';

        for (const badge of failedBadges) {
            if (!isScanning) break;

            const appId = badge.dataset.appId;
            if (!appId) continue;

            rechecked++;

            // Очистить кэш ZOG для этой игры
            localStorage.removeItem(`zog_ru_v3_${appId}`);

            // Сбросить бейдж в состояние проверки
            badge.className = 'zog-badge checking';
            badge.innerHTML = ICON.loader + ' Проверка ZOG...';
            badge.onclick = null;
            badge.style.cursor = 'default';

            // Очистить контейнер локализаций
            const container = document.querySelector(`.zog-loc-container[data-app-id="${appId}"]`);
            if (container) {
                container.innerHTML = '';
                container.style.display = 'none';
            }

            // Найти название игры из карточки
            const card = badge.closest('.no-ru-game-card');
            const nameEl = card?.querySelector('a div[style*="font-weight"]');
            const gameTitle = nameEl?.textContent || '';

            titleText.innerText = `Повторная проверка ZOG: ${rechecked}/${failedBadges.length}`;
            subtitleText.innerText = `Проверяем: ${gameTitle || appId}`;

            const zogResult = await checkZogLocalizer(appId, gameTitle);
            const oldZogFound = zogFoundCount;
            updateZogBadge(appId, zogResult);
            if (zogResult.status === 'found') newFound++;

            titleText.innerText = `Повторная проверка: ${rechecked}/${failedBadges.length} | Новых русификаторов: ${newFound}`;

            await sleep(ZOG_DELAY_MS);
        }

        isScanning = false;
        stopBtn.innerHTML = ICON.play;
        stopBtn.title = 'Продолжить';
        titleText.innerText = `Повторная проверка завершена. Проверено: ${rechecked} | Новых русификаторов: ${newFound}`;
        subtitleText.innerText = `Всего с русификатором: ${zogFoundCount}`;
    }

    async function startScanning(isRestart = false) {
        if (isRestart) {
            processedAppIds.clear();
            foundCount = 0;
            errorCount = 0;
            zogFoundCount = 0;
            // Сбросить фильтры при новом сканировании
            Object.keys(filters).forEach(key => { filters[key] = true; });
            document.querySelectorAll('.no-ru-filter-toggle').forEach(t => t.classList.add('on'));
            document.querySelectorAll('.no-ru-filter-dot').forEach(d => d.classList.remove('off'));
            document.querySelectorAll('.no-ru-filter-item').forEach(i => i.classList.remove('disabled'));
        }

        isScanning = true;

        const overlay = document.getElementById('no-ru-modal-overlay');
        const content = document.getElementById('no-ru-modal-content');
        const titleText = document.getElementById('no-ru-modal-title');
        const subtitleText = document.getElementById('no-ru-modal-subtitle');
        const stopBtn = document.getElementById('no-ru-stop-btn');
        const restartBtn = document.getElementById('no-ru-restart-btn');

        if (isRestart) content.innerHTML = '';
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Убедиться что кнопка стоп в правильном состоянии
        stopBtn.innerHTML = ICON.stop;
        stopBtn.title = 'Остановить';
        stopBtn.style.display = 'flex';
        restartBtn.style.display = 'flex';

        titleText.innerText = 'Сканирование запущено...';

        while (isScanning) {
            const gamesOnPage = document.querySelectorAll('#search_resultsRows a.search_result_row');
            let foundNewUnprocessedGames = false;

            for (let i = 0; i < gamesOnPage.length; i++) {
                if (!isScanning) break;

                const gameRow = gamesOnPage[i];
                const appId = gameRow.getAttribute('data-ds-appid');

                if (!appId || appId.includes(',') || processedAppIds.has(appId)) continue;

                foundNewUnprocessedGames = true;
                processedAppIds.add(appId);

                subtitleText.innerText = `Проверяем игру ${processedAppIds.size}: язык...`;

                const hasRussian = await checkLanguage(appId);

                if (hasRussian === false) {
                    const titleMatch = gameRow.querySelector('.title');
                    const imgMatch = gameRow.querySelector('img');
                    const gameTitle = titleMatch ? titleMatch.textContent : 'Неизвестно';

                    let priceText = '';
                    const discountPrice = gameRow.querySelector('.discount_final_price');
                    const normalPrice = gameRow.querySelector('.search_price:not(.transparent)');
                    const freePrice = gameRow.querySelector('.search_price.free');

                    if (discountPrice) priceText = discountPrice.textContent;
                    else if (freePrice) priceText = 'Free';
                    else if (normalPrice) priceText = normalPrice.textContent;

                    addGameToModal({
                        appId: appId,
                        title: gameTitle,
                        img: imgMatch ? imgMatch.src : '',
                        price: priceText.trim().replace(/\n/g, '').replace(/\s+/g, ' '),
                        link: gameRow.href
                    });

                    foundCount++;
                    titleText.innerText = `Найдено игр: ${foundCount} | С русификатором: ${zogFoundCount}`;

                    if (ZOG_CHECK_ENABLED) {
                        subtitleText.innerText = `Проверяем игру ${processedAppIds.size}: русификатор ZOG...`;
                        const zogResult = await checkZogLocalizer(appId, gameTitle);
                        updateZogBadge(appId, zogResult);
                        titleText.innerText = `Найдено игр: ${foundCount} | С русификатором: ${zogFoundCount}`;

                        if (localStorage.getItem(`zog_ru_v3_${appId}`) === null && isScanning) {
                            await sleep(ZOG_DELAY_MS);
                        }
                    }
                } else if (hasRussian === null) {
                    errorCount++;
                }

                if (localStorage.getItem(`lang_ru_v5_${appId}`) === null && isScanning) {
                    await sleep(DELAY_MS);
                }
            }

            if (!isScanning) break;

            subtitleText.innerText = 'Листаем страницу Steam вниз для загрузки новых игр...';
            window.scrollTo(0, document.body.scrollHeight);

            await sleep(2000);

            const newGamesCount = document.querySelectorAll('#search_resultsRows a.search_result_row').length;
            if (newGamesCount === gamesOnPage.length && !foundNewUnprocessedGames) {
                isScanning = false;
                stopBtn.innerHTML = ICON.play;
                stopBtn.title = 'Продолжить';
                titleText.innerText = `Сканирование завершено. Найдено: ${foundCount} | С русификатором: ${zogFoundCount}`;
                subtitleText.innerText = `Достигнут конец списка Steam. Ошибок: ${errorCount}`;
                break;
            }
        }
    }

    function createLaunchButton() {
        const button = document.createElement('button');
        button.className = 'no-ru-fab';
        button.title = 'Глобальный поиск (Без RU + ZOG)';
        button.innerHTML = ICON.search;
        button.onclick = () => startScanning(true);
        document.body.appendChild(button);
    }

    function registerHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && (e.key === 'F' || e.key === 'А' || e.key === 'f' || e.key === 'а')) {
                e.preventDefault();
                e.stopPropagation();
                startScanning(true);
            }
        }, true);
    }

    // ===================== TURBOLINKS / SPA НАВИГАЦИЯ =====================

    let currentUrl = location.href;

    function isSearchPage() {
        return /^https:\/\/store\.steampowered\.com\/search/.test(location.href);
    }

    function handleNavigation() {
        if (location.href === currentUrl) return;
        const wasSearchPage = isSearchPage.call(null, currentUrl);
        currentUrl = location.href;

        if (isSearchPage()) {
            // На странице поиска — убедиться что UI на месте
            isScanning = false;
            processedAppIds.clear();
            foundCount = 0;
            errorCount = 0;
            zogFoundCount = 0;

            // Сбросить фильтры
            Object.keys(filters).forEach(key => { filters[key] = true; });

            if (!document.getElementById('no-ru-modal-overlay')) {
                createModalUI();
            }
            if (!document.querySelector('.no-ru-fab')) {
                createLaunchButton();
            }
        } else {
            // Ушли со страницы поиска — убрать FAB
            const fab = document.querySelector('.no-ru-fab');
            if (fab) fab.remove();
        }
    }

    function patchHistoryMethod(method) {
        const original = history[method];
        history[method] = function() {
            original.apply(this, arguments);
            handleNavigation();
        };
    }

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', handleNavigation);

    // Fallback: отслеживание навигации через MutationObserver на контейнере поиска
    function watchForSpaNavigation() {
        const checkInterval = setInterval(() => {
            if (location.href !== currentUrl) {
                handleNavigation();
            }
        }, 1000);
    }

    // ===================== ИНИЦИАЛИЗАЦИЯ =====================

    function init() {
        if (!isSearchPage()) return;
        createModalUI();
        createLaunchButton();
        registerHotkeys();
        watchForSpaNavigation();
    }

    // Turbolinks-совместимая инициализация
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // На случай если Turbolinks/Turbo подменяет body
    document.addEventListener('turbolinks:load', init);
    document.addEventListener('turbo:load', init);
    document.addEventListener('pjax:end', init);

})();
