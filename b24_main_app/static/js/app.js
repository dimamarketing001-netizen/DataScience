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
    const menuCards = document.querySelectorAll('.menu-card');
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
        notificationTitle.style.display = 'none'; // No title for success
        notificationText.innerHTML = message;
        notificationButtons.style.display = 'none'; // No buttons for success

        notificationOverlay.classList.add('show');

        setTimeout(() => {
            notificationOverlay.classList.remove('show');
        }, 1000); // Исчезает через 1 секунду
    };

    App.Notify.error = (title, message) => {
        return new Promise(resolve => {
            notificationIcon.className = 'notification-popup-icon error-icon';
            notificationTitle.style.display = 'block';
            notificationTitle.textContent = title;
            notificationText.innerHTML = message;
            notificationButtons.style.display = 'flex';

            notificationOverlay.classList.add('show');

            // Получаем свежую ссылку на кнопку и пересоздаем ее
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

            // Получаем свежие ссылки на кнопки каждый раз при вызове функции
            let confirmActionBtn = document.getElementById('confirm-action-btn');
            let cancelActionBtn = document.getElementById('cancel-action-btn');

            confirmActionBtn.textContent = confirmButtonText;
            confirmActionBtn.className = `ui-btn btn-fixed-width ${confirmButtonClass}`;

            confirmationModal.style.display = 'flex';
            
            // Важно клонировать кнопки, чтобы избежать накопления обработчиков
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
        if (!permissions || !permissions.can_access_app) {
            App.showScreen(document.getElementById('no-access-screen'));
            appContainer.style.display = 'block';
            App.hideLoader();
            return false;
        }

        menuCards.forEach(card => {
            const tabName = card.dataset.tab;
            card.style.display = permissions.tabs[tabName] ? 'block' : 'none';
        });

        // Эта общая настройка применяется ко всем кнопкам "Сохранить" в приложении
        document.querySelectorAll('[data-action="save"]').forEach(btn => {
            btn.disabled = !permissions.actions.can_save;
            btn.style.cursor = permissions.actions.can_save ? 'pointer' : 'not-allowed';
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
                applyPermissions(null);
                return;
            }
            App.currentUser = res.data();
            console.log("Current user data received:", App.currentUser);

            try {
                const departmentId = (App.currentUser.UF_DEPARTMENT && App.currentUser.UF_DEPARTMENT.length > 0) ? App.currentUser.UF_DEPARTMENT[0] : '';
                const permRes = await fetch(`?action=my_permissions&user_id=${App.currentUser.ID}&department_id=${departmentId}`);
                
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
                applyPermissions(null);
            } finally {
                App.hideLoader();
            }
        });
    }

    // --- НАВИГАЦИЯ ---
    menuCards.forEach(card => {
        card.addEventListener('click', () => {
            const tab = card.dataset.tab;
            const screen = document.getElementById(`${tab}-screen`);
            if (screen) {
                // Вызываем инициализаторы модулей, если они еще не были вызваны
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
        });
    });
    backButtons.forEach(button => button.addEventListener('click', () => App.showScreen(mainMenu)));

    // --- ЗАПУСК ПРИЛОЖЕНИЯ ---
    initializeApp();
});
