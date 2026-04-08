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
    // Модальное окно
    const modal = document.getElementById('custom-modal');
    const modalText = document.getElementById('modal-text');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    function showCustomConfirm(text, data) {
        return new Promise(resolve => {
            modalText.innerHTML = text; // Используем innerHTML для поддержки тегов
            modal.style.display = 'flex';
            confirmBtn.onclick = () => { modal.style.display = 'none'; resolve(true); };
            cancelBtn.onclick = () => { modal.style.display = 'none'; resolve(false); };
        });
    }

    function initializeCashbox() {
        console.log("Initializing Cashbox Screen...");
        flatpickr("#expense-date", { locale: "ru", dateFormat: "Y-m-d", defaultDate: "today" });

        const employees = ["Попов", "Мирзоев", "Аптряев", "Иванова", "Васильев", "Коротаева", "Константинов", "Карпенко", "Хайнова", "Григорий"];
        const contractors = ["Лидпрайм", "Верба", "2ГИС", "Клик.Ру", "Яндекс", "МТТ", "Битрикс", "Сбер", "Т-банк", "Дельта"];
        
        const employeeSelect = document.getElementById('expense-employee');
        const contractorSelect = document.getElementById('expense-contractor');
        employees.forEach(name => employeeSelect.add(new Option(name, name)));
        contractors.forEach(name => contractorSelect.add(new Option(name, name)));

        expenseCategory.addEventListener('change', (event) => {
            Object.values(dynamicFields).forEach(field => field.style.display = 'none');
            const selectedCategory = event.target.value;
            if (dynamicFields[selectedCategory]) {
                dynamicFields[selectedCategory].style.display = 'block';
            }
        });

        const clientSearchInput = document.getElementById('expense-client-search');
        clientSearchInput.addEventListener('input', (event) => {
            const searchTerm = event.target.value;
            if (searchTerm.length > 2) console.log(`Ищем клиента: ${searchTerm}`);
        });

        expenseForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = {
                date: document.getElementById('expense-date').value,
                amount: document.getElementById('expense-amount').value,
                category: expenseCategory.options[expenseCategory.selectedIndex].text,
                category_val: expenseCategory.value,
                comment: document.getElementById('expense-comment').value,
            };

            let details = '';
            if (formData.category_val === 'employees') {
                formData.employee = document.getElementById('expense-employee').value;
                formData.paymentType = document.getElementById('expense-payment-type').value;
                details = `<li>Сотрудник: <strong>${formData.employee}</strong></li><li>Тип: <strong>${formData.paymentType}</strong></li>`;
            } else if (formData.category_val === 'marketing') {
                formData.contractor = document.getElementById('expense-contractor').value;
                details = `<li>Подрядчик: <strong>${formData.contractor}</strong></li>`;
            } else if (formData.category_val === 'clients') {
                formData.client = document.getElementById('expense-client-search').value;
                details = `<li>Клиент: <strong>${formData.client}</strong></li>`;
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

            const isConfirmed = await showCustomConfirm(confirmationText, formData);

            if (isConfirmed) {
                console.log("Сохраняем расход:", formData);
                // Здесь будет вызов BX24.callMethod для сохранения в универсальный список
                alert("Расход сохранен (в консоли)");
                expenseForm.reset();
                Object.values(dynamicFields).forEach(field => field.style.display = 'none');
            } else {
                console.log("Сохранение отменено пользователем.");
            }
        });
    }

    // --- ЛОГИКА СТАТИСТИКИ ---
    let statisticsInitialized = false;
    // ... остальной код статистики без изменений ...
});
