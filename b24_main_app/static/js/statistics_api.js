// Создаем пространство имен для API статистики
if (typeof App.statistics === 'undefined') {
    App.statistics = {};
}

App.statistics.api = {
    /**
     * Запрашивает данные для статистики с бэкенда.
     * @param {object} params - Параметры фильтра (date_from, date_to, source_id).
     * @returns {Promise<object>} - Промис с данными статистики.
     */
    getStatistics: async function(params) {
        const url = new URL(window.location.href);
        url.searchParams.set('action', 'get_statistics');
        
        // Добавляем параметры фильтра в URL
        Object.entries(params).forEach(([key, value]) => {
            if (value) { // Добавляем только если значение не пустое
                url.searchParams.set(key, value);
            }
        });

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Ошибка сети: ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            console.error("Получен не-JSON ответ:", text);
            throw new TypeError("Ожидался JSON, но получен HTML или другой тип ответа. Проверьте маршрутизацию на бэкенде.");
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        
        return data;
    }
};
