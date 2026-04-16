// Логика для модуля "Приходы"
App.cashbox.incomes = {
    init: async function() {
        console.log("Initializing Incomes logic...");

        let currentPage = 1;
        let currentIncomes = []; // Кэш для редактирования

        const incomeForm = document.getElementById('income-form');
        const addIncomeBtn = incomeForm.querySelector('button[type="submit"]');
        const editIncomeForm = document.getElementById('edit-income-form');
        const cancelEditBtn = document.getElementById('cancel-edit-income-btn');
        const updateIncomeBtn = editIncomeForm.querySelector('button[type="submit"]');

        if (!App.userPermissions.tabs.cashbox.income.save) {
            addIncomeBtn.classList.add('access-restricted');
        }
        if (!App.userPermissions.tabs.cashbox.income.edit) {
            updateIncomeBtn.classList.add('access-restricted');
        }

        flatpickr("#income-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

        new App.ClientSearchHandler({
            searchInput: document.getElementById('income-client-search'),
            searchResultsContainer: document.getElementById('income-client-search-results'),
            selectedClientIdInput: document.getElementById('income-selected-client-id'),
            onClientSelected: handleClientSelection
        });
        
        new App.ClientSearchHandler({
            searchInput: document.getElementById('edit-income-client-search'),
            searchResultsContainer: document.getElementById('edit-income-client-search-results'),
            selectedClientIdInput: document.getElementById('edit-income-selected-client-id'),
            onClientSelected: handleClientSelection
        });

        async function handleClientSelection(clientId, searchInput) {
            const isEdit = searchInput && searchInput.id ? searchInput.id.includes('edit') : false;
            const dealSelect = document.getElementById(isEdit ? 'edit-income-deal-select' : 'income-deal-select');
            const dealWrapper = document.getElementById(isEdit ? 'edit-income-deal-wrapper' : 'income-deal-wrapper');

            if (!clientId) {
                App.cashbox.ui.renderDealSelect([], dealSelect, dealWrapper);
                return;
            }
            try {
                App.showLoader();
                const deals = await App.cashbox.api.getClientDeals(clientId);
                App.cashbox.ui.renderDealSelect(deals, dealSelect, dealWrapper);
            } catch (e) {
                App.Notify.error('Ошибка', `Не удалось загрузить сделки клиента: ${e.message}`);
            } finally {
                App.hideLoader();
            }
        }

        incomeForm.addEventListener('submit', handleAddIncome);
        editIncomeForm.addEventListener('submit', handleUpdateIncome);
        cancelEditBtn.addEventListener('click', () => App.cashbox.ui.closeEditIncomeModal());
        document.getElementById('incomes-table-body').addEventListener('click', handleTableClick);

        async function handleAddIncome(event) {
            event.preventDefault();
            if (addIncomeBtn.classList.contains('access-restricted')) return;

            const dealSelect = document.getElementById('income-deal-select');
            const selectedOption = dealSelect.options[dealSelect.selectedIndex];

            const formData = {
                date: document.getElementById('income-date').value,
                amount: parseFloat(document.getElementById('income-amount').value),
                contact_id: document.getElementById('income-selected-client-id').value,
                deal_id: dealSelect.value,                                          // 2086
                deal_type_id: selectedOption ? selectedOption.dataset.typeId || '' : '',   // SALE
                deal_type_name: selectedOption ? selectedOption.dataset.typeName || '' : '', // БФЛ
                comment: document.getElementById('income-comment').value,
                added_by_user_id: App.currentUser.ID
            };

            if (!formData.contact_id) {
                await App.Notify.error('Ошибка валидации', 'Необходимо выбрать клиента.');
                return;
            }

            App.showLoader();
            try {
                await App.cashbox.api.addIncome(formData);
                App.Notify.success("Приход успешно сохранен!");
                incomeForm.reset();
                App.cashbox.ui.renderDealSelect([], document.getElementById('income-deal-select'), document.getElementById('income-deal-wrapper'));
                loadIncomesTable();
            } catch (error) {
                await App.Notify.error('Ошибка сохранения', error.message);
            } finally {
                App.hideLoader();
            }
        }

        async function loadIncomesTable(page = 1) {
            currentPage = page;
            App.showLoader();
            try {
                const params = { limit: 25, offset: (page - 1) * 25 };
                const data = await App.cashbox.api.getIncomes(params);
                currentIncomes = data.incomes; // Кэшируем данные
                App.cashbox.ui.renderIncomesTable(currentIncomes);
            } catch (error) {
                await App.Notify.error('Ошибка', `Ошибка загрузки приходов: ${error.message}`);
            } finally {
                App.hideLoader();
            }
        }
        
        this.loadIncomesTable = loadIncomesTable;

        function handleTableClick(event) {
            const target = event.target;
            if (target.classList.contains('edit-income-btn')) {
                openEditIncomeModal(target.dataset.id);
            } else if (target.classList.contains('delete-income-btn')) {
                App.cashbox.openDeleteConfirmModal(target.dataset.id, 'income');
            }
        }

        async function openEditIncomeModal(incomeId) {
            const income = currentIncomes.find(inc => inc.id == incomeId);
            if (!income) {
                App.Notify.error('Ошибка', 'Не удалось найти данные для редактирования.');
                return;
            }

            // Открываем модалку и заполняем базовые поля
            App.cashbox.ui.openEditIncomeModal(income);

            // Если у прихода есть клиент — загружаем его сделки
            if (income.contact_id) {
                // Передаём edit-input чтобы handleClientSelection знал что это форма редактирования
                await handleClientSelection(
                    income.contact_id,
                    document.getElementById('edit-income-client-search')
                );

                // Явный String() — deal_id из MySQL приходит как число, а option.value всегда строка
                if (income.deal_id) {
                    document.getElementById('edit-income-deal-select').value = String(income.deal_id);
                }
            }
        }

        async function handleUpdateIncome(event) {
            event.preventDefault();
            if (updateIncomeBtn.classList.contains('access-restricted')) return;

            const editDealSelect = document.getElementById('edit-income-deal-select');
            const selectedEditOption = editDealSelect.options[editDealSelect.selectedIndex];

            const formData = {
                id: document.getElementById('edit-income-id').value,
                date: document.getElementById('edit-income-date').value,
                amount: parseFloat(document.getElementById('edit-income-amount').value),
                contact_id: document.getElementById('edit-income-selected-client-id').value,
                deal_id: editDealSelect.value,                                                    // 2086
                deal_type_id: selectedEditOption ? selectedEditOption.dataset.typeId || '' : '',         // SALE
                deal_type_name: selectedEditOption ? selectedEditOption.dataset.typeName || '' : '',     // БФЛ
                comment: document.getElementById('edit-income-comment').value,
            };

            App.showLoader();
            try {
                await App.cashbox.api.updateIncome(formData);
                App.Notify.success('Приход успешно обновлен!');
                App.cashbox.ui.closeEditIncomeModal();
                loadIncomesTable(currentPage);
            } catch (error) {
                await App.Notify.error('Ошибка обновления', error.message);
            } finally {
                App.hideLoader();
            }
        }
        
        loadIncomesTable();
    }
};
