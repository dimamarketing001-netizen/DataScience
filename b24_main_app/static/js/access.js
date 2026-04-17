// Модуль для управления правами доступа
App.initializeAccessTab = async function () {
    console.log("Initializing Access Tab...");

    const employeeSelect = document.getElementById('access-employee-select');
    const departmentSelect = document.getElementById('access-department-select');
    const employeeSelectWrapper = document.getElementById('access-employee-select-wrapper');
    const departmentSelectWrapper = document.getElementById('access-department-select-wrapper');
    const accessTypeSelect = document.getElementById('access-type-select');
    const rulesTableBody = document.getElementById('access-rules-table-body');
    const deleteRuleModal = document.getElementById('delete-rule-confirm-modal');
    const confirmDeleteRuleBtn = document.getElementById('confirm-delete-rule-btn');
    const cancelDeleteRuleBtn = document.getElementById('cancel-delete-rule-btn');

    let availableUsers = [];
    let availableDepartments = [];
    let ruleToDelete = null;

    // --- Инициализация ---
    App.showLoader();
    try {
        const res = await fetch(`?action=initial_data_for_access`);
        if (!res.ok) throw new Error('Failed to load entities for access tab');
        const data = await res.json();

        availableUsers = data.users || [];
        availableDepartments = data.departments || [];

        App.populateSelect(employeeSelect, availableUsers.map(u => ({id: u.id, name: u.name})), 'Выберите сотрудника...');
        App.populateSelect(departmentSelect, availableDepartments.map(d => ({id: d.id, name: d.name})), 'Выберите отдел...');

        await loadAccessRules();
    } catch (e) {
        console.error("Error initializing access tab:", e);
        await App.Notify.error('Ошибка', 'Не удалось загрузить данные для настройки доступов.');
    } finally {
        App.hideLoader();
    }

    // --- Обработчики событий ---
    accessTypeSelect.addEventListener('change', () => {
        if (accessTypeSelect.value === 'employee') {
            employeeSelectWrapper.style.display = '';
            departmentSelectWrapper.style.display = 'none';
        } else {
            employeeSelectWrapper.style.display = 'none';
            departmentSelectWrapper.style.display = '';
        }
    });

    document.getElementById('add-access-rule-btn').addEventListener('click', async () => {
        const selectedType = accessTypeSelect.value;
        const selectedValue = selectedType === 'employee' ? employeeSelect.value : departmentSelect.value;
        const entityIdPrefix = selectedType === 'employee' ? 'user_' : 'department_';
        const entityId = entityIdPrefix + selectedValue;

        if (!selectedValue || document.querySelector(`tr[data-entity-id="${entityId}"]`)) {
            await App.Notify.error('Ошибка', 'Это правило уже добавлено или ничего не выбрано.');
            return;
        }

        const entityList = selectedType === 'employee' ? availableUsers : availableDepartments;
        const entity = entityList.find(e => String(e.id) === selectedValue);

        if (entity) {
            const defaultPermissions = {
                tabs: {
                    cashbox: { view: false, income: { view: false, save: false, edit: false, delete: false }, expense: { view: false, save: false, edit: false, delete: false } },
                    statistics: { view: false },
                    access: { view: false, save: false, delete: false }
                }
            };
            renderAccessRuleRow(entityId, entity.name, defaultPermissions);
        }
    });

    // --- Функции модального окна ---
    function showDeleteConfirmation(entityId, rowElement, entityName) {
        ruleToDelete = {entityId, rowElement, entityName};
        deleteRuleModal.style.display = 'flex';
    }

    function hideDeleteConfirmation() {
        ruleToDelete = null;
        deleteRuleModal.style.display = 'none';
    }

    cancelDeleteRuleBtn.addEventListener('click', hideDeleteConfirmation);

    confirmDeleteRuleBtn.addEventListener('click', async () => {
        if (!ruleToDelete) return;
        const {entityId, rowElement} = ruleToDelete;
        App.showLoader();
        try {
            const res = await fetch(`?action=access_rights`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ entity_id: entityId, sub_action: 'delete' })
            });
            if (!res.ok) throw new Error('Server responded with an error during deletion');
            rowElement.remove();
            App.Notify.success('Правило удалено.');
        } catch (e) {
            await App.Notify.error('Ошибка', 'Ошибка удаления правила.');
        } finally {
            App.hideLoader();
            hideDeleteConfirmation();
        }
    });

    // --- Функции ---
    async function loadAccessRules() {
        const res = await fetch(`?action=access_rights`);
        const rules = await res.json();
        rulesTableBody.innerHTML = '';
        rules.forEach(rule => {
            renderAccessRuleRow(rule.entity_id, rule.entity_name, rule.permissions);
        });
    }

    function renderAccessRuleRow(entityId, entityName, permissions) {
        const row = rulesTableBody.insertRow();
        row.dataset.entityId = entityId;

        const perms = permissions;

        const nameCell = row.insertCell();
        nameCell.textContent = entityName;

        const permsCell = row.insertCell();
        permsCell.className = 'access-grid-cell';
        permsCell.innerHTML = `
            <div class="access-grid">
                <div class="access-group">
                    <strong>Касса (общий доступ):</strong>
                    <label><input type="checkbox" data-perm="tabs.cashbox.view" ${perms.tabs.cashbox?.view ? 'checked' : ''}> Просмотр вкладки</label>
                </div>
                <div class="access-group">
                    <strong>Касса / Приходы:</strong>
                    <label><input type="checkbox" data-perm="tabs.cashbox.income.view" ${perms.tabs.cashbox?.income?.view ? 'checked' : ''}> Просмотр</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.income.save" ${perms.tabs.cashbox?.income?.save ? 'checked' : ''}> Сохранение</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.income.edit" ${perms.tabs.cashbox?.income?.edit ? 'checked' : ''}> Редактирование</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.income.delete" ${perms.tabs.cashbox?.income?.delete ? 'checked' : ''}> Удаление</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.income.confirm" ${perms.tabs.cashbox?.income?.confirm ? 'checked' : ''}> Подтверждение</label>
                </div>
                <div class="access-group">
                    <strong>Касса / Расходы:</strong>
                    <label><input type="checkbox" data-perm="tabs.cashbox.expense.view" ${perms.tabs.cashbox?.expense?.view ? 'checked' : ''}> Просмотр</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.expense.save" ${perms.tabs.cashbox?.expense?.save ? 'checked' : ''}> Сохранение</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.expense.edit" ${perms.tabs.cashbox?.expense?.edit ? 'checked' : ''}> Редактирование</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.expense.delete" ${perms.tabs.cashbox?.expense?.delete ? 'checked' : ''}> Удаление</label>
                </div>
                <div class="access-group">
                    <strong>Доступы:</strong>
                    <label><input type="checkbox" data-perm="tabs.access.view" ${perms.tabs.access?.view ? 'checked' : ''}> Просмотр</label>
                    <label><input type="checkbox" data-perm="tabs.access.save" ${perms.tabs.access?.save ? 'checked' : ''}> Сохранение</label>
                    <label><input type="checkbox" data-perm="tabs.access.delete" ${perms.tabs.access?.delete ? 'checked' : ''}> Удаление</label>
                </div>
                <div class="access-group">
                    <strong>Статистика:</strong>
                    <label><input type="checkbox" data-perm="tabs.statistics.view" ${perms.tabs.statistics?.view ? 'checked' : ''}> Просмотр</label>
                </div>
            </div>
        `;

        const actionCell = row.insertCell();
        actionCell.className = 'actions-column';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'ui-btn ui-btn-primary save-rule-btn';
        saveBtn.textContent = 'Сохранить';
        actionCell.appendChild(saveBtn);
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'ui-btn ui-btn-danger delete-rule-btn';
        deleteBtn.textContent = 'Удалить';
        actionCell.appendChild(deleteBtn);

        if (!App.userPermissions.tabs.access.save) saveBtn.classList.add('access-restricted');
        if (!App.userPermissions.tabs.access.delete) deleteBtn.classList.add('access-restricted');

        const cashboxView = row.querySelector('[data-perm="tabs.cashbox.view"]');
        const incomeView = row.querySelector('[data-perm="tabs.cashbox.income.view"]');
        const expenseView = row.querySelector('[data-perm="tabs.cashbox.expense.view"]');
        const accessView = row.querySelector('[data-perm="tabs.access.view"]');
        
        const updateDisabledState = () => {
            const cashboxChecked = cashboxView.checked;
            incomeView.disabled = !cashboxChecked;
            expenseView.disabled = !cashboxChecked;
            
            row.querySelector('[data-perm="tabs.cashbox.income.save"]').disabled = !cashboxChecked || !incomeView.checked;
            row.querySelector('[data-perm="tabs.cashbox.income.edit"]').disabled = !cashboxChecked || !incomeView.checked;
            row.querySelector('[data-perm="tabs.cashbox.income.delete"]').disabled = !cashboxChecked || !incomeView.checked;
            
            row.querySelector('[data-perm="tabs.cashbox.expense.save"]').disabled = !cashboxChecked || !expenseView.checked;
            row.querySelector('[data-perm="tabs.cashbox.expense.edit"]').disabled = !cashboxChecked || !expenseView.checked;
            row.querySelector('[data-perm="tabs.cashbox.expense.delete"]').disabled = !cashboxChecked || !expenseView.checked;
            row.querySelector('[data-perm="tabs.cashbox.income.confirm"]').disabled = !cashboxChecked || !incomeView.checked;

            row.querySelector('[data-perm="tabs.access.save"]').disabled = !accessView.checked;
            row.querySelector('[data-perm="tabs.access.delete"]').disabled = !accessView.checked;
        };
        
        [cashboxView, incomeView, expenseView, accessView].forEach(el => el.addEventListener('change', updateDisabledState));
        updateDisabledState();

        saveBtn.addEventListener('click', async () => {
            if(saveBtn.classList.contains('access-restricted')) return;
            const newPermissions = {
                tabs: {
                    cashbox: {
                        view: row.querySelector('[data-perm="tabs.cashbox.view"]').checked,
                        income: {
                            view:    row.querySelector('[data-perm="tabs.cashbox.income.view"]').checked,
                            save:    row.querySelector('[data-perm="tabs.cashbox.income.save"]').checked,
                            edit:    row.querySelector('[data-perm="tabs.cashbox.income.edit"]').checked,
                            delete:  row.querySelector('[data-perm="tabs.cashbox.income.delete"]').checked,
                            confirm: row.querySelector('[data-perm="tabs.cashbox.income.confirm"]').checked,
                        },
                        expense: {
                            view: row.querySelector('[data-perm="tabs.cashbox.expense.view"]').checked,
                            save: row.querySelector('[data-perm="tabs.cashbox.expense.save"]').checked,
                            edit: row.querySelector('[data-perm="tabs.cashbox.expense.edit"]').checked,
                            delete: row.querySelector('[data-perm="tabs.cashbox.expense.delete"]').checked,
                        }
                    },
                    statistics: { view: row.querySelector('[data-perm="tabs.statistics.view"]').checked },
                    access: {
                        view: row.querySelector('[data-perm="tabs.access.view"]').checked,
                        save: row.querySelector('[data-perm="tabs.access.save"]').checked,
                        delete: row.querySelector('[data-perm="tabs.access.delete"]').checked,
                    }
                }
            };

            App.showLoader();
            try {
                const res = await fetch(`?action=access_rights`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ entity_id: entityId, entity_name: entityName, permissions: newPermissions })
                });
                if (!res.ok) throw new Error('Server responded with an error');
                App.Notify.success('Права сохранены!');
            } catch (e) {
                await App.Notify.error('Ошибка', 'Ошибка сохранения прав.');
            } finally {
                App.hideLoader();
            }
        });

        deleteBtn.addEventListener('click', () => {
            if(deleteBtn.classList.contains('access-restricted')) return;
            showDeleteConfirmation(entityId, row, entityName);
        });
    }
};
