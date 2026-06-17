App.initializeStatistics = async function () {

    const tabButtons = document.querySelectorAll('.stats-tab-btn');
    const tabContents = document.querySelectorAll('.stats-tab-content');

    const tableHead = document.getElementById('statistics-table-head');
    const tableBody = document.getElementById('statistics-table-body');

    const sourceFilter = document.getElementById('stats-source-filter');
    const salesDepartment = document.getElementById('stats-sales-department');

    const comparisonBtn = document.getElementById('comparison-apply-btn');
    const comparisonHead = document.getElementById('comparison-table-head');
    const comparisonBody = document.getElementById('comparison-table-body');

    flatpickr("#stats-start-date", { locale: "ru", dateFormat: "Y-m-d" });
    flatpickr("#stats-end-date", { locale: "ru", dateFormat: "Y-m-d" });

    // ===== ТАБЫ =====
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
        });
    });

    // ===== ЗАГРУЗКА ОТДЕЛОВ =====
    async function loadSalesDepartments() {
        const res = await fetch('?action=get_sales_departments');
        const data = await res.json();

        data.forEach(dep => {
            const option = document.createElement('option');
            option.value = dep.id;
            option.textContent = dep.name;
            salesDepartment.appendChild(option);
        });
    }

    // ===== ОБЩАЯ СТАТИСТИКА =====
    async function loadStatistics() {

        const params = {
            date_from: document.getElementById('stats-start-date').value,
            date_to: document.getElementById('stats-end-date').value,
            source_id: sourceFilter.value,
            sales_department: salesDepartment.value
        };

        const data = await App.statistics.api.getStatistics(params);

        renderHead();
        renderBody(data);
    }

    function renderHead() {

        tableHead.innerHTML = `
        <tr>
            <th>Источник</th>
            <th>Лиды</th>
            <th>Дозвон</th>
            <th>Назначена встреча</th>
            <th>Приход</th>
            <th>Успех</th>
        </tr>`;
    }

    function renderBody(data) {

        tableBody.innerHTML = '';

        data.forEach(row => {

            tableBody.innerHTML += `
            <tr>
                <td>${row.source_name}</td>
                <td>${row.total}</td>
                <td>${row.answered.count}</td>
                <td>${row.meeting_scheduled.count}</td>
                <td>${row.arrival.count}</td>
                <td>${row.success.count}</td>
            </tr>`;
        });
    }

    document.getElementById('statistics-filter-form')
        .addEventListener('submit', e => {
            e.preventDefault();
            loadStatistics();
        });

    // ===== COMPARISON =====
    comparisonBtn.addEventListener('click', async () => {

        const year = document.getElementById('comparison-year').value;
        const groupBy = document.getElementById('comparison-group-by').value;
        const periodType = document.getElementById('comparison-period-type').value;

        const params = new URLSearchParams({
            action: 'get_statistics_comparison',
            year: year,
            group_by: groupBy,
            period_type: periodType
        });

        const res = await fetch(`?${params.toString()}`);
        const data = await res.json();

        renderComparison(data);
    });

    function renderComparison(data) {

        comparisonHead.innerHTML = '';
        comparisonBody.innerHTML = '';

        const periods = Object.keys(data[0]?.values || {});

        let head = '<tr><th>Группа</th>';

        periods.forEach(p => head += `<th>${p}</th>`);

        head += '</tr>';

        comparisonHead.innerHTML = head;

        data.forEach(row => {

            let tr = `<tr><td>${row.group_name}</td>`;

            periods.forEach(p => {
                tr += `<td>${row.values[p]?.total?.count || 0}</td>`;
            });

            tr += '</tr>';
            comparisonBody.innerHTML += tr;
        });
    }

    await loadSalesDepartments();
    await loadStatistics();
};