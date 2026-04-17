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

        const canEdit   = App.userPermissions.tabs.cashbox.expense.edit;
        const canDelete = App.userPermissions.tabs.cashbox.expense.delete;

        expenses.forEach(expense => {
            const row = expensesTableBody.insertRow();
            row.insertCell().textContent = expense.id;
            row.insertCell().textContent = expense.expense_date;
            row.insertCell().textContent = parseFloat(expense.amount).toFixed(2);
            row.insertCell().textContent = expense.category;
            row.insertCell().textContent = expense.employee_name  || '—';
            row.insertCell().textContent = expense.source_name    || '—';
            row.insertCell().textContent = expense.contact_name   || '—';
            row.insertCell().textContent = expense.comment        || '—';
            row.insertCell().textContent = expense.paid_leads  !== null ? expense.paid_leads  : '—';
            row.insertCell().textContent = expense.free_leads  !== null ? expense.free_leads  : '—';
            row.insertCell().textContent = expense.added_by_user_name || 'Неизвестно';

            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';

            const editBtn = document.createElement('span');
            editBtn.className   = canEdit
                ? 'action-icon edit-icon'
                : 'action-icon edit-icon access-restricted';
            editBtn.dataset.id  = expense.id;
            editBtn.title       = 'Редактировать';
            editBtn.textContent = '✏️';
            editBtn.addEventListener('click', () => {
                if (editBtn.classList.contains('access-restricted')) return;
                onEdit(expense.id);
            });

            const deleteBtn = document.createElement('span');
            deleteBtn.className   = canDelete
                ? 'action-icon delete-icon'
                : 'action-icon delete-icon access-restricted';
            deleteBtn.dataset.id  = expense.id;
            deleteBtn.title       = 'Удалить';
            deleteBtn.textContent = '🗑️';
            deleteBtn.addEventListener('click', () => {
                if (deleteBtn.classList.contains('access-restricted')) return;
                onDelete(expense.id);
            });

            actionsCell.appendChild(editBtn);
            actionsCell.appendChild(deleteBtn);
        });
    },

    renderIncomesTable: function(incomes, onEdit, onDelete) {
        const { incomesTableBody } = this.elements;
        incomesTableBody.innerHTML = '';
        if (!incomes || incomes.length === 0) {
            incomesTableBody.innerHTML = `<tr><td colspan="10">Нет записей о приходах.</td></tr>`;
            return;
        }

        const canEdit    = App.userPermissions.tabs.cashbox.income.edit;
        const canDelete  = App.userPermissions.tabs.cashbox.income.delete;
        const canConfirm = App.userPermissions.tabs.cashbox.income.confirm;

        incomes.forEach(income => {
            const row = incomesTableBody.insertRow();
            const isConfirmed = income.is_confirmed;

            if (isConfirmed) {
                row.style.backgroundColor = 'rgba(76, 175, 80, 0.08)';
            }

            row.insertCell().textContent = income.id;
            row.insertCell().textContent = income.income_date;
            row.insertCell().textContent = parseFloat(income.amount).toFixed(2);

            // Клиент
            const contactCell = row.insertCell();
            if (income.contact_id && income.contact_name) {
                const contactLink = document.createElement('a');
                contactLink.href   = `${App.b24Domain}/crm/contact/details/${income.contact_id}/`;
                contactLink.target = '_blank';
                contactLink.rel    = 'noopener noreferrer';
                contactLink.textContent = income.contact_name;
                contactLink.style.cssText = 'color:#2fc6f6;text-decoration:none;';
                contactLink.onmouseover = () => contactLink.style.textDecoration = 'underline';
                contactLink.onmouseout  = () => contactLink.style.textDecoration = 'none';
                contactCell.appendChild(contactLink);
            } else {
                contactCell.textContent = '—';
            }

            // Сделка
            const dealCell = row.insertCell();
            if (income.deal_id && income.deal_name && income.deal_name !== '—') {
                const dealLink = document.createElement('a');
                dealLink.href   = `${App.b24Domain}/crm/deal/details/${income.deal_id}/`;
                dealLink.target = '_blank';
                dealLink.rel    = 'noopener noreferrer';
                dealLink.textContent = income.deal_name;
                dealLink.style.cssText = 'color:#2fc6f6;text-decoration:none;';
                dealLink.onmouseover = () => dealLink.style.textDecoration = 'underline';
                dealLink.onmouseout  = () => dealLink.style.textDecoration = 'none';
                dealCell.appendChild(dealLink);
            } else {
                dealCell.textContent = income.deal_name || '—';
            }

            row.insertCell().textContent = income.comment || '—';
            row.insertCell().textContent = income.added_by_user_name || 'Неизвестно';

            // --- Подтвердил ---
            const confirmedByCell = row.insertCell();
            confirmedByCell.textContent = income.confirmed_by_user_name || '—';
            if (income.confirmed_by_user_name) {
                confirmedByCell.style.color = '#4CAF50';
                confirmedByCell.style.fontWeight = '500';
            }

            // --- Документ ---
            const docCell = row.insertCell();
            docCell.className = 'actions-column';
            if (income.b24_file_url) {
                const docLink = document.createElement('span');
                docLink.title = 'Открыть документ';
                docLink.style.cssText = 'display:inline-flex;align-items:center;gap:4px;color:#2fc6f6;font-size:13px;cursor:pointer;';
                docLink.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    Открыть
                `;
                docLink.addEventListener('click', () => {
                    App.cashbox.ui.openFileViewer(income.b24_file_url, income.b24_file_id);
                });
                docCell.appendChild(docLink);
            } else {
                docCell.textContent = '—';
            }

            // --- Действия ---
            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';

            const confirmBtn = document.createElement('span');
            confirmBtn.className = canConfirm
                ? 'action-icon confirm-income-btn'
                : 'action-icon confirm-income-btn access-restricted';
            confirmBtn.dataset.id        = income.id;
            confirmBtn.dataset.confirmed = isConfirmed ? '1' : '0';
            confirmBtn.title     = isConfirmed ? 'Отменить подтверждение' : 'Подтвердить платёж';
            confirmBtn.textContent = isConfirmed ? '↩️' : '✅';

            const editBtn = document.createElement('span');
            editBtn.className   = canEdit
                ? 'action-icon edit-income-btn'
                : 'action-icon edit-income-btn access-restricted';
            editBtn.dataset.id  = income.id;
            editBtn.title       = 'Редактировать';
            editBtn.textContent = '✏️';

            const deleteBtn = document.createElement('span');
            deleteBtn.className   = canDelete
                ? 'action-icon delete-income-btn'
                : 'action-icon delete-income-btn access-restricted';
            deleteBtn.dataset.id  = income.id;
            deleteBtn.title       = 'Удалить';
            deleteBtn.textContent = '🗑️';

            actionsCell.appendChild(confirmBtn);
            actionsCell.appendChild(editBtn);
            actionsCell.appendChild(deleteBtn);
        });
    },

    renderDealSelect: function(deals, selectElement, wrapperElement) {
        if (!selectElement || !wrapperElement) {
            console.error('renderDealSelect: selectElement или wrapperElement не найден!');
            return;
        }

        // deals теперь объект {sale: [], mandatory: []} или пустой массив [] (старый формат)
        const saleDeals      = Array.isArray(deals) ? deals : (deals.sale      || []);
        const mandatoryDeals = Array.isArray(deals) ? []    : (deals.mandatory || []);
        const hasDeals       = saleDeals.length > 0 || mandatoryDeals.length > 0;

        if (!hasDeals) {
            wrapperElement.style.display = 'none';
            selectElement.innerHTML = '';
            return;
        }

        selectElement.innerHTML = '<option value="">Выберите сделку...</option>';

        // --- Группа: Продажа ---
        if (saleDeals.length > 0) {
            const group1 = document.createElement('optgroup');
            group1.label = 'Продажа';
            saleDeals.forEach(deal => {
                const option = document.createElement('option');
                option.value               = deal.id;
                option.textContent         = deal.name;
                option.dataset.typeId      = deal.type_id   || '';
                option.dataset.typeName    = deal.name      || '';
                option.dataset.categoryId  = deal.category_id;
                option.dataset.opportunity = deal.opportunity || 0;
                group1.appendChild(option);
            });
            selectElement.appendChild(group1);
        }

        // --- Группа: Обязательные платежи ---
        if (mandatoryDeals.length > 0) {
            const group2 = document.createElement('optgroup');
            group2.label = 'Обязательные платежи';
            mandatoryDeals.forEach(deal => {
                const option = document.createElement('option');
                option.value               = deal.id;
                option.textContent         = deal.name;
                option.dataset.typeId      = '';
                option.dataset.typeName    = deal.name      || '';
                option.dataset.categoryId  = deal.category_id;
                option.dataset.opportunity = deal.opportunity || 0;
                group2.appendChild(option);
            });
            selectElement.appendChild(group2);
        }

        wrapperElement.style.display = '';
    },

    openEditIncomeModal: function(income) {
        const { editIncomeModal, editIncomeDealWrapper, editIncomeDealSelect } = this.elements;

        editIncomeDealWrapper.style.display = 'none';
        editIncomeDealSelect.innerHTML = '';

        document.getElementById('edit-income-id').value = income.id;
        document.getElementById('edit-income-amount').value = income.amount;
        document.getElementById('edit-income-comment').value = income.comment || '';
        document.getElementById('edit-income-client-search').value = income.contact_name || '';
        document.getElementById('edit-income-selected-client-id').value = income.contact_id || '';

        // Показываем текущий файл если есть
        const currentFileBlock = document.getElementById('edit-income-current-file');
        const currentFileLink  = document.getElementById('edit-income-current-file-link');
        if (income.b24_file_url) {
            currentFileBlock.style.display = 'block';
            currentFileLink.textContent = income.b24_file_id ? `Файл #${income.b24_file_id}` : 'Текущий документ';
            currentFileLink.onclick = () => App.cashbox.ui.openFileViewer(income.b24_file_url, income.b24_file_id);
        } else {
            currentFileBlock.style.display = 'none';
        }

        // Сбрасываем drop-zone
        const dropZone        = document.getElementById('edit-income-drop-zone');
        const dropZoneContent = document.getElementById('edit-income-drop-zone-content');
        const filePreview     = document.getElementById('edit-income-file-preview');
        const fileInput       = document.getElementById('edit-income-file-input');
        dropZone.classList.remove('has-file', 'drag-over');
        dropZoneContent.style.display = 'flex';
        filePreview.style.display = 'none';
        fileInput.value = '';

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
    },

    openFileViewer: function(fileUrl, fileId) {
        const modal        = document.getElementById('file-viewer-modal');
        const content      = document.getElementById('file-viewer-content');
        const title        = document.getElementById('file-viewer-title');
        const downloadLink = document.getElementById('file-viewer-download');

        // Сбрасываем и показываем модалку
        content.innerHTML = '';
        modal.style.display = 'flex';
        downloadLink.href = '#';
        title.textContent = 'Загрузка файла...';

        // Показываем спиннер загрузки
        content.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px;color:#fff;">
                <div style="
                    width:48px;height:48px;
                    border:4px solid rgba(255,255,255,0.2);
                    border-top:4px solid #2fc6f6;
                    border-radius:50%;
                    animation:spin 1s linear infinite;
                "></div>
                <div id="file-viewer-progress-text" style="font-size:14px;opacity:0.85;">Скачиваем файл...</div>
                <div style="width:240px;height:6px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;">
                    <div id="file-viewer-progress-bar" style="
                        height:100%;width:0%;
                        background:#2fc6f6;
                        border-radius:4px;
                        transition:width 0.3s ease;
                    "></div>
                </div>
            </div>
        `;

        const progressText = () => document.getElementById('file-viewer-progress-text');
        const progressBar  = () => document.getElementById('file-viewer-progress-bar');

        // Скачиваем файл через BX24.ajax чтобы передать авторизацию,
        // или через обычный fetch (urlMachine уже содержит подписанный токен)
        fetch(fileUrl)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const contentType   = response.headers.get('Content-Type') || '';
                const contentLength = response.headers.get('Content-Length');
                const total         = contentLength ? parseInt(contentLength) : 0;
                let   loaded        = 0;

                // Читаем поток с прогрессом
                const reader = response.body.getReader();
                const chunks = [];

                function pump() {
                    return reader.read().then(({ done, value }) => {
                        if (done) {
                            return { chunks, contentType, total: loaded };
                        }
                        chunks.push(value);
                        loaded += value.length;

                        if (total > 0) {
                            const pct = Math.round((loaded / total) * 100);
                            if (progressBar()) progressBar().style.width = pct + '%';
                            if (progressText()) progressText().textContent = `Скачиваем файл... ${pct}%`;
                        } else {
                            const kb = Math.round(loaded / 1024);
                            if (progressText()) progressText().textContent = `Скачиваем файл... ${kb} KB`;
                            // Анимируем прогресс-бар без точного значения
                            if (progressBar()) {
                                const cur = parseFloat(progressBar().style.width) || 0;
                                progressBar().style.width = Math.min(cur + 5, 90) + '%';
                            }
                        }

                        return pump();
                    });
                }

                return pump().then(({ chunks, contentType, total }) => {
                    return { blob: new Blob(chunks, { type: contentType }), contentType };
                });
            })
            .then(({ blob, contentType }) => {
                const blobUrl  = URL.createObjectURL(blob);
                const isPdf    = contentType.includes('pdf') ||
                                 fileUrl.toLowerCase().includes('.pdf');
                const isImage  = contentType.startsWith('image/');

                // Обновляем ссылку скачивания
                downloadLink.href = blobUrl;
                downloadLink.download = fileId ? `file_${fileId}` : 'document';

                // Заполняем прогресс до 100%
                if (progressBar()) progressBar().style.width = '100%';
                if (progressText()) progressText().textContent = 'Готово!';

                setTimeout(() => {
                    content.innerHTML = '';

                    if (isPdf) {
                        title.textContent = 'Просмотр PDF';
                        const frame = document.createElement('iframe');
                        frame.src   = blobUrl;
                        frame.style.cssText = 'width:100%;height:calc(90vh - 130px);border:none;background:#fff;';
                        frame.title = 'PDF документ';
                        content.appendChild(frame);

                    } else if (isImage) {
                        title.textContent = 'Просмотр изображения';
                        const img = document.createElement('img');
                        img.src   = blobUrl;
                        img.style.cssText = 'max-width:100%;max-height:calc(90vh - 130px);object-fit:contain;display:block;';
                        img.alt   = 'Изображение';
                        content.appendChild(img);

                    } else {
                        // Неизвестный тип — пробуем iframe
                        title.textContent = 'Просмотр документа';
                        const frame = document.createElement('iframe');
                        frame.src   = blobUrl;
                        frame.style.cssText = 'width:100%;height:calc(90vh - 130px);border:none;background:#fff;';
                        content.appendChild(frame);
                    }
                }, 300); // небольшая пауза чтобы пользователь увидел 100%
            })
            .catch(err => {
                console.error('openFileViewer fetch error:', err);
                content.innerHTML = `
                    <div style="
                        display:flex;flex-direction:column;align-items:center;
                        justify-content:center;padding:40px;gap:16px;
                        color:#ff6b6b;text-align:center;
                    ">
                        <div style="font-size:32px;">⚠️</div>
                        <div style="font-size:14px;max-width:320px;line-height:1.5;">
                            Не удалось загрузить файл.<br>
                            <span style="font-size:12px;opacity:0.7;">${err.message}</span>
                        </div>
                        <a href="${fileUrl}" target="_blank"
                           class="ui-btn ui-btn-primary"
                           style="margin-top:8px;display:inline-block;">
                            ⬇️ Скачать файл напрямую
                        </a>
                    </div>
                `;
                title.textContent = 'Ошибка загрузки';
            });

        // Освобождаем blob URL при закрытии модалки
        const closeBtn = document.getElementById('file-viewer-close');
        const oldClose = closeBtn.onclick;
        closeBtn.onclick = () => {
            content.innerHTML = '';
            modal.style.display = 'none';
            title.textContent = 'Документ';
        };
    },
};
