// static/js/client_search_handler.js
(function() {

    /**
     * Класс для реализации живого поиска клиентов (контактов) Bitrix24 с debounce и пагинацией.
     * Использует BX24.callMethod для прямого взаимодействия с API.
     */
    class ClientSearchHandler {
        /**
         * @param {object} options - Опции инициализации.
         * @param {HTMLInputElement} options.searchInput - Элемент input для ввода поискового запроса.
         * @param {HTMLElement} options.searchResultsContainer - Контейнер для отображения результатов поиска.
         * @param {HTMLInputElement} options.selectedClientIdInput - Скрытый input для хранения ID выбранного клиента.
         * @param {HTMLElement} options.pageInfoSpan - Элемент для отображения информации о текущей странице.
         * @param {HTMLButtonElement} options.prevPageBtn - Кнопка "Предыдущая страница".
         * @param {HTMLButtonElement} options.nextPageBtn - Кнопка "Следующая страница".
         * @param {number} [options.itemsPerPage=10] - Количество элементов на странице.
         * @param {number} [options.debounceDelay=500] - Задержка debounce в мс.
         */
        constructor(options) {
            this.searchInput = options.searchInput;
            this.searchResultsContainer = options.searchResultsContainer;
            this.selectedClientIdInput = options.selectedClientIdInput;
            this.pageInfoSpan = options.pageInfoSpan;
            this.prevPageBtn = options.prevPageBtn;
            this.nextPageBtn = options.nextPageBtn;
            this.itemsPerPage = options.itemsPerPage || 10;
            this.debounceDelay = options.debounceDelay || 700; // Увеличено для последовательных запросов

            this.currentPage = 1;
            this.currentSearchQuery = '';
            this.totalItems = 0;
            this.allFoundContacts = []; // Храним все найденные и дедуплицированные контакты для клиентской пагинации

            // Проверка наличия всех необходимых элементов
            if (!this.searchInput || !this.searchResultsContainer || !this.selectedClientIdInput ||
                !this.pageInfoSpan || !this.prevPageBtn || !this.nextPageBtn) {
                console.warn("ClientSearchHandler: Один или несколько необходимых элементов UI не найдены. Инициализация пропущена.", options);
                return;
            }

            this.debouncedSearch = this.debounce(this.handleSearchInput.bind(this), this.debounceDelay);

            this.init();
        }

        /**
         * Утилита debounce для предотвращения слишком частых вызовов функции.
         * @param {function} func - Функция, которую нужно отложить.
         * @param {number} delay - Задержка в миллисесекундах.
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
         * @param {number} page - Номер страницы результатов (для клиентской пагинации).
         */
        async performClientSearch(query, page = 1) {
            // Если запрос пуст, очищаем результаты и скрываем контейнер
            if (!query.trim()) {
                this.searchResultsContainer.innerHTML = '';
                this.searchResultsContainer.style.display = 'none';
                this.updatePaginationUI(0, 1);
                this.allFoundContacts = [];
                return;
            }

            this.currentSearchQuery = query;
            this.currentPage = page;
            App.showLoader(); // Показываем глобальный лоадер

            // Поля, по которым будем искать
            const searchFields = ['NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE', 'EMAIL'];
            const uniqueContactsMap = new Map(); // Для дедупликации контактов

            console.log(`[ClientSearchHandler] Performing sequential search for query: "${query}", page: ${page}`);

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

                this.totalItems = this.allFoundContacts.length;
                console.log('[ClientSearchHandler] Combined unique contacts found:', this.totalItems, this.allFoundContacts);

                // Применяем клиентскую пагинацию к объединенным результатам
                const startIndex = (this.currentPage - 1) * this.itemsPerPage;
                const endIndex = startIndex + this.itemsPerPage;
                const contactsToRender = this.allFoundContacts.slice(startIndex, endIndex);

                this.renderSearchResults(contactsToRender);
                this.updatePaginationUI(this.totalItems, this.currentPage);

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


                this.searchResultsContainer.innerHTML = `<div class="client-search-results-item">${errorMessage}</div>`;
                this.searchResultsContainer.style.display = 'block';
                this.updatePaginationUI(0, 1);
            } finally {
                App.hideLoader(); // Скрываем глобальный лоадер
            }
        }

        /**
         * Отображает результаты поиска в контейнере.
         * @param {Array<object>} contacts - Массив найденных контактов.
         */
        renderSearchResults(contacts) {
            this.searchResultsContainer.innerHTML = '';
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
         * Обновляет UI пагинации (информацию о странице и состояние кнопок).
         * @param {number} total - Общее количество элементов.
         * @param {number} current - Текущая страница.
         */
        updatePaginationUI(total, current) {
            const totalPages = Math.ceil(total / this.itemsPerPage);
            this.pageInfoSpan.textContent = `Страница ${current} из ${totalPages === 0 ? 1 : totalPages}`;
            this.prevPageBtn.disabled = current === 1;
            this.nextPageBtn.disabled = current >= totalPages;

            const paginationContainer = this.pageInfoSpan.closest('.pagination-controls');
            if (total <= this.itemsPerPage && total <= this.allFoundContacts.length) { // Учитываем, что allFoundContacts может быть больше, чем itemsPerPage
                if (paginationContainer) paginationContainer.style.display = 'none'; // Скрываем пагинацию, если нет или мало результатов
            } else {
                if (paginationContainer) paginationContainer.style.display = 'flex'; // Показываем пагинацию
            }
        }

        /**
         * Обработчик события ввода в поисковом поле.
         * @param {Event} event - Событие ввода.
         */
        handleSearchInput(event) {
            this.performClientSearch(event.target.value, 1); // Сбрасываем на первую страницу при новом поиске
        }

        /**
         * Инициализирует обработчики событий.
         */
        init() {
            this.searchInput.addEventListener('input', this.debouncedSearch);

            this.prevPageBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.performClientSearch(this.currentSearchQuery, this.currentPage - 1);
                }
            });

            this.nextPageBtn.addEventListener('click', () => {
                const totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
                if (this.currentPage < totalPages) {
                    this.performClientSearch(this.currentSearchQuery, this.currentPage + 1);
                }
            });

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
        selectedClientIdInput: document.getElementById('selected-client-id'),
        pageInfoSpan: document.getElementById('client-page-info'),
        prevPageBtn: document.getElementById('prev-client-page-btn'),
        nextPageBtn: document.getElementById('next-client-page-btn')
    });

    // Для формы редактирования расхода
    new App.ClientSearchHandler({
        searchInput: document.getElementById('edit-expense-client-search'),
        searchResultsContainer: document.getElementById('edit-client-search-results'),
        selectedClientIdInput: document.getElementById('edit-selected-client-id'),
        pageInfoSpan: document.getElementById('edit-client-page-info'),
        prevPageBtn: document.getElementById('edit-prev-client-page-btn'),
        nextPageBtn: document.getElementById('edit-next-client-page-btn')
    });
});