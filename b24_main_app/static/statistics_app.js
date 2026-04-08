BX24.ready(() => {
    // Находим главный контейнер для вывода данных.
    const dashboardContainer = document.getElementById('dashboard-container');

    // Проверяем, найден ли контейнер.
    if (dashboardContainer) {
        // Если найден, просто вставляем в него приветственный текст.
        dashboardContainer.innerHTML = '<h1 style="text-align: center; margin-top: 50px;">Привет</h1>';
        console.log("Новый скрипт statistics_app.js успешно выполнен.");
    } else {
        // Если контейнер не найден, выводим критическую ошибку в консоль.
        console.error("Критическая ошибка из statistics_app.js: Элемент #dashboard-container не найден.");
    }
});
