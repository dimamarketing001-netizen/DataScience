// Модуль-обертка для всех API-запросов
App.api = {
    async request(action, params = {}, options = {}) {
        // Формируем URL с параметрами
        const queryParams = new URLSearchParams({ action, ...params });
        const url = `?${queryParams.toString()}`;

        // Настройки по умолчанию
        const config = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            ...options // Пользовательские настройки (method, body) могут переопределить дефолтные
        };

        try {
            const response = await fetch(url, config);

            // Если ответ не 'ok', пытаемся извлечь ошибку из тела
            if (!response.ok) {
                let errorText = `HTTP error! status: ${response.status}`;
                try {
                    const errorJson = await response.json();
                    errorText = errorJson.error || JSON.stringify(errorJson);
                } catch (e) {
                    // Тело ответа не JSON, используем текстовое представление
                    errorText = await response.text();
                }
                throw new Error(errorText);
            }

            // Если все 'ok', возвращаем JSON
            return await response.json();

        } catch (error) {
            console.error(`API request failed for action "${action}":`, error);
            // Перебрасываем ошибку дальше, чтобы ее можно было поймать в вызывающем коде
            throw error;
        }
    }
};
