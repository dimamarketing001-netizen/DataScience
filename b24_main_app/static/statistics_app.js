BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

    // --- ЛОГИКА ВКЛАДОК ---
    const tabs = document.querySelectorAll('.ui-tabs-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Убираем активность со всех вкладок и панелей
            tabs.forEach(t => t.classList.remove('ui-tabs-item-active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            // Добавляем активность нужной вкладке
            tab.classList.add('ui-tabs-item-active');
            const targetPaneId = tab.dataset.tabId;
            const targetPane = document.getElementById(targetPaneId);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });

    // --- ЛОГИКА СТАТИСТИКИ (остается без изменений) ---
    const dashboardContainer = document.getElementById('dashboard-container');
    const loaderOverlay = document.getElementById('loader-overlay');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');

    if (!dashboardContainer || !loaderOverlay || !startDateInput || !endDateInput || !sourceFilter || !applyFilterBtn) {
        console.error("Критическая ошибка: Один или несколько ключевых элементов для вкладки 'Статистика' не найдены.");
        // Не прерываем весь скрипт, чтобы вкладка "Касса" могла работать
    } else {
        initializeStatistics();
    }
    
    let sortedStatuses = [];
    const showLoader = () => loaderOverlay.style.display = 'flex';
    const hideLoader = () => loaderOverlay.style.display = 'none';

    function initializeStatistics() {
        console.log("Initializing Statistics Tab...");
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
