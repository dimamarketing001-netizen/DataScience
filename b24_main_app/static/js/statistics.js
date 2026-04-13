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
            // Инициализация Flatpickr
            flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", defaultDate: new Date().fp_月初() });
            flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

            // Загрузка источников для фильтра
            const sources = await App.api.getSources();
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

    // --- Загрузка данных ---
    async function loadStatistics() {
        App.showLoader();
        const params = new URLSearchParams({
            date_from: startDateInput.value,
            date_to: endDateInput.value,
            source_id: sourceFilterSelect.value
        });

        try {
            const response = await fetch(`/?action=get_statistics&${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Ошибка сети: ${response.statusText}`);
            }
            const data = await response.json();
            renderTableBody(data);
        } catch (error) {
            console.error("Failed to load statistics:", error);
            await App.Notify.error('Ошибка загрузки', `Не удалось получить данные статистики: ${error.message}`);
            tableBody.innerHTML = `<tr><td colspan="5">Ошибка загрузки данных.</td></tr>`;
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
        // Сброс дат на значения по умолчанию
        startDateInput._flatpickr.setDate(new Date().fp_月初());
        endDateInput._flatpickr.setDate(new Date());
        loadStatistics();
    });

    // --- Запуск ---
    initialize();
};
