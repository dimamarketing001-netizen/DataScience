BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

    // --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
    // memberId передается из Flask-шаблона index.html
    const memberId = "{{ member_id }}";
    let currentPage = 1;
    let expensesPerPage = 25; // По умолчанию 25 последних строк
    let currentFilters = {}; // Объект для хранения текущих фильтров

    // --- ЛОГИКА НАВИГАЦИИ МЕЖДУ ЭКРАНАМИ ---
    const screens = document.querySelectorAll('.app-screen');
    const mainMenu = document.getElementById('main-menu');
    const cashboxScreen = document.getElementById('cashbox-screen');
    const statisticsScreen = document.getElementById('statistics-screen');

    const gotoCashboxBtn = document.getElementById('goto-cashbox');
    const gotoStatisticsBtn = document.getElementById('goto-statistics');
    const backButtons = document.querySelectorAll('.back-button');

    const showScreen = (screenToShow) => {
        screens.forEach(screen => screen.classList.remove('active'));
        screenToShow.classList.add('active');
    };

    gotoCashboxBtn.addEventListener('click', () => {
        if (!cashboxInitialized) {
            initializeCashbox();
            cashboxInitialized = true;
        }
        showScreen(cashboxScreen);
    });
    gotoStatisticsBtn.addEventListener('click', () => {
        if (!statisticsInitialized) {
            initializeStatistics();
            statisticsInitialized = true;
        }
        showScreen(statisticsScreen);
    });
    backButtons.forEach(button => button.addEventListener('click', () => showScreen(mainMenu)));

    // --- ОБЩИЕ ЭЛЕМЕНТЫ И ФУНКЦИИ ---
    const loaderOverlay = document.getElementById('loader-overlay');
    const showLoader = () => { if (loaderOverlay) loaderOverlay.style.display = 'flex'; };
    const hideLoader = () => { if (loaderOverlay) loaderOverlay.style.display = 'none'; };

    // --- ЛОГИКА КАССЫ (ДОБАВЛЕНИЕ РАСХОДА) ---
    let cashboxInitialized = false;
    const expenseForm = document.getElementById('expense-form');
    const expenseCategory = document.getElementById('expense-category');
    const dynamicFields = {
        employees: document.getElementById('employee-fields'),
        marketing: document.getElementById('marketing-fields'),
        clients: document.getElementById('client-fields')
    };
    // Модальное окно подтверждения (для добавления)
    const customModal = document.getElementById('custom-modal');
    const customModalText = document.getElementById('modal-text');
    const customModalConfirmBtn = document.getElementById('modal-confirm-btn');
    const customModalCancelBtn = document.getElementById('modal-cancel-btn');

    // Элементы для поиска клиентов (для добавления)
    const clientSearchInput = document.getElementById('expense-client-search');
    const clientSearchResults = document.getElementById('client-search-results');
    const selectedClientIdInput = document.getElementById('selected-client-id');

    let availableEmployees = [];
    let availableContractors = [];

    function showCustomConfirm(text) {
        return new Promise(resolve => {
            customModalText.innerHTML = text;
            customModal.style.display = 'flex';
            customModalConfirmBtn.onclick = () => { customModal.style.display = 'none'; resolve(true); };
            customModalCancelBtn.onclick = () => { customModal.style.display = 'none'; resolve(false); };
        });
    }

    async function initializeCashbox() {
        console.log("Initializing Cashbox Screen...");
        showLoader();
        try {
            const response = await fetch('api/cashbox_initial_data');
            if (!response.ok) throw new Error('Failed to load cashbox initial data');
            const data = await response.json();

            availableEmployees = data.users || [];
            availableContractors = data.sources || [];

            const employeeSelect = document.getElementById('expense-employee');
            const contractorSelect = document.getElementById('expense-contractor');

            employeeSelect.innerHTML = '<option value="">Выберите сотрудника...</option>';
            availableEmployees.forEach(user => {
                employeeSelect.add(new Option(user.NAME, user.ID));
            });

            contractorSelect.innerHTML = '<option value="">Выберите подрядчика...</option>';
            availableContractors.forEach(source => {
                contractorSelect.add(new Option(source.NAME, source.ID));
            });

            // Инициализация формы фильтров и загрузка таблицы
            setupFilterForm();
            loadExpensesTable();

        } catch (error) {
            console.error("Error fetching cashbox initial data:", error);
            alert(`Критическая ошибка: не удалось загрузить данные для кассы. ${error.message}`);
        } finally {
            hideLoader();
        }

        flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

        expenseCategory.addEventListener('change', (event) => {
            Object.values(dynamicFields).forEach(field => field.style.display = 'none');
            const selectedCategory = event.target.value;
            if (dynamicFields[selectedCategory]) {
                dynamicFields[selectedCategory].style.display = 'block';
            }
            clientSearchInput.value = '';
            selectedClientIdInput.value = '';
            clientSearchResults.innerHTML = '';
            clientSearchResults.style.display = 'none';
        });

        // Логика поиска клиентов (для добавления)
        let searchTimeout;
        clientSearchInput.addEventListener('input', (event) => {
            clearTimeout(searchTimeout);
            const searchTerm = event.target.value;

            if (searchTerm.length > 2) {
                searchTimeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`api/search_contacts?query=${encodeURIComponent(searchTerm)}`);
                        if (!response.ok) throw new Error('Failed to search contacts');
                        const contacts = await response.json();
                        clientSearchResults.innerHTML = '';
                        if (contacts.length > 0) {
                            contacts.forEach(contact => {
                                const item = document.createElement('div');
                                item.className = 'client-search-results-item';
                                item.textContent = contact.NAME;
                                item.dataset.id = contact.ID;
                                item.addEventListener('click', () => {
                                    clientSearchInput.value = contact.NAME;
                                    selectedClientIdInput.value = contact.ID;
                                    clientSearchResults.style.display = 'none';
                                });
                                clientSearchResults.appendChild(item);
                            });
                            clientSearchResults.style.display = 'block';
                        } else {
                            clientSearchResults.style.display = 'none';
                        }
                    } catch (error) {
                        console.error("Error searching contacts:", error);
                        clientSearchResults.style.display = 'none';
                    }
                }, 300);
            } else {
                clientSearchResults.innerHTML = '';
                clientSearchResults.style.display = 'none';
                selectedClientIdInput.value = '';
            }
        });

        document.addEventListener('click', (event) => {
            if (!clientSearchInput.contains(event.target) && !clientSearchResults.contains(event.target)) {
                clientSearchResults.style.display = 'none';
            }
        });

        expenseForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = {
                date: document.getElementById('expense-date').value,
                amount: parseFloat(document.getElementById('expense-amount').value),
                category: expenseCategory.options[expenseCategory.selectedIndex].text,
                category_val: expenseCategory.value,
                comment: document.getElementById('expense-comment').value,
                name: ''
            };

            let details = '';
            if (formData.category_val === 'employees') {
                const employeeSelect = document.getElementById('expense-employee');
                formData.employee_id = employeeSelect.value;
                formData.employee_name = employeeSelect.options[employeeSelect.selectedIndex].text;
                formData.paymentType = document.getElementById('expense-payment-type').value;
                details = `<li>Сотрудник: <strong>${formData.employee_name}</strong></li><li>Тип: <strong>${formData.paymentType}</strong></li>`;
                formData.name = `ЗП/Мотивация: ${formData.employee_name}`;
            } else if (formData.category_val === 'marketing') {
                const contractorSelect = document.getElementById('expense-contractor');
                formData.contractor_id = contractorSelect.value;
                formData.contractor_name = contractorSelect.options[contractorSelect.selectedIndex].text;
                details = `<li>Подрядчик: <strong>${formData.contractor_name}</strong></li>`;
                formData.name = `Маркетинг: ${formData.contractor_name}`;
            } else if (formData.category_val === 'clients') {
                formData.client_id = selectedClientIdInput.value;
                formData.client_name = clientSearchInput.value;
                details = `<li>Клиент: <strong>${formData.client_name}</strong></li>`;
                formData.name = `Расход по клиенту: ${formData.client_name}`;
            } else {
                if (formData.category) {
                     formData.name = `${formData.category}: ${formData.comment.substring(0, 50)}`;
                } else {
                    formData.name = `Расход: ${formData.comment.substring(0, 50)}`;
                }
            }

            const confirmationText = `
                <p>Вы уверены, что хотите сохранить расход?</p>
                <ul>
                    <li>Дата: <strong>${formData.date}</strong></li>
                    <li>Сумма: <strong>${formData.amount}</strong></li>
                    <li>Категория: <strong>${formData.category}</strong></li>
                    ${details}
                    ${formData.comment ? `<li>Комментарий: <strong>${formData.comment}</strong></li>` : ''}
                </ul>
            `;

            const isConfirmed = await showCustomConfirm(confirmationText);

            if (isConfirmed) {
                showLoader();
                try {
                    const saveResponse = await fetch('api/add_expense', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: formData.name,
                            date: formData.date,
                            amount: formData.amount,
                            category_text: formData.category,
                            comment: formData.comment,
                            employee_id: formData.employee_id || null,
                            contractor_id: formData.contractor_id || null,
                            client_id: formData.client_id || null,
                            payment_type: formData.paymentType || null,
                            added_by_user_id: memberId // Передаем ID пользователя
                        }),
                    });

                    if (!saveResponse.ok) {
                        const errorData = await saveResponse.json();
                        throw new Error(errorData.error || 'Ошибка при сохранении расхода');
                    }

                    const result = await saveResponse.json();
                    console.log("Расход успешно сохранен:", result);
                    alert("Расход успешно сохранен!");
                    expenseForm.reset();
                    Object.values(dynamicFields).forEach(field => field.style.display = 'none');
                    clientSearchInput.value = '';
                    clientSearchResults.innerHTML = '';
                    clientSearchResults.style.display = 'none';
                    selectedClientIdInput.value = '';
                    expenseCategory.value = '';
                    loadExpensesTable(); // Обновляем таблицу после сохранения

                } catch (error) {
                    console.error("Ошибка сохранения расхода:", error);
                    alert(`Ошибка при сохранении расхода: ${error.message}`);
                } finally {
                    hideLoader();
                }
            } else {
                console.log("Сохранение отменено пользователем.");
            }
        });
    }

    // --- ЛОГИКА ТАБЛИЦЫ РАСХОДОВ, ФИЛЬТРОВ И ПАГИНАЦИИ ---
    const expensesTableBody = document.getElementById('expenses-table-body');
    const filterForm = document.getElementById('expenses-filter-form');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfoSpan = document.getElementById('page-info');

    // Модальное окно редактирования
    const editExpenseModal = document.getElementById('edit-expense-modal');
    const editExpenseForm = document.getElementById('edit-expense-form');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');

    // Модальное окно удаления
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    let expenseToDeleteId = null; // Для хранения ID записи, которую нужно удалить

    function setupFilterForm() {
        flatpickr("#filter-start-date", { locale: "ru", dateFormat: "Y-m-d" });
        flatpickr("#filter-end-date", { locale: "ru", dateFormat: "Y-m-d" });

        // Заполняем селекты сотрудников и подрядчиков в фильтре
        const filterEmployeeSelect = document.getElementById('filter-employee');
        const filterContractorSelect = document.getElementById('filter-contractor');

        filterEmployeeSelect.innerHTML = '<option value="">Все сотрудники...</option>';
        availableEmployees.forEach(user => {
            filterEmployeeSelect.add(new Option(user.NAME, user.ID));
        });

        filterContractorSelect.innerHTML = '<option value="">Все подрядчики...</option>';
        availableContractors.forEach(source => {
            filterContractorSelect.add(new Option(source.NAME, source.ID));
        });

        filterForm.addEventListener('submit', (event) => {
            event.preventDefault();
            currentPage = 1; // Сбрасываем страницу при применении фильтров
            applyFilters();
        });

        resetFilterBtn.addEventListener('click', () => {
            resetFilters();
        });

        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadExpensesTable();
            }
        });

        nextPageBtn.addEventListener('click', () => {
            currentPage++;
            loadExpensesTable();
        });

        // Логика поиска клиентов для фильтра
        const filterClientSearchInput = document.getElementById('filter-client-search');
        const filterClientSearchResults = document.getElementById('filter-client-search-results');
        const filterSelectedClientIdInput = document.getElementById('filter-selected-client-id');

        let filterSearchTimeout;
        filterClientSearchInput.addEventListener('input', (event) => {
            clearTimeout(filterSearchTimeout);
            const searchTerm = event.target.value;

            if (searchTerm.length > 2) {
                filterSearchTimeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`api/search_contacts?query=${encodeURIComponent(searchTerm)}`);
                        if (!response.ok) throw new Error('Failed to search contacts');
                        const contacts = await response.json();
                        filterClientSearchResults.innerHTML = '';
                        if (contacts.length > 0) {
                            contacts.forEach(contact => {
                                const item = document.createElement('div');
                                item.className = 'client-search-results-item';
                                item.textContent = contact.NAME;
                                item.dataset.id = contact.ID;
                                item.addEventListener('click', () => {
                                    filterClientSearchInput.value = contact.NAME;
                                    filterSelectedClientIdInput.value = contact.ID;
                                    filterClientSearchResults.style.display = 'none';
                                });
                                filterClientSearchResults.appendChild(item);
                            });
                            filterClientSearchResults.style.display = 'block';
                        } else {
                            filterClientSearchResults.style.display = 'none';
                        }
                    } catch (error) {
                        console.error("Error searching contacts for filter:", error);
                        filterClientSearchResults.style.display = 'none';
                    }
                }, 300);
            } else {
                filterClientSearchResults.innerHTML = '';
                filterClientSearchResults.style.display = 'none';
                filterSelectedClientIdInput.value = '';
            }
        });

        document.addEventListener('click', (event) => {
            if (!filterClientSearchInput.contains(event.target) && !filterClientSearchResults.contains(event.target)) {
                filterClientSearchResults.style.display = 'none';
            }
        });
    }

    function applyFilters() {
        currentFilters = {
            name: document.getElementById('filter-name').value,
            category: document.getElementById('filter-category').value,
            employee_id: document.getElementById('filter-employee').value,
            source_id: document.getElementById('filter-contractor').value,
            contact_id: document.getElementById('filter-selected-client-id').value,
            start_date: document.getElementById('filter-start-date').value,
            end_date: document.getElementById('filter-end-date').value,
            min_amount: document.getElementById('filter-min-amount').value,
            max_amount: document.getElementById('filter-max-amount').value,
            comment: document.getElementById('filter-comment').value
        };
        // Удаляем пустые значения из фильтров
        for (const key in currentFilters) {
            if (!currentFilters[key]) {
                delete currentFilters[key];
            }
        }
        loadExpensesTable();
    }

    function resetFilters() {
        filterForm.reset();
        document.getElementById('filter-selected-client-id').value = ''; // Сброс скрытого поля клиента
        currentFilters = {};
        currentPage = 1;
        loadExpensesTable();
    }

    async function loadExpensesTable() {
        showLoader();
        try {
            const offset = (currentPage - 1) * expensesPerPage;
            const queryParams = new URLSearchParams({
                limit: expensesPerPage,
                offset: offset,
                ...currentFilters
            });

            const response = await fetch(`api/expenses?${queryParams.toString()}`);
            if (!response.ok) throw new Error('Failed to load expenses');
            const data = await response.json();

            renderExpensesTable(data.expenses);
            updatePaginationControls(data.total_records, data.limit, data.offset);

        } catch (error) {
            console.error("Error loading expenses table:", error);
            expensesTableBody.innerHTML = `<tr><td colspan="11">Ошибка загрузки расходов: ${error.message}</td></tr>`;
        } finally {
            hideLoader();
        }
    }

    function renderExpensesTable(expenses) {
        expensesTableBody.innerHTML = '';
        if (expenses.length === 0) {
            expensesTableBody.innerHTML = `<tr><td colspan="11">Нет записей о расходах.</td></tr>`;
            return;
        }

        expenses.forEach(expense => {
            const row = expensesTableBody.insertRow();
            row.insertCell().textContent = expense.id;
            row.insertCell().textContent = expense.name;
            row.insertCell().textContent = expense.expense_date;
            row.insertCell().textContent = parseFloat(expense.amount).toFixed(2);
            row.insertCell().textContent = expense.category;
            row.insertCell().textContent = expense.employee_name || '';
            row.insertCell().textContent = expense.source_name || '';
            row.insertCell().textContent = expense.contact_name || '';
            row.insertCell().textContent = expense.comment || '';
            row.insertCell().textContent = expense.added_by_user_name || '';

            const actionsCell = row.insertCell();
            actionsCell.className = 'actions-column';
            actionsCell.innerHTML = `
                <span class="action-icon edit-icon" data-id="${expense.id}" title="Редактировать">✏️</span>
                <span class="action-icon delete-icon" data-id="${expense.id}" title="Удалить">🗑️</span>
            `;
        });

        // Добавляем обработчики событий для иконок
        expensesTableBody.querySelectorAll('.edit-icon').forEach(icon => {
            icon.addEventListener('click', (event) => openEditModal(event.target.dataset.id));
        });
        expensesTableBody.querySelectorAll('.delete-icon').forEach(icon => {
            icon.addEventListener('click', (event) => openDeleteConfirmModal(event.target.dataset.id));
        });
    }

    function updatePaginationControls(totalRecords, limit, offset) {
        const totalPages = Math.ceil(totalRecords / limit);
        const currentPageCalculated = Math.floor(offset / limit) + 1;

        pageInfoSpan.textContent = `Страница ${currentPageCalculated} из ${totalPages}`;
        prevPageBtn.disabled = currentPageCalculated === 1;
        nextPageBtn.disabled = currentPageCalculated === totalPages || totalPages === 0;
    }

    // --- ЛОГИКА РЕДАКТИРОВАНИЯ ---
    const editExpenseIdInput = document.getElementById('edit-expense-id');
    const editExpenseNameInput = document.getElementById('edit-expense-name');
    const editExpenseDateInput = document.getElementById('edit-expense-date');
    const editExpenseAmountInput = document.getElementById('edit-expense-amount');
    const editExpenseCategorySelect = document.getElementById('edit-expense-category');
    const editExpenseCommentInput = document.getElementById('edit-expense-comment');

    const editDynamicFields = {
        employees: document.getElementById('edit-employee-fields'),
        marketing: document.getElementById('edit-marketing-fields'),
        clients: document.getElementById('edit-client-fields')
    };
    const editEmployeeSelect = document.getElementById('edit-expense-employee');
    const editContractorSelect = document.getElementById('edit-expense-contractor');
    const editClientSearchInput = document.getElementById('edit-expense-client-search');
    const editClientSearchResults = document.getElementById('edit-client-search-results');
    const editSelectedClientIdInput = document.getElementById('edit-selected-client-id');

    let editFlatpickrInstance; // Для хранения экземпляра flatpickr

    async function openEditModal(expenseId) {
        showLoader();
        try {
            const response = await fetch(`api/expenses/${expenseId}`);
            if (!response.ok) throw new Error('Failed to load expense for editing');
            const expense = await response.json();

            editExpenseIdInput.value = expense.id;
            editExpenseNameInput.value = expense.name;
            editExpenseAmountInput.value = parseFloat(expense.amount);
            editExpenseCategorySelect.value = expense.category_val; // Предполагаем, что у вас есть category_val в БД или нужно будет маппить
            editExpenseCommentInput.value = expense.comment;

            // Инициализация flatpickr для даты редактирования
            if (editFlatpickrInstance) {
                editFlatpickrInstance.destroy(); // Уничтожаем предыдущий экземпляр, если есть
            }
            editFlatpickrInstance = flatpickr(editExpenseDateInput, {
                locale: "ru",
                dateFormat: "Y-m-d",
                defaultDate: expense.expense_date // Устанавливаем текущую дату расхода
            });

            // Заполнение динамических полей
            Object.values(editDynamicFields).forEach(field => field.style.display = 'none');
            editEmployeeSelect.innerHTML = '<option value="">Выберите сотрудника...</option>';
            availableEmployees.forEach(user => {
                editEmployeeSelect.add(new Option(user.NAME, user.ID));
            });
            editContractorSelect.innerHTML = '<option value="">Выберите подрядчика...</option>';
            availableContractors.forEach(source => {
                editContractorSelect.add(new Option(source.NAME, source.ID));
            });

            if (expense.category_val === 'employees') {
                editDynamicFields.employees.style.display = 'block';
                editEmployeeSelect.value = expense.employee_id;
            } else if (expense.category_val === 'marketing') {
                editDynamicFields.marketing.style.display = 'block';
                editContractorSelect.value = expense.source_id;
            } else if (expense.category_val === 'clients') {
                editDynamicFields.clients.style.display = 'block';
                editClientSearchInput.value = expense.contact_name || ''; // Показываем имя
                editSelectedClientIdInput.value = expense.contact_id || ''; // Храним ID
            }

            editExpenseModal.style.display = 'flex'; // Показываем модальное окно
        } catch (error) {
            console.error("Error opening edit modal:", error);
            alert(`Ошибка при загрузке данных для редактирования: ${error.message}`);
        } finally {
            hideLoader();
        }
    }

    editExpenseCategorySelect.addEventListener('change', (event) => {
        Object.values(editDynamicFields).forEach(field => field.style.display = 'none');
        const selectedCategory = event.target.value;
        if (editDynamicFields[selectedCategory]) {
            editDynamicFields[selectedCategory].style.display = 'block';
        }
        editClientSearchInput.value = '';
        editSelectedClientIdInput.value = '';
        editClientSearchResults.innerHTML = '';
        editClientSearchResults.style.display = 'none';
    });

    // Логика поиска клиентов для редактирования
    let editSearchTimeout;
    editClientSearchInput.addEventListener('input', (event) => {
        clearTimeout(editSearchTimeout);
        const searchTerm = event.target.value;

        if (searchTerm.length > 2) {
            editSearchTimeout = setTimeout(async () => {
                try {
                    const response = await fetch(`api/search_contacts?query=${encodeURIComponent(searchTerm)}`);
                    if (!response.ok) throw new Error('Failed to search contacts');
                    const contacts = await response.json();
                    editClientSearchResults.innerHTML = '';
                    if (contacts.length > 0) {
                        contacts.forEach(contact => {
                            const item = document.createElement('div');
                            item.className = 'client-search-results-item';
                            item.textContent = contact.NAME;
                            item.dataset.id = contact.ID;
                            item.addEventListener('click', () => {
                                editClientSearchInput.value = contact.NAME;
                                editSelectedClientIdInput.value = contact.ID;
                                editClientSearchResults.style.display = 'none';
                            });
                            editClientSearchResults.appendChild(item);
                        });
                        editClientSearchResults.style.display = 'block';
                    } else {
                        editClientSearchResults.style.display = 'none';
                    }
                } catch (error) {
                    console.error("Error searching contacts for edit:", error);
                    editClientSearchResults.style.display = 'none';
                }
            }, 300);
        } else {
            editClientSearchResults.innerHTML = '';
            editClientSearchResults.style.display = 'none';
            editSelectedClientIdInput.value = '';
        }
    });

    document.addEventListener('click', (event) => {
        if (!editClientSearchInput.contains(event.target) && !editClientSearchResults.contains(event.target)) {
            editClientSearchResults.style.display = 'none';
        }
    });

    editExpenseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const expenseId = editExpenseIdInput.value;
        const formData = {
            name: editExpenseNameInput.value,
            date: editExpenseDateInput.value,
            amount: parseFloat(editExpenseAmountInput.value),
            category_text: editExpenseCategorySelect.options[editExpenseCategorySelect.selectedIndex].text,
            category_val: editExpenseCategorySelect.value,
            comment: editExpenseCommentInput.value,
        };

        // Динамические поля для редактирования
        if (formData.category_val === 'employees') {
            formData.employee_id = editEmployeeSelect.value;
        } else if (formData.category_val === 'marketing') {
            formData.contractor_id = editContractorSelect.value;
        } else if (formData.category_val === 'clients') {
            formData.client_id = editSelectedClientIdInput.value;
        }

        showLoader();
        try {
            const saveResponse = await fetch(`api/expenses/${expenseId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!saveResponse.ok) {
                const errorData = await saveResponse.json();
                throw new Error(errorData.error || 'Ошибка при обновлении расхода');
            }

            console.log("Расход успешно обновлен:", expenseId);
            alert("Расход успешно обновлен!");
            closeEditModal();
            loadExpensesTable(); // Обновляем таблицу после обновления

        } catch (error) {
            console.error("Ошибка обновления расхода:", error);
            alert(`Ошибка при обновлении расхода: ${error.message}`);
        } finally {
            hideLoader();
        }
    });

    cancelEditBtn.addEventListener('click', closeEditModal);

    function closeEditModal() {
        editExpenseModal.style.display = 'none';
        editExpenseForm.reset();
        Object.values(editDynamicFields).forEach(field => field.style.display = 'none');
        editClientSearchInput.value = '';
        editSelectedClientIdInput.value = '';
        editClientSearchResults.innerHTML = '';
        editClientSearchResults.style.display = 'none';
        if (editFlatpickrInstance) {
            editFlatpickrInstance.destroy(); // Уничтожаем flatpickr при закрытии
            editFlatpickrInstance = null;
        }
    }

    // --- ЛОГИКА УДАЛЕНИЯ ---
    function openDeleteConfirmModal(expenseId) {
        expenseToDeleteId = expenseId;
        deleteConfirmModal.style.display = 'flex';
    }

    confirmDeleteBtn.addEventListener('click', async () => {
        if (expenseToDeleteId) {
            showLoader();
            try {
                const response = await fetch(`api/expenses/${expenseToDeleteId}`, {
                    method: 'DELETE',
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Ошибка при удалении расхода');
                }

                console.log("Расход успешно удален:", expenseToDeleteId);
                alert("Расход успешно удален!");
                loadExpensesTable(); // Обновляем таблицу после удаления
            } catch (error) {
                console.error("Ошибка удаления расхода:", error);
                alert(`Ошибка при удалении расхода: ${error.message}`);
            } finally {
                hideLoader();
                closeDeleteConfirmModal();
            }
        }
    });

    cancelDeleteBtn.addEventListener('click', closeDeleteConfirmModal);

    function closeDeleteConfirmModal() {
        deleteConfirmModal.style.display = 'none';
        expenseToDeleteId = null;
    }

    // --- ЛОГИКА СТАТИСТИКИ ---
    let statisticsInitialized = false;
    const dashboardContainer = document.getElementById('dashboard-container');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const sourceFilter = document.getElementById('sourceFilter');
    const applyFilterBtn = document.getElementById('apply-filter-btn');

    let sortedStatuses = [];

    function initializeStatistics() {
        console.log("Initializing Statistics Screen...");
        if (!dashboardContainer || !startDateInput || !endDateInput || !sourceFilter || !applyFilterBtn) {
            console.error("Ошибка инициализации: один из элементов экрана статистики не найден.");
            return;
        }
        flatpickr(startDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        flatpickr(endDateInput, { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });
        applyFilterBtn.addEventListener('click', fetchLeadsAndRenderDashboard);
        fetchInitialData();
    }

    async function fetchInitialData() {
        showLoader();
        try {
            const response = await fetch('api/initial_data');
            if (!response.ok) throw new Error('Failed to load initial data');
            const data = await response.json();

            if (data.sources) {
                data.sources.forEach(source => {
                    const option = document.createElement('option');
                    option.value = source.STATUS_ID;
                    option.textContent = source.NAME;
                    sourceFilter.appendChild(option);
                });
            }

            if (data.statuses) {
                sortedStatuses = data.statuses.sort((a, b) => parseInt(a.SORT) - parseInt(b.SORT));
            }

            await fetchLeadsAndRenderDashboard();
        } catch (error) {
            console.error("Error fetching initial data:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для фильтров.</p>`;
        } finally {
            hideLoader();
        }
    }

    async function fetchLeadsAndRenderDashboard() {
        showLoader();
        const queryParams = new URLSearchParams({
            startDate: startDateInput.value,
            endDate: endDateInput.value,
            source: sourceFilter.value
        });

        try {
            const response = await fetch(`api/leads?${queryParams}`);
            if (!response.ok) throw new Error('Failed to load leads');
            const leads = await response.json();
            renderDashboard(leads);
        } catch (error) {
            console.error("Error fetching leads:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки лидов.</p>`;
        } finally {
            hideLoader();
        }
    }

    function renderDashboard(leads) {
        dashboardContainer.innerHTML = '';
        const totalLeads = leads.length;

        if (totalLeads === 0) {
            dashboardContainer.innerHTML = '<p>Лиды по заданным фильтрам не найдены.</p>';
            return;
        }

        const statusCounts = leads.reduce((acc, lead) => {
            acc[lead.STATUS_ID] = (acc[lead.STATUS_ID] || 0) + 1;
            return acc;
        }, {});

        let previousStatusCount = totalLeads;

        sortedStatuses.forEach(status => {
            const count = statusCounts[status.STATUS_ID] || 0;
            let conversionRate = 0;
            if (previousStatusCount > 0) {
                conversionRate = ((count / previousStatusCount) * 100).toFixed(1);
            }

            const card = document.createElement('div');
            card.className = 'status-card';

            if (previousStatusCount !== totalLeads) {
                card.innerHTML += `<div class="conversion-arrow">↓ ${conversionRate}%</div>`;
            }

            card.innerHTML += `
                <h3>${status.NAME}</h3>
                <p>Количество лидов: <span class="count">${count}</span></p>
            `;
            dashboardContainer.appendChild(card);

            if (count > 0) {
                previousStatusCount = count;
            }
        });
    }
});