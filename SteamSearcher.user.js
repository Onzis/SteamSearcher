// ==UserScript==
// @name            SteamSearcher
// @description     Cобирает игры без RU языка на странице поиска Steam и отображает их в удобной модалке. Быстрый способ найти все игры без русского языка в вашем регионе. Просто откройте поиск Steam и запустите скрипт! Идеально для тех, кто хочет избежать игр с русским языком или ищет игры с определенными языковыми опциями. Сканирует все игры на странице, проверяет наличие русского языка и показывает только те, которые его не поддерживают. Быстро, просто и эффективно! 
// @namespace       https://github.com/Onzis/
// @author          Onzi
// @license         GPL-3.0 license
// @version         1.4.1
// @homepageURL     https://github.com/Onzis/SteamSearcher
// @updateURL       https://github.com/Onzis/SteamSearcher/raw/refs/heads/main/SteamSearcher.user.js
// @downloadURL     https://github.com/Onzis/SteamSearcher/raw/refs/heads/main/SteamSearcher.user.js
// @grant           GM.xmlHttpRequest
// @connect         store.steampowered.com
// @match           https://store.steampowered.com/search/*
// ==/UserScript==

(function() {
    'use strict';

    const DELAY_MS = 500;
    let isScanning = false;
    let processedAppIds = new Set(); 
    let foundCount = 0;
    let errorCount = 0;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Инъекция стилей для красивого скроллбара
    function injectStyles() {
        if (document.getElementById('no-ru-styles')) return;
        const style = document.createElement('style');
        style.id = 'no-ru-styles';
        style.innerHTML = `
            #no-ru-modal-content::-webkit-scrollbar { width: 10px; }
            #no-ru-modal-content::-webkit-scrollbar-track { background: #171a21; border-radius: 0 0 8px 0; }
            #no-ru-modal-content::-webkit-scrollbar-thumb { background: #3d4450; border-radius: 5px; }
            #no-ru-modal-content::-webkit-scrollbar-thumb:hover { background: #66c0f4; }
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

        // БЛОКИРОВКА СКРОЛЛА: Запрещаем крутить колесиком задний фон Steam
        overlay.addEventListener('wheel', (e) => {
            const contentBlock = document.getElementById('no-ru-modal-content');
            // Если мы крутим колесиком НЕ внутри блока с играми - блокируем действие
            if (contentBlock && !contentBlock.contains(e.target)) {
                e.preventDefault();
            }
        }, { passive: false });

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
        buttonsDiv.style.cssText = 'display: flex; gap: 10px;';

        const stopBtn = document.createElement('button');
        stopBtn.id = 'no-ru-stop-btn';
        stopBtn.innerText = '⏹ Остановить поиск';
        stopBtn.style.cssText = `
            background: #d95b43; border: none; color: white; padding: 8px 15px; border-radius: 4px;
            cursor: pointer; transition: 0.2s; font-weight: bold;
        `;
        stopBtn.onclick = () => {
            isScanning = false;
            stopBtn.style.display = 'none';
            title.innerText = `Поиск остановлен. Найдено игр: ${foundCount}`;
            subtitle.innerText = `Можно прокручивать список.`;
        };

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✖ Закрыть';
        closeBtn.style.cssText = `
            background: #2a475e; border: none; color: white; padding: 8px 15px; border-radius: 4px;
            cursor: pointer; transition: 0.2s; font-weight: bold;
        `;
        closeBtn.onclick = () => {
            isScanning = false;
            overlay.style.display = 'none';
        };

        buttonsDiv.appendChild(stopBtn);
        buttonsDiv.appendChild(closeBtn);
        
        header.appendChild(titleContainer);
        header.appendChild(buttonsDiv);

        const content = document.createElement('div');
        content.id = 'no-ru-modal-content';
        // БЛОКИРОВКА СКРОЛЛА: overscroll-behavior: contain не дает скроллу выйти за пределы этого блока
        content.style.cssText = `
            padding: 20px; overflow-y: auto; flex: 1; min-height: 0;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); 
            grid-auto-rows: max-content; gap: 20px; align-content: start; background: #171a21;
            overscroll-behavior: contain;
        `;

        modal.appendChild(header);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    function addGameToModal(gameData) {
        const content = document.getElementById('no-ru-modal-content');
        
        const gameItem = document.createElement('a');
        gameItem.href = gameData.link;
        gameItem.target = '_blank';
        gameItem.style.cssText = `
            display: flex; flex-direction: column; background: #202d39; border: 1px solid #3d4450;
            text-decoration: none; border-radius: 4px; transition: transform 0.2s, box-shadow 0.2s; 
            overflow: hidden; color: #c6d4df; cursor: pointer;
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

        gameItem.innerHTML = `
            <img src="${hqImg}" style="width: 100%; aspect-ratio: 16/7; object-fit: cover; border-bottom: 1px solid #171a21;">
            <div style="padding: 12px; display: flex; flex-direction: column; flex: 1;">
                <div style="font-weight: bold; font-size: 14px; margin-bottom: 15px; line-height: 1.3;">${gameData.title}</div>
                <div style="margin-top: auto; align-self: flex-start; font-size: 13px; color: #a3cc40; background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 3px;">
                    ${gameData.price || 'Не указана'}
                </div>
            </div>
        `;

        content.appendChild(gameItem);
    }

    async function startScanning() {
        if (isScanning) return;
        
        isScanning = true;
        processedAppIds.clear();
        foundCount = 0;
        errorCount = 0;

        const overlay = document.getElementById('no-ru-modal-overlay');
        const content = document.getElementById('no-ru-modal-content');
        const titleText = document.getElementById('no-ru-modal-title');
        const subtitleText = document.getElementById('no-ru-modal-subtitle');
        const stopBtn = document.getElementById('no-ru-stop-btn');
        
        content.innerHTML = '';
        overlay.style.display = 'flex';
        stopBtn.style.display = 'block';

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
                
                subtitleText.innerText = `Проверяем игру: ${processedAppIds.size} ...`;

                const hasRussian = await checkLanguage(appId);

                if (hasRussian === false) {
                    const titleMatch = gameRow.querySelector('.title');
                    const imgMatch = gameRow.querySelector('img');
                    
                    let priceText = '';
                    const discountPrice = gameRow.querySelector('.discount_final_price');
                    const normalPrice = gameRow.querySelector('.search_price:not(.transparent)');
                    const freePrice = gameRow.querySelector('.search_price.free');
                    
                    if (discountPrice) priceText = discountPrice.textContent;
                    else if (freePrice) priceText = 'Free';
                    else if (normalPrice) priceText = normalPrice.textContent;

                    addGameToModal({
                        title: titleMatch ? titleMatch.textContent : 'Неизвестно',
                        img: imgMatch ? imgMatch.src : '',
                        price: priceText.trim().replace(/\n/g, '').replace(/\s+/g, ' '),
                        link: gameRow.href
                    });
                    
                    foundCount++;
                    titleText.innerText = `Найдено игр: ${foundCount}`;
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
                stopBtn.style.display = 'none';
                titleText.innerText = `Сканирование завершено. Найдено: ${foundCount}`;
                subtitleText.innerText = `Достигнут конец списка Steam. Ошибок: ${errorCount}`;
                break;
            }
        }
    }

    function createLaunchButton() {
        const button = document.createElement('button');
        button.innerText = 'Глобальный поиск (Без RU)';
        button.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 9998;
            padding: 15px 25px; background-color: #66c0f4; color: #171a21;
            border: none; border-radius: 8px; font-weight: bold; font-size: 15px;
            cursor: pointer; box-shadow: 0 5px 15px rgba(0,0,0,0.6); transition: 0.2s;
        `;

        button.onmouseover = () => {
            button.style.backgroundColor = '#4192c0';
            button.style.transform = 'scale(1.05)';
        }
        button.onmouseout = () => {
            button.style.backgroundColor = '#66c0f4';
            button.style.transform = 'scale(1)';
        }
        button.onclick = startScanning;

        document.body.appendChild(button);
    }

    createModalUI();
    createLaunchButton();

})();