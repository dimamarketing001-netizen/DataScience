BX24.ready(function() {
    console.log("BX24 is ready. Lead statistics app starts.");

    // --- Элементы управления ---
    const loaderOverlay = document.getElementById('loader-overlay');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');
    const dashboardContainer = document.getElementById('dashboard-container');

    // --- Критическая проверка перед запуском ---
    if (!applyFilterBtn) {
        console.error("Critical Error: Button with ID 'apply-filter-btn' not found in the DOM. Please check if the correct HTML file is loaded.");
        alert("Критическая ошибка: не найден ключевой элемент управления. Проверьте консоль.");
        return; // Прекращаем выполнение, если кнопка не найдена
    }

    // --- Глобальные переменные ---
    let statuses = []; // Сохраняем статусы для использования при отрисовке

    // --- Вспомогательные функции ---
    const showLoader = () => loaderOverlay.style.display = 'flex';
    const hideLoader = () => loaderOverlay.style.display = 'none';

    // --- Инициализация ---
    function initialize() {
        // Инициализация календарей
        flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });

        // Добавление обработчика событий (теперь безопасно)
        applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);

        // Загрузка данных для фильтров и первая отрисовка
        fetchInitialData();
    }

    // --- Загрузка данных ---
    async function fetchInitialData() {
        showLoader();
        try {
            const response = await fetch('/api/initial_data');
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
                statuses = data.statuses;
            }

            fetchLeadsAndRenderDashboard();

        } catch (error) {
            console.error("Error fetching initial data:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки начальных данных. Попробуйте обновить страницу.</p>`;
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
            const response = await fetch(`/api/leads?${queryParams}`);
            if (!response.ok) throw new Error('Failed to load leads');

            const leads = await response.json();
            renderDashboard(leads);

        } catch (error) {
            console.error("Error fetching leads:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки лидов. Проверьте фильтры и попробуйте снова.</p>`;
        } finally {
            hideLoader();
        }
    }

    // --- Отрисовка дашборда ---
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

        statuses.forEach(status => {
            const count = statusCounts[status.STATUS_ID] || 0;
            const conversion = totalLeads > 0 ? ((count / totalLeads) * 100).toFixed(2) : 0;

            const card = document.createElement('div');
            card.className = 'status-card';
            card.innerHTML = `
                <h3>${status.NAME}</h3>
                <p>Количество: <span class="count">${count}</span></p>
                <p>Конверсия: <span class="conversion">${conversion}%</span></p>
            `;
            dashboardContainer.appendChild(card);
        });
    }

    // --- Запуск приложения ---
    initialize();
});
