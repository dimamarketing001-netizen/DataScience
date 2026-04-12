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

    // --- Элементы для кастомных уведомлений ---
    const notificationOverlay = document.getElementById('notification-overlay');
    const notificationIcon = notificationOverlay.querySelector('.notification-icon');
    const notificationMessage = notificationOverlay.querySelector('.notification-message');

    // --- Вспомогательная функция для кастомных уведомлений ---
    function showCustomNotification(message, type = 'success', duration = 3000) {
        notificationMessage.textContent = message;
        notificationIcon.className = 'notification-icon'; // Сброс классов
        notificationIcon.classList.add(type); // Добавление класса типа (success/error)

        notificationOverlay.classList.add('show');

        setTimeout(() => {
            notificationOverlay.classList.remove('show');
        }, duration);
    }

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
        showCustomNotification(`Критическая ошибка инициализации кассы: ${error.message}`, 'error');
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
            showCustomNotification(`Ошибка загрузки расходов: ${error.message}`, 'error');
            App.cashbox.ui.elements.expensesTableBody.innerHTML = `<tr><td colspan="11">Ошибка загрузки расходов.</td></tr>`;
        } finally {
            App.hideLoader();
        }
    }

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
        event.preventDefault();

        // Собираем данные из формы
        const formData = {
            date: document.getElementById('expense-date').value,
            amount: parseFloat(document.getElementById('expense-amount').value),
            category_text: expenseCategory.options[expenseCategory.selectedIndex].text,
            category_val: expenseCategory.value,
            comment: document.getElementById('expense-comment').value,
            employee_id: document.getElementById('expense-employee').value,
            source_id: document.getElementById('expense-contractor').value,
            contact_id: document.getElementById('selected-client-id').value,
            paid_leads: document.getElementById('expense-paid-leads').value, // New field
            free_leads: document.getElementById('expense-free-leads').value, // New field
        };

        // --- Валидация ---
        if (formData.category_val === 'employees' && !formData.employee_id) {
            showCustomNotification("Поле 'Сотрудник' обязательно для категории 'Сотрудники'.", 'error');
            return;
        }

        // Формируем данные для отображения в попапе подтверждения
        const formDataForDisplay = {
            'Дата': formData.date,
            'Сумма': formData.amount,
            'Категория': formData.category_text,
        };

        if (formData.comment) {
            formDataForDisplay['Комментарий'] = formData.comment;
        }

        // Добавляем динамические поля, если они выбраны
        const selectedCategory = formData.category_val;
        if (selectedCategory === 'employees') {
            const employeeSelect = document.getElementById('expense-employee');
            if (employeeSelect.value) {
                formDataForDisplay['Сотрудник'] = employeeSelect.options[employeeSelect.selectedIndex].text;
            }
            const paymentTypeSelect = document.getElementById('expense-payment-type');
            if (paymentTypeSelect.value) {
                formDataForDisplay['Тип выплаты'] = paymentTypeSelect.options[paymentTypeSelect.selectedIndex].text;
            }
        } else if (selectedCategory === 'marketing') {
            const contractorSelect = document.getElementById('expense-contractor');
            if (contractorSelect.value) {
                formDataForDisplay['Подрядчик'] = contractorSelect.options[contractorSelect.selectedIndex].text;
            }
            if (formData.paid_leads) {
                formDataForDisplay['Платные лиды'] = formData.paid_leads;
            }
            if (formData.free_leads) {
                formDataForDisplay['Бесплатные лиды'] = formData.free_leads;
            }
        } else if (selectedCategory === 'clients') {
            const clientSearchInput = document.getElementById('expense-client-search');
            if (clientSearchInput.value) {
                formDataForDisplay['Клиент'] = clientSearchInput.value;
            }
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
                showCustomNotification("Расход успешно сохранен!");
                expenseForm.reset();
                App.cashbox.ui.toggleDynamicFields('');
                loadExpensesTable(1);
            } catch (error) {
                showCustomNotification(`Ошибка сохранения: ${error.message}`, 'error');
            } finally {
                App.hideLoader();
            }
        }
    }

    async function openEditModal(expenseId) {
        App.showLoader();
        try {
            const expense = await App.cashbox.api.getSingleExpense(expenseId);
            // Передаем доступных сотрудников и подрядчиков в openEditModal UI-модуля
            App.cashbox.ui.openEditModal(expense, availableEmployees, availableContractors);
        } catch (error) {
            showCustomNotification(`Ошибка загрузки данных для редактирования: ${error.message}`, 'error');
        } finally {
            App.hideLoader();
        }
    }

    async function handleUpdateExpense(event) {
        event.preventDefault();

        const editExpenseCategory = document.getElementById('edit-expense-category');
        const selectedCategory = editExpenseCategory.value;

        const formData = {
            id: document.getElementById('edit-expense-id').value,
            date: document.getElementById('edit-expense-date').value,
            amount: parseFloat(document.getElementById('edit-expense-amount').value),
            category_text: editExpenseCategory.options[editExpenseCategory.selectedIndex].text,
            category_val: selectedCategory,
            comment: document.getElementById('edit-expense-comment').value,
            employee_id: '',
            source_id: '',
            contact_id: '',
            payment_type: '',
            paid_leads: document.getElementById('edit-expense-paid-leads').value, // New field
            free_leads: document.getElementById('edit-expense-free-leads').value, // New field
        };

        // Заполняем динамические поля в зависимости от категории
        if (selectedCategory === 'employees') {
            formData.employee_id = document.getElementById('edit-expense-employee').value;
            formData.payment_type = document.getElementById('edit-expense-payment-type').value;
        } else if (selectedCategory === 'marketing') {
            formData.source_id = document.getElementById('edit-expense-contractor').value;
        } else if (selectedCategory === 'clients') {
            formData.contact_id = document.getElementById('edit-selected-client-id').value;
        }

        // --- Валидация ---
        if (selectedCategory === 'employees' && !formData.employee_id) {
            showCustomNotification("Поле 'Сотрудник' обязательно для категории 'Сотрудники'.", 'error');
            return;
        }

        // Формируем данные для отображения в попапе подтверждения
        const formDataForDisplay = {
            'Дата': formData.date,
            'Сумма': formData.amount,
            'Категория': editExpenseCategory.options[editExpenseCategory.selectedIndex].text,
        };

        // Заполняем динамические поля в зависимости от категории
        if (selectedCategory === 'employees') {
            const employeeSelect = document.getElementById('edit-expense-employee');
            if (employeeSelect.value) {
                formDataForDisplay['Сотрудник'] = employeeSelect.options[employeeSelect.selectedIndex].text;
            }
            const paymentTypeSelect = document.getElementById('edit-expense-payment-type');
            if (paymentTypeSelect.value) {
                formDataForDisplay['Тип выплаты'] = paymentTypeSelect.options[paymentTypeSelect.selectedIndex].text;
            }
        } else if (selectedCategory === 'marketing') {
            const contractorSelect = document.getElementById('edit-expense-contractor');
            if (contractorSelect.value) {
                formDataForDisplay['Подрядчик'] = contractorSelect.options[contractorSelect.selectedIndex].text;
            }
            if (formData.paid_leads) {
                formDataForDisplay['Платные лиды'] = formData.paid_leads;
            }
            if (formData.free_leads) {
                formDataForDisplay['Бесплатные лиды'] = formData.free_leads;
            }
        } else if (selectedCategory === 'clients') {
            const clientSearchInput = document.getElementById('edit-expense-client-search');
            if (clientSearchInput.value) {
                formDataForDisplay['Клиент'] = clientSearchInput.value;
            }
        }

        if (formData.comment) {
            formDataForDisplay['Комментарий'] = formData.comment;
        }

        const isConfirmed = await App.showCustomConfirm({
            title: 'Подтвердите обновление расхода',
            text: 'Выверены, что хотите обновить следующий расход?',
            data: formDataForDisplay,
            confirmButtonText: 'Обновить'
        });

        if (isConfirmed) {
            App.showLoader();
            try {
                await App.cashbox.api.updateExpense(formData);
                showCustomNotification('Расход успешно обновлен!');
                App.cashbox.ui.closeEditModal();
                loadExpensesTable(currentPage);
            } catch (error) {
                showCustomNotification(`Ошибка обновления: ${error.message}`, 'error');
            } finally {
                App.hideLoader();
            }
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
            showCustomNotification('Расход удален.');
            App.cashbox.ui.closeDeleteConfirmModal();
            expenseToDeleteId = null;
            loadExpensesTable(currentPage);
        } catch (error) {
            showCustomNotification(`Ошибка удаления: ${error.message}`, 'error');
        } finally {
            App.hideLoader();
        }
    }
};
