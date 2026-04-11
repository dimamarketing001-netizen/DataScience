BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

    // --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
    let currentUser = null;
    let userPermissions = null;
    let currentPage = 1;
    let expensesPerPage = 25;
    let currentFilters = {};
    let availableEmployees = [];
    let availableContractors = [];
    let userCache = {};
    let cashboxInitialized = false;
    let statisticsInitialized = false;
    let accessInitialized = false;
    let sortedStatuses = [];

    // --- ЭЛЕМЕНТЫ UI ---
    const loaderOverlay = document.getElementById('loader-overlay');
    const appContainer = document.getElementById('app-container');
    const screens = document.querySelectorAll('.app-screen');
    const mainMenu = document.getElementById('main-menu');
    const menuCards = document.querySelectorAll('.menu-card');
    const backButtons = document.querySelectorAll('.back-button');
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationModalTitle = document.getElementById('confirmation-modal-title');
    const confirmationModalText = document.getElementById('confirmation-modal-text');
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    const cancelActionBtn = document.getElementById('cancel-action-btn');
    const expenseForm = document.getElementById('expense-form');
    const expenseCategory = document.getElementById('expense-category');
    const dynamicFields = {
        employees: document.getElementById('employee-fields'),
        marketing: document.getElementById('marketing-fields'),
        clients: document.getElementById('client-fields')
    };
    const clientSearchInput = document.getElementById('expense-client-search');
    const clientSearchResults = document.getElementById('client-search-results');
    const selectedClientIdInput = document.getElementById('selected-client-id');
    const expensesTableBody = document.getElementById('expenses-table-body');
    const pageInfoSpan = document.getElementById('page-info');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const dashboardContainer = document.getElementById('dashboard-container');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');

    // --- ОБЩИЕ ФУНКЦИИ ---
    const showLoader = () => loaderOverlay.style.display = 'flex';
    const hideLoader = () => loaderOverlay.style.display = 'none';

    const showScreen = (screenToShow) => {
        screens.forEach(screen => screen.classList.remove('active'));
        if (screenToShow) screenToShow.classList.add('active');
    };
    
    const populateSelect = (selectElement, data, placeholder) => {
        selectElement.innerHTML = `<option value="">${placeholder}</option>`;
        data.forEach(item => {
            selectElement.add(new Option(item.name, item.id));
        });
    };

    function showCustomConfirm({ title = 'Подтвердите действие', text = 'Вы уверены?', confirmButtonText = 'Подтвердить', confirmButtonClass = 'ui-btn-primary' }) {
        return new Promise(resolve => {
            confirmationModalTitle.textContent = title;
            confirmationModalText.innerHTML = text;
            confirmActionBtn.textContent = confirmButtonText;
            confirmActionBtn.className = `ui-btn btn-fixed-width ${confirmButtonClass}`;
            confirmationModal.style.display = 'flex';
            confirmActionBtn.onclick = () => {
                confirmationModal.style.display = 'none';
                resolve(true);
            };
            cancelActionBtn.onclick = () => {
                confirmationModal.style.display = 'none';
                resolve(false);
            };
        });
    }

    // --- ЛОГИКА ДОСТУПОВ И АВТОРИЗАЦИИ ---
    function applyPermissions(permissions) {
        if (!permissions || !permissions.can_access_app) {
            showScreen(document.getElementById('no-access-screen'));
            appContainer.style.display = 'block';
            hideLoader();
            return false;
        }

        menuCards.forEach(card => {
            const tabName = card.dataset.tab;
            card.style.display = permissions.tabs[tabName] ? 'block' : 'none';
        });

        document.querySelectorAll('[data-action="save"]').forEach(btn => {
            btn.disabled = !permissions.actions.can_save;
            btn.style.cursor = permissions.actions.can_save ? 'pointer' : 'not-allowed';
        });
        
        return true;
    }

    // --- ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ---
    function initializeApp() {
        showLoader();
        BX24.callMethod('user.current', {}, async (res) => {
            if (res.error()) {
                console.error("Failed to get current user:", res.error());
                applyPermissions(null);
                return;
            }
            currentUser = res.data();
            console.log("Current user data received:", currentUser);

            try {
                const permRes = await fetch(`/?action=my_permissions&user_id=${currentUser.ID}&department_id=${currentUser.UF_DEPARTMENT[0]}`);
                if (!permRes.ok) {
                    const errorText = await permRes.text();
                    throw new Error(`Failed to fetch permissions: ${permRes.status} ${permRes.statusText} - ${errorText}`);
                }
                userPermissions = await permRes.json();
                console.log("User permissions received:", userPermissions);

                if (applyPermissions(userPermissions)) {
                    appContainer.style.display = 'block';
                    showScreen(mainMenu);
                }
            } catch (e) {
                console.error("Error during permission check:", e);
                applyPermissions(null);
            } finally {
                hideLoader();
            }
        });
    }

    // --- НАВИГАЦИЯ ---
    menuCards.forEach(card => {
        card.addEventListener('click', () => {
            const tab = card.dataset.tab;
            const screen = document.getElementById(`${tab}-screen`);
            if (screen) {
                if (tab === 'cashbox' && !cashboxInitialized) { initializeCashbox(); cashboxInitialized = true; }
                if (tab === 'statistics' && !statisticsInitialized) { initializeStatistics(); statisticsInitialized = true; }
                if (tab === 'access' && !accessInitialized) { initializeAccessTab(); accessInitialized = true; }
                showScreen(screen);
            }
        });
    });
    backButtons.forEach(button => button.addEventListener('click', () => showScreen(mainMenu)));

    // --- ЛОГИКА ВКЛАДКИ "ДОСТУПЫ" ---
    async function initializeAccessTab() {
        const selectEl = document.getElementById('access-entity-select');
        const rulesContainer = document.getElementById('access-rules-container');
        let availableEntities = [];

        showLoader();
        try {
            const res = await fetch(`/?action=initial_data_for_access`);
            const data = await res.json();
            availableEntities = [...data.users, ...data.departments];
            populateSelect(selectEl, availableEntities, "Выберите сотрудника или отдел...");
            await loadAccessRules();
        } catch (e) { 
            console.error("Failed to load entities for access tab", e);
            alert('Не удалось загрузить данные для настройки доступов.');
        } finally {
            hideLoader();
        }

        document.getElementById('add-access-rule-btn').addEventListener('click', () => {
            const selectedId = selectEl.value;
            if (!selectedId || document.querySelector(`.access-rule-card[data-entity-id="${selectedId}"]`)) return;
            
            const entity = availableEntities.find(e => e.id === selectedId);
            if (entity) {
                renderAccessRuleCard(entity.id, entity.name, {
                    can_access_app: true,
                    tabs: { cashbox: false, statistics: false, access: false },
                    actions: { can_save: false, can_delete: false }
                });
            }
        });

        async function loadAccessRules() {
            const res = await fetch(`/?action=access_rights`);
            const rules = await res.json();
            rulesContainer.innerHTML = '';
            rules.forEach(rule => {
                renderAccessRuleCard(rule.entity_id, rule.entity_name, rule.permissions);
            });
        }

        function renderAccessRuleCard(entityId, entityName, permissions) {
            const card = document.createElement('div');
            card.className = 'access-rule-card';
            card.dataset.entityId = entityId;

            card.innerHTML = `
                <h4>${entityName}</h4>
                <div class="access-grid">
                    <label><input type="checkbox" data-perm="can_access_app" ${permissions.can_access_app ? 'checked' : ''}> Доступ к приложению</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox" ${permissions.tabs.cashbox ? 'checked' : ''}> Вкладка "Касса"</label>
                    <label><input type="checkbox" data-perm="tabs.statistics" ${permissions.tabs.statistics ? 'checked' : ''}> Вкладка "Статистика"</label>
                    <label><input type="checkbox" data-perm="tabs.access" ${permissions.tabs.access ? 'checked' : ''}> Вкладка "Доступы"</label>
                    <label><input type="checkbox" data-perm="actions.can_save" ${permissions.actions.can_save ? 'checked' : ''}> Право на сохр./ред.</label>
                    <label><input type="checkbox" data-perm="actions.can_delete" ${permissions.actions.can_delete ? 'checked' : ''}> Право на удаление</label>
                </div>
                <button class="ui-btn ui-btn-primary save-rule-btn" data-action="save">Сохранить</button>
            `;
            rulesContainer.appendChild(card);

            card.querySelector('.save-rule-btn').addEventListener('click', async () => {
                const newPermissions = {
                    can_access_app: card.querySelector('[data-perm="can_access_app"]').checked,
                    tabs: {
                        cashbox: card.querySelector('[data-perm="tabs.cashbox"]').checked,
                        statistics: card.querySelector('[data-perm="tabs.statistics"]').checked,
                        access: card.querySelector('[data-perm="tabs.access"]').checked,
                    },
                    actions: {
                        can_save: card.querySelector('[data-perm="actions.can_save"]').checked,
                        can_delete: card.querySelector('[data-perm="actions.can_delete"]').checked,
                    }
                };
                
                showLoader();
                try {
                    await fetch(`/?action=access_rights`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            entity_id: entityId,
                            entity_name: entityName,
                            permissions: newPermissions
                        })
                    });
                    alert('Права сохранены!');
                } catch (e) {
                    alert('Ошибка сохранения прав.');
                } finally {
                    hideLoader();
                }
            });
        }
    }
    
    // --- ЛОГИКА КАССЫ ---
    async function initializeCashbox() {
        console.log("Initializing Cashbox Screen...");
        showLoader();
        Object.values(dynamicFields).forEach(field => field.style.display = 'none');

        try {
            const response = await fetch(`/?action=cashbox_initial_data`);
            if (!response.ok) throw new Error('Failed to load cashbox initial data');
            const data = await response.json();

            availableEmployees = data.users || [];
            availableContractors = data.sources || [];
            
            userCache = (data.users || []).reduce((acc, user) => {
                acc[user.ID] = user.NAME;
                return acc;
            }, {});
            console.log("User cache for Cashbox initialized:", userCache);

            loadExpensesTable();
        } catch (error) {
            console.error("Error fetching cashbox initial data:", error);
            alert(`Критическая ошибка: не удалось загрузить данные для кассы. ${error.message}`);
        } finally {
            hideLoader();
        }

        flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

        expenseCategory.addEventListener('change', (event) => {
            Object.values(dynamicFields).forEach(field => field.style.display = 'none');
            const selectedCategory = event.target.value;
            if (dynamicFields[selectedCategory]) {
                dynamicFields[selectedCategory].style.display = 'block';
            }
            if (selectedCategory === 'employees') {
                populateSelect(document.getElementById('expense-employee'), availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...');
            } else if (selectedCategory === 'marketing') {
                populateSelect(document.getElementById('expense-contractor'), availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...');
            }
        });
    }

    expenseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = {
            date: document.getElementById('expense-date').value,
            amount: parseFloat(document.getElementById('expense-amount').value),
            category: expenseCategory.options[expenseCategory.selectedIndex].text,
            category_val: expenseCategory.value,
            comment: document.getElementById('expense-comment').value,
            name: ''
        };

        let details = '';
        if (formData.category_val === 'employees') {
            const employeeSelect = document.getElementById('expense-employee');
            formData.employee_id = employeeSelect.value;
            formData.employee_name = employeeSelect.options[employeeSelect.selectedIndex].text;
            formData.paymentType = document.getElementById('expense-payment-type').value;
            details = `<li>Сотрудник: <strong>${formData.employee_name}</strong></li><li>Тип: <strong>${formData.paymentType}</strong></li>`;
            formData.name = `ЗП/Мотивация: ${formData.employee_name}`;
        } else if (formData.category_val === 'marketing') {
            const contractorSelect = document.getElementById('expense-contractor');
            formData.contractor_id = contractorSelect.value;
            formData.contractor_name = contractorSelect.options[contractorSelect.selectedIndex].text;
            details = `<li>Подрядчик: <strong>${formData.contractor_name}</strong></li>`;
            formData.name = `Маркетинг: ${formData.contractor_name}`;
        } else if (formData.category_val === 'clients') {
            formData.client_id = selectedClientIdInput.value;
            formData.client_name = clientSearchInput.value;
            details = `<li>Клиент: <strong>${formData.client_name}</strong></li>`;
            formData.name = `Расход по клиенту: ${formData.client_name}`;
        } else {
            formData.name = `${formData.category}: ${formData.comment.substring(0, 50)}`;
        }
        
        const isConfirmed = await showCustomConfirm({ 
            title: 'Сохранение расхода', 
            text: `
                <p>Вы уверены, что хотите сохранить расход?</p>
                <ul>
                    <li>Дата: <strong>${formData.date}</strong></li>
                    <li>Сумма: <strong>${formData.amount}</strong></li>
                    <li>Категория: <strong>${formData.category}</strong></li>
                    ${details}
                    ${formData.comment ? `<li>Комментарий: <strong>${formData.comment}</strong></li>` : ''}
                </ul>
            `, 
            confirmButtonText: 'Сохранить' 
        });

        if (isConfirmed) {
            console.log(`Попытка сохранения... ID юзера: ${currentUser.ID}, Данные:`, formData);
            showLoader();
            try {
                await fetch(`/?action=add_expense`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...formData, added_by_user_id: currentUser.ID })
                });
                alert("Расход успешно сохранен!");
                expenseForm.reset();
                Object.values(dynamicFields).forEach(field => field.style.display = 'none');
                loadExpensesTable();
            } catch (error) {
                alert(`Ошибка при сохранении расхода: ${error.message}`);
            } finally {
                hideLoader();
            }
        }
    });

    async function loadExpensesTable() {
        showLoader();
        try {
            const queryParams = new URLSearchParams({ action: 'expenses', limit: expensesPerPage, offset: (currentPage - 1) * expensesPerPage, ...currentFilters });
            const response = await fetch(`/?${queryParams.toString()}`);
            if (!response.ok) throw new Error('Failed to load expenses');
            const data = await response.json();
            renderExpensesTable(data.expenses);
            updatePaginationControls(data.total_records, data.limit, data.offset);
        } catch (error) {
            console.error("Error loading expenses table:", error);
            expensesTableBody.innerHTML = `<tr><td colspan="11">Ошибка загрузки расходов: ${error.message}</td></tr>`;
        } finally {
            hideLoader();
        }
    }

    function renderExpensesTable(expenses) {
        expensesTableBody.innerHTML = '';
        if (expenses.length === 0) {
            expensesTableBody.innerHTML = `<tr><td colspan="11">Нет записей о расходах.</td></tr>`;
            return;
        }
        expenses.forEach(expense => {
            const row = expensesTableBody.insertRow();
            row.insertCell().textContent = expense.id;
            row.insertCell().textContent = expense.name;
            row.insertCell().textContent = expense.expense_date;
            row.insertCell().textContent = parseFloat(expense.amount).toFixed(2);
            row.insertCell().textContent = expense.category;
            row.insertCell().textContent = expense.employee_name || '';
            row.insertCell().textContent = expense.source_name || '';
            row.insertCell().textContent = expense.contact_name || '';
            row.insertCell().textContent = expense.comment || '';
            row.insertCell().textContent = userCache[expense.added_by_user_id] || expense.added_by_user_name || 'Неизвестно';
            
            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';
            if (userPermissions.actions.can_save) {
                actionsCell.innerHTML += `<span class="action-icon edit-icon" data-id="${expense.id}" title="Редактировать">✏️</span>`;
            }
            if (userPermissions.actions.can_delete) {
                actionsCell.innerHTML += `<span class="action-icon delete-icon" data-id="${expense.id}" title="Удалить" data-action="delete">🗑️</span>`;
            }
        });

        expensesTableBody.querySelectorAll('.edit-icon').forEach(icon => icon.addEventListener('click', (e) => openEditModal(e.target.dataset.id)));
        expensesTableBody.querySelectorAll('.delete-icon').forEach(icon => icon.addEventListener('click', (e) => openDeleteConfirmModal(e.target.dataset.id)));
    }

    function updatePaginationControls(totalRecords, limit, offset) {
        const totalPages = Math.ceil(totalRecords / limit) || 1;
        const currentPageCalculated = Math.floor(offset / limit) + 1;
        pageInfoSpan.textContent = `Страница ${currentPageCalculated} из ${totalPages}`;
        prevPageBtn.disabled = currentPageCalculated === 1;
        nextPageBtn.disabled = currentPageCalculated >= totalPages;
    }
    
    // --- ЛОГИКА СТАТИСТИКИ ---
    function initializeStatistics() {
        console.log("Initializing Statistics Screen...");
        if (!dashboardContainer || !startDateInput || !endDateInput || !sourceFilter || !applyFilterBtn) {
            console.error("Ошибка инициализации: один из элементов экрана статистики не найден.");
            return;
        }
        flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);
        fetchInitialDataForStatistics();
    }

    async function fetchInitialDataForStatistics() {
        showLoader();
        try {
            const response = await fetch(`/?action=initial_data`); // Предполагается, что этот эндпоинт существует
            if (!response.ok) throw new Error('Failed to load initial data for statistics');
            const data = await response.json();

            if (data.sources) {
                sourceFilter.innerHTML = '<option value="">Все источники</option>';
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
            console.error("Error fetching initial data for statistics:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для статистики.</p>`;
        } finally {
            hideLoader();
        }
    }

    async function fetchLeadsAndRenderDashboard() {
        showLoader();
        const queryParams = new URLSearchParams({
            action: 'leads',
            startDate: startDateInput.value,
            endDate: endDateInput.value,
            source: sourceFilter.value
        });

        try {
            const response = await fetch(`/?${queryParams}`);
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

    // --- ЗАПУСК ПРИЛОЖЕНИЯ ---
    initializeApp();
});