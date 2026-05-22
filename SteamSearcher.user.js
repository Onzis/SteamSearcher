// ==UserScript==
// @name            SteamSearcher
// @description     Собирает игры без RU языка на странице поиска Steam и отображает их в удобной модалке. Проверяет наличие русификаторов на ZoneOfGames.ru. Быстрый способ найти все игры без русского языка в вашем регионе и узнать, есть ли для них фанатские переводы.
// @namespace       https://github.com/Onzis/
// @author          Onzis
// @license         GPL-3.0 license
// @version         3.5.9
// @homepageURL     https://github.com/Onzis/SteamSearcher
// @updateURL       https://github.com/Onzis/SteamSearcher/raw/refs/heads/main/SteamSearcher.user.js
// @downloadURL     https://github.com/Onzis/SteamSearcher/raw/refs/heads/main/SteamSearcher.user.js
// @grant           GM_xmlhttpRequest
// @connect         store.steampowered.com
// @connect         api.steampowered.com
// @connect         zoneofgames.ru
// @connect         protondb.com
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

    // Ключ для хранения фильтров в localStorage
    const FILTERS_STORAGE_KEY = 'steamsearcher_filters';

    // Состояние фильтров (true = показывать, false = скрывать)
    const filters = {
        found: true,
        no_translations: true,
        not_found: true,
        error: true,
        checking: true
    };

    // Загрузить сохранённые фильтры из localStorage
    function loadFilters() {
        try {
            const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(filters).forEach(key => {
                    if (parsed.hasOwnProperty(key) && typeof parsed[key] === 'boolean') {
                        filters[key] = parsed[key];
                    }
                });
            }
        } catch (e) {
            console.warn('SteamSearcher: Ошибка загрузки фильтров:', e);
        }
    }

    // Сохранить текущие фильтры в localStorage
    function saveFilters() {
        try {
            localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
        } catch (e) {
            console.warn('SteamSearcher: Ошибка сохранения фильтров:', e);
        }
    }

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
        thumbsup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>',
        shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
        doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v7h7v9H6z"/></svg>',
        trophy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>',
        cog: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
        chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/></svg>',
        protondb: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/><path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/></svg>',
        star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
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
                const result = { status: 'not_found', localizations: [], url: null };
                return result;
            }

            const matches = findPossibleMatches(searchName, allGames);
            if (matches.length === 0) {
                const result = { status: 'not_found', localizations: [], url: null };
                return result;
            }

            const bestMatch = matches[0];
            console.log(`ZOG: Лучшее совпадение: "${bestMatch.item.title}" (${bestMatch.percentage}%) -> ${bestMatch.item.path}`);

            const locData = await fetchLocalizations(bestMatch.item.path);

            if (!locData) {
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

    // ===================== PROTONDB =====================

    const PROTONDB_TIERS = {
        'platinum': { label: 'Платина', color: '#b4c7dc', bg: '#4a5a6e', border: '#7a8fa3' },
        'gold':     { label: 'Золото',   color: '#ffd700', bg: '#6e5a1a', border: '#a8892a' },
        'silver':   { label: 'Серебро',  color: '#c0c0c0', bg: '#4a4a4a', border: '#808080' },
        'bronze':   { label: 'Бронза',   color: '#cd7f32', bg: '#5a3a1a', border: '#8a5a2a' },
        'borked':   { label: 'Сломано',  color: '#ff4444', bg: '#5a1a1a', border: '#8a2a2a' },
        'pending':  { label: 'Ожидание', color: '#999999', bg: '#333333', border: '#555555' },
    };

    async function fetchProtonDBRating(appId) {
        const cacheKey = `protondb_v1_${appId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached !== null) {
            try { return JSON.parse(cached); } catch (e) { localStorage.removeItem(cacheKey); }
        }

        try {
            const url = `https://www.protondb.com/api/v1/reports/summaries/${appId}.json`;
            const response = await new Promise((resolve, reject) => GM_xmlhttpRequest({
                method: 'GET', url, onload: resolve, onerror: reject, ontimeout: reject
            }));
            if (response.status === 200) {
                const data = JSON.parse(response.responseText);
                if (data && data.tier) {
                    const result = { tier: data.tier.toLowerCase() };
                    localStorage.setItem(cacheKey, JSON.stringify(result));
                    return result;
                }
            }
        } catch (e) {
            console.error(`ProtonDB: Ошибка получения рейтинга ${appId}:`, e);
        }
        return null;
    }

    function updateProtonDBBadge(appId, protonData) {
        const badges = document.querySelectorAll(`.ss-protondb-badge[data-app-id="${appId}"]`);
        badges.forEach(badge => {
            if (!protonData || !PROTONDB_TIERS[protonData.tier]) {
                badge.innerHTML = ICON.protondb + ' N/A';
                badge.style.background = '#333333';
                badge.style.borderColor = '#555555';
                badge.style.color = '#999999';
                return;
            }
            const tier = PROTONDB_TIERS[protonData.tier];
            badge.innerHTML = ICON.protondb + ' ' + tier.label;
            badge.style.background = tier.bg;
            badge.style.borderColor = tier.border;
            badge.style.color = tier.color;
        });
    }

    // ===================== ОБЗОРЫ STEAM =====================

    async function fetchReviewSummary(appId) {
        const cacheKey = `review_v1_${appId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached !== null) {
            try { return JSON.parse(cached); } catch (e) { localStorage.removeItem(cacheKey); }
        }

        try {
            const url = `https://store.steampowered.com/appreviews/${appId}?json=1&num_per_page=0&purchase_type=all&language=all`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            if (data && data.query_summary && data.query_summary.total_reviews > 0) {
                const result = {
                    score: data.query_summary.review_score || 0,
                    desc: data.query_summary.review_score_desc || '',
                    positive: data.query_summary.total_positive || 0,
                    negative: data.query_summary.total_negative || 0,
                    total: data.query_summary.total_reviews || 0
                };
                localStorage.setItem(cacheKey, JSON.stringify(result));
                return result;
            }
        } catch (e) {
            console.error(`Ошибка получения обзоров ${appId}:`, e);
        }
        return null;
    }

    function updateReviewBadge(appId, reviewData) {
        const badges = document.querySelectorAll(`.ss-review-badge[data-app-id="${appId}"]`);
        badges.forEach(badge => {
            if (!reviewData) {
                badge.innerHTML = 'Нет обзоров';
                badge.classList.add('no-reviews');
                return;
            }

            const pct = reviewData.total > 0 ? Math.round((reviewData.positive / reviewData.total) * 100) : 0;
            badge.innerHTML = `<span class="ss-review-icon">${ICON.thumbsup}</span> ${reviewData.desc} (${pct}% из ${reviewData.total.toLocaleString()})`;

            const score = reviewData.score;
            if (score >= 8) badge.classList.add('overwhelmingly-positive');
            else if (score === 7) badge.classList.add('very-positive');
            else if (score === 6) badge.classList.add('positive');
            else if (score === 5) badge.classList.add('mostly-positive');
            else if (score === 4) badge.classList.add('mixed');
            else if (score === 3) badge.classList.add('mostly-negative');
            else if (score === 2) badge.classList.add('negative');
            else if (score === 1) badge.classList.add('very-negative');
            else badge.classList.add('mixed');
        });
    }

    // ===================== ОСНОВНОЙ КОД =====================

    function injectStyles() {
        if (document.getElementById('no-ru-styles')) return;
        const style = document.createElement('style');
        style.id = 'no-ru-styles';
        style.innerHTML = `
            /* === Scrollbar === */
            #no-ru-modal-content::-webkit-scrollbar { width: 10px !important; }
            #no-ru-modal-content::-webkit-scrollbar-track { background: #1a1a1a !important; border-radius: 0 0 8px 0 !important; }
            #no-ru-modal-content::-webkit-scrollbar-thumb { background: #3d3d3d !important; border-radius: 5px !important; }
            #no-ru-modal-content::-webkit-scrollbar-thumb:hover { background: #4a4a4a !important; }
            body.no-ru-modal-open { overflow: hidden !important; }

            /* === Control Buttons === */
            .no-ru-btn { border: none; color: #b0b0b0; width: 38px; height: 38px; border-radius: 6px;
                background: #333333; cursor: pointer; transition: all 0.15s;
                display: flex; align-items: center; justify-content: center; }
            .no-ru-btn:hover { background: #444444; color: #fff; }
            .no-ru-btn:active { transform: scale(0.92); }

            /* === FAB === */
            .ss-fab {
                position: fixed; bottom: 28px; left: 28px; z-index: 9998;
                width: 50px; height: 50px; border-radius: 50%; border: none;
                background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
                color: #ffffff; cursor: pointer;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 2px #333333;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s ease;
            }
            .ss-fab:hover {
                transform: scale(1.1);
                box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 20px rgba(255,255,255,0.1), 0 0 0 2px #444444;
                color: #fff;
            }
            .ss-fab:active { transform: scale(0.95); }

            /* === Game Card === */
            .no-ru-game-card {
                display: flex; flex-direction: column;
                background: linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%);
                border: 2px solid #333333;
                border-radius: 12px;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                overflow: hidden; color: #ffffff; position: relative;
                box-shadow: 0 10px 30px rgba(0,0,0,0.25);
            }
            .no-ru-game-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 14px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1);
                border-color: #444444;
            }
            .no-ru-game-card:hover .no-ru-card-img img { transform: scale(1.05); }

            /* Card Image */
            .no-ru-card-img { position: relative; overflow: hidden; }
            .no-ru-card-img::after {
                content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 60px;
                background: linear-gradient(to top, #2a2a2a, transparent); z-index: 1; pointer-events: none;
            }
            .no-ru-card-img img {
                width: 100%; aspect-ratio: 16/7; object-fit: cover; display: block;
                transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                background: #1a1a1a;
            }

            /* Review Badge Overlay */
            .ss-review-badge {
                position: absolute; bottom: 8px; left: 8px; z-index: 2;
                display: inline-flex; align-items: center; gap: 6px;
                font-size: 13px; padding: 6px 12px; border-radius: 6px;
                font-weight: bold; white-space: nowrap;
                backdrop-filter: blur(8px);
                text-shadow: 0 1px 3px rgba(0,0,0,0.9);
                box-shadow: 0 2px 12px rgba(0,0,0,0.7);
                pointer-events: none; letter-spacing: 0.2px;
                border: 1px solid rgba(255,255,255,0.12);
            }
            .ss-review-icon { display: inline-flex; align-items: center; }
            .ss-review-badge.overwhelmingly-positive { background: rgba(27, 94, 32, 0.95); color: #fff; border-color: rgba(76, 175, 80, 0.8); }
            .ss-review-badge.very-positive { background: rgba(46, 125, 50, 0.95); color: #fff; border-color: rgba(102, 187, 106, 0.8); }
            .ss-review-badge.positive { background: rgba(56, 142, 60, 0.93); color: #fff; border-color: rgba(129, 199, 132, 0.7); }
            .ss-review-badge.mostly-positive { background: rgba(67, 160, 71, 0.9); color: #fff; border-color: rgba(165, 214, 167, 0.6); }
            .ss-review-badge.mixed { background: rgba(130, 100, 0, 0.93); color: #fff; border-color: rgba(255, 193, 7, 0.7); }
            .ss-review-badge.mostly-negative { background: rgba(160, 90, 0, 0.93); color: #fff; border-color: rgba(255, 152, 0, 0.7); }
            .ss-review-badge.negative { background: rgba(160, 30, 30, 0.93); color: #fff; border-color: rgba(244, 67, 54, 0.7); }
            .ss-review-badge.very-negative { background: rgba(130, 20, 20, 0.95); color: #fff; border-color: rgba(211, 47, 47, 0.8); }
            .ss-review-badge.no-reviews { background: rgba(0, 0, 0, 0.85); color: #b0b0b0; border-color: rgba(158, 158, 158, 0.4); }

            /* Card Body */
            .no-ru-card-body {
                padding: 16px; display: flex; flex-direction: column; flex: 1; gap: 10px;
            }

            /* Game Title */
            .no-ru-card-title { text-decoration: none; color: #ffffff; transition: color 0.15s; display: block; }
            .no-ru-card-title:hover { color: #e0e0e0; }
            .no-ru-card-title-text {
                font-weight: 700; font-size: 20px; line-height: 1.3;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
                font-family: Arial, sans-serif;
            }

            /* Button Row */
            .no-ru-card-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
            .no-ru-btn-price {
                background: #27ae60; color: #ffffff; border: 1px solid #219150;
                border-radius: 6px; padding: 8px 14px; font-size: 14px; font-weight: bold;
                cursor: pointer; transition: all 0.15s; text-decoration: none;
                display: inline-flex; align-items: center; font-family: Arial, sans-serif;
            }
            .no-ru-btn-price:hover { background: #219a52; color: #ffffff; }
            .no-ru-btn-secondary {
                background: #34495e; color: #ffffff; border: 1px solid #2c3e50;
                border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: bold;
                cursor: pointer; transition: all 0.15s; text-decoration: none;
                display: inline-flex; align-items: center; gap: 5px;
                font-family: Arial, sans-serif;
            }
            .no-ru-btn-secondary:hover { background: #3d566e; filter: brightness(1.1); }
            .no-ru-btn-secondary svg { flex-shrink: 0; }

            /* ProtonDB Badge */
            .ss-protondb-badge {
                background: #333333; color: #999999; border: 1px solid #555555;
                border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: bold;
                cursor: pointer; transition: all 0.15s; text-decoration: none;
                display: inline-flex; align-items: center; gap: 5px;
                font-family: Arial, sans-serif;
            }
            .ss-protondb-badge:hover { filter: brightness(1.2); }
            .ss-protondb-badge svg { flex-shrink: 0; }

            /* Info Section */
            .no-ru-card-info {
                display: flex; flex-direction: column; gap: 8px;
                padding: 12px 0 0; border-top: 1px solid #333333;
            }
            .no-ru-info-row {
                display: flex; align-items: flex-start; gap: 8px;
                font-size: 13px; color: #ffffff; line-height: 1.5;
            }
            .no-ru-info-row svg { flex-shrink: 0; margin-top: 1px; }
            .no-ru-info-icon-green { color: #27ae60; }
            .no-ru-info-icon-blue { color: #3498db; }
            .no-ru-info-label { color: #b0b0b0; }
            .no-ru-info-value { color: #ffffff; }
            .no-ru-info-link { color: #3498db; text-decoration: none; transition: color 0.15s; }
            .no-ru-info-link:hover { color: #5dade2; text-decoration: underline; }

            /* Loc List */
            .zog-loc-list { margin-top: 6px; padding-left: 0; list-style: none; }
            .zog-loc-list li { font-size: 12px; color: #ffffff; margin-bottom: 5px; line-height: 1.4; display: flex; align-items: flex-start; gap: 6px; }
            .zog-loc-list li svg { flex-shrink: 0; margin-top: 1px; color: #3498db; }
            .zog-loc-list a { color: #3498db; text-decoration: none; transition: color 0.15s; }
            .zog-loc-list a:hover { color: #5dade2; text-decoration: underline; }

            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

            /* === Body Wrapper: Sidebar + Content === */
            .no-ru-body-wrapper { display: flex; flex: 1; min-height: 0; overflow: hidden; }

            /* === Sidebar === */
            .no-ru-sidebar {
                width: 14%; min-width: 180px; flex-shrink: 0;
                background: #1a1a1a; border-right: 1px solid #333333;
                display: flex; flex-direction: column; overflow-y: auto;
                scrollbar-width: thin; scrollbar-color: #3d3d3d #1a1a1a;
            }
            .no-ru-sidebar-header {
                padding: 16px 16px 12px; color: #ffffff; font-size: 14px; font-weight: bold;
                text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #333333;
            }
            .no-ru-filter-item {
                display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer;
                transition: background 0.15s; user-select: none;
            }
            .no-ru-filter-item:hover { background: rgba(255,255,255,0.05); }
            .no-ru-filter-item.disabled { opacity: 0.4; }
            .no-ru-filter-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 2px solid; }
            .no-ru-filter-dot.found { background: rgba(39, 174, 96, 0.6); border-color: #27ae60; }
            .no-ru-filter-dot.no-translations { background: rgba(255, 152, 0, 0.6); border-color: #FF9800; }
            .no-ru-filter-dot.not-found { background: rgba(158, 158, 158, 0.6); border-color: #9e9e9e; }
            .no-ru-filter-dot.error { background: rgba(244, 67, 54, 0.6); border-color: #f44336; }
            .no-ru-filter-dot.checking { background: rgba(102, 192, 244, 0.6); border-color: #66c0f4; }
            .no-ru-filter-dot.off { background: transparent !important; }
            .no-ru-filter-label { flex: 1; color: #ffffff; font-size: 12px; line-height: 1.3; }
            .no-ru-filter-count { color: #b0b0b0; font-size: 11px; font-weight: bold; min-width: 20px; text-align: right; }
            .no-ru-filter-toggle {
                width: 32px; height: 18px; border-radius: 9px; background: #3d3d3d;
                position: relative; transition: background 0.2s; flex-shrink: 0;
            }
            .no-ru-filter-toggle.on { background: #27ae60; }
            .no-ru-filter-toggle::after {
                content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
                border-radius: 50%; background: #fff; transition: transform 0.2s;
            }
            .no-ru-filter-toggle.on::after { transform: translateX(14px); }
            .no-ru-sidebar-divider { height: 1px; background: #333333; margin: 8px 16px; }
            .no-ru-sidebar-stats { padding: 12px 16px; color: #b0b0b0; font-size: 11px; line-height: 1.6; }
            .no-ru-sidebar-stats span { color: #ffffff; font-weight: bold; }

            .no-ru-hidden-card { display: none !important; }
            .no-ru-card-loc-link { font-size: 12px; color: #3498db; text-decoration: none; margin-top: 4px; display: inline-block; transition: color 0.15s; }
            .no-ru-card-loc-link:hover { color: #5dade2; text-decoration: underline; }
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
            background: rgba(0, 0, 0, 0.9); z-index: 99999; display: none;
            justify-content: center; align-items: center; font-family: Arial, sans-serif;
        `;

        overlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            const contentBlock = document.getElementById('no-ru-modal-content');
            if (contentBlock) {
                contentBlock.scrollTop += e.deltaY;
            }
        }, { passive: false });

        const modal = document.createElement('div');
        modal.style.cssText = `
            width: 100%; max-width: 100%; height: 100%; background: #1a1a1a;
            border-radius: 0; box-shadow: 0 0 30px rgba(0,0,0,0.8);
            display: flex; flex-direction: column; overflow: hidden; border: 1px solid #333333;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            background: linear-gradient(90deg, #222222 0%, #1a1a1a 100%);
            padding: 15px 20px; display: flex;
            justify-content: space-between; align-items: center;
            border-bottom: 1px solid #333333; flex-shrink: 0;
        `;

        const titleContainer = document.createElement('div');
        const title = document.createElement('h2');
        title.id = 'no-ru-modal-title';
        title.innerText = 'Подготовка к сканированию...';
        title.style.cssText = 'color: #ffffff; margin: 0; font-size: 18px; font-weight: bold;';

        const subtitle = document.createElement('div');
        subtitle.id = 'no-ru-modal-subtitle';
        subtitle.style.cssText = 'color: #b0b0b0; font-size: 13px; margin-top: 5px;';
        subtitle.innerText = 'Идет поиск...';

        titleContainer.appendChild(title);
        titleContainer.appendChild(subtitle);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.style.cssText = 'display: flex; gap: 8px;';

        // Кнопка Стоп/Продолжить
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

        // Body wrapper: sidebar + content
        const bodyWrapper = document.createElement('div');
        bodyWrapper.className = 'no-ru-body-wrapper';

        // ===== Sidebar with filters =====
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
                saveFilters();
                applyFilters();
            };

            sidebar.appendChild(item);
        });

        // Divider + stats
        const divider = document.createElement('div');
        divider.className = 'no-ru-sidebar-divider';
        sidebar.appendChild(divider);

        const stats = document.createElement('div');
        stats.className = 'no-ru-sidebar-stats';
        stats.id = 'no-ru-sidebar-stats';
        stats.innerHTML = 'Всего: <span id="stat-total">0</span><br>Показано: <span id="stat-visible">0</span><br>Скрыто: <span id="stat-hidden">0</span>';
        sidebar.appendChild(stats);

        // ===== Content area =====
        const content = document.createElement('div');
        content.id = 'no-ru-modal-content';
        content.style.cssText = `
            padding: 20px; overflow-y: scroll; flex: 1; min-height: 0;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            grid-auto-rows: max-content; gap: 20px; align-content: start; background: #111111;
            overscroll-behavior: contain;
            scrollbar-width: thin; scrollbar-color: #3d3d3d #1a1a1a; scrollbar-gutter: stable;
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
        gameItem.dataset.locStatus = 'checking';

        // Use higher quality image (616x353 for crisp display in cards)
        // Regex catches ALL capsule variants (capsule_sm_120, capsule_184x69, capsule_231x87, capsule_467x181, etc.)
        // Also handles header.jpg -> capsule_616x353.jpg
        const hqImg = gameData.img
            .replace(/capsule_\w+/g, 'capsule_616x353')
            .replace(/header\.jpg/g, 'capsule_616x353.jpg');

        // ===== Header Image =====
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'no-ru-card-img';

        const imgLink = document.createElement('a');
        imgLink.href = gameData.link;
        imgLink.target = '_blank';
        const img = document.createElement('img');
        img.src = hqImg;
        img.loading = 'lazy';
        img.onerror = function() {
            // Fallback: try medium quality, then original
            if (this.src.includes('capsule_616x353')) {
                this.src = this.src.replace('capsule_616x353', 'capsule_231x87');
            } else {
                this.src = gameData.img;
            }
        };
        imgLink.appendChild(img);
        imgWrapper.appendChild(imgLink);

        // Review badge overlay on image
        const reviewBadge = document.createElement('div');
        reviewBadge.className = 'ss-review-badge';
        reviewBadge.dataset.appId = gameData.appId;
        reviewBadge.innerHTML = '<span class="ss-review-icon">' + ICON.thumbsup + '</span> Загрузка...';
        imgWrapper.appendChild(reviewBadge);

        gameItem.appendChild(imgWrapper);

        // ===== Card Body =====
        const innerDiv = document.createElement('div');
        innerDiv.className = 'no-ru-card-body';

        // Game Title
        const nameLink = document.createElement('a');
        nameLink.href = gameData.link;
        nameLink.target = '_blank';
        nameLink.className = 'no-ru-card-title';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'no-ru-card-title-text';
        nameDiv.textContent = gameData.title;
        nameLink.appendChild(nameDiv);
        innerDiv.appendChild(nameLink);

        // Button Row: Price + Options + SteamDB
        const btnRow = document.createElement('div');
        btnRow.className = 'no-ru-card-buttons';

        // Price button
        const priceBtn = document.createElement('a');
        priceBtn.href = gameData.link;
        priceBtn.target = '_blank';
        priceBtn.className = 'no-ru-btn-price';
        priceBtn.textContent = gameData.price || 'N/A';
        btnRow.appendChild(priceBtn);

        // SteamDB button
        const steamdbBtn = document.createElement('a');
        steamdbBtn.href = `https://steamdb.info/app/${gameData.appId}/`;
        steamdbBtn.target = '_blank';
        steamdbBtn.className = 'no-ru-btn-secondary';
        steamdbBtn.innerHTML = ICON.chart + ' SteamDB';
        btnRow.appendChild(steamdbBtn);

        // ProtonDB badge
        const protondbBadge = document.createElement('a');
        protondbBadge.href = `https://www.protondb.com/app/${gameData.appId}`;
        protondbBadge.target = '_blank';
        protondbBadge.className = 'ss-protondb-badge';
        protondbBadge.dataset.appId = gameData.appId;
        protondbBadge.innerHTML = ICON.protondb + ' ...';
        btnRow.appendChild(protondbBadge);

        innerDiv.appendChild(btnRow);

        // Info Section
        const infoSection = document.createElement('div');
        infoSection.className = 'no-ru-card-info';

        // Localization row (shield icon)
        const locRow = document.createElement('div');
        locRow.className = 'no-ru-info-row';
        locRow.innerHTML = `<span class="no-ru-info-icon-green">${ICON.shield}</span> <span><span class="no-ru-info-label">Локализация:</span> <span class="no-ru-info-value" data-loc-text="${gameData.appId}">Проверка...</span></span>`;
        infoSection.appendChild(locRow);

        // ZOG loc container (list of localizations)
        const zogLocContainer = document.createElement('div');
        zogLocContainer.className = 'zog-loc-container';
        zogLocContainer.dataset.appId = gameData.appId;
        zogLocContainer.style.display = 'none';
        infoSection.appendChild(zogLocContainer);

        innerDiv.appendChild(infoSection);

        gameItem.appendChild(innerDiv);
        content.appendChild(gameItem);

        // Update filter counts
        updateFilterCounts();
    }

    // ===================== ФИЛЬТРЫ =====================

    function getLocStatusKey(card) {
        const status = card.dataset.locStatus;
        if (status && filters.hasOwnProperty(status)) return status;
        return null;
    }

    function updateFilterCounts() {
        const counts = { found: 0, no_translations: 0, not_found: 0, error: 0, checking: 0 };
        const allCards = document.querySelectorAll('.no-ru-game-card');
        allCards.forEach(card => {
            const key = card.dataset.locStatus;
            if (key && counts.hasOwnProperty(key)) counts[key]++;
        });

        Object.keys(counts).forEach(key => {
            const el = document.getElementById('filter-count-' + key);
            if (el) el.textContent = counts[key];
        });

        const total = allCards.length;
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
            const statusKey = card.dataset.locStatus;
            if (statusKey && filters.hasOwnProperty(statusKey) && !filters[statusKey]) {
                card.classList.add('no-ru-hidden-card');
            } else {
                card.classList.remove('no-ru-hidden-card');
            }
        });
        updateFilterCounts();
    }

    function updateZogBadge(appId, zogResult) {
        const locTexts = document.querySelectorAll(`[data-loc-text="${appId}"]`);
        const containers = document.querySelectorAll(`.zog-loc-container[data-app-id="${appId}"]`);

        // Update localization text based on ZOG result
        locTexts.forEach(el => {
            const card = el.closest('.no-ru-game-card');
            switch (zogResult.status) {
                case 'found':
                    el.textContent = 'Есть' + (zogResult.matchPercent ? ` (${zogResult.matchPercent}%)` : '');
                    el.style.color = '#27ae60';
                    if (card) card.dataset.locStatus = 'found';
                    zogFoundCount++;
                    break;
                case 'no_translations':
                    el.textContent = 'Нет русификатора' + (zogResult.matchPercent ? ` (${zogResult.matchPercent}%)` : '');
                    el.style.color = '#FF9800';
                    if (card) card.dataset.locStatus = 'no_translations';
                    break;
                case 'not_found':
                    el.textContent = 'Не найдена на ZOG';
                    el.style.color = '#9e9e9e';
                    if (card) card.dataset.locStatus = 'not_found';
                    break;
                case 'error':
                    el.textContent = 'Ошибка загрузки';
                    el.style.color = '#f44336';
                    if (card) card.dataset.locStatus = 'error';
                    break;
            }
        });

        containers.forEach(container => {
            if (zogResult.status === 'found' && zogResult.localizations && zogResult.localizations.length > 0) {
                container.style.display = 'block';
                const list = document.createElement('ul');
                list.className = 'zog-loc-list';
                const fileIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>';
                zogResult.localizations.forEach(loc => {
                    const li = document.createElement('li');
                    li.innerHTML = fileIcon;
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
                link.className = 'no-ru-card-loc-link';
                link.textContent = 'Открыть на ZoneOfGames';
                container.appendChild(link);
            }
        });

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

        const failedCards = document.querySelectorAll('.no-ru-game-card[data-loc-status="not_found"], .no-ru-game-card[data-loc-status="no_translations"], .no-ru-game-card[data-loc-status="error"]');
        if (failedCards.length === 0) {
            titleText.innerText = 'Нет игр для повторной проверки';
            subtitleText.innerText = 'Все игры уже проверены. Попробуйте полный перезапуск.';
            return;
        }

        isScanning = true;
        let rechecked = 0;
        let newFound = 0;

        titleText.innerText = `Повторная проверка ZOG: 0/${failedCards.length}`;
        subtitleText.innerText = 'Проверяем игры с ошибками и без русификатора...';

        for (const card of failedCards) {
            if (!isScanning) break;

            const appId = card.querySelector('[data-loc-text]')?.dataset.locText;
            if (!appId) continue;

            rechecked++;

            localStorage.removeItem(`zog_ru_v3_${appId}`);

            // Reset loc text
            const locText = card.querySelector(`[data-loc-text="${appId}"]`);
            if (locText) { locText.textContent = 'Проверка...'; locText.style.color = ''; }
            card.dataset.locStatus = 'checking';

            const container = card.querySelector(`.zog-loc-container[data-app-id="${appId}"]`);
            if (container) {
                container.innerHTML = '';
                container.style.display = 'none';
            }

            const nameEl = card.querySelector('.no-ru-card-title-text');
            const gameTitle = nameEl?.textContent || '';

            titleText.innerText = `Повторная проверка ZOG: ${rechecked}/${failedCards.length}`;
            subtitleText.innerText = `Проверяем: ${gameTitle || appId}`;

            const zogResult = await checkZogLocalizer(appId, gameTitle);
            updateZogBadge(appId, zogResult);
            if (zogResult.status === 'found') newFound++;

            titleText.innerText = `Повторная проверка: ${rechecked}/${failedCards.length} | Новых русификаторов: ${newFound}`;

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
            loadFilters();
            document.querySelectorAll('.no-ru-filter-toggle').forEach(t => {
                const key = t.dataset.filterKey;
                if (key && filters.hasOwnProperty(key)) t.classList.toggle('on', filters[key]);
            });
            document.querySelectorAll('.no-ru-filter-dot').forEach(d => {
                const key = d.dataset.filterKey;
                if (key && filters.hasOwnProperty(key)) d.classList.toggle('off', !filters[key]);
            });
            document.querySelectorAll('.no-ru-filter-item').forEach(i => {
                const key = i.dataset.filterKey;
                if (key && filters.hasOwnProperty(key)) i.classList.toggle('disabled', !filters[key]);
            });
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

                    subtitleText.innerText = `Проверяем игру ${processedAppIds.size}: обзоры...`;
                    const reviewData = await fetchReviewSummary(appId);
                    updateReviewBadge(appId, reviewData);

                    subtitleText.innerText = `Проверяем игру ${processedAppIds.size}: ProtonDB...`;
                    const protonData = await fetchProtonDBRating(appId);
                    updateProtonDBBadge(appId, protonData);

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
        button.className = 'ss-fab';
        button.title = 'SteamSearcher (Shift+F)';
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
            isScanning = false;
            processedAppIds.clear();
            foundCount = 0;
            errorCount = 0;
            zogFoundCount = 0;

            loadFilters();
            document.querySelectorAll('.no-ru-filter-toggle').forEach(t => {
                const key = t.dataset.filterKey;
                if (key && filters.hasOwnProperty(key)) t.classList.toggle('on', filters[key]);
            });
            document.querySelectorAll('.no-ru-filter-dot').forEach(d => {
                const key = d.dataset.filterKey;
                if (key && filters.hasOwnProperty(key)) d.classList.toggle('off', !filters[key]);
            });
            document.querySelectorAll('.no-ru-filter-item').forEach(i => {
                const key = i.dataset.filterKey;
                if (key && filters.hasOwnProperty(key)) i.classList.toggle('disabled', !filters[key]);
            });

            if (!document.getElementById('no-ru-modal-overlay')) {
                createModalUI();
            }
            if (!document.querySelector('.ss-fab')) {
                createLaunchButton();
            }
        } else {
            const fab = document.querySelector('.ss-fab');
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
        loadFilters();
        createModalUI();
        createLaunchButton();
        registerHotkeys();
        watchForSpaNavigation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    document.addEventListener('turbolinks:load', init);
    document.addEventListener('turbo:load', init);
    document.addEventListener('pjax:end', init);

})();
