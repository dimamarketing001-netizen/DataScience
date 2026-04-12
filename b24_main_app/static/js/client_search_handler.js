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
            this.debounceDelay = options.debounceDelay || 500;

            this.currentPage = 1;
            this.currentSearchQuery = '';
            this.totalItems = 0;

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
         * @param {number} page - Номер страницы результатов.
         */
        async performClientSearch(query, page = 1) {
            // Если запрос пуст, очищаем результаты и скрываем контейнер
            if (!query.trim()) {
                this.searchResultsContainer.innerHTML = '';
                this.searchResultsContainer.style.display = 'none';
                this.updatePaginationUI(0, 1);
                return;
            }

            this.currentSearchQuery = query;
            this.currentPage = page;
            App.showLoader(); // Показываем глобальный лоадер

            const start = (this.currentPage - 1) * this.itemsPerPage;

            // Формируем фильтр для поиска по имени, фамилии, телефону и email
            const filter = {
                "LOGIC": "OR", // Ищем по любому из полей
                "NAME": `%${query}%`,
                "LAST_NAME": `%${query}%`,
                "PHONE": `%${query}%`, // Bitrix24 API позволяет искать по значениям PHONE/EMAIL напрямую
                "EMAIL": `%${query}%`
            };

            try {
                const response = await BX24.callMethod('crm.contact.list', {
                    filter: filter,
                    select: ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE', 'EMAIL'],
                    start: start,
                    order: { "LAST_NAME": "ASC", "NAME": "ASC" } // Сортировка для предсказуемого порядка
                });

                // ДОБАВЛЕНА ПРОВЕРКА: Если response не существует, обрабатываем это как ошибку
                if (!response) {
                    console.error('Bitrix24 API Error: BX24.callMethod вернул пустой ответ.');
                    this.searchResultsContainer.innerHTML = `<div class="client-search-results-item">Ошибка поиска: Не удалось получить ответ от Bitrix24 API.</div>`;
                    this.searchResultsContainer.style.display = 'block';
                    this.updatePaginationUI(0, 1);
                    return;
                }

                if (response.error()) {
                    console.error('Bitrix24 API Error:', response.error());
                    this.searchResultsContainer.innerHTML = `<div class="client-search-results-item">Ошибка поиска: ${response.error().error_description || 'Неизвестная ошибка API'}</div>`;
                    this.searchResultsContainer.style.display = 'block';
                    this.updatePaginationUI(0, 1);
                    return;
                }

                const contacts = response.data();
                this.totalItems = response.total(); // Общее количество найденных элементов для пагинации

                this.renderSearchResults(contacts);
                this.updatePaginationUI(this.totalItems, this.currentPage);

            } catch (error) {
                console.error('Network or unexpected error:', error);
                this.searchResultsContainer.innerHTML = `<div class="client-search-results-item">Произошла ошибка при выполнении запроса: ${error.message || error}.</div>`;
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
            if (total <= this.itemsPerPage) {
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