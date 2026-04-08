from flask import Flask, request, jsonify, render_template
import requests
import logging
import json

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/" # <--- ВАШ ВЕБХУК ЗДЕСЬ

# Настройка логирования
logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

if "your-portal.bitrix24.ru" in B24_WEBHOOK_URL:
    app.logger.critical("Критическая ошибка: URL вебхука не был заменен! Пожалуйста, укажите ваш реальный вебхук в файле app.py.")

# --- Вспомогательные функции ---
def b24_call_method(method, params={}):
    """Универсальная функция для вызова методов REST API."""
    try:
        url = B24_WEBHOOK_URL + method
        app.logger.info(f"Вызов метода: {method}")
        response = requests.post(url, json=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Сетевая ошибка при вызове {method}: {e}")
        return None
    except json.JSONDecodeError as e:
        app.logger.error(f"Ошибка декодирования JSON от {method}: {e}. Ответ: {response.text}")
        return None

# --- Маршруты API ---
@app.route('/api/initial_data', methods=['GET'])
def get_initial_data():
    """Загружает источники и статусы лидов для фильтров и дашборда."""
    batch_payload = {
        'halt': 0,
        'cmd': {
            'sources': 'crm.status.list?filter[ENTITY_ID]=SOURCE',
            'statuses': 'crm.status.list?filter[ENTITY_ID]=STATUS'
        }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        sources = response['result']['result']['sources']
        statuses = response['result']['result']['statuses']
        return jsonify({'sources': sources, 'statuses': statuses})
    return jsonify({'error': 'Не удалось загрузить начальные данные'}), 500

@app.route('/api/leads', methods=['GET'])
def get_leads():
    """Получает список лидов на основе фильтров."""
    filter_params = {}
    if request.args.get('startDate'):
        filter_params['>=DATE_CREATE'] = request.args.get('startDate')
    if request.args.get('endDate'):
        filter_params['<=DATE_CREATE'] = request.args.get('endDate')
    if request.args.get('source'):
        filter_params['SOURCE_ID'] = request.args.get('source')
    
    params = {'filter': filter_params, 'select': ['ID', 'STATUS_ID', 'SOURCE_ID']}
    leads_response = b24_call_method('crm.lead.list', params)
    
    if leads_response and 'result' in leads_response:
        return jsonify(leads_response['result'])
    return jsonify([]), 500

# --- Главный маршрут ---
@app.route('/', methods=['GET', 'POST'])
def index():
    """Отображает главную страницу приложения."""
    # Логируем данные, которые приходят от Битрикс24 при открытии
    if request.method == 'POST':
        app.logger.info(f"Приложение открыто из Битрикс24 с данными: {request.form.to_dict()}")
    return render_template('index.html')

if __name__ == '__main__':
    # Для локального тестирования. На сервере используйте Gunicorn или аналоги.
    app.run(debug=True, port=5002)
