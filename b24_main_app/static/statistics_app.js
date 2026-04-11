BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

    // --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
    const memberId = "{{ member_id }}";
    let currentPage = 1;
    let expensesPerPage = 25;
    let currentFilters = {};
    let availableEmployees = [];
    let availableContractors = [];
    let cashboxInitialized = false;
    let statisticsInitialized = false;

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

    // --- УНИВЕРСАЛЬНОЕ МОДАЛЬНОЕ ОКНО ---
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationModalTitle = document.getElementById('confirmation-modal-title');
    const confirmationModalText = document.getElementById('confirmation-modal-text');
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    const cancelActionBtn = document.getElementById('cancel-action-btn');

    function showCustomConfirm({
        title = 'Подтвердите действие',
        text = 'Вы уверены?',
        confirmButtonText = 'Подтвердить',
        confirmButtonClass = 'ui-btn-primary'
    }) {
        return new Promise(resolve => {
            confirmationModalTitle.textContent = title;
            confirmationModalText.innerHTML = text;
            confirmActionBtn.textContent = confirmButtonText;

            // Управление классами кнопки
            confirmActionBtn.className = `ui-btn btn-fixed-width ${confirmButtonClass}`;

            confirmationModal.style.display = 'flex';

            confirmActionBtn.onclick = () => {
                confirmationModal.style.display = 'none';
                resolve(true);
            };
            cancelActionBtn.onclick = () => {
                confirmationModal.style.display = 'none';
                resolve(false);
            };
        });
    }

    // --- ЛОГИКА КАССЫ ---
    const expenseForm = document.getElementById('expense-form');
    const expenseCategory = document.getElementById('expense-category');
    const dynamicFields = {
        employees: document.getElementById('employee-fields'),
        marketing: document.getElementById('marketing-fields'),
        clients: document.getElementById('client-fields')
    };
    const clientSearchInput = document.getElementById('expense-client-search');
    const clientSearchResults = document.getElementById('client-search-results');
    const selectedClientIdInput = document.getElementById('selected-client-id');

    const populateSelect = (selectElement, data, placeholder) => {
        selectElement.innerHTML = `<option value="">${placeholder}</option>`;
        data.forEach(item => {
            selectElement.add(new Option(item.NAME, item.ID));
        });
    };

    async function initializeCashbox() {
        console.log("Initializing Cashbox Screen...");
        showLoader();
        try {
            const response = await fetch('api/cashbox_initial_data');
            if (!response.ok) throw new Error('Failed to load cashbox initial data');
            const data = await response.json();

            availableEmployees = data.users || [];
            availableContractors = data.sources || [];

            // Первоначальное заполнение фильтров
            setupFilterForm();
            // Первоначальная загрузка таблицы
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

            // Динамическое заполнение селектов
            if (selectedCategory === 'employees') {
                populateSelect(document.getElementById('expense-employee'), availableEmployees, 'Выберите сотрудника...');
            } else if (selectedCategory === 'marketing') {
                populateSelect(document.getElementById('expense-contractor'), availableContractors, 'Выберите подрядчика...');
            }

            // Сброс полей при смене категории
            clientSearchInput.value = '';
            selectedClientIdInput.value = '';
            clientSearchResults.innerHTML = '';
            clientSearchResults.style.display = 'none';
        });

        // Логика поиска клиентов
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
                formData.name = `${formData.category}: ${formData.comment.substring(0, 50)}`;
            }

            const isConfirmed = await showCustomConfirm({
                title: 'Сохранение расхода',
                text: `
                    <p>Вы уверены, что хотите сохранить расход?</p>
                    <ul>
                        <li>Дата: <strong>${formData.date}</strong></li>
                        <li>Сумма: <strong>${formData.amount}</strong></li>
                        <li>Категория: <strong>${formData.category}</strong></li>
                        ${details}
                        ${formData.comment ? `<li>Комментарий: <strong>${formData.comment}</strong></li>` : ''}
                    </ul>
                `,
                confirmButtonText: 'Сохранить',
                confirmButtonClass: 'ui-btn-primary'
            });

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
                            added_by_user_id: memberId
                        }),
                    });

                    if (!saveResponse.ok) {
                        const errorData = await saveResponse.json();
                        throw new Error(errorData.error || 'Ошибка при сохранении расхода');
                    }

                    alert("Расход успешно сохранен!");
                    expenseForm.reset();
                    Object.values(dynamicFields).forEach(field => field.style.display = 'none');
                    clientSearchInput.value = '';
                    selectedClientIdInput.value = '';
                    expenseCategory.value = '';
                    loadExpensesTable();

                } catch (error) {
                    console.error("Ошибка сохранения расхода:", error);
                    alert(`Ошибка при сохранении расхода: ${error.message}`);
                } finally {
                    hideLoader();
                }
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

    function setupFilterForm() {
        flatpickr("#filter-start-date", { locale: "ru", dateFormat: "Y-m-d" });
        flatpickr("#filter-end-date", { locale: "ru", dateFormat: "Y-m-d" });

        populateSelect(document.getElementById('filter-employee'), availableEmployees, 'Все сотрудники...');
        populateSelect(document.getElementById('filter-contractor'), availableContractors, 'Все подрядчики...');

        filterForm.addEventListener('submit', (event) => {
            event.preventDefault();
            currentPage = 1;
            applyFilters();
        });

        resetFilterBtn.addEventListener('click', resetFilters);
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
    }

    function applyFilters() {
        const categorySelect = document.getElementById('filter-category');
        const selectedCategoryText = categorySelect.value ? categorySelect.options[categorySelect.selectedIndex].text : '';

        currentFilters = {
            category: selectedCategoryText,
            employee_id: document.getElementById('filter-employee').value,
            source_id: document.getElementById('filter-contractor').value,
            start_date: document.getElementById('filter-start-date').value,
            end_date: document.getElementById('filter-end-date').value,
        };

        for (const key in currentFilters) {
            if (!currentFilters[key]) {
                delete currentFilters[key];
            }
        }
        loadExpensesTable();
    }

    function resetFilters() {
        filterForm.reset();
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
        nextPageBtn.disabled = currentPageCalculated >= totalPages;
    }

    // --- ЛОГИКА РЕДАКТИРОВАНИЯ ---
    const editExpenseModal = document.getElementById('edit-expense-modal');
    const editExpenseForm = document.getElementById('edit-expense-form');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const editExpenseCategorySelect = document.getElementById('edit-expense-category');
    const editDynamicFields = {
        employees: document.getElementById('edit-employee-fields'),
        marketing: document.getElementById('edit-marketing-fields'),
        clients: document.getElementById('edit-client-fields')
    };
    let editFlatpickrInstance;

    async function openEditModal(expenseId) {
        showLoader();
        try {
            const response = await fetch(`api/expenses/${expenseId}`);
            if (!response.ok) throw new Error('Failed to load expense for editing');
            const expense = await response.json();

            document.getElementById('edit-expense-id').value = expense.id;
            document.getElementById('edit-expense-name').value = expense.name;
            document.getElementById('edit-expense-amount').value = parseFloat(expense.amount);
            editExpenseCategorySelect.value = expense.category_val;
            document.getElementById('edit-expense-comment').value = expense.comment;

            if (editFlatpickrInstance) editFlatpickrInstance.destroy();
            editFlatpickrInstance = flatpickr("#edit-expense-date", {
                locale: "ru",
                dateFormat: "Y-m-d",
                defaultDate: expense.expense_date
            });

            Object.values(editDynamicFields).forEach(field => field.style.display = 'none');
            
            // Заполняем и настраиваем динамические поля
            if (expense.category_val === 'employees') {
                editDynamicFields.employees.style.display = 'block';
                const editEmployeeSelect = document.getElementById('edit-expense-employee');
                populateSelect(editEmployeeSelect, availableEmployees, 'Выберите сотрудника...');
                editEmployeeSelect.value = expense.employee_id;
            } else if (expense.category_val === 'marketing') {
                editDynamicFields.marketing.style.display = 'block';
                const editContractorSelect = document.getElementById('edit-expense-contractor');
                populateSelect(editContractorSelect, availableContractors, 'Выберите подрядчика...');
                editContractorSelect.value = expense.source_id;
            } else if (expense.category_val === 'clients') {
                editDynamicFields.clients.style.display = 'block';
                document.getElementById('edit-expense-client-search').value = expense.contact_name || '';
                document.getElementById('edit-selected-client-id').value = expense.contact_id || '';
            }

            editExpenseModal.style.display = 'flex';
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
        if (selectedCategory === 'employees') {
            populateSelect(document.getElementById('edit-expense-employee'), availableEmployees, 'Выберите сотрудника...');
        } else if (selectedCategory === 'marketing') {
            populateSelect(document.getElementById('edit-expense-contractor'), availableContractors, 'Выберите подрядчика...');
        }
    });

    editExpenseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const expenseId = document.getElementById('edit-expense-id').value;
        const categorySelect = document.getElementById('edit-expense-category');
        const formData = {
            name: document.getElementById('edit-expense-name').value,
            date: document.getElementById('edit-expense-date').value,
            amount: parseFloat(document.getElementById('edit-expense-amount').value),
            category_text: categorySelect.options[categorySelect.selectedIndex].text,
            category_val: categorySelect.value,
            comment: document.getElementById('edit-expense-comment').value,
            employee_id: null,
            contractor_id: null,
            client_id: null
        };

        if (formData.category_val === 'employees') {
            formData.employee_id = document.getElementById('edit-expense-employee').value;
        } else if (formData.category_val === 'marketing') {
            formData.contractor_id = document.getElementById('edit-expense-contractor').value;
        } else if (formData.category_val === 'clients') {
            formData.client_id = document.getElementById('edit-selected-client-id').value;
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

            alert("Расход успешно обновлен!");
            closeEditModal();
            loadExpensesTable();
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
        if (editFlatpickrInstance) {
            editFlatpickrInstance.destroy();
            editFlatpickrInstance = null;
        }
    }

    // --- ЛОГИКА УДАЛЕНИЯ ---
    let expenseToDeleteId = null;
    async function openDeleteConfirmModal(expenseId) {
        expenseToDeleteId = expenseId;
        const isConfirmed = await showCustomConfirm({
            title: 'Подтвердите удаление',
            text: 'Вы уверены, что хотите безвозвратно удалить эту запись?',
            confirmButtonText: 'Удалить',
            confirmButtonClass: 'ui-btn-danger'
        });

        if (isConfirmed) {
            showLoader();
            try {
                const response = await fetch(`api/expenses/${expenseToDeleteId}`, { method: 'DELETE' });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Ошибка при удалении расхода');
                }
                alert("Расход успешно удален!");
                loadExpensesTable();
            } catch (error) {
                console.error("Ошибка удаления расхода:", error);
                alert(`Ошибка при удалении расхода: ${error.message}`);
            } finally {
                hideLoader();
                expenseToDeleteId = null;
            }
        }
    }

    // --- ЛОГИКА СТАТИСТИКИ ---
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
            const response = await fetch('api/initial_data'); // This seems to be for a different part of the app.
            if (!response.ok) throw new Error('Failed to load initial data for statistics');
            const data = await response.json();

            if (data.sources) {
                populateSelect(sourceFilter, data.sources, 'Все источники');
            }
            if (data.statuses) {
                sortedStatuses = data.statuses.sort((a, b) => parseInt(a.SORT) - parseInt(b.SORT));
            }
            await fetchLeadsAndRenderDashboard();
        } catch (error) {
            console.error("Error fetching initial data for statistics:", error);
            dashboardContainer.innerHTML = `<p>Ошибка загрузки данных для статистики.</p>`;
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