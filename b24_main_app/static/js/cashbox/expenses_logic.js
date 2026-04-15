// Логика для модуля "Расходы"
App.cashbox.expenses = {
    init: async function() {
        console.log("Initializing Expenses logic...");

        let currentPage = 1;
        let currentFilters = {};
        let availableEmployees = [];
        let availableContractors = [];

        const expenseForm = document.getElementById('expense-form');
        const expenseCategory = document.getElementById('expense-category');
        const filterForm = document.getElementById('expenses-filter-form');
        const resetFilterBtn = document.getElementById('reset-filter-btn');
        const editExpenseForm = document.getElementById('edit-expense-form');
        const cancelEditBtn = document.getElementById('cancel-edit-btn');
        const prevPageBtn = document.getElementById('prev-page-btn');
        const nextPageBtn = document.getElementById('next-page-btn');
        const addExpenseBtn = expenseForm.querySelector('button[type="submit"]');
        const updateExpenseBtn = editExpenseForm.querySelector('button[type="submit"]');

        // --- ИСПРАВЛЕНИЕ: Проверяем правильные, гранулярные права ---
        if (!App.userPermissions.tabs.cashbox.expense.save) {
            addExpenseBtn.classList.add('access-restricted');
        }
        if (!App.userPermissions.tabs.cashbox.expense.edit) {
            updateExpenseBtn.classList.add('access-restricted');
        }

        try {
            App.showLoader();
            const data = await App.cashbox.api.getInitialData();
            availableEmployees = data.users || [];
            availableContractors = data.sources || [];
            const categories = Array.from(expenseCategory.options).map(opt => ({ id: opt.value, name: opt.text })).slice(1);
            App.cashbox.ui.setupFilterForm(categories, availableEmployees.map(u=>({id: u.ID, name: u.NAME})), availableContractors.map(c=>({id: c.ID, name: c.NAME})));
            await loadExpensesTable();
        } catch (error) {
            await App.Notify.error('Ошибка', `Критическая ошибка инициализации расходов: ${error.message}`);
        } finally {
            App.hideLoader();
        }

        flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });
        expenseCategory.addEventListener('change', (event) => {
            const selectedCategory = event.target.value;
            App.cashbox.ui.toggleDynamicFields(selectedCategory, 'add');
            if (selectedCategory !== 'clients') document.getElementById('selected-client-id').value = '';
            if (selectedCategory !== 'employees') document.getElementById('expense-employee').value = '';
            if (selectedCategory !== 'marketing') document.getElementById('expense-contractor').value = '';
            if (selectedCategory === 'employees') App.populateSelect(document.getElementById('expense-employee'), availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...');
            else if (selectedCategory === 'marketing') App.populateSelect(document.getElementById('expense-contractor'), availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...');
        });

        filterForm.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
        resetFilterBtn.addEventListener('click', resetFilters);
        expenseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (addExpenseBtn.classList.contains('access-restricted')) return;
            handleAddExpense(e);
        });
        editExpenseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (updateExpenseBtn.classList.contains('access-restricted')) return;
            handleUpdateExpense(e);
        });
        cancelEditBtn.addEventListener('click', () => App.cashbox.ui.closeEditModal());
        prevPageBtn.addEventListener('click', () => { if (currentPage > 1) loadExpensesTable(currentPage - 1); });
        nextPageBtn.addEventListener('click', () => loadExpensesTable(currentPage + 1));

        async function loadExpensesTable(page = 1) {
            currentPage = page;
            App.showLoader();
            try {
                const params = { limit: 25, offset: (currentPage - 1) * 25, ...currentFilters };
                const data = await App.cashbox.api.getExpenses(params);
                App.cashbox.ui.renderExpensesTable(data.expenses, openEditModal, (id) => App.cashbox.openDeleteConfirmModal(id, 'expense'));
                currentPage = App.cashbox.ui.updatePaginationControls(data.total_records, data.limit, data.offset);
            } catch (error) {
                await App.Notify.error('Ошибка', `Ошибка загрузки расходов: ${error.message}`);
            } finally {
                App.hideLoader();
            }
        }
        
        this.loadExpensesTable = loadExpensesTable;

        function applyFilters() {
            currentFilters = {
                start_date: document.getElementById('filter-start-date').value,
                end_date: document.getElementById('filter-end-date').value,
                category_val: document.getElementById('filter-category').value,
                employee_id: document.getElementById('filter-employee').value,
                source_id: document.getElementById('filter-contractor').value,
            };
            Object.keys(currentFilters).forEach(key => { if (!currentFilters[key]) delete currentFilters[key]; });
            loadExpensesTable(1);
        }

        function resetFilters() {
            filterForm.reset();
            currentFilters = {};
            App.cashbox.ui.toggleFilterDynamicFields('');
            loadExpensesTable(1);
        }

        async function handleAddExpense(event) {
            const paidLeadsValue = document.getElementById('expense-paid-leads').value;
            const freeLeadsValue = document.getElementById('expense-free-leads').value;
            const formData = {
                date: document.getElementById('expense-date').value,
                amount: parseFloat(document.getElementById('expense-amount').value),
                category_text: expenseCategory.options[expenseCategory.selectedIndex].text,
                category_val: expenseCategory.value,
                comment: document.getElementById('expense-comment').value,
                employee_id: document.getElementById('expense-employee').value,
                source_id: document.getElementById('expense-contractor').value,
                contact_id: document.getElementById('selected-client-id').value,
                paid_leads: paidLeadsValue === '' ? null : parseInt(paidLeadsValue),
                free_leads: freeLeadsValue === '' ? null : parseInt(freeLeadsValue),
            };
            if (formData.category_val === 'employees' && !formData.employee_id) {
                await App.Notify.error('Ошибка', "Поле 'Сотрудник' обязательно для категории 'Сотрудники'.");
                return;
            }
            const formDataForDisplay = {
                'Дата': formData.date, 'Сумма': formData.amount, 'Категория': formData.category_text,
            };
            if (formData.comment) formDataForDisplay['Комментарий'] = formData.comment;
            const selectedCategory = formData.category_val;
            if (selectedCategory === 'employees') {
                const employeeSelect = document.getElementById('expense-employee');
                if (employeeSelect.value) formDataForDisplay['Сотрудник'] = employeeSelect.options[employeeSelect.selectedIndex].text;
                const paymentTypeSelect = document.getElementById('expense-payment-type');
                if (paymentTypeSelect.value) formDataForDisplay['Тип выплаты'] = paymentTypeSelect.options[paymentTypeSelect.selectedIndex].text;
            } else if (selectedCategory === 'marketing') {
                const contractorSelect = document.getElementById('expense-contractor');
                if (contractorSelect.value) formDataForDisplay['Подрядчик'] = contractorSelect.options[contractorSelect.selectedIndex].text;
                if (formData.paid_leads !== null) formDataForDisplay['Платные лиды'] = formData.paid_leads;
                if (formData.free_leads !== null) formDataForDisplay['Бесплатные лиды'] = formData.free_leads;
            } else if (selectedCategory === 'clients') {
                const clientSearchInput = document.getElementById('expense-client-search');
                if (clientSearchInput.value) formDataForDisplay['Клиент'] = clientSearchInput.value;
            }
            const isConfirmed = await App.showCustomConfirm({
                title: 'Подтвердите сохранение расхода',
                text: 'Вы уверены, что хотите сохранить следующий расход?',
                data: formDataForDisplay,
                confirmButtonText: 'Сохранить'
            });
            if (isConfirmed) {
                App.showLoader();
                try {
                    await App.cashbox.api.addExpense({ ...formData, added_by_user_id: App.currentUser.ID });
                    App.Notify.success("Расход успешно сохранен!");
                    expenseForm.reset();
                    App.cashbox.ui.toggleDynamicFields('');
                    loadExpensesTable(1);
                } catch (error) {
                    await App.Notify.error('Ошибка сохранения', error.message);
                } finally {
                    App.hideLoader();
                }
            }
        }

        async function openEditModal(expenseId) {
            App.showLoader();
            try {
                const expense = await App.cashbox.api.getSingleExpense(expenseId);
                App.cashbox.ui.openEditModal(expense, availableEmployees, availableContractors);
            } catch (error) {
                await App.Notify.error('Ошибка', `Ошибка загрузки данных для редактирования: ${error.message}`);
            } finally {
                App.hideLoader();
            }
        }

        async function handleUpdateExpense(event) {
            const editExpenseCategory = document.getElementById('edit-expense-category');
            const selectedCategory = editExpenseCategory.value;
            const editPaidLeadsValue = document.getElementById('edit-expense-paid-leads').value;
            const editFreeLeadsValue = document.getElementById('edit-expense-free-leads').value;
            const formData = {
                id: document.getElementById('edit-expense-id').value,
                date: document.getElementById('edit-expense-date').value,
                amount: parseFloat(document.getElementById('edit-expense-amount').value),
                category_text: editExpenseCategory.options[editExpenseCategory.selectedIndex].text,
                category_val: selectedCategory,
                comment: document.getElementById('edit-expense-comment').value,
                employee_id: '', source_id: '', contact_id: '', payment_type: '',
                paid_leads: editPaidLeadsValue === '' ? null : parseInt(editPaidLeadsValue),
                free_leads: editFreeLeadsValue === '' ? null : parseInt(editFreeLeadsValue),
            };
            if (selectedCategory === 'employees') {
                formData.employee_id = document.getElementById('edit-expense-employee').value;
                formData.payment_type = document.getElementById('edit-expense-payment-type').value;
            } else if (selectedCategory === 'marketing') {
                formData.source_id = document.getElementById('edit-expense-contractor').value;
            } else if (selectedCategory === 'clients') {
                formData.contact_id = document.getElementById('edit-selected-client-id').value;
            }
            if (selectedCategory === 'employees' && !formData.employee_id) {
                await App.Notify.error('Ошибка', "Поле 'Сотрудник' обязательно для категории 'Сотрудники'.");
                return;
            }
            const formDataForDisplay = {
                'Дата': formData.date, 'Сумма': formData.amount, 'Категория': editExpenseCategory.options[editExpenseCategory.selectedIndex].text,
            };
            if (selectedCategory === 'employees') {
                const employeeSelect = document.getElementById('edit-expense-employee');
                if (employeeSelect.value) formDataForDisplay['Сотрудник'] = employeeSelect.options[employeeSelect.selectedIndex].text;
                const paymentTypeSelect = document.getElementById('edit-expense-payment-type');
                if (paymentTypeSelect.value) formDataForDisplay['Тип выплаты'] = paymentTypeSelect.options[paymentTypeSelect.selectedIndex].text;
            } else if (selectedCategory === 'marketing') {
                const contractorSelect = document.getElementById('edit-expense-contractor');
                if (contractorSelect.value) formDataForDisplay['Подрядчик'] = contractorSelect.options[contractorSelect.selectedIndex].text;
                if (formData.paid_leads !== null) formDataForDisplay['Платные лиды'] = formData.paid_leads;
                if (formData.free_leads !== null) formDataForDisplay['Бесплатные лиды'] = formData.free_leads;
            } else if (selectedCategory === 'clients') {
                const clientSearchInput = document.getElementById('edit-expense-client-search');
                if (clientSearchInput.value) formDataForDisplay['Клиент'] = clientSearchInput.value;
            }
            if (formData.comment) formDataForDisplay['Комментарий'] = formData.comment;
            const isConfirmed = await App.showCustomConfirm({
                title: 'Подтвердите обновление расхода',
                text: 'Вы уверены, что хотите обновить следующий расход?',
                data: formDataForDisplay,
                confirmButtonText: 'Обновить'
            });
            if (isConfirmed) {
                App.showLoader();
                try {
                    await App.cashbox.api.updateExpense(formData);
                    App.Notify.success('Расход успешно обновлен!');
                    App.cashbox.ui.closeEditModal();
                    loadExpensesTable(currentPage);
                } catch (error) {
                    await App.Notify.error('Ошибка обновления', error.message);
                } finally {
                    App.hideLoader();
                }
            }
        }
        
        new App.ClientSearchHandler({
            searchInput: document.getElementById('expense-client-search'),
            searchResultsContainer: document.getElementById('client-search-results'),
            selectedClientIdInput: document.getElementById('selected-client-id')
        });
        new App.ClientSearchHandler({
            searchInput: document.getElementById('edit-expense-client-search'),
            searchResultsContainer: document.getElementById('edit-client-search-results'),
            selectedClientIdInput: document.getElementById('edit-selected-client-id')
        });
    }
};
