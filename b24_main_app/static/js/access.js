// Модуль для управления правами доступа
App.initializeAccessTab = async function() {
    console.log("Initializing Access Tab...");
    const selectEl = document.getElementById('access-entity-select');
    const rulesContainer = document.getElementById('access-rules-container');
    let availableEntities = [];

    App.showLoader();
    try {
        const res = await fetch(`?action=initial_data_for_access`);
        if (!res.ok) throw new Error('Failed to load entities for access tab');
        const data = await res.json();
        
        availableEntities = [...(data.users || []), ...(data.departments || [])];
        App.populateSelect(selectEl, availableEntities, "Выберите сотрудника или отдел...");
        
        await loadAccessRules();
    } catch (e) { 
        console.error("Failed to load entities for access tab", e);
        alert('Не удалось загрузить данные для настройки доступов.');
    } finally {
        App.hideLoader();
    }

    document.getElementById('add-access-rule-btn').addEventListener('click', () => {
        const selectedId = selectEl.value;
        if (!selectedId || document.querySelector(`.access-rule-card[data-entity-id="${selectedId}"]`)) {
            return;
        }
        
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
        const res = await fetch(`?action=access_rights`);
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

        // Применяем права к только что созданной кнопке
        const saveBtn = card.querySelector('.save-rule-btn');
        if (App.userPermissions && !App.userPermissions.actions.can_save) {
            saveBtn.disabled = true;
            saveBtn.style.cursor = 'not-allowed';
        }

        saveBtn.addEventListener('click', async () => {
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
            
            App.showLoader();
            try {
                const res = await fetch(`?action=access_rights`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity_id: entityId,
                        entity_name: entityName,
                        permissions: newPermissions
                    })
                });
                if (!res.ok) throw new Error('Server responded with an error');
                alert('Права сохранены!');
            } catch (e) {
                alert('Ошибка сохранения прав.');
                console.error(e);
            } finally {
                App.hideLoader();
            }
        });
    }
};
