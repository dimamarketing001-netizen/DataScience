// Модуль для управления вкладкой "Статистика"
App.initializeStatistics = async function () {
    console.log("Initializing Statistics Tab...");

    // =========================================================
    // ЭЛЕМЕНТЫ UI
    // =========================================================
    const filterForm        = document.getElementById('statistics-filter-form');
    const startDateInput    = document.getElementById('stats-start-date');
    const endDateInput      = document.getElementById('stats-end-date');
    const groupingSelect    = document.getElementById('stats-grouping-filter');
    const periodModeSelect  = document.getElementById('stats-period-mode');
    const periodModeHint    = document.getElementById('stats-period-mode-hint');
    const attributionWrap   = document.getElementById('stats-attribution-wrap');
    const attributionSelect = document.getElementById('stats-attribution');
    const resetBtn          = document.getElementById('stats-reset-btn');
    const tableHead         = document.getElementById('statistics-table-head');
    const tableBody         = document.getElementById('statistics-table-body');

    const cmpForm           = document.getElementById('comparison-filter-form');
    const cmpYear           = document.getElementById('cmp-year');
    const cmpPeriodType     = document.getElementById('cmp-period-type');
    const cmpGrouping       = document.getElementById('cmp-grouping');
    const cmpGroupValueWrap = document.getElementById('cmp-group-value-wrap');
    const cmpPeriodMode     = document.getElementById('cmp-period-mode');
    const cmpPeriodModeHint = document.getElementById('cmp-period-mode-hint');
    const cmpAttributionWrap= document.getElementById('cmp-attribution-wrap');
    const cmpAttribution    = document.getElementById('cmp-attribution');
    const cmpResetBtn       = document.getElementById('cmp-reset-btn');
    const cmpTableHead      = document.getElementById('comparison-table-head');
    const cmpTableBody      = document.getElementById('comparison-table-body');
    const cmpEmpty          = document.getElementById('comparison-empty');
    const cmpChartsWrap     = document.getElementById('comparison-charts-wrap');

    const utmLabelForm   = document.getElementById('utm-label-form');
    const utmLabelType   = document.getElementById('utm-label-type');
    const utmLabelValue  = document.getElementById('utm-label-value');
    const utmLabelName   = document.getElementById('utm-label-name');
    const utmLabelsBody  = document.getElementById('utm-labels-body');

    const leadsDetailOverlay = document.getElementById('leads-detail-overlay');
    const leadsDetailTitle   = document.getElementById('leads-detail-title');
    const leadsDetailContent = document.getElementById('leads-detail-content');
    const leadsDetailClose   = document.getElementById('leads-detail-close');

    let sourcesCache   = [];
    let salesDeptCache = [];

    // Хранилище Chart.js инстансов для уничтожения при перерисовке
    let _chartInstances = [];

    const CONVERSION_METRICS = new Set([
        'answered','meeting_scheduled','arrival','success','clients_with_payment'
    ]);
    const METRIC_LABELS = {
        expenses:'Расходы', total:'Лиды', cpl:'CPL',
        answered:'Дозвон', meeting_scheduled:'Назначена встреча',
        arrival:'Приход', success:'Успех', clients:'Клиенты',
        clients_with_payment:'Клиенты с оплатой', deals:'Сделки',
        deals_with_payment:'Сделки с оплатой', cpo:'CPO',
        invoices_sum:'Сумма счетов', romi:'ROMI'
    };
    const CURRENCY_METRICS = new Set(['expenses','cpl','cpo','invoices_sum']);
    const PERCENT_METRICS  = new Set(['romi']);

    // Воронка: порядок метрик для расчёта конверсии
    // Каждая метрика конвертируется от предыдущей в воронке
    const FUNNEL_ORDER = [
        'total', 'answered', 'meeting_scheduled', 'arrival', 'success',
        'clients', 'clients_with_payment', 'deals', 'deals_with_payment'
    ];

    // Палитра цветов для группировок
    const GROUP_COLORS = [
        '#0b66c3','#e74c3c','#27ae60','#f39c12','#8e44ad',
        '#16a085','#d35400','#2980b9','#c0392b','#1abc9c',
        '#e67e22','#9b59b6','#2ecc71','#e91e63','#ff5722'
    ];

    // =========================================================
    // РАСЧЁТ КОНВЕРСИИ МЕЖДУ ВЫБРАННЫМИ МЕТРИКАМИ
    // Строим карту: metric -> denominator_metric
    // Берём только те метрики которые выбраны пользователем
    // =========================================================
    function buildConversionMap(selectedMetrics) {
        // convMap[metric] = метрика-знаменатель (из выбранных)
        const convMap = {};
        const selected = new Set(selectedMetrics);

        // Для каждой метрики в воронке ищем ближайший предыдущий выбранный знаменатель
        for (let i = 0; i < FUNNEL_ORDER.length; i++) {
            const metric = FUNNEL_ORDER[i];
            if (!selected.has(metric)) continue;

            // Ищем ближайшую предыдущую выбранную метрику как знаменатель
            let denominator = null;
            for (let j = i - 1; j >= 0; j--) {
                if (selected.has(FUNNEL_ORDER[j])) {
                    denominator = FUNNEL_ORDER[j];
                    break;
                }
            }
            convMap[metric] = denominator; // null = нет знаменателя (первая метрика)
        }

        // Метрики вне воронки (expenses, cpl, cpo, invoices_sum, romi) — без конверсии
        return convMap;
    }

    // =========================================================
    // МУЛЬТИФИЛЬТР
    // =========================================================
    function createMultiFilter(config) {
        const box      = document.getElementById(config.boxId);
        const dropdown = document.getElementById(config.dropdownId);
        const optsCont = document.getElementById(config.optionsId);
        const tagsCont = document.getElementById(config.tagsId);
        const search   = dropdown ? dropdown.querySelector('.multi-filter-search') : null;
        const clearBtn = dropdown ? dropdown.querySelector('.multi-filter-clear') : null;

        const state = { selected: [], excluded: [], open: false };

        function render() {
            if (!optsCont) return;
            const q = search ? search.value.toLowerCase() : '';
            optsCont.innerHTML = '';
            const filtered = config.items.filter(i =>
                i.name.toLowerCase().includes(q));

            filtered.forEach(item => {
                const isSelected = state.selected.includes(item.id);
                const isExcluded = state.excluded.includes(item.id);
                const row = document.createElement('div');
                row.className = 'mf-option-row';
                if (isSelected) row.classList.add('mf-selected');
                if (isExcluded) row.classList.add('mf-excluded');
                row.innerHTML = `
                    <span class="mf-option-name">${item.name}</span>
                    <span class="mf-option-actions">
                        <button type="button"
                            class="mf-btn-include ${isSelected ? 'mf-btn-active':''}"
                            title="Включить">✓</button>
                        <button type="button"
                            class="mf-btn-exclude ${isExcluded ? 'mf-btn-active mf-btn-exc-active':''}"
                            title="Исключить">✕</button>
                    </span>`;
                row.querySelector('.mf-btn-include').addEventListener('click', e => {
                    e.stopPropagation();
                    if (isSelected) state.selected = state.selected.filter(x => x !== item.id);
                    else {
                        state.selected.push(item.id);
                        state.excluded = state.excluded.filter(x => x !== item.id);
                    }
                    renderTags(); render();
                    if (config.onChange) config.onChange(state.selected, state.excluded);
                });
                row.querySelector('.mf-btn-exclude').addEventListener('click', e => {
                    e.stopPropagation();
                    if (isExcluded) state.excluded = state.excluded.filter(x => x !== item.id);
                    else {
                        state.excluded.push(item.id);
                        state.selected = state.selected.filter(x => x !== item.id);
                    }
                    renderTags(); render();
                    if (config.onChange) config.onChange(state.selected, state.excluded);
                });
                optsCont.appendChild(row);
            });

            if (filtered.length === 0) {
                optsCont.innerHTML =
                    `<div class="mf-no-results">Ничего не найдено</div>`;
            }
        }

        function renderTags() {
            if (!tagsCont) return;
            tagsCont.innerHTML = '';
            state.selected.forEach(id => {
                const item = config.items.find(i => i.id === id);
                if (!item) return;
                const tag = document.createElement('span');
                tag.className = 'mf-tag mf-tag-include';
                tag.innerHTML = `${item.name}
                    <span class="mf-tag-remove"
                        data-id="${id}" data-type="include">×</span>`;
                tagsCont.appendChild(tag);
            });
            state.excluded.forEach(id => {
                const item = config.items.find(i => i.id === id);
                if (!item) return;
                const tag = document.createElement('span');
                tag.className = 'mf-tag mf-tag-exclude';
                tag.innerHTML = `НЕ ${item.name}
                    <span class="mf-tag-remove"
                        data-id="${id}" data-type="exclude">×</span>`;
                tagsCont.appendChild(tag);
            });
            tagsCont.querySelectorAll('.mf-tag-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id, type = btn.dataset.type;
                    if (type === 'include')
                        state.selected = state.selected.filter(x => x !== id);
                    else
                        state.excluded = state.excluded.filter(x => x !== id);
                    renderTags(); render();
                    if (config.onChange) config.onChange(state.selected, state.excluded);
                });
            });
            const ph = box.querySelector('.multi-filter-placeholder');
            if (ph) {
                const total = state.selected.length + state.excluded.length;
                ph.textContent = total > 0
                    ? `Выбрано: ${state.selected.length} / Исключено: ${state.excluded.length}`
                    : (config.placeholder || 'Выбрать...');
            }
        }

        box.addEventListener('click', e => {
            if (e.target.closest('.multi-filter-dropdown')) return;
            state.open = !state.open;
            if (dropdown) dropdown.style.display = state.open ? 'block' : 'none';
            if (state.open) render();
        });
        if (search) {
            search.addEventListener('input', render);
            search.addEventListener('click', e => e.stopPropagation());
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', e => {
                e.stopPropagation();
                state.selected = []; state.excluded = [];
                renderTags(); render();
                if (config.onChange) config.onChange([], []);
            });
        }
        document.addEventListener('click', e => {
            if (!box.contains(e.target)) {
                state.open = false;
                if (dropdown) dropdown.style.display = 'none';
            }
        });

        return {
            getSelected: () => [...state.selected],
            getExcluded: () => [...state.excluded],
            reset() { state.selected = []; state.excluded = []; renderTags(); },
            setItems(items) { config.items = items; render(); }
        };
    }

    // =========================================================
    // ВКЛАДКИ
    // =========================================================
    function initTabs() {
        document.querySelectorAll('.stats-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.stats-tab-btn')
                    .forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.stats-tab-content')
                    .forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const tab = document.getElementById(`stats-tab-${btn.dataset.tab}`);
                if (tab) tab.classList.add('active');
                if (btn.dataset.tab === 'settings') loadUtmLabels();
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

            const today = new Date();
            const first = new Date(today.getFullYear(), today.getMonth(), 1);
            flatpickr(startDateInput, {
                locale:"ru", dateFormat:"Y-m-d", defaultDate: first
            });
            flatpickr(endDateInput, {
                locale:"ru", dateFormat:"Y-m-d", defaultDate: today
            });

            sourcesCache = await getLeadSources();
            window._mfStatsSource = createMultiFilter({
                boxId:'stats-source-box', dropdownId:'stats-source-dropdown',
                optionsId:'stats-source-options', tagsId:'stats-source-tags',
                placeholder:'Все источники',
                items: sourcesCache.map(s => ({ id:s.id, name:s.name }))
            });

            salesDeptCache = await getSalesDeptEnum();
            window._mfStatsDept = createMultiFilter({
                boxId:'stats-dept-box', dropdownId:'stats-dept-dropdown',
                optionsId:'stats-dept-options', tagsId:'stats-dept-tags',
                placeholder:'Не выбрано',
                items: salesDeptCache.map(s => ({ id:s.id, name:s.value }))
            });
            window._mfCmpDept = createMultiFilter({
                boxId:'cmp-dept-box', dropdownId:'cmp-dept-dropdown',
                optionsId:'cmp-dept-options', tagsId:'cmp-dept-tags',
                placeholder:'Не выбрано',
                items: salesDeptCache.map(s => ({ id:s.id, name:s.value }))
            });
            window._mfCmpGroupValue = createMultiFilter({
                boxId:'cmp-group-value-box', dropdownId:'cmp-group-value-dropdown',
                optionsId:'cmp-group-value-options', tagsId:'cmp-group-value-tags',
                placeholder:'Все', items:[]
            });

            populateYears();
            renderTableHead();
            await loadStatistics();

            initPeriodModeHandlers();
            initComparisonHandlers();
            initSettingsHandlers();
            initLeadsDetailPopup();
            initMetricsButtons();

        } catch (error) {
            console.error("Error initializing statistics tab:", error);
            await App.Notify.error('Ошибка инициализации', error.message);
        } finally {
            App.hideLoader();
        }
    }

    // =========================================================
    // РЕЖИМ ПЕРИОДА + АТРИБУТ
    // =========================================================
    function initPeriodModeHandlers() {
        periodModeSelect.addEventListener('change', () => {
            const isStrict = periodModeSelect.value === 'strict';
            periodModeHint.style.display    = isStrict ? 'flex' : 'none';
            attributionWrap.style.display   = isStrict ? ''     : 'none';
        });

        cmpPeriodMode.addEventListener('change', () => {
            const isStrict = cmpPeriodMode.value === 'strict';
            cmpPeriodModeHint.style.display  = isStrict ? 'flex' : 'none';
            cmpAttributionWrap.style.display = isStrict ? ''     : 'none';
        });
    }

    // =========================================================
    // ИСТОЧНИКИ / ОТДЕЛЫ
    // =========================================================
    async function getLeadSources() {
        return new Promise((resolve, reject) => {
            BX24.callMethod('crm.status.entity.items', { entityId:'SOURCE' }, result => {
                if (result.error()) reject(new Error("Не удалось загрузить источники"));
                else resolve(result.data().map(i => ({ id:i.STATUS_ID, name:i.NAME })));
            });
        });
    }

    async function getSalesDeptEnum() {
        try {
            const data = await apiCall('get_sales_dept_enum', {});
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn("Не удалось загрузить отделы:", e);
            return [];
        }
    }

    // =========================================================
    // ЗАГРУЗКА СТАТИСТИКИ
    // =========================================================
    async function loadStatistics() {
        App.showLoader();
        const params = new URLSearchParams();
        params.set('action',      'get_statistics_grouped');
        params.set('date_from',   startDateInput.value);
        params.set('date_to',     endDateInput.value);
        params.set('grouping',    groupingSelect.value || 'source');
        params.set('period_mode', periodModeSelect.value || 'standard');

        if (periodModeSelect.value === 'strict') {
            params.set('attribution', attributionSelect.value || 'last_touch');
        }

        window._mfStatsSource.getSelected().forEach(v =>
            params.append('source_id[]', v));
        window._mfStatsSource.getExcluded().forEach(v =>
            params.append('source_id_exclude[]', v));
        window._mfStatsDept.getSelected().forEach(v =>
            params.append('sales_dept[]', v));
        window._mfStatsDept.getExcluded().forEach(v =>
            params.append('sales_dept_exclude[]', v));

        try {
            const url = new URL(window.location.href);
            url.search = params.toString();
            const response = await fetch(url.toString());
            if (!response.ok) throw new Error(response.statusText);
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            renderTableBody(data);
        } catch (error) {
            console.error("Failed to load statistics:", error);
            await App.Notify.error('Ошибка загрузки', error.message);
            tableBody.innerHTML =
                `<tr><td colspan="15">Ошибка загрузки данных.</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

    // =========================================================
    // РЕНДЕРИНГ ТАБЛИЦЫ (ОБЩАЯ СТАТИСТИКА)
    // =========================================================
    function renderTableHead() {
        tableHead.innerHTML = `
            <tr>
                <th class="group-1 col-sticky">Источник</th>
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
            </tr>`;
    }

    function renderTableBody(data) {
        tableBody.innerHTML = '';
        if (!data || data.length === 0) {
            tableBody.innerHTML =
                `<tr><td colspan="15">Нет данных за выбранный период.</td></tr>`;
            return;
        }
        data.forEach(row => {
            const tr = document.createElement('tr');
            if (row.source_name === "Итого") tr.classList.add('summary-row');

            const idsTotal     = (row.ids_total||[]).join(',');
            const idsAnswered  = (row.ids_answered||[]).join(',');
            const idsMeeting   = (row.ids_meeting_scheduled||[]).join(',');
            const idsArrival   = (row.ids_arrival||[]).join(',');
            const idsSuccess   = (row.ids_success||[]).join(',');
            const idsClients   = (row.ids_clients||[]).join(',');
            const idsClientsWP = (row.ids_clients_with_payment||[]).join(',');
            const idsDeals     = (row.ids_deals||[]).join(',');
            const idsDealsWP   = (row.ids_deals_with_payment||[]).join(',');

            tr.innerHTML = `
                <td class="group-1 col-sticky">${row.source_name}</td>
                <td class="group-2">${formatCurrency(row.expenses)}</td>
                <td class="group-2 clickable-cell"
                    data-ids="${idsTotal}" data-type="lead"
                    data-title="Лиды: ${row.source_name}">
                    <span class="cell-value">${row.total}</span>
                </td>
                <td class="group-2">${formatCurrency(row.cpl)}</td>
                ${createLeadCell(row.answered,'group-3',idsAnswered,
                    `Дозвон: ${row.source_name}`)}
                ${createLeadCell(row.meeting_scheduled,'group-3',idsMeeting,
                    `Назначена встреча: ${row.source_name}`)}
                ${createLeadCell(row.arrival,'group-3',idsArrival,
                    `Приход: ${row.source_name}`)}
                ${createLeadCell(row.success,'group-3',idsSuccess,
                    `Успех: ${row.source_name}`)}
                <td class="group-4 clickable-cell"
                    data-ids="${idsClients}" data-type="contact"
                    data-title="Клиенты: ${row.source_name}">
                    <span class="cell-value">${row.clients}</span>
                </td>
                ${createContactCell(row.clients_with_payment,'group-4',
                    idsClientsWP,`Клиенты с оплатой: ${row.source_name}`)}
                <td class="group-4 clickable-cell"
                    data-ids="${idsDeals}" data-type="deal"
                    data-title="Сделки: ${row.source_name}">
                    <span class="cell-value">${row.deals}</span>
                </td>
                <td class="group-4 clickable-cell"
                    data-ids="${idsDealsWP}" data-type="deal"
                    data-title="Сделки с оплатой: ${row.source_name}">
                    <span class="cell-value">${row.deals_with_payment}</span>
                </td>
                <td class="group-4">${formatCurrency(row.cpo)}</td>
                <td class="group-5">${formatCurrency(row.invoices_sum)}</td>
                <td class="group-5">${(row.romi||0).toFixed(2)}%</td>
            `;
            tableBody.appendChild(tr);
        });

        tableBody.querySelectorAll('.clickable-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const ids   = cell.dataset.ids;
                const type  = cell.dataset.type;
                const title = cell.dataset.title;
                if (ids) openDetailPopup(ids, type, title);
            });
        });
    }

    function createLeadCell(data, groupClass, ids, title) {
        if (!data) return `<td class="${groupClass}">-</td>`;
        const hasIds = ids && data.count > 0;
        return `
            <td class="${groupClass}${hasIds?' clickable-cell':''}"
                ${hasIds?`data-ids="${ids}" data-type="lead" data-title="${title}"`:''}> 
                <span class="cell-value">${data.count}</span>
                <span class="conversion-percent">
                    (${data.conv_from_prev.toFixed(1)}%&nbsp;/&nbsp;${data.conv_from_total.toFixed(1)}%)
                </span>
            </td>`;
    }

    function createContactCell(data, groupClass, ids, title) {
        if (!data) return `<td class="${groupClass}">-</td>`;
        const hasIds = ids && data.count > 0;
        return `
            <td class="${groupClass}${hasIds?' clickable-cell':''}"
                ${hasIds?`data-ids="${ids}" data-type="contact" data-title="${title}"`:''}> 
                <span class="cell-value">${data.count}</span>
                <span class="conversion-percent">
                    (${data.conv_from_prev.toFixed(1)}%&nbsp;/&nbsp;${data.conv_from_total.toFixed(1)}%)
                </span>
            </td>`;
    }

    // =========================================================
    // ФОРМАТИРОВАНИЕ
    // =========================================================
    function formatCurrency(value) {
        return new Intl.NumberFormat('ru-RU', {
            style:'currency', currency:'RUB', minimumFractionDigits:0
        }).format(value||0);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try { return new Date(dateStr).toLocaleDateString('ru-RU'); }
        catch(e) { return dateStr; }
    }

    function formatMetricValue(metric, val) {
        if (val === null || val === undefined) return '—';
        if (CURRENCY_METRICS.has(metric)) return formatCurrency(val);
        if (PERCENT_METRICS.has(metric))  return `${(+val).toFixed(2)}%`;
        return String(val);
    }

    // =========================================================
    // POPUP ДЕТАЛИЗАЦИИ
    // =========================================================
    function initLeadsDetailPopup() {
        leadsDetailClose.addEventListener('click', () => {
            leadsDetailOverlay.style.display = 'none';
        });
        leadsDetailOverlay.addEventListener('click', e => {
            if (e.target === leadsDetailOverlay)
                leadsDetailOverlay.style.display = 'none';
        });
    }

    async function openDetailPopup(ids, type, title) {
        if (!ids) return;
        leadsDetailTitle.textContent = title || 'Детализация';
        leadsDetailContent.innerHTML =
            `<div style="text-align:center;padding:20px;color:#828b95;">Загрузка...</div>`;
        leadsDetailOverlay.style.display = 'flex';
        try {
            let action = 'get_lead_details';
            if (type === 'contact') action = 'get_contact_details';
            if (type === 'deal')    action = 'get_deal_details';
            const data = await apiCall(action, { ids });
            renderDetailList(data, type);
        } catch (e) {
            leadsDetailContent.innerHTML =
                `<div style="color:red;padding:16px;">Ошибка: ${e.message}</div>`;
        }
    }

    function renderDetailList(items, type) {
        if (!items || items.length === 0) {
            leadsDetailContent.innerHTML =
                `<div style="padding:16px;color:#828b95;">Нет данных.</div>`;
            return;
        }
        let col1 = type === 'contact' ? 'Контакт' : type === 'deal' ? 'Сделка' : 'Лид';
        const rows = items.map(item => {
            const mainLink = `<a href="${item.url}" target="_blank"
                class="detail-link">${item.name||`#${item.id}`}</a>`;
            let contactCell = `<span style="color:#c6cdd3;">—</span>`;
            if (item.contact) contactCell = `<a href="${item.contact.url}"
                target="_blank" class="detail-link detail-link-secondary">
                ${item.contact.name}</a>`;
            let dealCell = `<span style="color:#c6cdd3;">—</span>`;
            if (item.deal) dealCell = `<a href="${item.deal.url}"
                target="_blank" class="detail-link detail-link-secondary">
                ${item.deal.title}</a>`;
            const dateVal = item.deal
                ? formatDate(item.deal.date_create)
                : formatDate(item.date_create);
            return `<tr class="detail-row">
                <td class="detail-td detail-td-main">${mainLink}</td>
                <td class="detail-td detail-td-secondary">${contactCell}</td>
                <td class="detail-td detail-td-secondary">${dealCell}</td>
                <td class="detail-td detail-td-date">${dateVal}</td>
            </tr>`;
        }).join('');
        leadsDetailContent.innerHTML = `
            <table class="detail-table">
                <thead><tr>
                    <th class="detail-th">${col1}</th>
                    <th class="detail-th">Контакт</th>
                    <th class="detail-th">Сделка</th>
                    <th class="detail-th">Дата</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    // =========================================================
    // СРАВНЕНИЕ
    // =========================================================
    function populateYears() {
        const cur = new Date().getFullYear();
        cmpYear.innerHTML = '';
        for (let y = cur; y >= cur - 5; y--) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            cmpYear.appendChild(opt);
        }
    }

    function initMetricsButtons() {
        const allCbs = () =>
            document.querySelectorAll('#cmp-metrics-list input[type="checkbox"]');
        document.getElementById('cmp-select-all-metrics')
            .addEventListener('click', () => allCbs().forEach(cb => cb.checked = true));
        document.getElementById('cmp-clear-all-metrics')
            .addEventListener('click', () => allCbs().forEach(cb => cb.checked = false));
    }

    function initComparisonHandlers() {
        cmpGrouping.addEventListener('change', async () => {
            const val = cmpGrouping.value;
            if (val) {
                cmpGroupValueWrap.style.display = '';
                await populateCmpGroupValues(val);
            } else {
                cmpGroupValueWrap.style.display = 'none';
                window._mfCmpGroupValue.reset();
                window._mfCmpGroupValue.setItems([]);
            }
        });
        cmpForm.addEventListener('submit', async e => {
            e.preventDefault();
            await loadComparisonData();
        });
        cmpResetBtn.addEventListener('click', () => {
            cmpForm.reset();
            populateYears();
            cmpGroupValueWrap.style.display  = 'none';
            cmpAttributionWrap.style.display = 'none';
            window._mfCmpGroupValue.reset();
            window._mfCmpDept.reset();
            cmpPeriodModeHint.style.display = 'none';
            document.querySelectorAll('#cmp-metrics-list input[type="checkbox"]')
                .forEach(cb => cb.checked = false);
            cmpTableHead.innerHTML = '';
            cmpTableBody.innerHTML = '';
            cmpEmpty.style.display = 'block';
            _destroyCharts();
            if (cmpChartsWrap) cmpChartsWrap.innerHTML = '';
        });
    }

    async function populateCmpGroupValues(grouping) {
        let items = [];
        if (grouping === 'source') {
            items = sourcesCache.map(s => ({ id:s.id, name:s.name }));
        } else {
            try {
                const labels = await apiCall('get_utm_labels', {});
                items = labels
                    .filter(l => l.utm_type === grouping)
                    .map(l => ({ id:l.utm_value, name:l.custom_name||l.utm_value }));
            } catch(e) {
                console.warn('Не удалось загрузить UTM-метки');
            }
        }
        window._mfCmpGroupValue.reset();
        window._mfCmpGroupValue.setItems(items);
    }

    async function loadComparisonData() {
        const selectedMetrics = Array.from(
            document.querySelectorAll('#cmp-metrics-list input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        if (selectedMetrics.length === 0) {
            await App.Notify.error('Ошибка', 'Выберите хотя бы один показатель.');
            return;
        }

        App.showLoader();
        const params = new URLSearchParams();
        params.set('action',      'get_comparison_data');
        params.set('year',        cmpYear.value);
        params.set('period_type', cmpPeriodType.value);
        params.set('grouping',    cmpGrouping.value);
        params.set('metrics',     selectedMetrics.join(','));
        params.set('period_mode', cmpPeriodMode.value || 'standard');

        if (cmpPeriodMode.value === 'strict') {
            params.set('attribution', cmpAttribution.value || 'last_touch');
        }

        window._mfCmpGroupValue.getSelected().forEach(v =>
            params.append('group_value[]', v));
        window._mfCmpGroupValue.getExcluded().forEach(v =>
            params.append('group_value_exclude[]', v));
        window._mfCmpDept.getSelected().forEach(v =>
            params.append('sales_dept[]', v));
        window._mfCmpDept.getExcluded().forEach(v =>
            params.append('sales_dept_exclude[]', v));

        try {
            const url = new URL(window.location.href);
            url.search = params.toString();
            const response = await fetch(url.toString());
            if (!response.ok) throw new Error(response.statusText);
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            renderComparisonTable(data, selectedMetrics);
            renderComparisonCharts(data, selectedMetrics);
            cmpEmpty.style.display = 'none';
        } catch(e) {
            console.error("Ошибка загрузки сравнения:", e);
            await App.Notify.error('Ошибка', e.message);
        } finally {
            App.hideLoader();
        }
    }

    // =========================================================
    // ТАБЛИЦА СРАВНЕНИЯ
    // =========================================================
    function renderComparisonTable(data, selectedMetrics) {
        if (!data || !data.rows || data.rows.length === 0) {
            cmpTableHead.innerHTML = '';
            cmpTableBody.innerHTML = '';
            cmpEmpty.style.display = 'block';
            return;
        }

        const periodLabels = data.period_labels || [];
        const rows         = data.rows;
        const groupLabels  = data.group_labels || {};
        const metricCount  = selectedMetrics.length;

        // Строим карту конверсий между выбранными метриками
        const convMap = buildConversionMap(selectedMetrics);

        // ---- ЗАГОЛОВОК ----
        let head1 = `<tr>
            <th class="cmp-th-group col-sticky" rowspan="2">
                ${data.grouping
                    ? (METRIC_LABELS[data.grouping] || data.grouping)
                    : 'Группировка'}
            </th>`;
        periodLabels.forEach(label => {
            head1 += `<th class="cmp-th-period" colspan="${metricCount}">${label}</th>`;
        });
        head1 += '</tr>';

        let head2 = '<tr>';
        periodLabels.forEach(() => {
            selectedMetrics.forEach(metric => {
                head2 += `<th class="cmp-th-metric">${METRIC_LABELS[metric] || metric}</th>`;
            });
        });
        head2 += '</tr>';

        cmpTableHead.innerHTML = head1 + head2;

        // ---- ТЕЛО ----
        let bodyHtml = '';
        rows.forEach(row => {
            const groupLabel = groupLabels[row.group_key] || row.group_key || 'Все';
            bodyHtml += `<tr><td class="cmp-td-group col-sticky">${groupLabel}</td>`;

            row.periods.forEach(period => {
                selectedMetrics.forEach(metric => {
                    const mdata = period.metrics[metric];
                    bodyHtml += renderCmpDataCell(metric, mdata, convMap, period, selectedMetrics);
                });
            });

            bodyHtml += '</tr>';
        });

        cmpTableBody.innerHTML = bodyHtml;
    }

    // =========================================================
    // ЯЧЕЙКА ДАННЫХ ТАБЛИЦЫ СРАВНЕНИЯ
    // Строка 1: значение (+ конверсия от выбранного знаменателя)
    // Строка 2: дельта к предыдущему периоду (всегда с новой строки)
    // =========================================================
    function renderCmpDataCell(metric, mdata, convMap, period, selectedMetrics) {
        if (!mdata) {
            return `<td class="cmp-td"><div class="cmp-cell-inner">
                <div class="cmp-cell-top">
                    <span class="cmp-cell-value">—</span>
                </div>
            </div></td>`;
        }

        const val     = mdata.value;
        const pctPrev = mdata.pct_from_prev;

        const valStr = formatMetricValue(metric, val);

        // -------------------------------------------------------
        // Конверсия: считаем относительно знаменателя из выбранных метрик
        // convMap[metric] = метрика-знаменатель (из выбранных пользователем)
        // -------------------------------------------------------
        let convHtml = '';
        const denominatorMetric = convMap ? convMap[metric] : null;
        if (denominatorMetric && period && period.metrics) {
            const denomData = period.metrics[denominatorMetric];
            const denomVal  = denomData ? (denomData.value || 0) : 0;
            if (denomVal > 0 && val !== null && val !== undefined) {
                const convPct = (val / denomVal * 100).toFixed(1);
                convHtml = `<span class="conversion-percent">&nbsp;(${convPct}%)</span>`;
            }
        }

        // -------------------------------------------------------
        // Дельты — всегда с новой строки, одинаковый размер
        // -------------------------------------------------------
        let deltaItems = [];

        // Дельта значения к предыдущему периоду
        if (pctPrev !== null && pctPrev !== undefined) {
            const isUp   = pctPrev > 0;
            const isDown = pctPrev < 0;
            const sign   = isUp ? '+' : '';
            const cls    = isUp ? 'cmp-delta-up' : isDown ? 'cmp-delta-down' : 'cmp-delta-flat';
            const arrow  = isUp ? '↑' : isDown ? '↓' : '→';
            deltaItems.push(
                `<span class="cmp-delta cmp-delta-fixed ${cls}">${arrow}&nbsp;${sign}${pctPrev.toFixed(1)}%</span>`
            );
        }

        // Дельта конверсии к предыдущему периоду (в пп) — из бэкенда
        // Используем pct_conv_from_prev только если есть конверсия в бэкенде
        const pctConv = mdata.pct_conv_from_prev;
        if (CONVERSION_METRICS.has(metric) && pctConv !== null && pctConv !== undefined) {
            const isUp   = pctConv > 0;
            const isDown = pctConv < 0;
            const sign   = isUp ? '+' : '';
            const cls    = isUp ? 'cmp-delta-up' : isDown ? 'cmp-delta-down' : 'cmp-delta-flat';
            const arrow  = isUp ? '↑' : isDown ? '↓' : '→';
            deltaItems.push(
                `<span class="cmp-delta cmp-delta-fixed cmp-delta-conv ${cls}">${arrow}&nbsp;${sign}${pctConv.toFixed(1)}пп</span>`
            );
        }

        const deltasHtml = deltaItems.length > 0
            ? `<div class="cmp-cell-deltas">${deltaItems.join('')}</div>`
            : '';

        return `<td class="cmp-td">
            <div class="cmp-cell-inner">
                <div class="cmp-cell-top">
                    <span class="cmp-cell-value">${valStr}</span>${convHtml}
                </div>
                ${deltasHtml}
            </div>
        </td>`;
    }

    // =========================================================
    // ГРАФИКИ СРАВНЕНИЯ (Chart.js)
    // =========================================================
    function _destroyCharts() {
        _chartInstances.forEach(c => { try { c.destroy(); } catch(e) {} });
        _chartInstances = [];
    }

    function renderComparisonCharts(data, selectedMetrics) {
        _destroyCharts();
        if (!cmpChartsWrap) return;
        cmpChartsWrap.innerHTML = '';

        // Проверяем наличие Chart.js
        if (typeof Chart === 'undefined') {
            console.error('Chart.js не загружен');
            cmpChartsWrap.innerHTML =
                `<div style="padding:16px;color:#e74c3c;text-align:center;">
                    ⚠️ Не удалось загрузить библиотеку графиков (Chart.js).
                    Проверьте интернет-соединение.
                </div>`;
            return;
        }

        if (!data || !data.rows || data.rows.length === 0) return;

        const periodLabels = data.period_labels || [];
        const rows         = data.rows;
        const groupLabels  = data.group_labels || {};

        // Строим карту конверсий для графиков
        const convMap = buildConversionMap(selectedMetrics);

        selectedMetrics.forEach((metric) => {
            const metricLabel = METRIC_LABELS[metric] || metric;
            const hasConv     = !!(convMap[metric]); // есть знаменатель среди выбранных

            const chartBlock = document.createElement('div');
            chartBlock.className = 'cmp-chart-block';

            const title = document.createElement('div');
            title.className   = 'cmp-chart-title';
            title.textContent = metricLabel;
            chartBlock.appendChild(title);

            const canvas = document.createElement('canvas');
            canvas.className = 'cmp-chart-canvas';
            chartBlock.appendChild(canvas);
            cmpChartsWrap.appendChild(chartBlock);

            const datasets = [];

            rows.forEach((row, rowIdx) => {
                const color      = GROUP_COLORS[rowIdx % GROUP_COLORS.length];
                const groupLabel = groupLabels[row.group_key] || row.group_key || 'Все';

                // Значения метрики
                const valData = row.periods.map(p => {
                    const m = p.metrics[metric];
                    return m ? (m.value || 0) : 0;
                });

                datasets.push({
                    label:           groupLabel,
                    data:            valData,
                    borderColor:     color,
                    backgroundColor: color + '22',
                    borderWidth:     2,
                    pointRadius:     4,
                    pointHoverRadius:6,
                    tension:         0.3,
                    yAxisID:         'y',
                    fill:            false,
                });

                // Конверсия — пунктирная линия на правой оси
                // Считаем из выбранных метрик (convMap)
                if (hasConv) {
                    const denomMetric = convMap[metric];
                    const convData = row.periods.map(p => {
                        const mVal     = p.metrics[metric];
                        const denomVal = p.metrics[denomMetric];
                        const v  = mVal    ? (mVal.value    || 0) : 0;
                        const dv = denomVal ? (denomVal.value || 0) : 0;
                        return dv > 0 ? parseFloat((v / dv * 100).toFixed(2)) : 0;
                    });

                    datasets.push({
                        label:           `${groupLabel} (конв.%)`,
                        data:            convData,
                        borderColor:     color,
                        backgroundColor: 'transparent',
                        borderWidth:     1.5,
                        borderDash:      [5, 4],
                        pointRadius:     3,
                        pointHoverRadius:5,
                        tension:         0.3,
                        yAxisID:         'y2',
                        fill:            false,
                    });
                }
            });

            const scales = {
                x: {
                    grid:  { color: '#f0f0f0' },
                    ticks: { font: { size: 11 }, color: '#535c69' }
                },
                y: {
                    position: 'left',
                    grid:  { color: '#f0f0f0' },
                    ticks: {
                        font: { size: 11 }, color: '#535c69',
                        callback: (val) => {
                            if (CURRENCY_METRICS.has(metric)) {
                                return new Intl.NumberFormat('ru-RU', {
                                    notation: 'compact', compactDisplay: 'short'
                                }).format(val) + ' ₽';
                            }
                            if (PERCENT_METRICS.has(metric)) return val + '%';
                            return val;
                        }
                    }
                }
            };

            if (hasConv) {
                scales['y2'] = {
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: {
                        font: { size: 10 }, color: '#9aabb8',
                        callback: (val) => val + '%'
                    },
                    title: {
                        display: true,
                        text:    'Конверсия %',
                        font:    { size: 10 },
                        color:   '#9aabb8'
                    }
                };
            }

            try {
                const chart = new Chart(canvas, {
                    type: 'line',
                    data: { labels: periodLabels, datasets },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: {
                                position: 'top',
                                labels: {
                                    font: { size: 11 }, boxWidth: 14, padding: 10
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => {
                                        const ds     = ctx.dataset;
                                        const isConv = ds.yAxisID === 'y2';
                                        const val    = ctx.parsed.y;
                                        if (isConv)
                                            return `${ds.label}: ${val.toFixed(1)}%`;
                                        if (CURRENCY_METRICS.has(metric))
                                            return `${ds.label}: ${formatCurrency(val)}`;
                                        if (PERCENT_METRICS.has(metric))
                                            return `${ds.label}: ${val.toFixed(2)}%`;
                                        return `${ds.label}: ${val}`;
                                    }
                                }
                            }
                        },
                        scales
                    }
                });
                _chartInstances.push(chart);
            } catch(chartErr) {
                console.error('Ошибка создания графика:', chartErr);
                chartBlock.innerHTML +=
                    `<div style="color:#e74c3c;font-size:12px;padding:8px;">
                        Ошибка отрисовки графика
                    </div>`;
            }
        });
    }

    // =========================================================
    // НАСТРОЙКИ UTM
    // =========================================================
    function initSettingsHandlers() {
        utmLabelForm.addEventListener('submit', async e => {
            e.preventDefault();
            const utm_type    = utmLabelType.value;
            const utm_value   = utmLabelValue.value.trim();
            const custom_name = utmLabelName.value.trim();
            if (!utm_value) {
                await App.Notify.error('Ошибка', 'Укажите значение UTM-параметра.');
                return;
            }
            try {
                App.showLoader();
                await apiCallPost('save_utm_label', { utm_type, utm_value, custom_name });
                utmLabelValue.value = '';
                utmLabelName.value  = '';
                await loadUtmLabels();
                await App.Notify.success('Готово', 'Метка сохранена.');
            } catch(e) {
                await App.Notify.error('Ошибка', e.message);
            } finally {
                App.hideLoader();
            }
        });
    }

    async function loadUtmLabels() {
        utmLabelsBody.innerHTML =
            `<tr><td colspan="4" style="text-align:center;color:#828b95;">
                Загрузка...</td></tr>`;
        try {
            const labels = await apiCall('get_utm_labels', {});
            renderUtmLabels(labels);
        } catch(e) {
            utmLabelsBody.innerHTML =
                `<tr><td colspan="4" style="color:red;">Ошибка: ${e.message}</td></tr>`;
        }
    }

    function renderUtmLabels(labels) {
        if (!labels || labels.length === 0) {
            utmLabelsBody.innerHTML =
                `<tr><td colspan="4" style="text-align:center;color:#828b95;">
                    Нет меток. Добавьте первую.</td></tr>`;
            return;
        }
        utmLabelsBody.innerHTML = labels.map(l => `
            <tr>
                <td>${l.utm_type}</td>
                <td>${l.utm_value}</td>
                <td>${l.custom_name||'<span style="color:#828b95;">—</span>'}</td>
                <td style="text-align:center;">
                    <span class="action-icon" data-id="${l.id}"
                        style="color:#e74c3c;cursor:pointer;">🗑</span>
                </td>
            </tr>`).join('');

        utmLabelsBody.querySelectorAll('.action-icon[data-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    App.showLoader();
                    await apiCall('delete_utm_label', { id: btn.dataset.id });
                    await loadUtmLabels();
                } catch(e) {
                    await App.Notify.error('Ошибка', e.message);
                } finally {
                    App.hideLoader();
                }
            });
        });
    }

    // =========================================================
    // ОБРАБОТЧИКИ — ОБЩАЯ СТАТИСТИКА
    // =========================================================
    filterForm.addEventListener('submit', e => {
        e.preventDefault();
        loadStatistics();
    });

    resetBtn.addEventListener('click', () => {
        const today = new Date();
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput._flatpickr.setDate(first);
        endDateInput._flatpickr.setDate(today);
        groupingSelect.value     = 'source';
        periodModeSelect.value   = 'standard';
        attributionSelect.value  = 'last_touch';
        periodModeHint.style.display  = 'none';
        attributionWrap.style.display = 'none';
        window._mfStatsSource.reset();
        window._mfStatsDept.reset();
        loadStatistics();
    });

    // =========================================================
    // API HELPERS
    // =========================================================
    function buildApiUrl(action, params) {
        const url = new URL(window.location.href);
        url.searchParams.set('action', action);
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '')
                url.searchParams.set(k, v);
        });
        return url.toString();
    }

    async function apiCall(action, params) {
        const url = buildApiUrl(action, params);
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.statusText);
        const ct = response.headers.get('content-type');
        if (!ct || !ct.includes('application/json'))
            throw new TypeError('Ожидался JSON');
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
    }

    async function apiCallPost(action, body) {
        const url = buildApiUrl(action, {});
        const response = await fetch(url, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
    }

    // =========================================================
    // ЗАПУСК
    // =========================================================
    initialize();
};