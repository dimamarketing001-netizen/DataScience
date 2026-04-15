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
        const selectedValue = selectedType === 'employee' ? employeeSelect.value : departmentSelect.value;

        // Убираем возможный старый префикс и добавляем правильный
        const cleanId = String(selectedValue).replace('user_', '').replace('department_', '');
        const entityIdPrefix = selectedType === 'employee' ? 'user_' : 'department_';
        const entityId = String(selectedValue).startsWith(entityIdPrefix) ? selectedValue : entityIdPrefix + selectedValue;


        if (!selectedValue || document.querySelector(`tr[data-entity-id="${entityId}"]`)) {
            await App.Notify.error('Ошибка', 'Это правило уже добавлено или ничего не выбрано.');
            return;
        }

        const entityList = selectedType === 'employee' ? availableUsers : availableDepartments;

        if (entity) {
            const defaultPermissions = {
                tabs: {
                    cashbox: { view: false, save: false, edit: false, delete: false },
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

        let perms;
        if (permissions.tabs && typeof permissions.tabs.cashbox === 'object') {
            perms = permissions;
        } else {
            perms = {
                tabs: {
                    cashbox: {
                        view: permissions.tabs?.cashbox,
                        save: permissions.actions?.can_save,
                        edit: permissions.actions?.can_save,
                        delete: permissions.actions?.can_delete
                    },
                    statistics: {
                        view: permissions.tabs?.statistics
                    },
                    access: {
                        view: permissions.tabs?.access,
                        save: permissions.actions?.can_save,
                        delete: permissions.actions?.can_delete
                    }
                }
            };
        }

        const nameCell = row.insertCell();
        nameCell.textContent = entityName;

        const permsCell = row.insertCell();
        permsCell.className = 'access-grid-cell';
        permsCell.innerHTML = `
            <div class="access-grid">
                <div class="access-group">
                    <strong>Касса:</strong>
                    <label><input type="checkbox" data-perm="tabs.cashbox.view" ${perms.tabs.cashbox?.view ? 'checked' : ''}> Просмотр</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.save" ${perms.tabs.cashbox?.save ? 'checked' : ''}> Сохранение</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.edit" ${perms.tabs.cashbox?.edit ? 'checked' : ''}> Редактирование</label>
                    <label><input type="checkbox" data-perm="tabs.cashbox.delete" ${perms.tabs.cashbox?.delete ? 'checked' : ''}> Удаление</label>
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

        if (!App.userPermissions.tabs.access.save) {
            saveBtn.classList.add('access-restricted');
        }
        if (!App.userPermissions.tabs.access.delete) {
            deleteBtn.classList.add('access-restricted');
        }

        const cashboxView = row.querySelector('[data-perm="tabs.cashbox.view"]');
        const accessView = row.querySelector('[data-perm="tabs.access.view"]');
        
        const updateDisabledState = () => {
            row.querySelector('[data-perm="tabs.cashbox.save"]').disabled = !cashboxView.checked;
            row.querySelector('[data-perm="tabs.cashbox.edit"]').disabled = !cashboxView.checked;
            row.querySelector('[data-perm="tabs.cashbox.delete"]').disabled = !cashboxView.checked;
            row.querySelector('[data-perm="tabs.access.save"]').disabled = !accessView.checked;
            row.querySelector('[data-perm="tabs.access.delete"]').disabled = !accessView.checked;
        };
        
        cashboxView.addEventListener('change', updateDisabledState);
        accessView.addEventListener('change', updateDisabledState);
        updateDisabledState();

        saveBtn.addEventListener('click', async () => {
            if(saveBtn.classList.contains('access-restricted')) return;
            const newPermissions = {
                tabs: {
                    cashbox: {
                        view: row.querySelector('[data-perm="tabs.cashbox.view"]').checked,
                        save: row.querySelector('[data-perm="tabs.cashbox.save"]').checked,
                        edit: row.querySelector('[data-perm="tabs.cashbox.edit"]').checked,
                        delete: row.querySelector('[data-perm="tabs.cashbox.delete"]').checked,
                    },
                    statistics: {
                        view: row.querySelector('[data-perm="tabs.statistics.view"]').checked,
                    },
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
            if(deleteBtn.classList.contains('access-restricted')) return;
            showDeleteConfirmation(entityId, row, entityName);
        });
    }
};
