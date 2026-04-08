// Эта функция-обертка гарантирует, что код не выполнится, пока вся страница не будет готова.
document.addEventListener('DOMContentLoaded', () => {
    BX24.ready(() => {
        console.log("BX24 is ready. Application logic starts.");

        // --- Элементы DOM ---
        const dashboardContainer = document.getElementById('dashboard-container');
        const loaderOverlay = document.getElementById('loader-overlay');
        const startDateInput = document.getElementById('startDate');
        const endDateInput = document.getElementById('endDate');
        const sourceFilter = document.getElementById('sourceFilter');
        const applyFilterBtn = document.getElementById('apply-filter-btn');

        // --- Централизованная проверка всех важных элементов ---
        const requiredElements = {
            dashboardContainer,
            loaderOverlay,
            startDateInput,
            endDateInput,
            sourceFilter,
            applyFilterBtn
        };

        for (const name in requiredElements) {
            if (!requiredElements[name]) {
                const errorMessage = `Критическая ошибка: Элемент DOM '${name}' не найден. Работа скрипта прекращена.`;
                console.error(errorMessage);
                // Показываем ошибку пользователю, так как приложение не может работать.
                const body = document.querySelector('body');
                if (body) {
                    body.innerHTML = `<div style="padding: 20px; text-align: center; font-family: sans-serif; color: #a00; background-color: #fee;">
                                        <h1>Ошибка инициализации приложения</h1>
                                        <p>${errorMessage}</p>
                                        <p>Убедитесь, что приложение установлено корректно и все файлы на месте.</p>
                                     </div>`;
                }
                return; // Прекращаем выполнение скрипта
            }
        }

        // Если мы дошли до сюда, все элементы на месте.
        console.log("Success: All required DOM elements are found. Starting statistics app...");

        // --- Глобальные переменные ---
        let sortedStatuses = [];

        // --- Вспомогательные функции ---
        const showLoader = () => loaderOverlay.style.display = 'flex';
        const hideLoader = () => loaderOverlay.style.display = 'none';

        // --- Инициализация ---
        function initialize() {
            flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
            flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
            applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);
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
                const response = await fetch(`/api/leads?${queryParams}`);
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
});
