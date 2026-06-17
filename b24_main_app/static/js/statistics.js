App.initializeStatistics = async function () {

    // ================================
    // ЭЛЕМЕНТЫ
    // ================================

    const stageCheckboxes = document.querySelectorAll('.comparison-stage');

    const tabButtons = document.querySelectorAll('.stats-tab-btn');
    const tabContents = document.querySelectorAll('.stats-tab-content');

    const tableBody = document.getElementById('statistics-table-body');
    const groupBySelect = document.getElementById('stats-group-by');
    const salesDepartmentSelect = document.getElementById('stats-sales-department');

    const utmCampaignBody = document.getElementById('utm-campaign-table-body');
    const utmContentBody = document.getElementById('utm-content-table-body');

    const comparisonBtn = document.getElementById('comparison-apply-btn');
    const comparisonHead = document.getElementById('comparison-table-head');
    const comparisonBody = document.getElementById('comparison-table-body');

    // ================================
    // КАЛЕНДАРИ
    // ================================

    flatpickr("#stats-start-date", { locale: "ru", dateFormat: "Y-m-d" });
    flatpickr("#stats-end-date", { locale: "ru", dateFormat: "Y-m-d" });

    // ================================
    // ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
    // ================================

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {

            tabButtons.forEach(b => {
                b.classList.remove('ui-btn-primary');
                b.classList.add('ui-btn-light-border');
            });

            btn.classList.remove('ui-btn-light-border');
            btn.classList.add('ui-btn-primary');

            tabContents.forEach(c => c.style.display = 'none');

            document.getElementById('stats-tab-' + btn.dataset.tab).style.display = 'block';

            if (btn.dataset.tab === 'settings') {
                loadUtmSettings();
            }
        });
    });

    // ================================
    // ЗАГРУЗКА ОТДЕЛОВ ПРОДАЖ
    // ================================

    async function loadSalesDepartments() {
        const response = await fetch(`?action=get_sales_departments`);
        const data = await response.json();

        data.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            salesDepartmentSelect.appendChild(option);
        });
    }

    // ================================
    // ОБЩАЯ СТАТИСТИКА
    // ================================

    document.getElementById('statistics-filter-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await loadStatistics();
    });

    async function loadStatistics() {

        const params = {
            date_from: document.getElementById('stats-start-date').value,
            date_to: document.getElementById('stats-end-date').value,
            group_by: groupBySelect.value,
            sales_department: salesDepartmentSelect.value
        };

        const data = await App.statistics.api.getStatistics(params);

        tableBody.innerHTML = '';

        data.forEach(row => {

            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td>${row.group_name}</td>
                <td>
                    <span class="stat-clickable" 
                          data-group="${row.group_value}"
                          data-group-by="${groupBySelect.value}">
                        ${row.total}
                    </span>
                </td>
                <td>${row.success}</td>
            `;

            tableBody.appendChild(tr);
        });
    }

    // ================================
    // ДЕТАЛИЗАЦИЯ
    // ================================

    document.addEventListener('click', async (e) => {
        if (!e.target.classList.contains('stat-clickable')) return;

        const groupValue = e.target.dataset.group;
        const groupBy = e.target.dataset.groupBy;

        const params = new URLSearchParams({
            action: 'get_statistics_details',
            date_from: document.getElementById('stats-start-date').value,
            date_to: document.getElementById('stats-end-date').value,
            group_by: groupBy,
            group_value: groupValue
        });

        const response = await fetch(`?${params.toString()}`);
        const data = await response.json();

        showDetailsModal(data);
    });

    function showDetailsModal(leads) {

        const modalHtml = `
            <div id="details-modal" class="modal-overlay" style="display:flex;">
                <div class="modal-content" style="width:600px; max-height:80vh; overflow:auto;">
                    <div class="ui-form-title">
                        <div class="ui-form-title-text">Детализация</div>
                    </div>
                    <div>
                        ${leads.map(l => `
                            <div style="padding:6px 0; border-bottom:1px solid #eee;">
                                <a href="${App.b24Domain}/crm/lead/details/${l.id}/" 
                                   target="_blank">
                                   ${l.title}
                                </a>
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top:15px; text-align:center;">
                        <button class="ui-btn ui-btn-light-border"
                                onclick="document.getElementById('details-modal').remove()">
                                Закрыть
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // ================================
    // UTM НАСТРОЙКИ
    // ================================

    async function loadUtmSettings() {
        await loadUtmTable('utm_campaign', utmCampaignBody);
        await loadUtmTable('utm_content', utmContentBody);
    }

    async function loadUtmTable(type, tableBody) {

        const response = await fetch(`?action=get_utm_values&utm_type=${type}`);
        const data = await response.json();

        tableBody.innerHTML = '';

        data.forEach(item => {

            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td>${item.utm_value}</td>
                <td>
                    <input type="text" value="${item.custom_name || ''}" 
                           class="ui-ctl-element">
                </td>
                <td>
                    <button class="ui-btn ui-btn-primary">Сохранить</button>
                </td>
            `;

            const input = tr.querySelector('input');
            const button = tr.querySelector('button');

            button.addEventListener('click', async () => {
                await fetch(`?action=save_utm_label`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        utm_type: type,
                        utm_value: item.utm_value,
                        custom_name: input.value
                    })
                });

                App.Notify.success("Сохранено");
            });

            tableBody.appendChild(tr);
        });
    }

    // ================================
    // СРАВНЕНИЕ
    // ================================

    comparisonBtn.addEventListener('click', async () => {
        await loadComparison();
    });

    async function loadComparison() {

        const year = document.getElementById('comparison-year').value;
        const groupBy = document.getElementById('comparison-group-by').value;

        const params = new URLSearchParams();
        params.append('action', 'get_statistics_comparison');
        params.append('year', year);
        params.append('group_by', groupBy);
        params.append('period_type', document.getElementById('comparison-period-type').value);

        metricCheckboxes.forEach(cb => {
            if (cb.checked) {
                params.append('metrics', cb.value);
            }
        });

        const response = await fetch(`?${params.toString()}`);
        const data = await response.json();

        renderComparisonTable(data);
    }

    function renderComparisonTable(data) {

        comparisonHead.innerHTML = '';
        comparisonBody.innerHTML = '';

        const selectedStages = Array.from(stageCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        const periods = Object.keys(data[0]?.values || {});

        let headRow = '<tr><th>Группа</th>';

        periods.forEach((p, index) => {

            selectedStages.forEach(stage => {
                headRow += `<th>${p} (${stage})</th>`;
                headRow += `<th>% prev</th>`;
                headRow += `<th>% total</th>`;
                if (index < periods.length - 1) {
                    headRow += `<th>Δ count</th>`;
                    headRow += `<th>Δ %prev</th>`;
                    headRow += `<th>Δ %total</th>`;
                }
            });
        });

        headRow += '</tr>';
        comparisonHead.innerHTML = headRow;

        data.forEach(row => {

            let tr = `<tr><td>${row.group_name}</td>`;

            periods.forEach((p, index) => {

                selectedStages.forEach(stage => {

                    const currentData = row.values[p]?.[stage] || {
                        count: 0,
                        conv_from_prev: 0,
                        conv_from_total: 0
                    };

                    const nextData = row.values[periods[index + 1]]?.[stage] || null;

                    tr += `<td>${currentData.count}</td>`;
                    tr += `<td>${currentData.conv_from_prev.toFixed(1)}%</td>`;
                    tr += `<td>${currentData.conv_from_total.toFixed(1)}%</td>`;

                    if (nextData) {

                        // ===== Δ COUNT (относительный рост)
                        let diffCount = 0;
                        if (currentData.count > 0) {
                            diffCount = ((nextData.count - currentData.count) / currentData.count) * 100;
                        }

                        // ===== Δ CONV (% пункты)
                        const diffPrev = nextData.conv_from_prev - currentData.conv_from_prev;
                        const diffTotal = nextData.conv_from_total - currentData.conv_from_total;

                        tr += buildDiffCell(diffCount, true);
                        tr += buildDiffCell(diffPrev, false);
                        tr += buildDiffCell(diffTotal, false);
                    }
                });
            });

            tr += '</tr>';
            comparisonBody.innerHTML += tr;
        });
    }

    function buildDiffCell(value, isRelative) {

        let diffClass = '';
        let arrow = '';

        if (value > 0) {
            diffClass = 'diff-positive';
            arrow = '↑';
        } else if (value < 0) {
            diffClass = 'diff-negative';
            arrow = '↓';
        }

        const display = isRelative
            ? `${arrow} ${value.toFixed(1)}%`
            : `${arrow} ${value.toFixed(1)} п.п.`;

        return `<td class="${diffClass}">${display}</td>`;
    }

    document.addEventListener('click', async (e) => {

        if (!e.target.classList.contains('comparison-clickable')) return;

        const groupValue = e.target.dataset.group;
        const month = e.target.dataset.month;
        const year = document.getElementById('comparison-year').value;
        const groupBy = document.getElementById('comparison-group-by').value;

        const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;

        let dateTo;
        if (month == 12) {
            dateTo = `${year}-12-31`;
        } else {
            const nextMonth = Number(month) + 1;
            dateTo = `${year}-${String(nextMonth).padStart(2, '0')}-01`;
        }

        const params = new URLSearchParams({
            action: 'get_statistics_details',
            date_from: dateFrom,
            date_to: dateTo,
            group_by: groupBy,
            group_value: groupValue
        });

        const response = await fetch(`?${params.toString()}`);
        const data = await response.json();

        showDetailsModal(data);
    });

    // ================================
    // ПЕРВИЧНАЯ ЗАГРУЗКА
    // ================================

    await loadSalesDepartments();
    await loadStatistics();
};