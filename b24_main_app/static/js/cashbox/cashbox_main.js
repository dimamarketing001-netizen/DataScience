// Главный файл модуля "Касса", выполняет роль контроллера

// Создаем пространство имен для модуля кассы
App.cashbox = {};

App.initializeCashbox = async function() {
    console.log("Initializing Cashbox main controller...");

    // --- Состояние модуля ---
    let currentPage = 1;
    let currentFilters = {};
    let availableEmployees = [];
    let availableContractors = [];
    let expenseToDeleteId = null;

    // --- Элементы UI (для навешивания событий) ---
    const expenseForm = document.getElementById('expense-form');
    const expenseCategory = document.getElementById('expense-category');
    const filterForm = document.getElementById('expenses-filter-form');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    const editExpenseForm = document.getElementById('edit-expense-form');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');

    // --- Инициализация ---
    App.showLoader();
    try {
        const data = await App.cashbox.api.getInitialData();
        availableEmployees = data.users || [];
        availableContractors = data.sources || [];
        
        const categories = Array.from(expenseCategory.options).map(opt => ({ id: opt.value, name: opt.text })).slice(1);
        const employeeOptions = availableEmployees.map(u => ({ id: u.ID, name: u.NAME }));
        const contractorOptions = availableContractors.map(c => ({ id: c.ID, name: c.NAME }));

        App.cashbox.ui.setupFilterForm(categories, employeeOptions, contractorOptions);
        
        await loadExpensesTable();
    } catch (error) {
        alert(`Критическая ошибка инициализации кассы: ${error.message}`);
    } finally {
        App.hideLoader();
    }

    // --- Установка обработчиков событий ---
    flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

    expenseCategory.addEventListener('change', (event) => {
        const selectedCategory = event.target.value;
        App.cashbox.ui.toggleDynamicFields(selectedCategory, 'add');
        if (selectedCategory === 'employees') {
            App.populateSelect(document.getElementById('expense-employee'), availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...');
        } else if (selectedCategory === 'marketing') {
            App.populateSelect(document.getElementById('expense-contractor'), availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...');
        }
    });

    filterForm.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
    resetFilterBtn.addEventListener('click', resetFilters);
    expenseForm.addEventListener('submit', handleAddExpense);
    editExpenseForm.addEventListener('submit', handleUpdateExpense);
    cancelEditBtn.addEventListener('click', () => App.cashbox.ui.closeEditModal());
    confirmDeleteBtn.addEventListener('click', handleDeleteExpense);
    cancelDeleteBtn.addEventListener('click', () => App.cashbox.ui.closeDeleteConfirmModal());
    prevPageBtn.addEventListener('click', () => { if (currentPage > 1) { loadExpensesTable(currentPage - 1); } });
    nextPageBtn.addEventListener('click', () => { loadExpensesTable(currentPage + 1); });

    // --- Основные функции-обработчики ---

    async function loadExpensesTable(page = 1) {
        currentPage = page;
        App.showLoader();
        try {
            const params = { limit: 25, offset: (currentPage - 1) * 25, ...currentFilters };
            const data = await App.cashbox.api.getExpenses(params);
            App.cashbox.ui.renderExpensesTable(data.expenses, openEditModal, openDeleteConfirmModal);
            currentPage = App.cashbox.ui.updatePaginationControls(data.total_records, data.limit, data.offset);
        } catch (error) {
            alert(`Ошибка загрузки расходов: ${error.message}`);
            App.cashbox.ui.elements.expensesTableBody.innerHTML = `<tr><td colspan="11">Ошибка загрузки расходов.</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

    function applyFilters() {
        currentFilters = {
            start_date: document.getElementById('filter-start-date').value,
            end_date: document.getElementById('filter-end-date').value,
            // Удалены поля name, min_amount, max_amount
            category_val: document.getElementById('filter-category').value,
            employee_id: document.getElementById('filter-employee').value,
            source_id: document.getElementById('filter-contractor').value,
        };
        // Удаляем пустые значения из фильтров
        Object.keys(currentFilters).forEach(key => { if (!currentFilters[key]) delete currentFilters[key]; });
        loadExpensesTable(1);
    }

    function resetFilters() {
        filterForm.reset();
        currentFilters = {};
        // Дополнительно вызываем toggleFilterDynamicFields для скрытия полей при сбросе
        App.cashbox.ui.toggleFilterDynamicFields('');
        loadExpensesTable(1);
    }

    async function handleAddExpense(event) {
        event.preventDefault();
        const formData = {
            date: document.getElementById('expense-date').value,
            amount: parseFloat(document.getElementById('expense-amount').value),
            category_text: expenseCategory.options[expenseCategory.selectedIndex].text,
            category_val: expenseCategory.value,
            comment: document.getElementById('expense-comment').value,
            name: '',
            employee_id: document.getElementById('expense-employee').value,
            source_id: document.getElementById('expense-contractor').value,
            contact_id: document.getElementById('selected-client-id').value,
        };
        // ... логика формирования имени ...

        const isConfirmed = await App.showCustomConfirm({ title: 'Сохранение расхода', text: 'Вы уверены?', confirmButtonText: 'Сохранить' });
        if (isConfirmed) {
            App.showLoader();
            try {
                await App.cashbox.api.addExpense({ ...formData, added_by_user_id: App.currentUser.ID });
                alert("Расход успешно сохранен!");
                expenseForm.reset();
                App.cashbox.ui.toggleDynamicFields('');
                loadExpensesTable(1);
            } catch (error) {
                alert(`Ошибка сохранения: ${error.message}`);
            } finally {
                App.hideLoader();
            }
        }
    }

    async function openEditModal(expenseId) {
        App.showLoader();
        try {
            const expense = await App.cashbox.api.getSingleExpense(expenseId);
            App.cashbox.ui.openEditModal(expense);
        } catch (error) {
            alert(`Ошибка загрузки данных для редактирования: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }

    async function handleUpdateExpense(event) {
        event.preventDefault();
        const formData = {
            id: document.getElementById('edit-expense-id').value,
            name: document.getElementById('edit-expense-name').value,
            date: document.getElementById('edit-expense-date').value,
            amount: parseFloat(document.getElementById('edit-expense-amount').value),
            category_text: document.getElementById('edit-expense-category').options[document.getElementById('edit-expense-category').selectedIndex].text,
            category_val: document.getElementById('edit-expense-category').value,
            comment: document.getElementById('edit-expense-comment').value,
        };
        App.showLoader();
        try {
            await App.cashbox.api.updateExpense(formData);
            alert('Расход успешно обновлен!');
            App.cashbox.ui.closeEditModal();
            loadExpensesTable(currentPage);
        } catch (error) {
            alert(`Ошибка обновления: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }

    function openDeleteConfirmModal(expenseId) {
        expenseToDeleteId = expenseId;
        App.cashbox.ui.openDeleteConfirmModal();
    }

    async function handleDeleteExpense() {
        if (!expenseToDeleteId) return;
        App.showLoader();
        try {
            await App.cashbox.api.deleteExpense(expenseToDeleteId);
            alert('Расход удален.');
            App.cashbox.ui.closeDeleteConfirmModal();
            expenseToDeleteId = null;
            loadExpensesTable(currentPage);
        } catch (error) {
            alert(`Ошибка удаления: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }
};
