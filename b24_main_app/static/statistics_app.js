BX24.ready(() => {
    console.log("BX24 is ready. Application logic starts.");

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

    // --- ЛОГИКА КАССЫ ---
    let cashboxInitialized = false;
    const expenseForm = document.getElementById('expense-form');
    const expenseCategory = document.getElementById('expense-category');
    const dynamicFields = {
        employees: document.getElementById('employee-fields'),
        marketing: document.getElementById('marketing-fields'),
        clients: document.getElementById('client-fields')
    };

    function initializeCashbox() {
        console.log("Initializing Cashbox Screen...");
        // Инициализация календаря
        flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

        // Заполнение списков
        const employees = ["Попов", "Мирзоев", "Аптряев", "Иванова", "Васильев", "Коротаева", "Константинов", "Карпенко", "Хайнова", "Григорий"];
        const contractors = ["Лидпрайм", "Верба", "2ГИС", "Клик.Ру", "Яндекс", "МТТ", "Битрикс", "Сбер", "Т-банк", "Дельта"];

        const employeeSelect = document.getElementById('expense-employee');
        const contractorSelect = document.getElementById('expense-contractor');

        employees.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            employeeSelect.appendChild(option);
        });

        contractors.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            contractorSelect.appendChild(option);
        });

        // Логика отображения динамических полей
        expenseCategory.addEventListener('change', (event) => {
            // Сначала скрыть все динамические поля
            Object.values(dynamicFields).forEach(field => field.style.display = 'none');
            // Показать нужное поле
            const selectedCategory = event.target.value;
            if (dynamicFields[selectedCategory]) {
                dynamicFields[selectedCategory].style.display = 'block';
            }
        });

        // Поиск клиентов (пока просто пример)
        const clientSearchInput = document.getElementById('expense-client-search');
        clientSearchInput.addEventListener('input', (event) => {
            const searchTerm = event.target.value;
            if (searchTerm.length > 2) {
                console.log(`Ищем клиента: ${searchTerm}`);
                // Здесь будет вызов BX24.callMethod('crm.contact.list', ...)
            }
        });

        // Обработка отправки формы
        expenseForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const formData = {
                date: document.getElementById('expense-date').value,
                amount: document.getElementById('expense-amount').value,
                category: expenseCategory.value,
                comment: document.getElementById('expense-comment').value,
            };
            // Добавляем данные из динамических полей
            if (formData.category === 'employees') {
                formData.employee = document.getElementById('expense-employee').value;
                formData.paymentType = document.getElementById('expense-payment-type').value;
            } else if (formData.category === 'marketing') {
                formData.contractor = document.getElementById('expense-contractor').value;
            } else if (formData.category === 'clients') {
                formData.client = document.getElementById('expense-client-search').value;
            }
            console.log("Сохраняем расход:", formData);
            alert("Расход сохранен (в консоли)");
            expenseForm.reset();
            // Сбрасываем динамические поля
            Object.values(dynamicFields).forEach(field => field.style.display = 'none');
        });
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

    async function fetchInitialData() { /* ... код без изменений ... */ }
    async function fetchLeadsAndRenderDashboard() { /* ... код без изменений ... */ }
    function renderDashboard(leads) { /* ... код без изменений ... */ }
});
