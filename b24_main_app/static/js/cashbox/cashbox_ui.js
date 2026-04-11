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
        resetFilterBtn: document.getElementById('reset-filter-btn')
    },

    // --- Функции рендеринга и управления UI ---

    renderExpensesTable: function(expenses, onEdit, onDelete) {
        const { expensesTableBody } = this.elements;
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
            // Дополнительно скрываем поля при сбросе
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

    openEditModal: function(expense) {
        const { editExpenseForm, editExpenseModal } = this.elements;
        editExpenseForm.reset();

        document.getElementById('edit-expense-id').value = expense.id;
        document.getElementById('edit-expense-name').value = expense.name;
        document.getElementById('edit-expense-amount').value = expense.amount;
        document.getElementById('edit-expense-comment').value = expense.comment;
        
        flatpickr("#edit-expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: expense.expense_date });
        document.getElementById('edit-expense-category').value = expense.category_val;
        
        this.toggleDynamicFields(expense.category_val, 'edit');
        // Здесь может быть логика заполнения селектов в модальном окне, если нужно
        
        editExpenseModal.style.display = 'flex';
    },

    closeEditModal: function() {
        this.elements.editExpenseModal.style.display = 'none';
        this.elements.editExpenseForm.reset();
    },

    openDeleteConfirmModal: function() {
        this.elements.deleteConfirmModal.style.display = 'flex';
    },

    closeDeleteConfirmModal: function() {
        this.elements.deleteConfirmModal.style.display = 'none';
    }
};
