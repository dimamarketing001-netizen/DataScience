// Модуль для управления вкладкой "Статистика"
App.initializeStatistics = async function() {
    console.log("Initializing Statistics module...");

    // --- Переменные модуля ---
    let sortedStatuses = [];

    // --- Элементы UI ---
    const dashboardContainer = document.getElementById('dashboard-container');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');

    if (!dashboardContainer || !startDateInput || !endDateInput || !sourceFilter || !applyFilterBtn) {
        console.error("Ошибка инициализации: один из элементов экрана статистики не найден.");
        return;
    }

    // --- Инициализация ---
    flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
    flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
    applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);
    
    await fetchInitialDataForStatistics();

    // --- Функции модуля ---
    async function fetchInitialDataForStatistics() {
        App.showLoader();
        try {
            // Предполагается, что этот эндпоинт будет создан в api_statistics.py
            const response = await fetch(`?action=initial_data_for_stats`); 
            if (!response.ok) throw new Error('Failed to load initial data for statistics');
            const data = await response.json();

            if (data.sources) {
                sourceFilter.innerHTML = '<option value="">Все источники</option>';
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
            console.error("Error fetching initial data for statistics:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для статистики: ${error.message}</p>`;
        } finally {
            App.hideLoader();
        }
    }

    async function fetchLeadsAndRenderDashboard() {
        App.showLoader();
        const queryParams = new URLSearchParams({
            action: 'leads', // Предполагается, что этот эндпоинт будет создан в api_statistics.py
            startDate: startDateInput.value,
            endDate: endDateInput.value,
            source: sourceFilter.value
        });

        try {
            const response = await fetch(`?${queryParams}`);
            if (!response.ok) throw new Error('Failed to load leads');
            const leads = await response.json();
            renderDashboard(leads);
        } catch (error) {
            console.error("Error fetching leads:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки лидов: ${error.message}</p>`;
        } finally {
            App.hideLoader();
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
            if (previousStatusCount > 0 && previousStatusCount !== totalLeads) {
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
};
