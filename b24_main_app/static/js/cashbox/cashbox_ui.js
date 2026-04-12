// Модуль для управления UI-компонентами кассы
App.cashbox.ui = {
    // --- Элементы UI ---
    elements: {
        expensesTableBody: document.getElementById('expenses-table-body'),
        pageInfoSpan: document.getElementById('page-info'),
        prevPageBtn: document.getElementById('prev-page-btn'),
        nextPageBtn: document.getElementById('next-page-btn'),
        editExpenseModal: document.getElementById('edit-expense-modal'),
        editExpenseForm: document.getElementById('edit-expense-form'),
        deleteConfirmModal: document.getElementById('delete-confirm-modal'),
        dynamicFields: {
            employees: document.getElementById('employee-fields'),
            marketing: document.getElementById('marketing-fields'),
            clients: document.getElementById('client-fields')
        },
        editDynamicFields: {
            employees: document.getElementById('edit-employee-fields'),
            marketing: document.getElementById('edit-marketing-fields'),
            clients: document.getElementById('edit-client-fields')
        },
        // Элементы для фильтра
        filterCategory: document.getElementById('filter-category'),
        filterEmployeeWrapper: document.getElementById('filter-employee-wrapper'),
        filterContractorWrapper: document.getElementById('filter-contractor-wrapper'),
        resetFilterBtn: document.getElementById('reset-filter-btn'),

        // Элементы для формы редактирования (добавлены/обновлены)
        editExpenseCategory: document.getElementById('edit-expense-category'),
        editExpenseEmployee: document.getElementById('edit-expense-employee'),
        editExpensePaymentType: document.getElementById('edit-expense-payment-type'),
        editExpenseContractor: document.getElementById('edit-expense-contractor'),
        editExpenseClientSearch: document.getElementById('edit-expense-client-search'),
        editSelectedClientId: document.getElementById('edit-selected-client-id'),

        // Новые элементы для лидов (добавление)
        expensePaidLeads: document.getElementById('expense-paid-leads'),
        expenseFreeLeads: document.getElementById('expense-free-leads'),
        // Новые элементы для лидов (редактирование)
        editExpensePaidLeads: document.getElementById('edit-expense-paid-leads'),
        editExpenseFreeLeads: document.getElementById('edit-expense-free-leads'),
    },

    // --- Функции рендеринга и управления UI ---

    renderExpensesTable: function(expenses, onEdit, onDelete) {
        const { expensesTableBody } = this.elements;
        expensesTableBody.innerHTML = '';
        if (!expenses || expenses.length === 0) {
            expensesTableBody.innerHTML = `<tr><td colspan="10">Нет записей о расходах по заданным фильтрам.</td></tr>`;
            return;
        }
        expenses.forEach(expense => {
            const row = expensesTableBody.insertRow();
            row.insertCell().textContent = expense.id;
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

        // Навешиваем обработчики на новые иконки
        expensesTableBody.querySelectorAll('.edit-icon').forEach(icon => icon.addEventListener('click', (e) => onEdit(e.target.dataset.id)));
        expensesTableBody.querySelectorAll('.delete-icon').forEach(icon => icon.addEventListener('click', (e) => onDelete(e.target.dataset.id)));
    },

    updatePaginationControls: function(totalRecords, limit, offset) {
        const { pageInfoSpan, prevPageBtn, nextPageBtn } = this.elements;
        const totalPages = Math.ceil(totalRecords / limit) || 1;
        const currentPage = Math.floor(offset / limit) + 1;
        
        pageInfoSpan.textContent = `Страница ${currentPage} из ${totalPages}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage >= totalPages;
        
        return currentPage;
    },

    setupFilterForm: function(categories, employees, contractors) {
        const { filterCategory, filterEmployeeWrapper, filterContractorWrapper, resetFilterBtn } = this.elements;

        flatpickr("#filter-start-date", { locale: "ru", dateFormat: "Y-m-d" });
        flatpickr("#filter-end-date", { locale: "ru", dateFormat: "Y-m-d" });

        App.populateSelect(filterCategory, categories, "Все категории");
        App.populateSelect(document.getElementById('filter-employee'), employees, "Все сотрудники");
        App.populateSelect(document.getElementById('filter-contractor'), contractors, "Все подрядчики");

        // Инициализация видимости полей фильтра
        this.toggleFilterDynamicFields(filterCategory.value);

        // Обработчик изменения категории фильтра
        filterCategory.addEventListener('change', (event) => {
            this.toggleFilterDynamicFields(event.target.value);
        });

        // Обработчик сброса фильтра
        resetFilterBtn.addEventListener('click', () => {
            filterCategory.value = ''; // Сбрасываем категорию
            this.toggleFilterDynamicFields('');
        });
    },
    
    toggleDynamicFields: function(categoryValue, formType = 'add') {
        const fields = formType === 'edit' ? this.elements.editDynamicFields : this.elements.dynamicFields;
        Object.values(fields).forEach(field => field.style.display = 'none');
        if (fields[categoryValue]) {
            fields[categoryValue].style.display = 'block';
        }
    },

    toggleFilterDynamicFields: function(categoryValue) {
        const { filterEmployeeWrapper, filterContractorWrapper } = this.elements;
        
        filterEmployeeWrapper.style.display = 'none';
        filterContractorWrapper.style.display = 'none';

        if (categoryValue === 'employees') {
            filterEmployeeWrapper.style.display = 'block';
        } else if (categoryValue === 'marketing') {
            filterContractorWrapper.style.display = 'block';
        }
    },

    openEditModal: function(expense, availableEmployees, availableContractors) {
        const { editExpenseForm, editExpenseModal, editExpenseCategory, editExpenseEmployee, editExpensePaymentType, editExpenseContractor, editExpenseClientSearch, editSelectedClientId, editExpensePaidLeads, editExpenseFreeLeads } = this.elements;
        editExpenseForm.reset();

        document.getElementById('edit-expense-id').value = expense.id;
        // Поле "Название" удалено, поэтому не заполняем
        document.getElementById('edit-expense-amount').value = expense.amount;
        document.getElementById('edit-expense-comment').value = expense.comment;
        
        flatpickr("#edit-expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: expense.expense_date });
        editExpenseCategory.value = expense.category_val;
        
        // Показываем/скрываем динамические поля
        this.toggleDynamicFields(expense.category_val, 'edit');

        // Заполняем динамические поля данными
        if (expense.category_val === 'employees') {
            App.populateSelect(editExpenseEmployee, availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...', expense.employee_id);
            if (expense.payment_type) {
                editExpensePaymentType.value = expense.payment_type;
            }
        } else if (expense.category_val === 'marketing') {
            App.populateSelect(editExpenseContractor, availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...', expense.source_id);
            editExpensePaidLeads.value = expense.paid_leads || '';
            editExpenseFreeLeads.value = expense.free_leads || '';
        } else if (expense.category_val === 'clients') {
            editExpenseClientSearch.value = expense.contact_name || ''; // Отображаем имя клиента
            editSelectedClientId.value = expense.contact_id || ''; // Сохраняем ID клиента
        }

        // Обработчик изменения категории в форме редактирования
        editExpenseCategory.onchange = (event) => {
            const selectedCategory = event.target.value;
            this.toggleDynamicFields(selectedCategory, 'edit');
            // При изменении категории, перенаселяем соответствующие селекты
            if (selectedCategory === 'employees') {
                App.populateSelect(editExpenseEmployee, availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...');
            } else if (selectedCategory === 'marketing') {
                App.populateSelect(editExpenseContractor, availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...');
            }
            // Сбрасываем значения динамических полей при смене категории
            if (editExpenseEmployee) editExpenseEmployee.value = '';
            if (editExpensePaymentType) editExpensePaymentType.value = 'fix'; // или другое значение по умолчанию
            if (editExpenseContractor) editExpenseContractor.value = '';
            if (editExpenseClientSearch) editExpenseClientSearch.value = '';
            if (editSelectedClientId) editSelectedClientId.value = '';
            // Сбрасываем новые поля лидов
            if (editExpensePaidLeads) editExpensePaidLeads.value = '';
            if (editExpenseFreeLeads) editExpenseFreeLeads.value = '';
        };
        
        editExpenseModal.style.display = 'flex';
    },

    closeEditModal: function() {
        this.elements.editExpenseModal.style.display = 'none';
        this.elements.editExpenseForm.reset();
        // Скрываем все динамические поля при закрытии модального окна
        this.toggleDynamicFields('', 'edit');
        // Сбрасываем новые поля лидов при закрытии
        if (this.elements.editExpensePaidLeads) this.elements.editExpensePaidLeads.value = '';
        if (this.elements.editExpenseFreeLeads) this.elements.editExpenseFreeLeads.value = '';
    },

    openDeleteConfirmModal: function() {
        this.elements.deleteConfirmModal.style.display = 'flex';
    },

    closeDeleteConfirmModal: function() {
        this.elements.deleteConfirmModal.style.display = 'none';
    }
};
