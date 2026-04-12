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

        employeeSelect.innerHTML = '<option value="">Выберите сотрудника...</option>';
        availableUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.name;
            employeeSelect.appendChild(option);
        });

        departmentSelect.innerHTML = '<option value="">Выберите отдел...</option>';
        availableDepartments.forEach(dep => {
            const option = document.createElement('option');
            option.value = dep.id;
            option.textContent = dep.name;
            departmentSelect.appendChild(option);
        });

        await loadAccessRules();
    } catch (e) {
        console.error("Failed to load entities for access tab", e);
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
        const selectedId = selectedType === 'employee' ? employeeSelect.value : departmentSelect.value;

        if (!selectedId || document.querySelector(`tr[data-entity-id="${selectedId}"]`)) {
            await App.Notify.error('Ошибка', 'Это правило уже добавлено или ничего не выбрано.');
            return;
        }

        const entityList = selectedType === 'employee' ? availableUsers : availableDepartments;
        const entity = entityList.find(e => String(e.id) === selectedId);

        if (entity) {
            renderAccessRuleRow(entity.id, entity.name, {
                can_access_app: true,
                tabs: {cashbox: false, statistics: false, access: false},
                actions: {can_save: false, can_delete: false}
            });
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

        const {entityId, rowElement, entityName} = ruleToDelete;
        App.showLoader();
        try {
            // ИЗМЕНЕНО: Структура тела запроса теперь полностью повторяет структуру сохранения
            const res = await fetch(`?action=access_rights`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    entity_id: entityId,
                    entity_name: entityName,
                    sub_action: 'delete', // Сигнал для бэкенда на удаление
                    permissions: { // Добавляем пустой объект permissions, чтобы соответствовать структуре
                        can_access_app: false,
                        tabs: {cashbox: false, statistics: false, access: false},
                        actions: {can_save: false, can_delete: false}
                    }
                })
            });

            if (!res.ok) throw new Error('Server responded with an error during deletion');

            rowElement.remove();
            App.Notify.success('Правило удалено.');
        } catch (e) {
            await App.Notify.error('Ошибка', 'Ошибка удаления правила.');
            console.error(e);
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

        const nameCell = row.insertCell();
        nameCell.textContent = entityName;

        const permsCell = row.insertCell();
        permsCell.className = 'access-grid-cell';
        permsCell.innerHTML = `
            <div class="access-grid">
                <label><input type="checkbox" data-perm="can_access_app" ${permissions.can_access_app ? 'checked' : ''}> Доступ к приложению</label>
                <label><input type="checkbox" data-perm="tabs.cashbox" ${permissions.tabs.cashbox ? 'checked' : ''}> Вкладка "Касса"</label>
                <label><input type="checkbox" data-perm="tabs.statistics" ${permissions.tabs.statistics ? 'checked' : ''}> Вкладка "Статистика"</label>
                <label><input type="checkbox" data-perm="tabs.access" ${permissions.tabs.access ? 'checked' : ''}> Вкладка "Доступы"</label>
                <label><input type="checkbox" data-perm="actions.can_save" ${permissions.actions.can_save ? 'checked' : ''}> Право на сохр./ред.</label>
                <label><input type="checkbox" data-perm="actions.can_delete" ${permissions.actions.can_delete ? 'checked' : ''}> Право на удаление</label>
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

        if (App.userPermissions && !App.userPermissions.actions.can_save) {
            saveBtn.disabled = true;
            saveBtn.style.cursor = 'not-allowed';
        }
        if (App.userPermissions && !App.userPermissions.actions.can_delete) {
            deleteBtn.disabled = true;
            deleteBtn.style.cursor = 'not-allowed';
        }

        saveBtn.addEventListener('click', async () => {
            const newPermissions = {
                can_access_app: row.querySelector('[data-perm="can_access_app"]').checked,
                tabs: {
                    cashbox: row.querySelector('[data-perm="tabs.cashbox"]').checked,
                    statistics: row.querySelector('[data-perm="tabs.statistics"]').checked,
                    access: row.querySelector('[data-perm="tabs.access"]').checked,
                },
                actions: {
                    can_save: row.querySelector('[data-perm="actions.can_save"]').checked,
                    can_delete: row.querySelector('[data-perm="actions.can_delete"]').checked,
                }
            };

            App.showLoader();
            try {
                const res = await fetch(`?action=access_rights`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        entity_id: entityId,
                        entity_name: entityName,
                        permissions: newPermissions
                    })
                });
                if (!res.ok) throw new Error('Server responded with an error');
                App.Notify.success('Права сохранены!');
            } catch (e) {
                await App.Notify.error('Ошибка', 'Ошибка сохранения прав.');
                console.error(e);
            } finally {
                App.hideLoader();
            }
        });

        deleteBtn.addEventListener('click', () => {
            showDeleteConfirmation(entityId, row, entityName);
        });
    }
};
