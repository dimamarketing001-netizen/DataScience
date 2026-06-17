// Модуль для управления вкладкой "Статистика"
App.initializeStatistics = async function () {
    console.log("Initializing Statistics Tab...");

    // =========================================================
    // ЭЛЕМЕНТЫ UI — ОБЩАЯ СТАТИСТИКА (оригинальные + новые)
    // =========================================================
    const filterForm = document.getElementById('statistics-filter-form');
    const startDateInput = document.getElementById('stats-start-date');
    const endDateInput = document.getElementById('stats-end-date');
    const sourceFilterSelect = document.getElementById('stats-source-filter');
    const salesDeptSelect = document.getElementById('stats-sales-dept-filter');
    const groupingSelect = document.getElementById('stats-grouping-filter');
    const resetBtn = document.getElementById('stats-reset-btn');
    const tableHead = document.getElementById('statistics-table-head');
    const tableBody = document.getElementById('statistics-table-body');

    // =========================================================
    // ЭЛЕМЕНТЫ UI — СРАВНЕНИЕ
    // =========================================================
    const cmpForm = document.getElementById('comparison-filter-form');
    const cmpYear = document.getElementById('cmp-year');
    const cmpPeriodType = document.getElementById('cmp-period-type');
    const cmpGrouping = document.getElementById('cmp-grouping');
    const cmpGroupValue = document.getElementById('cmp-group-value');
    const cmpGroupValueWrap = document.getElementById('cmp-group-value-wrap');
    const cmpSalesDept = document.getElementById('cmp-sales-dept');
    const cmpResetBtn = document.getElementById('cmp-reset-btn');
    const cmpTableHead = document.getElementById('comparison-table-head');
    const cmpTableBody = document.getElementById('comparison-table-body');
    const cmpEmpty = document.getElementById('comparison-empty');

    // =========================================================
    // ЭЛЕМЕНТЫ UI — НАСТРОЙКИ
    // =========================================================
    const utmLabelForm = document.getElementById('utm-label-form');
    const utmLabelType = document.getElementById('utm-label-type');
    const utmLabelValue = document.getElementById('utm-label-value');
    const utmLabelName = document.getElementById('utm-label-name');
    const utmLabelsBody = document.getElementById('utm-labels-body');

    // =========================================================
    // ЭЛЕМЕНТЫ UI — POPUP ДЕТАЛИЗАЦИИ
    // =========================================================
    const leadsDetailOverlay = document.getElementById('leads-detail-overlay');
    const leadsDetailTitle = document.getElementById('leads-detail-title');
    const leadsDetailContent = document.getElementById('leads-detail-content');
    const leadsDetailClose = document.getElementById('leads-detail-close');

    // Кэш источников для сравнения
    let sourcesCache = [];
    let salesDeptCache = [];

    // =========================================================
    // ВКЛАДКИ
    // =========================================================
    function initTabs() {
        const tabBtns = document.querySelectorAll('.stats-tab-btn');
        const tabContents = document.querySelectorAll('.stats-tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const tabId = `stats-tab-${btn.dataset.tab}`;
                const tabContent = document.getElementById(tabId);
                if (tabContent) tabContent.classList.add('active');

                // При переходе на настройки — загружаем метки
                if (btn.dataset.tab === 'settings') {
                    loadUtmLabels();
                }
            });
        });
    }

    // =========================================================
    // ИНИЦИАЛИЗАЦИЯ
    // =========================================================
    async function initialize() {
        App.showLoader();
        try {
            initTabs();

            // Даты
            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", defaultDate: firstDayOfMonth });
            flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", defaultDate: today });

            // Источники
            sourcesCache = await getLeadSources();
            App.populateSelect(sourceFilterSelect, sourcesCache, "Все источники");

            // Отдел продаж
            salesDeptCache = await getSalesDeptEnum();
            populateSalesDept(salesDeptSelect, salesDeptCache);
            populateSalesDept(cmpSalesDept, salesDeptCache);

            // Годы для сравнения
            populateYears();

            // Рендер заголовка и загрузка данных
            renderTableHead();
            await loadStatistics();

            // Обработчики сравнения
            initComparisonHandlers();

            // Обработчики настроек
            initSettingsHandlers();

            // Popup
            initLeadsDetailPopup();

        } catch (error) {
            console.error("Error initializing statistics tab:", error);
            await App.Notify.error('Ошибка инициализации', `Не удалось загрузить начальные данные: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }

    // =========================================================
    // ПОЛУЧЕНИЕ ИСТОЧНИКОВ (оригинал)
    // =========================================================
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

    // =========================================================
    // ПОЛУЧЕНИЕ ОТДЕЛОВ ПРОДАЖ
    // =========================================================
    async function getSalesDeptEnum() {
        try {
            const url = buildApiUrl('get_sales_dept_enum', {});
            const response = await fetch(url);
            if (!response.ok) return [];
            const data = await response.json();
            if (data.error) return [];
            return data;
        } catch (e) {
            console.warn("Не удалось загрузить отделы продаж:", e);
            return [];
        }
    }

    function populateSalesDept(selectEl, items) {
        if (!selectEl) return;
        // Сохраняем первый option (Все отделы)
        const firstOption = selectEl.options[0];
        selectEl.innerHTML = '';
        selectEl.appendChild(firstOption);
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.value;
            selectEl.appendChild(opt);
        });
    }

    // =========================================================
    // ЗАГРУЗКА СТАТИСТИКИ (оригинальная логика сохранена)
    // =========================================================
    async function loadStatistics() {
        App.showLoader();
        const params = {
            date_from: startDateInput.value,
            date_to: endDateInput.value,
            source_id: sourceFilterSelect.value,
            sales_dept: salesDeptSelect.value,
            grouping: groupingSelect.value || 'source'
        };

        try {
            // Используем новый grouped endpoint, который поддерживает все группировки
            const data = await apiCall('get_statistics_grouped', params);
            renderTableBody(data);
        } catch (error) {
            console.error("Failed to load statistics:", error);
            await App.Notify.error('Ошибка загрузки', `Не удалось получить данные статистики: ${error.message}`);
            tableBody.innerHTML = `<tr><td colspan="15">Ошибка загрузки данных.</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

    // =========================================================
    // РЕНДЕРИНГ ТАБЛИЦЫ (оригинал — НЕ ИЗМЕНЁН)
    // =========================================================
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

            const leadIds = (row.lead_ids || []).join(',');

            tr.innerHTML = `
                <td class="group-1">${row.source_name}</td>
                <td class="group-2">${formatCurrency(row.expenses)}</td>
                <td class="group-2 clickable-cell" data-ids="${leadIds}" data-title="Лиды: ${row.source_name}">${row.total}</td>
                <td class="group-2">${formatCurrency(row.cpl)}</td>
                ${createCell(row.answered, 'group-3', leadIds, `Дозвон: ${row.source_name}`)}
                ${createCell(row.meeting_scheduled, 'group-3', leadIds, `Назначена встреча: ${row.source_name}`)}
                ${createCell(row.arrival, 'group-3', leadIds, `Приход: ${row.source_name}`)}
                ${createCell(row.success, 'group-3', leadIds, `Успех: ${row.source_name}`)}
                <td class="group-4">${row.clients}</td>
                ${createCell(row.clients_with_payment, 'group-4', leadIds, `Клиенты с оплатой: ${row.source_name}`)}
                <td class="group-4">${row.deals}</td>
                <td class="group-4">${row.deals_with_payment}</td>
                <td class="group-4">${formatCurrency(row.cpo)}</td>
                <td class="group-5">${formatCurrency(row.invoices_sum)}</td>
                <td class="group-5">${(row.romi || 0).toFixed(2)}%</td>
            `;
            tableBody.appendChild(tr);
        });

        // Навешиваем клики для детализации
        tableBody.querySelectorAll('.clickable-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const ids = cell.dataset.ids;
                const title = cell.dataset.title;
                if (ids) openLeadsDetail(ids, title);
            });
        });
    }

    // Оригинальный createCell — расширен параметрами для клика
    function createCell(data, groupClass, leadIds, title) {
        if (!data) return `<td class="${groupClass}">-</td>`;
        const ids = leadIds || '';
        const clickable = ids ? `clickable-cell" data-ids="${ids}" data-title="${title || ''}"` : ``;
        return `
            <td class="${groupClass} ${clickable ? 'clickable-cell' : ''}" ${ids ? `data-ids="${ids}" data-title="${title || ''}"` : ''}>
                ${data.count}
                <span class="conversion-percent">(${data.conv_from_prev.toFixed(1)}% / ${data.conv_from_total.toFixed(1)}%)</span>
            </td>
        `;
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency', currency: 'RUB', minimumFractionDigits: 0
        }).format(value || 0);
    }

    // =========================================================
    // POPUP: ДЕТАЛИЗАЦИЯ ЛИДОВ
    // =========================================================
    function initLeadsDetailPopup() {
        leadsDetailClose.addEventListener('click', () => {
            leadsDetailOverlay.style.display = 'none';
        });
        leadsDetailOverlay.addEventListener('click', (e) => {
            if (e.target === leadsDetailOverlay) {
                leadsDetailOverlay.style.display = 'none';
            }
        });
    }

    async function openLeadsDetail(ids, title) {
        leadsDetailTitle.textContent = title || 'Детализация';
        leadsDetailContent.innerHTML = '<div style="text-align:center; padding: 20px; color: #828b95;">Загрузка...</div>';
        leadsDetailOverlay.style.display = 'flex';

        try {
            const data = await apiCall('get_lead_details', { ids });
            renderLeadsDetail(data);
        } catch (e) {
            leadsDetailContent.innerHTML = `<div style="color:red; padding:16px;">Ошибка загрузки: ${e.message}</div>`;
        }
    }

    function renderLeadsDetail(leads) {
        if (!leads || leads.length === 0) {
            leadsDetailContent.innerHTML = '<div style="padding:16px; color:#828b95;">Нет данных.</div>';
            return;
        }

        const rows = leads.map(lead => `
            <tr>
                <td style="padding: 8px 10px;">
                    <a href="${lead.url}" target="_blank" style="color: #0b66c3; text-decoration: none;">
                        ${lead.name || `Лид #${lead.id}`}
                    </a>
                </td>
                <td style="padding: 8px 10px; color: #828b95; font-size: 12px;">
                    ${lead.status_id || ''}
                </td>
                <td style="padding: 8px 10px; color: #828b95; font-size: 12px;">
                    ${formatDate(lead.date_create)}
                </td>
            </tr>
        `).join('');

        leadsDetailContent.innerHTML = `
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 8px 10px; text-align:left; font-size:13px; color:#535c69;">Имя</th>
                        <th style="padding: 8px 10px; text-align:left; font-size:13px; color:#535c69;">Статус</th>
                        <th style="padding: 8px 10px; text-align:left; font-size:13px; color:#535c69;">Дата создания</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('ru-RU');
        } catch (e) {
            return dateStr;
        }
    }

    // =========================================================
    // СРАВНЕНИЕ
    // =========================================================
    function populateYears() {
        const currentYear = new Date().getFullYear();
        cmpYear.innerHTML = '';
        for (let y = currentYear; y >= currentYear - 5; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            cmpYear.appendChild(opt);
        }
    }

    function initComparisonHandlers() {
        // Показ/скрытие поля значения группировки
        cmpGrouping.addEventListener('change', async () => {
            const val = cmpGrouping.value;
            if (val) {
                cmpGroupValueWrap.style.display = '';
                await populateCmpGroupValues(val);
            } else {
                cmpGroupValueWrap.style.display = 'none';
                cmpGroupValue.innerHTML = '<option value="">Все</option>';
            }
        });

        cmpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await loadComparisonData();
        });

        cmpResetBtn.addEventListener('click', () => {
            cmpForm.reset();
            populateYears();
            cmpGroupValueWrap.style.display = 'none';
            cmpGroupValue.innerHTML = '<option value="">Все</option>';
            cmpTableHead.innerHTML = '';
            cmpTableBody.innerHTML = '';
            cmpEmpty.style.display = 'block';
        });
    }

    async function populateCmpGroupValues(grouping) {
        cmpGroupValue.innerHTML = '<option value="">Все</option>';

        if (grouping === 'source') {
            sourcesCache.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                cmpGroupValue.appendChild(opt);
            });
        } else {
            // Для utm — пытаемся загрузить уникальные значения из меток
            try {
                const labels = await apiCall('get_utm_labels', {});
                const filtered = labels.filter(l => l.utm_type === grouping);
                filtered.forEach(l => {
                    const opt = document.createElement('option');
                    opt.value = l.utm_value;
                    opt.textContent = l.custom_name || l.utm_value;
                    cmpGroupValue.appendChild(opt);
                });
            } catch (e) {
                console.warn('Не удалось загрузить UTM-метки для сравнения');
            }
        }
    }

    async function loadComparisonData() {
        App.showLoader();

        const selectedMetrics = Array.from(
            document.querySelectorAll('#cmp-metrics-list input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        if (selectedMetrics.length === 0) {
            await App.Notify.error('Ошибка', 'Выберите хотя бы один показатель.');
            App.hideLoader();
            return;
        }

        const params = {
            year: cmpYear.value,
            period_type: cmpPeriodType.value,
            grouping: cmpGrouping.value,
            group_value: cmpGroupValue.value,
            sales_dept: cmpSalesDept.value,
            metrics: selectedMetrics.join(',')
        };

        try {
            const data = await apiCall('get_comparison_data', params);
            renderComparisonTable(data, selectedMetrics);
            cmpEmpty.style.display = 'none';
        } catch (e) {
            console.error("Ошибка загрузки сравнения:", e);
            await App.Notify.error('Ошибка', `Не удалось загрузить данные: ${e.message}`);
        } finally {
            App.hideLoader();
        }
    }

    const METRIC_LABELS = {
        expenses: 'Расходы',
        total: 'Лиды',
        cpl: 'CPL',
        answered: 'Дозвон',
        meeting_scheduled: 'Назначена встреча',
        arrival: 'Приход',
        success: 'Успех',
        clients: 'Клиенты',
        clients_with_payment: 'Клиенты с оплатой',
        deals: 'Сделки',
        deals_with_payment: 'Сделки с оплатой',
        cpo: 'CPO',
        invoices_sum: 'Сумма счетов',
        romi: 'ROMI'
    };

    const CURRENCY_METRICS = new Set(['expenses', 'cpl', 'cpo', 'invoices_sum']);
    const PERCENT_METRICS = new Set(['romi']);

    function renderComparisonTable(data, selectedMetrics) {
        if (!data || !data.periods || data.periods.length === 0) {
            cmpTableHead.innerHTML = '';
            cmpTableBody.innerHTML = '';
            cmpEmpty.style.display = 'block';
            return;
        }

        const periods = data.periods;

        // Заголовок: строка метрик + строка периодов
        // Структура: первый столбец — "Показатель", остальные — периоды
        let headHtml = '<tr><th class="group-1" style="min-width:160px;">Показатель</th>';
        periods.forEach(p => {
            headHtml += `<th class="group-2" colspan="4" style="text-align:center;">${p.label}</th>`;
        });
        headHtml += '</tr>';

        // Подзаголовок
        headHtml += '<tr><th class="group-1"></th>';
        periods.forEach(() => {
            headHtml += `
                <th class="group-2" style="font-size:11px; color:#828b95;">Значение</th>
                <th class="group-2" style="font-size:11px; color:#828b95;">Δ к пред.</th>
                <th class="group-2" style="font-size:11px; color:#828b95;">% к пред.</th>
                <th class="group-2" style="font-size:11px; color:#828b95;">% от года</th>
            `;
        });
        headHtml += '</tr>';
        cmpTableHead.innerHTML = headHtml;

        // Тело: одна строка на метрику
        let bodyHtml = '';
        selectedMetrics.forEach(metric => {
            bodyHtml += `<tr>`;
            bodyHtml += `<td class="group-1" style="font-weight:600;">${METRIC_LABELS[metric] || metric}</td>`;

            periods.forEach(p => {
                const mdata = p.metrics[metric];
                if (!mdata) {
                    bodyHtml += `<td>-</td><td>-</td><td>-</td><td>-</td>`;
                    return;
                }

                const val = mdata.value;
                const delta = mdata.delta;
                const pctPrev = mdata.pct_from_prev;
                const pctTotal = mdata.pct_from_total;

                // Форматирование значения
                let valStr;
                if (CURRENCY_METRICS.has(metric)) {
                    valStr = formatCurrency(val);
                } else if (PERCENT_METRICS.has(metric)) {
                    valStr = `${(val || 0).toFixed(2)}%`;
                } else {
                    valStr = val ?? '-';
                }

                // Дельта
                let deltaStr = '-';
                let deltaClass = '';
                if (delta !== null && delta !== undefined) {
                    const sign = delta > 0 ? '+' : '';
                    if (CURRENCY_METRICS.has(metric)) {
                        deltaStr = `${sign}${formatCurrency(delta)}`;
                    } else {
                        deltaStr = `${sign}${delta}`;
                    }
                    deltaClass = delta > 0 ? 'cmp-delta-pos' : delta < 0 ? 'cmp-delta-neg' : '';
                }

                // % к предыдущему
                let pctPrevStr = '-';
                let pctPrevClass = '';
                if (pctPrev !== null && pctPrev !== undefined) {
                    const sign = pctPrev > 0 ? '+' : '';
                    pctPrevStr = `${sign}${pctPrev.toFixed(1)}%`;
                    pctPrevClass = pctPrev > 0 ? 'cmp-delta-pos' : pctPrev < 0 ? 'cmp-delta-neg' : '';
                }

                // % от года
                let pctTotalStr = pctTotal !== null && pctTotal !== undefined
                    ? `${pctTotal.toFixed(1)}%`
                    : '-';

                bodyHtml += `
                    <td class="group-2">${valStr}</td>
                    <td class="group-2 ${deltaClass}">${deltaStr}</td>
                    <td class="group-2 ${pctPrevClass}">${pctPrevStr}</td>
                    <td class="group-2">${pctTotalStr}</td>
                `;
            });

            bodyHtml += `</tr>`;
        });

        cmpTableBody.innerHTML = bodyHtml;
    }

    // =========================================================
    // НАСТРОЙКИ: UTM МЕТКИ
    // =========================================================
    function initSettingsHandlers() {
        utmLabelForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const utm_type = utmLabelType.value;
            const utm_value = utmLabelValue.value.trim();
            const custom_name = utmLabelName.value.trim();

            if (!utm_value) {
                await App.Notify.error('Ошибка', 'Укажите значение UTM-параметра.');
                return;
            }

            try {
                App.showLoader();
                await apiCallPost('save_utm_label', { utm_type, utm_value, custom_name });
                utmLabelValue.value = '';
                utmLabelName.value = '';
                await loadUtmLabels();
                await App.Notify.success('Готово', 'Метка сохранена.');
            } catch (e) {
                await App.Notify.error('Ошибка', e.message);
            } finally {
                App.hideLoader();
            }
        });
    }

    async function loadUtmLabels() {
        utmLabelsBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#828b95;">Загрузка...</td></tr>';
        try {
            const labels = await apiCall('get_utm_labels', {});
            renderUtmLabels(labels);
        } catch (e) {
            utmLabelsBody.innerHTML = `<tr><td colspan="4" style="color:red;">Ошибка загрузки: ${e.message}</td></tr>`;
        }
    }

    function renderUtmLabels(labels) {
        if (!labels || labels.length === 0) {
            utmLabelsBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#828b95;">Нет меток. Добавьте первую.</td></tr>';
            return;
        }

        utmLabelsBody.innerHTML = labels.map(l => `
            <tr>
                <td>${l.utm_type}</td>
                <td>${l.utm_value}</td>
                <td>${l.custom_name || '<span style="color:#828b95;">—</span>'}</td>
                <td style="text-align:center;">
                    <span class="action-icon" data-id="${l.id}" title="Удалить" style="color:#e74c3c; cursor:pointer;">🗑</span>
                </td>
            </tr>
        `).join('');

        utmLabelsBody.querySelectorAll('.action-icon[data-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    App.showLoader();
                    await apiCall('delete_utm_label', { id }, 'GET');
                    await loadUtmLabels();
                } catch (e) {
                    await App.Notify.error('Ошибка', e.message);
                } finally {
                    App.hideLoader();
                }
            });
        });
    }

    // =========================================================
    // ОБРАБОТЧИКИ СОБЫТИЙ — ОБЩАЯ СТАТИСТИКА (оригинал)
    // =========================================================
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
        groupingSelect.value = 'source';
        loadStatistics();
    });

    // =========================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ API
    // =========================================================
    function buildApiUrl(action, params) {
        const url = new URL(window.location.href);
        url.searchParams.set('action', action);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    }

    async function apiCall(action, params, method = 'GET') {
        const url = buildApiUrl(action, method === 'GET' ? params : {});
        const options = { method };
        if (method === 'POST') {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(params);
        }

        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`Ошибка сети: ${response.statusText}`);

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            console.error("Получен не-JSON ответ:", text);
            throw new TypeError("Ожидался JSON, но получен другой тип ответа.");
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
    }

    async function apiCallPost(action, body) {
        const url = buildApiUrl(action, {});
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`Ошибка сети: ${response.statusText}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
    }

    // =========================================================
    // ЗАПУСК
    // =========================================================
    initialize();
};