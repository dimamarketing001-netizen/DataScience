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
            tableBody.innerHTML = `<tr><td colspan="15">Ошибка загрузки данных.</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

    // --- Рендеринг таблицы ---
    function renderTableHead() {
        tableHead.innerHTML = `
            <tr>
                <th class="group-1">Источник</th>
                <th class="group-2">Расходы</th>
                <th class="group-2">Лиды</th>
                <th class="group-2">CPL</th>
                <th class="group-3">Дозвон</th>
                <th class="group-3">Назначена встреча</th>
                <th class="group-3">Приход</th>
                <th class="group-3">Успех</th>
                <th class="group-4">Клиенты</th>
                <th class="group-4">Клиенты с оплатой</th>
                <th class="group-4">Сделки</th>
                <th class="group-4">Сделки с оплатой</th>
                <th class="group-4">CPO</th>
                <th class="group-5">Сумма счетов</th>
                <th class="group-5">ROMI</th>
            </tr>
        `;
    }

    function renderTableBody(data) {
        tableBody.innerHTML = '';
        if (!data || data.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="15">Нет данных за выбранный период.</td></tr>`;
            return;
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            if (row.source_name === "Итого") {
                tr.classList.add('summary-row');
            }
            tr.innerHTML = `
                <td class="group-1">${row.source_name}</td>
                <td class="group-2">${formatCurrency(row.expenses)}</td>
                <td class="group-2">${row.total}</td>
                <td class="group-2">${formatCurrency(row.cpl)}</td>
                ${createCell(row.answered, 'group-3')}
                ${createCell(row.meeting_scheduled, 'group-3')}
                ${createCell(row.arrival, 'group-3')}
                ${createCell(row.success, 'group-3')}
                <td class="group-4">${row.clients}</td>
                ${createCell(row.clients_with_payment, 'group-4')}
                <td class="group-4">${row.deals}</td>
                <td class="group-4">${row.deals_with_payment}</td>
                <td class="group-4">${formatCurrency(row.cpo)}</td>
                <td class="group-5">${formatCurrency(row.invoices_sum)}</td>
                <td class="group-5">${row.romi.toFixed(2)}%</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function createCell(data, groupClass) {
        if (!data) return `<td class="${groupClass}">-</td>`;
        return `
            <td class="${groupClass}">
                ${data.count}
                <span class="conversion-percent">(${data.conv_from_prev.toFixed(1)}% / ${data.conv_from_total.toFixed(1)}%)</span>
            </td>
        `;
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(value || 0);
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
