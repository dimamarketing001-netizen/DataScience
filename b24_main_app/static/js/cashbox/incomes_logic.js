// Логика для модуля "Приходы"
App.cashbox.incomes = {
    init: async function() {
        console.log("Initializing Incomes logic...");

        // --- Состояние модуля ---
        let currentPage = 1;

        // --- Элементы UI ---
        const incomeForm = document.getElementById('income-form');
        const addIncomeBtn = incomeForm.querySelector('button[type="submit"]');

        // --- ИСПРАВЛЕНИЕ: Проверяем правильные, гранулярные права ---
        if (!App.userPermissions.tabs.cashbox.income.save) {
            addIncomeBtn.classList.add('access-restricted');
        }

        // --- Инициализация ---
        flatpickr("#income-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });
        
        new App.ClientSearchHandler({
            searchInput: document.getElementById('income-client-search'),
            searchResultsContainer: document.getElementById('income-client-search-results'),
            selectedClientIdInput: document.getElementById('income-selected-client-id'),
            onClientSelected: async (clientId) => {
                if (!clientId) {
                    App.cashbox.ui.renderDealSelect([]);
                    return;
                }
                try {
                    App.showLoader();
                    const deals = await App.cashbox.api.getClientDeals(clientId);
                    App.cashbox.ui.renderDealSelect(deals);
                } catch (e) {
                    App.Notify.error('Ошибка', `Не удалось загрузить сделки клиента: ${e.message}`);
                } finally {
                    App.hideLoader();
                }
            }
        });

        // --- Обработчики ---
        incomeForm.addEventListener('submit', handleAddIncome);
        
        // --- Функции ---
        async function handleAddIncome(event) {
            event.preventDefault();
            if (addIncomeBtn.classList.contains('access-restricted')) return;

            const formData = {
                date: document.getElementById('income-date').value,
                amount: parseFloat(document.getElementById('income-amount').value),
                contact_id: document.getElementById('income-selected-client-id').value,
                deal_id: document.getElementById('income-deal-select').value,
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
                App.cashbox.ui.renderDealSelect([]);
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
                App.cashbox.ui.renderIncomesTable(data.incomes, (id) => App.cashbox.openDeleteConfirmModal(id, 'income'));
                // TODO: Добавить пагинацию для приходов, если нужно
            } catch (error) {
                await App.Notify.error('Ошибка', `Ошибка загрузки приходов: ${error.message}`);
            } finally {
                App.hideLoader();
            }
        }
        
        // Сделаем функцию доступной извне для перезагрузки после удаления
        this.loadIncomesTable = loadIncomesTable;
        
        // Первоначальная загрузка
        loadIncomesTable();
    }
};
