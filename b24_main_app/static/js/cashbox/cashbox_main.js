// Главный файл модуля "Касса", выполняет роль контроллера
App.cashbox = {
    // Инициализация будет вызвана из app.js
    init: function() {
        console.log("Initializing Cashbox main controller...");

        // --- Элементы UI ---
        const choiceMenu = document.getElementById('cashbox-choice-menu');
        const incomeSection = document.getElementById('cashbox-income-section');
        const expenseSection = document.getElementById('cashbox-expense-section');
        const backToChoiceBtns = document.querySelectorAll('.cashbox-back-button');
        const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
        const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

        // --- Состояние ---
        let itemToDelete = { id: null, type: null };
        let expenseModuleInitialized = false;
        let incomeModuleInitialized = false;

        // --- Навигация ---
        document.getElementById('goto-add-income').addEventListener('click', () => showSection('income'));
        document.getElementById('goto-add-expense').addEventListener('click', () => showSection('expense'));
        backToChoiceBtns.forEach(btn => btn.addEventListener('click', () => showSection('choice')));

        function showSection(sectionName) {
            choiceMenu.style.display = sectionName === 'choice' ? 'flex' : 'none';
            incomeSection.style.display = sectionName === 'income' ? 'block' : 'none';
            expenseSection.style.display = sectionName === 'expense' ? 'block' : 'none';

            if (sectionName === 'income' && !incomeModuleInitialized) {
                if (App.cashbox.incomes && typeof App.cashbox.incomes.init === 'function') {
                    App.cashbox.incomes.init();
                    incomeModuleInitialized = true;
                }
            }
            if (sectionName === 'expense' && !expenseModuleInitialized) {
                if (App.cashbox.expenses && typeof App.cashbox.expenses.init === 'function') {
                    App.cashbox.expenses.init();
                    expenseModuleInitialized = true;
                }
            }
        }

        // --- Общая логика ---
        App.cashbox.openDeleteConfirmModal = function(id, type) {
            itemToDelete = { id, type };
            App.cashbox.ui.openDeleteConfirmModal();
        };

        async function handleDeleteItem() {
            if (!itemToDelete.id || !App.userPermissions.tabs.cashbox.delete) return;
            App.showLoader();
            try {
                if (itemToDelete.type === 'income') {
                    await App.cashbox.api.deleteIncome(itemToDelete.id);
                    App.Notify.success('Приход удален.');
                    if (App.cashbox.incomes && typeof App.cashbox.incomes.loadIncomesTable === 'function') {
                        App.cashbox.incomes.loadIncomesTable();
                    }
                } else {
                    await App.cashbox.api.deleteExpense(itemToDelete.id);
                    App.Notify.success('Расход удален.');
                    if (App.cashbox.expenses && typeof App.cashbox.expenses.loadExpensesTable === 'function') {
                         App.cashbox.expenses.loadExpensesTable();
                    }
                }
            } catch (error) {
                await App.Notify.error('Ошибка удаления', error.message);
            } finally {
                itemToDelete = { id: null, type: null };
                App.cashbox.ui.closeDeleteConfirmModal();
                App.hideLoader();
            }
        }

        confirmDeleteBtn.addEventListener('click', handleDeleteItem);
        cancelDeleteBtn.addEventListener('click', () => App.cashbox.ui.closeDeleteConfirmModal());
        
        // Показываем меню выбора при первом входе
        showSection('choice');
    }
};
