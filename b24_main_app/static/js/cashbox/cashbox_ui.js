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
        filterCategory: document.getElementById('filter-category'),
        filterEmployeeWrapper: document.getElementById('filter-employee-wrapper'),
        filterContractorWrapper: document.getElementById('filter-contractor-wrapper'),
        resetFilterBtn: document.getElementById('reset-filter-btn'),
        editExpenseCategory: document.getElementById('edit-expense-category'),
        editExpenseEmployee: document.getElementById('edit-expense-employee'),
        editExpensePaymentType: document.getElementById('edit-expense-payment-type'),
        editExpenseContractor: document.getElementById('edit-expense-contractor'),
        editExpenseClientSearch: document.getElementById('edit-expense-client-search'),
        editSelectedClientId: document.getElementById('edit-selected-client-id'),
        expensePaidLeads: document.getElementById('expense-paid-leads'),
        expenseFreeLeads: document.getElementById('expense-free-leads'),
        editExpensePaidLeads: document.getElementById('edit-expense-paid-leads'),
        editExpenseFreeLeads: document.getElementById('edit-expense-free-leads'),
        
        incomesTableBody: document.getElementById('incomes-table-body'),
        incomeDealWrapper: document.getElementById('income-deal-wrapper'),
        incomeDealSelect: document.getElementById('income-deal-select'),
        editIncomeModal: document.getElementById('edit-income-modal'),
        editIncomeDealSelect: document.getElementById('edit-income-deal-select'),
        editIncomeDealWrapper: document.getElementById('edit-income-deal-wrapper'),
    },

    // --- Функции рендеринга и управления UI ---

    renderExpensesTable: function(expenses, onEdit, onDelete) {
        const { expensesTableBody } = this.elements;
        expensesTableBody.innerHTML = '';
        if (!expenses || expenses.length === 0) {
            expensesTableBody.innerHTML = `<tr><td colspan="12">Нет записей о расходах по заданным фильтрам.</td></tr>`;
            return;
        }
        
        const canEdit = App.userPermissions.tabs.cashbox.expense.edit;
        const canDelete = App.userPermissions.tabs.cashbox.expense.delete;

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
            row.insertCell().textContent = expense.paid_leads !== null ? expense.paid_leads : '—';
            row.insertCell().textContent = expense.free_leads !== null ? expense.free_leads : '—';
            row.insertCell().textContent = expense.added_by_user_name || 'Неизвестно';
            
            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';

            const editIconClass = canEdit ? 'action-icon edit-icon' : 'action-icon edit-icon access-restricted';
            const deleteIconClass = canDelete ? 'action-icon delete-icon' : 'action-icon delete-icon access-restricted';

            actionsCell.innerHTML = `
                <span class="${editIconClass}" data-id="${expense.id}" title="Редактировать">✏️</span>
                <span class="${deleteIconClass}" data-id="${expense.id}" title="Удалить">🗑️</span>
            `;
        });
    },

    renderIncomesTable: function(incomes, onEdit, onDelete) {
        const { incomesTableBody } = this.elements;
        incomesTableBody.innerHTML = '';
        if (!incomes || incomes.length === 0) {
            incomesTableBody.innerHTML = `<tr><td colspan="8">Нет записей о приходах.</td></tr>`;
            return;
        }

        const canEdit = App.userPermissions.tabs.cashbox.income.edit;
        const canDelete = App.userPermissions.tabs.cashbox.income.delete;

        incomes.forEach(income => {
            const row = incomesTableBody.insertRow();
            row.insertCell().textContent = income.id;
            row.insertCell().textContent = income.income_date;
            row.insertCell().textContent = parseFloat(income.amount).toFixed(2);
            row.insertCell().textContent = income.contact_name || '—';
            row.insertCell().textContent = income.deal_name || '—';
            row.insertCell().textContent = income.comment || '—';
            row.insertCell().textContent = income.added_by_user_name || 'Неизвестно';

            // --- Столбец "Документ" ---
            const docCell = row.insertCell();
            docCell.className = 'actions-column';
            if (income.b24_invoice_id && income.b24_file_id) {
                // Ссылка открывает файл через BX24.openPath внутри Битрикс24
                const docLink = document.createElement('span');
                docLink.className = 'action-icon';
                docLink.title = 'Открыть документ';
                docLink.style.cursor = 'pointer';
                docLink.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" style="color:#2fc6f6;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                `;
                // Открываем файл через BX24.openPath — файл откроется внутри Б24 как из карточки счёта
                docLink.addEventListener('click', () => {
                    const fileUrl = `/bitrix/services/main/ajax.php?action=crm.controller.item.getFile` +
                        `&SITE_ID=s1` +
                        `&entityTypeId=31` +
                        `&id=${income.b24_invoice_id}` +
                        `&fieldName=UF_CRM_SMART_INVOICE_1776360197269` +
                        `&fileId=${income.b24_file_id}`;

                    // BX24.openPath открывает URL внутри iframe Битрикс24
                    if (typeof BX24 !== 'undefined' && BX24.openPath) {
                        BX24.openPath(fileUrl, (result) => {
                            console.log('BX24.openPath result:', result);
                        });
                    } else {
                        // Fallback — открыть в новой вкладке
                        window.open(fileUrl, '_blank');
                    }
                });
                docCell.appendChild(docLink);
            } else {
                docCell.textContent = '—';
            }

            // --- Столбец "Действия" ---
            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';
            const editIconClass = canEdit ? 'action-icon edit-income-btn' : 'action-icon edit-income-btn access-restricted';
            const deleteIconClass = canDelete ? 'action-icon delete-income-btn' : 'action-icon delete-income-btn access-restricted';
            actionsCell.innerHTML = `
                <span class="${editIconClass}" data-id="${income.id}" title="Редактировать">✏️</span>
                <span class="${deleteIconClass}" data-id="${income.id}" title="Удалить">🗑️</span>
            `;
        });
    },

    renderDealSelect: function(deals, selectElement, wrapperElement) {
        if (!selectElement || !wrapperElement) {
            console.error('renderDealSelect: selectElement или wrapperElement не найден!');
            return;
        }
        if (deals && deals.length > 0) {
            selectElement.innerHTML = '<option value="">Выберите сделку...</option>';
            deals.forEach(deal => {
                const option = document.createElement('option');
                option.value = deal.id;               // 2086
                option.textContent = deal.name;       // БФЛ
                option.dataset.typeId = deal.type_id; // SALE
                option.dataset.typeName = deal.name;  // БФЛ
                selectElement.appendChild(option);
            });
            wrapperElement.style.display = '';
        } else {
            wrapperElement.style.display = 'none';
            selectElement.innerHTML = '';
        }
    },

    openEditIncomeModal: function(income) {
        const { editIncomeModal, editIncomeDealWrapper, editIncomeDealSelect } = this.elements;

        // Сбрасываем блок сделок перед открытием, чтобы не было старых данных
        editIncomeDealWrapper.style.display = 'none';
        editIncomeDealSelect.innerHTML = '';

        document.getElementById('edit-income-id').value = income.id;
        document.getElementById('edit-income-amount').value = income.amount;
        document.getElementById('edit-income-comment').value = income.comment || '';
        document.getElementById('edit-income-client-search').value = income.contact_name || '';
        document.getElementById('edit-income-selected-client-id').value = income.contact_id || '';

        flatpickr("#edit-income-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: income.income_date });

        editIncomeModal.style.display = 'flex';
    },

    closeEditIncomeModal: function() {
        this.elements.editIncomeModal.style.display = 'none';
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

        this.toggleFilterDynamicFields(filterCategory.value);

        filterCategory.addEventListener('change', (event) => {
            this.toggleFilterDynamicFields(event.target.value);
        });

        resetFilterBtn.addEventListener('click', () => {
            filterCategory.value = '';
            this.toggleFilterDynamicFields('');
        });
    },
    
    toggleDynamicFields: function(categoryValue, formType = 'add') {
        const fields = formType === 'edit' ? this.elements.editDynamicFields : this.elements.dynamicFields;
        
        if (formType === 'add') {
            document.getElementById('expense-employee').value = '';
            document.getElementById('expense-contractor').value = '';
            document.getElementById('selected-client-id').value = '';
            document.getElementById('expense-client-search').value = '';
            document.getElementById('expense-paid-leads').value = '';
            document.getElementById('expense-free-leads').value = '';
        } else {
            document.getElementById('edit-expense-employee').value = '';
            document.getElementById('edit-expense-contractor').value = '';
            document.getElementById('edit-selected-client-id').value = '';
            document.getElementById('edit-expense-client-search').value = '';
            document.getElementById('edit-expense-paid-leads').value = '';
            document.getElementById('edit-expense-free-leads').value = '';
        }

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
        document.getElementById('edit-expense-amount').value = expense.amount;
        document.getElementById('edit-expense-comment').value = expense.comment;
        
        flatpickr("#edit-expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: expense.expense_date });
        editExpenseCategory.value = expense.category_val;
        
        this.toggleDynamicFields(expense.category_val, 'edit');

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
            editExpenseClientSearch.value = expense.contact_name || '';
            editSelectedClientId.value = expense.contact_id || '';
        }

        editExpenseCategory.onchange = (event) => {
            const selectedCategory = event.target.value;
            this.toggleDynamicFields(selectedCategory, 'edit');
            if (selectedCategory === 'employees') {
                App.populateSelect(editExpenseEmployee, availableEmployees.map(u => ({id: u.ID, name: u.NAME})), 'Выберите сотрудника...');
            } else if (selectedCategory === 'marketing') {
                App.populateSelect(editExpenseContractor, availableContractors.map(c => ({id: c.ID, name: c.NAME})), 'Выберите подрядчика...');
            }
            if (editExpenseEmployee) editExpenseEmployee.value = '';
            if (editExpensePaymentType) editExpensePaymentType.value = 'fix';
            if (editExpenseContractor) editExpenseContractor.value = '';
            if (editExpenseClientSearch) editExpenseClientSearch.value = '';
            if (editSelectedClientId) editSelectedClientId.value = '';
            if (editExpensePaidLeads) editExpensePaidLeads.value = '';
            if (editExpenseFreeLeads) editExpenseFreeLeads.value = '';
        };
        
        editExpenseModal.style.display = 'flex';
    },

    closeEditModal: function() {
        this.elements.editExpenseModal.style.display = 'none';
        this.elements.editExpenseForm.reset();
        this.toggleDynamicFields('', 'edit');
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
