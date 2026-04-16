// Создаем глобальное пространство имен для всего приложения
window.App = {
    // Флаги, чтобы избежать повторной инициализации модулей
    cashboxInitialized: false,
    statisticsInitialized: false,
    accessInitialized: false,
    
    // Общие данные, доступные всем модулям
    currentUser: null,
    userPermissions: null,
    
    // Объект для управления уведомлениями
    Notify: {},

    // Общие функции и UI элементы будут добавлены сюда
};

BX24.ready(() => {
    console.log("BX24 is ready. Main application logic starts.");

    // --- ГЛОБАЛЬНЫЕ ЭЛЕМЕНТЫ UI ---
    const loaderOverlay = document.getElementById('loader-overlay');
    const appContainer = document.getElementById('app-container');
    const screens = document.querySelectorAll('.app-screen');
    const mainMenu = document.getElementById('main-menu');
    const menuCards = document.querySelectorAll('#main-menu .menu-card');
    const backButtons = document.querySelectorAll('.back-button');
    
    // --- Элементы системы уведомлений ---
    const notificationOverlay = document.getElementById('notification-overlay');
    const notificationIcon = document.getElementById('notification-icon');
    const notificationTitle = document.getElementById('notification-title');
    const notificationText = document.getElementById('notification-text');
    const notificationButtons = document.getElementById('notification-buttons');
    
    // Элементы для кастомного подтверждения
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationModalTitle = document.getElementById('confirmation-modal-title');
    const confirmationModalText = document.getElementById('confirmation-modal-text');

    // --- СИСТЕМА УВЕДОМЛЕНИЙ ---
    App.Notify.success = (message) => {
        notificationIcon.className = 'notification-popup-icon success-icon';
        notificationTitle.style.display = 'none';
        notificationText.innerHTML = message;
        notificationButtons.style.display = 'none';
        notificationOverlay.classList.add('show');
        setTimeout(() => {
            notificationOverlay.classList.remove('show');
        }, 1000);
    };

    App.Notify.error = (title, message) => {
        return new Promise(resolve => {
            notificationIcon.className = 'notification-popup-icon error-icon';
            notificationTitle.style.display = 'block';
            notificationTitle.textContent = title;
            notificationText.innerHTML = message;
            notificationButtons.style.display = 'flex';
            notificationOverlay.classList.add('show');
            let notificationOkBtn = document.getElementById('notification-ok-btn');
            const newOkBtn = notificationOkBtn.cloneNode(true);
            notificationOkBtn.parentNode.replaceChild(newOkBtn, notificationOkBtn);
            newOkBtn.onclick = () => {
                notificationOverlay.classList.remove('show');
                resolve();
            };
        });
    };

    // --- ГЛОБАЛЬНЫЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    App.showLoader = () => loaderOverlay.style.display = 'flex';
    App.hideLoader = () => loaderOverlay.style.display = 'none';

    App.showScreen = (screenToShow) => {
        screens.forEach(screen => screen.classList.remove('active'));
        if (screenToShow) screenToShow.classList.add('active');
    };
    
    App.populateSelect = (selectElement, data, placeholder, selectedValue = '') => {
        selectElement.innerHTML = `<option value="">${placeholder}</option>`;
        data.forEach(item => {
            const option = new Option(item.name, item.id);
            if (item.id == selectedValue) {
                option.selected = true;
            }
            selectElement.add(option);
        });
    };

    App.showCustomConfirm = ({ title = 'Подтвердите действие', text = 'Вы уверены?', data = null, confirmButtonText = 'Подтвердить', confirmButtonClass = 'ui-btn-primary' }) => {
        return new Promise(resolve => {
            confirmationModalTitle.textContent = title;
            let contentHtml = `<p>${text}</p>`;
            if (data) {
                contentHtml += '<ul style="list-style: none; padding: 0; text-align: left;">';
                for (const key in data) {
                    if (data.hasOwnProperty(key)) {
                        contentHtml += `<li><strong>${key}:</strong> ${data[key]}</li>`;
                    }
                }
                contentHtml += '</ul>';
            }
            confirmationModalText.innerHTML = contentHtml;
            let confirmActionBtn = document.getElementById('confirm-action-btn');
            let cancelActionBtn = document.getElementById('cancel-action-btn');
            confirmActionBtn.textContent = confirmButtonText;
            confirmActionBtn.className = `ui-btn btn-fixed-width ${confirmButtonClass}`;
            confirmationModal.style.display = 'flex';
            const newConfirmBtn = confirmActionBtn.cloneNode(true);
            confirmActionBtn.parentNode.replaceChild(newConfirmBtn, confirmActionBtn);
            const newCancelBtn = cancelActionBtn.cloneNode(true);
            cancelActionBtn.parentNode.replaceChild(newCancelBtn, cancelActionBtn);
            newConfirmBtn.onclick = () => {
                confirmationModal.style.display = 'none';
                resolve(true);
            };
            newCancelBtn.onclick = () => {
                confirmationModal.style.display = 'none';
                resolve(false);
            };
        });
    };

    // --- ЛОГИКА ДОСТУПОВ И АВТОРИЗАЦИИ ---
    function applyPermissions(permissions) {
        const hasAnyAccess = Object.values(permissions.tabs).some(tab => tab.view);
        if (!hasAnyAccess) {
            App.showScreen(document.getElementById('no-access-screen'));
            appContainer.style.display = 'block';
            return false;
        }
        menuCards.forEach(card => {
            const tabName = card.dataset.tab;
            if (permissions.tabs[tabName]) {
                if (permissions.tabs[tabName].view) {
                    card.classList.remove('ui-disabled-card');
                } else {
                    card.classList.add('ui-disabled-card');
                }
            } else {
                card.classList.add('ui-disabled-card');
            }
        });
        return true;
    }

    // --- ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ---
    function initializeApp() {
        App.showLoader();
        BX24.callMethod('user.current', {}, async (res) => {
            if (res.error()) {
                console.error("Failed to get current user:", res.error());
                await App.Notify.error('Ошибка авторизации', 'Не удалось получить данные текущего пользователя. Попробуйте перезагрузить страницу.');
                return;
            }
            App.currentUser = res.data();
            console.log("Current user data received:", App.currentUser);
            // Определяем домен Б24 для построения ссылок
            // BX24.getDomain() возвращает домен без протокола
            App.b24Domain = 'https://' + BX24.getDomain();
            console.log("B24 domain:", App.b24Domain);
            try {
                const departmentId = (App.currentUser.UF_DEPARTMENT && App.currentUser.UF_DEPARTMENT.length > 0) ? App.currentUser.UF_DEPARTMENT[0] : '';
                
                // --- ИСПРАВЛЕНИЕ: Формируем полный URL ---
                const url = new URL(window.location.href);
                url.searchParams.set('action', 'my_permissions');
                url.searchParams.set('user_id', App.currentUser.ID);
                url.searchParams.set('department_id', departmentId);

                const permRes = await fetch(url);
                
                if (!permRes.ok) {
                    const errorText = await permRes.text();
                    throw new Error(`Failed to fetch permissions: ${permRes.status} ${permRes.statusText} - ${errorText}`);
                }
                App.userPermissions = await permRes.json();
                console.log("User permissions received:", App.userPermissions);
                if (applyPermissions(App.userPermissions)) {
                    appContainer.style.display = 'block';
                    App.showScreen(mainMenu);
                }
            } catch (e) {
                console.error("Error during permission check:", e);
                await App.Notify.error('Ошибка получения доступов', `Произошла критическая ошибка при проверке прав доступа. ${e.message}`);
            } finally {
                App.hideLoader();
            }
        });
    }

    // --- НАВИГАЦИЯ ---
    document.addEventListener('click', (event) => {
        const card = event.target.closest('.menu-card');
        if (!card) return;

        const tab = card.dataset.tab;
        if (tab) {
            const screen = document.getElementById(`${tab}-screen`);
            if (screen) {
                if (tab === 'cashbox' && !App.cashboxInitialized) {
                    if (App.initializeCashbox) App.initializeCashbox();
                    App.cashboxInitialized = true;
                }
                if (tab === 'statistics' && !App.statisticsInitialized) {
                    if (App.initializeStatistics) App.initializeStatistics();
                    App.statisticsInitialized = true;
                }
                if (tab === 'access' && !App.accessInitialized) {
                    if (App.initializeAccessTab) App.initializeAccessTab();
                    App.accessInitialized = true;
                }
                App.showScreen(screen);
            }
        }
    });

    backButtons.forEach(button => button.addEventListener('click', () => App.showScreen(mainMenu)));

    // --- ЗАПУСК ПРИЛОЖЕНИЯ ---
    initializeApp();
});
