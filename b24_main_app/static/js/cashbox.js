// Модуль для управления вкладкой "Касса"
App.initializeCashbox = async function() {
    console.log("Initializing Cashbox module...");

    // --- Переменные модуля ---
    let currentPage = 1;
    const expensesPerPage = 25;
    let currentFilters = {};
    let availableEmployees = [];
    let availableContractors = [];
    let expenseToEditId = null;
    let expenseToDeleteId = null;

    // --- Элементы UI модуля ---
    const expenseForm = document.getElementById('expense-form');
    const expenseCategory = document.getElementById('expense-category');
    const dynamicFields = {
        employees: document.getElementById('employee-fields'),
        marketing: document.getElementById('marketing-fields'),
        clients: document.getElementById('client-fields')
    };
    const clientSearchInput = document.getElementById('expense-client-search');
    const selectedClientIdInput = document.getElementById('selected-client-id');
    const expensesTableBody = document.getElementById('expenses-table-body');
    const pageInfoSpan = document.getElementById('page-info');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const filterForm = document.getElementById('expenses-filter-form');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    const editExpenseModal = document.getElementById('edit-expense-modal');
    const editExpenseForm = document.getElementById('edit-expense-form');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

    // --- Инициализация данных ---
    App.showLoader();
    try {
        const response = await fetch(`?action=cashbox_initial_data`);
        if (!response.ok) throw new Error('Failed to load cashbox initial data');
        const data = await response.json();

        availableEmployees = data.users || [];
        availableContractors = data.sources || [];
        
        setupFilterForm();
        await loadExpensesTable();

    } catch (error) {
        console.error("Error fetching cashbox initial data:", error);
        alert(`Критическая ошибка: не удалось загрузить данные для кассы. ${error.message}`);
    } finally {
        App.hideLoader();
    }

    // --- Установка обработчиков событий ---
    flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

    expenseCategory.addEventListener('change', (event) => {
        Object.values(dynamicFields).forEach(field => field.style.display = 'none');
        const selectedCategory = event.target.value;
        if (dynamicFields[selectedCategory]) {
            dynamicFields[selectedCategory].style.display = 'block';
            if (selectedCategory === 'employees') {
                App.populateSelect(document.getElementById('expense-employee'), availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...');
            } else if (selectedCategory === 'marketing') {
                App.populateSelect(document.getElementById('expense-contractor'), availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...');
            }
        }
    });

    expenseForm.addEventListener('submit', handleAddExpense);
    cancelEditBtn.addEventListener('click', closeEditModal);
    editExpenseForm.addEventListener('submit', handleUpdateExpense);
    cancelDeleteBtn.addEventListener('click', () => deleteConfirmModal.style.display = 'none');
    confirmDeleteBtn.addEventListener('click', handleDeleteExpense);
    prevPageBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadExpensesTable(); } });
    nextPageBtn.addEventListener('click', () => { currentPage++; loadExpensesTable(); });

    // --- Логика добавления расхода ---
    async function handleAddExpense(event) {
        event.preventDefault();
        const formData = {
            date: document.getElementById('expense-date').value,
            amount: parseFloat(document.getElementById('expense-amount').value),
            category_text: expenseCategory.options[expenseCategory.selectedIndex].text,
            category_val: expenseCategory.value,
            comment: document.getElementById('expense-comment').value,
            name: ''
        };

        // ... (логика формирования formData.name и details)

        const isConfirmed = await App.showCustomConfirm({ title: 'Сохранение расхода', text: '...', confirmButtonText: 'Сохранить' });

        if (isConfirmed) {
            App.showLoader();
            try {
                const res = await fetch(`?action=add_expense`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...formData, added_by_user_id: App.currentUser.ID })
                });
                if (!res.ok) throw new Error('Server responded with an error');
                alert("Расход успешно сохранен!");
                expenseForm.reset();
                Object.values(dynamicFields).forEach(field => field.style.display = 'none');
                loadExpensesTable();
            } catch (error) {
                alert(`Ошибка при сохранении расхода: ${error.message}`);
            } finally {
                App.hideLoader();
            }
        }
    }

    // --- Логика фильтров ---
    function setupFilterForm() {
        flatpickr("#filter-start-date", { locale: "ru", dateFormat: "Y-m-d" });
        flatpickr("#filter-end-date", { locale: "ru", dateFormat: "Y-m-d" });

        const categories = Array.from(expenseCategory.options).map(opt => ({ id: opt.value, name: opt.text }));
        App.populateSelect(document.getElementById('filter-category'), categories.slice(1), "Все категории");
        App.populateSelect(document.getElementById('filter-employee'), availableEmployees.map(u => ({id: u.ID, name: u.NAME})), "Все сотрудники");
        App.populateSelect(document.getElementById('filter-contractor'), availableContractors.map(c => ({id: c.ID, name: c.NAME})), "Все подрядчики");

        filterForm.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
        resetFilterBtn.addEventListener('click', resetFilters);
    }

    function applyFilters() {
        currentPage = 1;
        currentFilters = {
            start_date: document.getElementById('filter-start-date').value,
            end_date: document.getElementById('filter-end-date').value,
            name: document.getElementById('filter-name').value,
            min_amount: document.getElementById('filter-min-amount').value,
            max_amount: document.getElementById('filter-max-amount').value,
            category_val: document.getElementById('filter-category').value,
            employee_id: document.getElementById('filter-employee').value,
            source_id: document.getElementById('filter-contractor').value,
        };
        Object.keys(currentFilters).forEach(key => { if (!currentFilters[key]) delete currentFilters[key]; });
        loadExpensesTable();
    }

    function resetFilters() {
        filterForm.reset();
        currentFilters = {};
        currentPage = 1;
        loadExpensesTable();
    }

    // --- CRUD операции ---
    async function loadExpensesTable() {
        App.showLoader();
        try {
            const params = new URLSearchParams({ action: 'expenses', limit: expensesPerPage, offset: (currentPage - 1) * expensesPerPage, ...currentFilters });
            const response = await fetch(`?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load expenses');
            const data = await response.json();
            renderExpensesTable(data.expenses);
            updatePaginationControls(data.total_records, data.limit, data.offset);
        } catch (error) {
            console.error("Error loading expenses table:", error);
            expensesTableBody.innerHTML = `<tr><td colspan="11">Ошибка загрузки расходов: ${error.message}</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

    function renderExpensesTable(expenses) {
        expensesTableBody.innerHTML = '';
        if (!expenses || expenses.length === 0) {
            expensesTableBody.innerHTML = `<tr><td colspan="11">Нет записей о расходах по заданным фильтрам.</td></tr>`;
            return;
        }
        expenses.forEach(expense => {
            const row = expensesTableBody.insertRow();
            row.insertCell().textContent = expense.id;
            row.insertCell().textContent = expense.name;
            row.insertCell().textContent = expense.expense_date;
            row.insertCell().textContent = parseFloat(expense.amount).toFixed(2);
            row.insertCell().textContent = expense.category;
            row.insertCell().textContent = expense.employee_name || '—';
            row.insertCell().textContent = expense.source_name || '—';
            row.insertCell().textContent = expense.contact_name || '—';
            row.insertCell().textContent = expense.comment || '—';
            row.insertCell().textContent = expense.added_by_user_name || 'Неизвестно';
            
            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';
            if (App.userPermissions.actions.can_save) {
                actionsCell.innerHTML += `<span class="action-icon edit-icon" data-id="${expense.id}" title="Редактировать">✏️</span>`;
            }
            if (App.userPermissions.actions.can_delete) {
                actionsCell.innerHTML += `<span class="action-icon delete-icon" data-id="${expense.id}" title="Удалить">🗑️</span>`;
            }
        });

        expensesTableBody.querySelectorAll('.edit-icon').forEach(icon => icon.addEventListener('click', (e) => openEditModal(e.target.dataset.id)));
        expensesTableBody.querySelectorAll('.delete-icon').forEach(icon => icon.addEventListener('click', (e) => openDeleteConfirmModal(e.target.dataset.id)));
    }

    async function openEditModal(expenseId) {
        expenseToEditId = expenseId;
        App.showLoader();
        try {
            const res = await fetch(`?action=get_single_expense&id=${expenseId}`);
            if (!res.ok) throw new Error('Failed to fetch expense details');
            const expense = await res.json();

            document.getElementById('edit-expense-id').value = expense.id;
            document.getElementById('edit-expense-name').value = expense.name;
            document.getElementById('edit-expense-amount').value = expense.amount;
            document.getElementById('edit-expense-comment').value = expense.comment;
            
            flatpickr("#edit-expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: expense.expense_date });
            document.getElementById('edit-expense-category').value = expense.category_val;
            
            editExpenseModal.style.display = 'flex';
        } catch (error) {
            alert(`Ошибка загрузки данных для редактирования: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }

    function closeEditModal() {
        editExpenseModal.style.display = 'none';
        editExpenseForm.reset();
        expenseToEditId = null;
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
            const res = await fetch(`?action=update_expense`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (!res.ok) throw new Error('Failed to update expense');
            alert('Расход успешно обновлен!');
            closeEditModal();
            loadExpensesTable();
        } catch (error) {
            alert(`Ошибка обновления: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }

    function openDeleteConfirmModal(expenseId) {
        expenseToDeleteId = expenseId;
        deleteConfirmModal.style.display = 'flex';
    }

    async function handleDeleteExpense() {
        if (!expenseToDeleteId) return;
        App.showLoader();
        try {
            const res = await fetch(`?action=delete_expense&id=${expenseToDeleteId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete expense');
            alert('Расход удален.');
            deleteConfirmModal.style.display = 'none';
            expenseToDeleteId = null;
            loadExpensesTable();
        } catch (error) {
            alert(`Ошибка удаления: ${error.message}`);
        } finally {
            App.hideLoader();
        }
    }

    function updatePaginationControls(totalRecords, limit, offset) {
        const totalPages = Math.ceil(totalRecords / limit) || 1;
        currentPage = Math.floor(offset / limit) + 1;
        pageInfoSpan.textContent = `Страница ${currentPage} из ${totalPages}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }
};
