// Используем только BX24.ready, как в рабочем примере.
BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

    // --- Элементы DOM ---
    const dashboardContainer = document.getElementById('dashboard-container');
    const loaderOverlay = document.getElementById('loader-overlay');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');

    // --- Главная проверка ---
    // Если ключевого элемента нет на странице, дальнейшее выполнение бессмысленно.
    if (!dashboardContainer) {
        console.error("Критическая ошибка: Элемент #dashboard-container не найден. Убедитесь, что загружен правильный HTML. Скрипт остановлен.");
        return;
    }

    console.log("Success: All required DOM elements are found. Starting statistics app...");

    // --- Глобальные переменные ---
    let sortedStatuses = [];

    // --- Вспомогательные функции ---
    const showLoader = () => { if (loaderOverlay) loaderOverlay.style.display = 'flex'; };
    const hideLoader = () => { if (loaderOverlay) loaderOverlay.style.display = 'none'; };

    // --- Инициализация ---
    function initialize() {
        // Безопасно инициализируем календари
        if (startDateInput) {
            flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        }
        if (endDateInput) {
            flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        }
        
        // ГЛАВНОЕ ИСПРАВЛЕНИЕ: Безопасно добавляем обработчик событий
        if (applyFilterBtn) {
            applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);
        } else {
            // Эта ошибка не должна появиться, если HTML корректен, но это хорошая страховка.
            console.error("Элемент #apply-filter-btn не найден. Кнопка 'Применить' не будет работать.");
        }
        
        fetchInitialData();
    }

    // --- Загрузка данных ---
    async function fetchInitialData() {
        showLoader();
        try {
            const response = await fetch('/api/initial_data');
            if (!response.ok) throw new Error('Failed to load initial data');
            const data = await response.json();

            if (data.sources && sourceFilter) {
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
            if (dashboardContainer) dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для фильтров.</p>`;
        } finally {
            hideLoader();
        }
    }

    async function fetchLeadsAndRenderDashboard() {
        showLoader();
        // Проверяем наличие полей перед использованием их значений
        const queryParams = new URLSearchParams({
            startDate: startDateInput ? startDateInput.value : '',
            endDate: endDateInput ? endDateInput.value : '',
            source: sourceFilter ? sourceFilter.value : ''
        });

        try {
            const response = await fetch(`/api/leads?${queryParams}`);
            if (!response.ok) throw new Error('Failed to load leads');
            const leads = await response.json();
            renderDashboard(leads);
        } catch (error) {
            console.error("Error fetching leads:", error);
            if (dashboardContainer) dashboardContainer.innerHTML = `<p>Ошибка загрузки лидов.</p>`;
        } finally {
            hideLoader();
        }
    }

    // --- Отрисовка дашборда ---
    function renderDashboard(leads) {
        if (!dashboardContainer) return;
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

    // --- Запуск приложения ---
    initialize();
});
