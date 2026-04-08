BX24.ready(() => {
    // Находим главный контейнер для вывода данных.
    const dashboardContainer = document.getElementById('dashboard-container');

    // Проверяем, найден ли контейнер.
    if (dashboardContainer) {
        // Если найден, просто вставляем в него приветственный текст.
        dashboardContainer.innerHTML = '<h1 style="text-align: center; margin-top: 50px;">Привет</h1>';
        console.log("Простой скрипт v1.4 успешно выполнен. Элемент 'dashboard-container' найден и изменен.");
    } else {
        // Если контейнер не найден, выводим критическую ошибку в консоль.
        console.error("Критическая ошибка v1.4: Элемент #dashboard-container не найден.");
    }
});
