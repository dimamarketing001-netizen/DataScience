BX24.ready(function() {
    console.log("BX24 is ready. Lead statistics app starts.");

    // --- Элементы DOM ---
    const loaderOverlay = document.getElementById('loader-overlay');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');
    const dashboardContainer = document.getElementById('dashboard-container');

    // --- Глобальные переменные для хранения данных ---
    let sortedStatuses = []; // Статусы, отсортированные как в CRM

    // --- Вспомогательные функции ---
    const showLoader = () => {
        if (loaderOverlay) loaderOverlay.style.display = 'flex';
    };
    const hideLoader = () => {
        if (loaderOverlay) loaderOverlay.style.display = 'none';
    };

    // --- Инициализация приложения ---
    function initialize() {
        // Проверяем наличие ключевых элементов
        if (!applyFilterBtn || !dashboardContainer) {
            console.error("Critical Error: Key UI elements not found. Check HTML structure.");
            alert("Критическая ошибка: отсутствует интерфейс. Проверьте HTML.");
            return;
        }

        // Инициализация календарей
        flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });

        // Навешиваем обработчик на кнопку
        applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);

        // Загружаем первоначальные данные (статусы, источники) и запускаем первый поиск
        fetchInitialData();
    }

    // --- Загрузка данных для фильтров ---
    async function fetchInitialData() {
        showLoader();
        try {
            const response = await fetch('/api/initial_data');
            if (!response.ok) throw new Error('Failed to load initial data');
            
            const data = await response.json();
            
            // Заполняем фильтр по источникам
            if (data.sources) {
                data.sources.forEach(source => {
                    const option = document.createElement('option');
                    option.value = source.STATUS_ID;
                    option.textContent = source.NAME;
                    sourceFilter.appendChild(option);
                });
            }

            // Сохраняем и сортируем статусы по полю SORT, как в CRM
            if (data.statuses) {
                sortedStatuses = data.statuses.sort((a, b) => parseInt(a.SORT) - parseInt(b.SORT));
            }

            // После успешной загрузки данных, запускаем первый поиск лидов
            await fetchLeadsAndRenderDashboard();

        } catch (error) {
            console.error("Error fetching initial data:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для фильтров. Попробуйте обновить страницу.</p>`;
        } finally {
            hideLoader();
        }
    }

    // --- Основная функция: получение лидов и отрисовка дашборда ---
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

    // --- Отрисовка дашборда с новой логикой конверсии ---
    function renderDashboard(leads) {
        dashboardContainer.innerHTML = ''; // Очищаем контейнер
        const totalLeads = leads.length;

        if (totalLeads === 0) {
            dashboardContainer.innerHTML = '<p>Лиды по заданным фильтрам не найдены.</p>';
            return;
        }

        // Считаем количество лидов в каждом статусе
        const statusCounts = leads.reduce((acc, lead) => {
            acc[lead.STATUS_ID] = (acc[lead.STATUS_ID] || 0) + 1;
            return acc;
        }, {});

        let previousStatusCount = totalLeads; // Для первого статуса конверсия считается от общего числа

        // Создаем карточки для каждого статуса в отсортированном порядке
        sortedStatuses.forEach(status => {
            const count = statusCounts[status.STATUS_ID] || 0;

            // Считаем конверсию из предыдущего статуса
            let conversionRate = 0;
            if (previousStatusCount > 0) {
                conversionRate = ((count / previousStatusCount) * 100).toFixed(1);
            }

            const card = document.createElement('div');
            card.className = 'status-card';

            // Добавляем стрелку конверсии, если это не первая карточка
            if (previousStatusCount !== totalLeads) {
                card.innerHTML += `<div class="conversion-arrow">↓ ${conversionRate}%</div>`;
            }

            card.innerHTML += `
                <h3>${status.NAME}</h3>
                <p>Количество лидов: <span class="count">${count}</span></p>
            `;
            dashboardContainer.appendChild(card);

            // Обновляем счетчик для следующего шага воронки, только если на текущем шаге были лиды
            if (count > 0) {
                previousStatusCount = count;
            }
        });
    }

    // --- Запуск приложения ---
    initialize();
});
