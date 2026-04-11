// Создаем глобальное пространство имен для всего приложения
window.App = {
    // Флаги, чтобы избежать повторной инициализации модулей
    cashboxInitialized: false,
    statisticsInitialized: false,
    accessInitialized: false,
    
    // Общие данные, доступные всем модулям
    currentUser: null,
    userPermissions: null,
    
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
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationModalTitle = document.getElementById('confirmation-modal-title');
    const confirmationModalText = document.getElementById('confirmation-modal-text');
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    const cancelActionBtn = document.getElementById('cancel-action-btn');

    // --- ГЛОБАЛЬНЫЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    // Прикрепляем к App, чтобы сделать их доступными для других модулей
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

    App.showCustomConfirm = ({ title = 'Подтвердите действие', text = 'Вы уверены?', confirmButtonText = 'Подтвердить', confirmButtonClass = 'ui-btn-primary' }) => {
        return new Promise(resolve => {
            confirmationModalTitle.textContent = title;
            confirmationModalText.innerHTML = text;
            confirmActionBtn.textContent = confirmButtonText;
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
                applyPermissions(null);
                return;
            }
            App.currentUser = res.data();
            console.log("Current user data received:", App.currentUser);

            try {
                const departmentId = (App.currentUser.UF_DEPARTMENT && App.currentUser.UF_DEPARTMENT.length > 0) ? App.currentUser.UF_DEPARTMENT[0] : '';
                const permRes = await fetch(`?action=my_permissions&user_id=${App.currentUser.ID}&department_id=${departmentId}`);
                
                const rawText = await permRes.text();
                console.log("Raw response from server for permissions:", rawText);

                if (!permRes.ok) {
                    throw new Error(`Failed to fetch permissions: ${permRes.status} ${permRes.statusText} - ${rawText}`);
                }

                App.userPermissions = JSON.parse(rawText);
                console.log("User permissions received:", App.userPermissions);

                if (applyPermissions(App.userPermissions)) {
                    appContainer.style.display = 'block';
                    App.showScreen(mainMenu);
                }
            } catch (e) {
                console.error("Error during permission check:", e);
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
