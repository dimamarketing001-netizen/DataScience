// Модуль для управления вкладкой "Статистика"
App.initializeStatistics = async function () {
    console.log("Initializing Statistics Tab...");

    // --- Элементы UI ---
    const filterForm = document.getElementById('statistics-filter-form');
    const startDateInput = document.getElementById('stats-start-date');
    const endDateInput = document.getElementById('stats-end-date');
    const sourceFilterSelect = document.getElementById('stats-source-filter');
    const resetBtn = document.getElementById('stats-reset-btn');
    const tableHead = document.getElementById('statistics-table-head');
    const tableBody = document.getElementById('statistics-table-body');

    // --- Инициализация ---
    async function initialize() {
        App.showLoader();
        try {
            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", defaultDate: firstDayOfMonth });
            flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", defaultDate: today });

            const sources = await getLeadSources();
            App.populateSelect(sourceFilterSelect, sources, "Все источники");

            renderTableHead();
            await loadStatistics();
        } catch (error) {
            console.error("Error initializing statistics tab:", error);
            await App.Notify.error('Ошибка инициализации', `Не удалось загрузить начальные данные: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }
    
    async function getLeadSources() {
        return new Promise((resolve, reject) => {
            BX24.callMethod('crm.status.entity.items', { entityId: 'SOURCE' }, (result) => {
                if (result.error()) {
                    console.error("Failed to get lead sources:", result.error());
                    reject(new Error("Не удалось загрузить источники лидов"));
                } else {
                    const sources = result.data().map(item => ({
                        id: item.STATUS_ID,
                        name: item.NAME
                    }));
                    resolve(sources);
                }
            });
        });
    }

    // --- Загрузка данных ---
    async function loadStatistics() {
        App.showLoader();
        const params = {
            date_from: startDateInput.value,
            date_to: endDateInput.value,
            source_id: sourceFilterSelect.value
        };

        try {
            const data = await App.statistics.api.getStatistics(params);
            renderTableBody(data);
        } catch (error) {
            console.error("Failed to load statistics:", error);
            await App.Notify.error('Ошибка загрузки', `Не удалось получить данные статистики: ${error.message}`);
            tableBody.innerHTML = `<tr><td colspan="6">Ошибка загрузки данных.</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

    // --- Рендеринг таблицы ---
    function renderTableHead() {
        tableHead.innerHTML = `
            <tr>
                <th>Источник</th>
                <th>Лиды</th>
                <th>Дозвон</th>
                <th>Назначена встреча</th>
                <th>Приход</th>
                <th>Успех</th>
            </tr>
        `;
    }

    function renderTableBody(data) {
        tableBody.innerHTML = '';
        if (!data || data.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6">Нет данных за выбранный период.</td></tr>`;
            return;
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            if (row.source_name === "Итого") {
                tr.classList.add('summary-row');
            }
            tr.innerHTML = `
                <td>${row.source_name}</td>
                <td>${row.total}</td>
                ${createCell(row.answered)}
                ${createCell(row.meeting_scheduled)}
                ${createCell(row.arrival)}
                ${createCell(row.success)}
            `;
            tableBody.appendChild(tr);
        });
    }

    function createCell(data) {
        if (!data) return '<td>-</td>';
        return `
            <td>
                ${data.count}
                <span class="conversion-percent">(${data.conv_from_prev.toFixed(1)}% / ${data.conv_from_total.toFixed(1)}%)</span>
            </td>
        `;
    }

    // --- Обработчики событий ---
    filterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadStatistics();
    });

    resetBtn.addEventListener('click', () => {
        filterForm.reset();
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput._flatpickr.setDate(firstDayOfMonth);
        endDateInput._flatpickr.setDate(today);
        loadStatistics();
    });

    // --- Запуск ---
    initialize();
};
