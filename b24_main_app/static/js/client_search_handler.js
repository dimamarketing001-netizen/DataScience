// static/js/client_search_handler.js
(function() {

    /**
     * Класс для реализации живого поиска клиентов (контактов) Bitrix24 с debounce.
     * Использует BX24.callMethod для прямого взаимодействия с API.
     */
    class ClientSearchHandler {
        /**
         * @param {object} options - Опции инициализации.
         * @param {HTMLInputElement} options.searchInput - Элемент input для ввода поискового запроса.
         * @param {HTMLElement} options.searchResultsContainer - Контейнер для отображения результатов поиска.
         * @param {HTMLInputElement} options.selectedClientIdInput - Скрытый input для хранения ID выбранного клиента.
         * @param {number} [options.itemsPerPage=10] - Количество элементов на странице (больше не используется для пагинации, но сохранено для потенциального ограничения отображения).
         * @param {number} [options.debounceDelay=500] - Задержка debounce в мс.
         */
        constructor(options) {
            this.searchInput = options.searchInput;
            this.searchResultsContainer = options.searchResultsContainer;
            this.selectedClientIdInput = options.selectedClientIdInput;

            this.itemsPerPage = options.itemsPerPage || 10; // Может быть использовано для ограничения количества отображаемых результатов, если нужно
            this.debounceDelay = options.debounceDelay || 700; // Увеличено для последовательных запросов

            this.currentSearchQuery = '';
            this.allFoundContacts = []; // Храним все найденные и дедуплицированные контакты

            // Проверка наличия всех необходимых элементов
            if (!this.searchInput || !this.searchResultsContainer || !this.selectedClientIdInput) {
                console.warn("ClientSearchHandler: Один или несколько необходимых элементов UI не найдены. Инициализация пропущена.", options);
                return;
            }

            this.debouncedSearch = this.debounce(this.handleSearchInput.bind(this), this.debounceDelay);

            this.init();
        }

        /**
         * Утилита debounce для предотвращения слишком частых вызовов функции.
         * @param {function} func - Функция, которую нужно отложить.
         * @param {number} delay - Задержка в миллисекундах.
         * @returns {function} - Дебаунсированная функция.
         */
        debounce(func, delay) {
            let timeout;
            return function(...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), delay);
            };
        }

        /**
         * Выполняет поиск клиентов через Bitrix24 API.
         * @param {string} query - Поисковый запрос.
         */
        async performClientSearch(query) {
            // Если запрос пуст, очищаем результаты и скрываем контейнер
            if (!query.trim()) {
                this.searchResultsContainer.innerHTML = '';
                this.searchResultsContainer.style.display = 'none';
                this.allFoundContacts = [];
                return;
            }

            this.currentSearchQuery = query;
            App.showLoader(); // Показываем глобальный лоадер

            // --- ДОБАВЛЕНО: Отображаем сообщение о поиске ---
            this.searchResultsContainer.innerHTML = '<div class="client-search-results-item">Идет поиск...</div>';
            this.searchResultsContainer.style.display = 'block';
            // -------------------------------------------------

            const searchFields = ['NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE', 'EMAIL'];
            const uniqueContactsMap = new Map(); // Для дедупликации контактов

            console.log(`[ClientSearchHandler] Performing sequential search for query: "${query}"`);

            try {
                for (const field of searchFields) {
                    const filter = {};
                    // Используем wildcard '*' для частичного совпадения
                    filter[field] = `${query}`;

                    console.log(`[ClientSearchHandler] Sending API call for field "${field}" with filter:`, filter);

                    const response = await new Promise((resolve, reject) => {
                        BX24.callMethod('crm.contact.list', {
                            filter: filter,
                            select: ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE', 'EMAIL'],
                            start: 0, // Всегда запрашиваем с начала для каждого поля
                            limit: 50, // Ограничиваем количество результатов для каждого запроса
                            order: { "LAST_NAME": "ASC", "NAME": "ASC" }
                        }, (result) => {
                            if (result.error()) {
                                reject({ field: field, error: result.error() });
                            } else {
                                resolve({ field: field, data: result.data(), total: result.total() });
                            }
                        });
                    });

                    console.log(`[ClientSearchHandler] API call for field "${response.field}" fulfilled. Total found: ${response.total}, Data:`, response.data);

                    for (const contact of response.data) {
                        uniqueContactsMap.set(contact.ID, contact);
                    }
                }

                this.allFoundContacts = Array.from(uniqueContactsMap.values());
                // Сортируем объединенные контакты для предсказуемого отображения
                this.allFoundContacts.sort((a, b) => {
                    const lastNameA = (a.LAST_NAME || '').toLowerCase();
                    const lastNameB = (b.LAST_NAME || '').toLowerCase();
                    if (lastNameA < lastNameB) return -1;
                    if (lastNameA > lastNameB) return 1;

                    const nameA = (a.NAME || '').toLowerCase();
                    const nameB = (b.NAME || '').toLowerCase();
                    if (nameA < nameB) return -1;
                    if (nameA > nameB) return 1;
                    return 0;
                });

                // Теперь this.allFoundContacts содержит все уникальные найденные контакты
                // Мы рендерим их все, без клиентской пагинации
                console.log('[ClientSearchHandler] Combined unique contacts found:', this.allFoundContacts.length, this.allFoundContacts);

                this.renderSearchResults(this.allFoundContacts); // Рендерим все найденные контакты

            } catch (error) {
                console.error('[ClientSearchHandler] General search error during sequential calls:', error);
                let errorMessage = 'Произошла ошибка при выполнении запроса.';
                if (error && error.error_description) {
                    errorMessage = `Ошибка поиска: ${error.error_description}`;
                } else if (error && error.message) {
                    errorMessage = `Произошла ошибка при выполнении запроса: ${error.message}`;
                } else if (typeof error === 'string') {
                    errorMessage = `Произошла ошибка при выполнении запроса: ${error}`;
                } else if (error && error.field) { // Ошибка конкретного поля
                    errorMessage = `Ошибка поиска по полю ${error.field}: ${error.error.error_description || error.error.message || 'Неизвестная ошибка'}`;
                }

                // Используем новую систему уведомлений для критических ошибок
                await App.Notify.error('Ошибка поиска клиента', errorMessage);
                // Очищаем контейнер результатов, так как ошибка модальная
                this.searchResultsContainer.innerHTML = '';
                this.searchResultsContainer.style.display = 'none';
            } finally {
                App.hideLoader(); // Скрываем глобальный лоадер
            }
        }

        /**
         * Отображает результаты поиска в контейнере.
         * @param {Array<object>} contacts - Массив найденных контактов.
         */
        renderSearchResults(contacts) {
            this.searchResultsContainer.innerHTML = ''; // Очищаем сообщение "Идет поиск..."
            if (contacts.length === 0) {
                this.searchResultsContainer.innerHTML = '<div class="client-search-results-item">Ничего не найдено.</div>';
                this.searchResultsContainer.style.display = 'block';
                return;
            }

            contacts.forEach(contact => {
                const item = document.createElement('div');

                item.className = 'client-search-results-item';
                item.dataset.id = contact.ID;

                let displayInfo = `${contact.LAST_NAME || ''} ${contact.NAME || ''} ${contact.SECOND_NAME || ''}`.trim();


                // Добавляем телефоны, если есть
                if (contact.PHONE && contact.PHONE.length > 0) {
                    const phones = contact.PHONE.map(p => p.VALUE).join(', ');
                    displayInfo += ` (Тел: ${phones})`;
                }

                // Добавляем email, если есть
                if (contact.EMAIL && contact.EMAIL.length > 0) {
                    const emails = contact.EMAIL.map(e => e.VALUE).join(', ');
                    displayInfo += ` (Email: ${emails})`;
                }

                item.textContent = displayInfo;
                item.addEventListener('click', () => {
                    // При выборе клиента заполняем input и скрытое поле ID
                    this.selectedClientIdInput.value = contact.ID;
                    this.searchInput.value = displayInfo;
                    this.searchResultsContainer.style.display = 'none'; // Скрываем результаты после выбора
                });
                this.searchResultsContainer.appendChild(item);
            });
            this.searchResultsContainer.style.display = 'block'; // Показываем контейнер с результатами
        }

        /**
         * Обработчик события ввода в поисковом поле.
         * @param {Event} event - Событие ввода.
         */
        handleSearchInput(event) {
            this.performClientSearch(event.target.value); // Вызываем без номера страницы
        }

        /**
         * Инициализирует обработчики событий.
         */
        init() {
            this.searchInput.addEventListener('input', this.debouncedSearch);

            // Скрываем результаты при клике вне контейнера поиска
            document.addEventListener('click', (event) => {
                if (!this.searchResultsContainer.contains(event.target) && event.target !== this.searchInput) {
                    this.searchResultsContainer.style.display = 'none';
                }
            });

            // Показываем результаты снова, если input в фокусе и есть запрос
            this.searchInput.addEventListener('focus', () => {
                if (this.currentSearchQuery.trim() && this.searchResultsContainer.children.length > 0) {
                    this.searchResultsContainer.style.display = 'block';
                }
            });
        }
    }

    // Делаем класс доступным в глобальном пространстве App
    if (typeof App === 'undefined') {
        window.App = {};
    }
    App.ClientSearchHandler = ClientSearchHandler;

})();

// Инициализируем поиск клиентов, когда Bitrix24 API будет готов
BX24.ready(function() {
    // Для формы добавления расхода
    new App.ClientSearchHandler({
        searchInput: document.getElementById('expense-client-search'),
        searchResultsContainer: document.getElementById('client-search-results'),
        selectedClientIdInput: document.getElementById('selected-client-id')
    });

    // Для формы редактирования расхода
    new App.ClientSearchHandler({
        searchInput: document.getElementById('edit-expense-client-search'),
        searchResultsContainer: document.getElementById('edit-client-search-results'),
        selectedClientIdInput: document.getElementById('edit-selected-client-id')
    });
});
