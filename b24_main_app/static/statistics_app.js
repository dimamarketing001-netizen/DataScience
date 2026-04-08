BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

    // --- ЛОГИКА НАВИГАЦИИ МЕЖДУ ЭКРАНАМИ ---
    const screens = document.querySelectorAll('.app-screen');
    const mainMenu = document.getElementById('main-menu');
    const cashboxScreen = document.getElementById('cashbox-screen');
    const statisticsScreen = document.getElementById('statistics-screen');
    
    const gotoCashboxBtn = document.getElementById('goto-cashbox');
    const gotoStatisticsBtn = document.getElementById('goto-statistics');
    const backButtons = document.querySelectorAll('.back-button');

    const showScreen = (screenToShow) => {
        screens.forEach(screen => {
            screen.classList.remove('active');
        });
        screenToShow.classList.add('active');
    };

    gotoCashboxBtn.addEventListener('click', () => showScreen(cashboxScreen));
    gotoStatisticsBtn.addEventListener('click', () => showScreen(statisticsScreen));
    backButtons.forEach(button => {
        button.addEventListener('click', () => showScreen(mainMenu));
    });

    // --- ОБЩИЕ ЭЛЕМЕНТЫ И ФУНКЦИИ ---
    const loaderOverlay = document.getElementById('loader-overlay');
    const showLoader = () => { if (loaderOverlay) loaderOverlay.style.display = 'flex'; };
    const hideLoader = () => { if (loaderOverlay) loaderOverlay.style.display = 'none'; };

    // --- ЛОГИКА СТАТИСТИКИ (остается без изменений) ---
    const dashboardContainer = document.getElementById('dashboard-container');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');
    
    let sortedStatuses = [];
    let statisticsInitialized = false; // Флаг, чтобы инициализировать статистику только один раз

    // Запускаем логику статистики, только когда пользователь переходит на этот экран
    gotoStatisticsBtn.addEventListener('click', () => {
        if (!statisticsInitialized) {
            initializeStatistics();
            statisticsInitialized = true;
        }
    });
    
    function initializeStatistics() {
        console.log("Initializing Statistics Screen...");
        if (!dashboardContainer || !startDateInput || !endDateInput || !sourceFilter || !applyFilterBtn) {
            console.error("Ошибка инициализации: один из элементов экрана статистики не найден.");
            return;
        }
        flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);
        fetchInitialData();
    }

    async function fetchInitialData() {
        showLoader();
        try {
            const response = await fetch('api/initial_data');
            if (!response.ok) throw new Error('Failed to load initial data');
            const data = await response.json();

            if (data.sources) {
                data.sources.forEach(source => {
                    const option = document.createElement('option');
                    option.value = source.STATUS_ID;
                    option.textContent = source.NAME;
                    sourceFilter.appendChild(option);
                });
            }

            if (data.statuses) {
                sortedStatuses = data.statuses.sort((a, b) => parseInt(a.SORT) - parseInt(b.SORT));
            }

            await fetchLeadsAndRenderDashboard();
        } catch (error) {
            console.error("Error fetching initial data:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для фильтров.</p>`;
        } finally {
            hideLoader();
        }
    }

    async function fetchLeadsAndRenderDashboard() {
        showLoader();
        const queryParams = new URLSearchParams({
            startDate: startDateInput.value,
            endDate: endDateInput.value,
            source: sourceFilter.value
        });

        try {
            const response = await fetch(`api/leads?${queryParams}`);
            if (!response.ok) throw new Error('Failed to load leads');
            const leads = await response.json();
            renderDashboard(leads);
        } catch (error) {
            console.error("Error fetching leads:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки лидов.</p>`;
        } finally {
            hideLoader();
        }
    }

    function renderDashboard(leads) {
        dashboardContainer.innerHTML = '';
        const totalLeads = leads.length;

        if (totalLeads === 0) {
            dashboardContainer.innerHTML = '<p>Лиды по заданным фильтрам не найдены.</p>';
            return;
        }

        const statusCounts = leads.reduce((acc, lead) => {
            acc[lead.STATUS_ID] = (acc[lead.STATUS_ID] || 0) + 1;
            return acc;
        }, {});

        let previousStatusCount = totalLeads;

        sortedStatuses.forEach(status => {
            const count = statusCounts[status.STATUS_ID] || 0;
            let conversionRate = 0;
            if (previousStatusCount > 0) {
                conversionRate = ((count / previousStatusCount) * 100).toFixed(1);
            }

            const card = document.createElement('div');
            card.className = 'status-card';

            if (previousStatusCount !== totalLeads) {
                card.innerHTML += `<div class="conversion-arrow">↓ ${conversionRate}%</div>`;
            }

            card.innerHTML += `
                <h3>${status.NAME}</h3>
                <p>Количество лидов: <span class="count">${count}</span></p>
            `;
            dashboardContainer.appendChild(card);

            if (count > 0) {
                previousStatusCount = count;
            }
        });
    }
});
