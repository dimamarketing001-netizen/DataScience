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

    // Элементы для поиска клиентов
    const clientSearchInput = document.getElementById('expense-client-search');
    const clientSearchResults = document.getElementById('client-search-results');
    const selectedClientIdInput = document.getElementById('selected-client-id');

    let availableEmployees = [];
    let availableContractors = [];

    function showCustomConfirm(text) {
        return new Promise(resolve => {
            modalText.innerHTML = text;
            modal.style.display = 'flex';
            confirmBtn.onclick = () => { modal.style.display = 'none'; resolve(true); };
            cancelBtn.onclick = () => { modal.style.display = 'none'; resolve(false); };
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
                            // УПРОЩЕНО: Просто отправляем текст категории
                            category_text: formData.category,
                            comment: formData.comment,
                            employee_id: formData.employee_id || null,
                            contractor_id: formData.contractor_id || null,
                            client_id: formData.client_id || null,
                            payment_type: formData.paymentType || null
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