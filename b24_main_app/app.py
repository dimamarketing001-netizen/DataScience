from flask import Flask, request, jsonify, render_template
import requests
import logging
import json

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/"  # <--- ВАШ ВЕБХУК ЗДЕСЬ
RPA_LIST_ID = 2 # ID вашего универсального списка (смарт-процесса)

# Настройка логирования
logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

if "your-portal.bitrix24.ru" in B24_WEBHOOK_URL:
    app.logger.critical(
        "Критическая ошибка: URL вебхука не был заменен! Пожалуйста, укажите ваш реальный вебхук в файле app.py.")


# --- Вспомогательные функции ---
def b24_call_method(method, params={}):
    """Универсальная функция для вызова методов REST API."""
    try:
        url = B24_WEBHOOK_URL + method
        app.logger.info(
            f"Вызов метода: {method} с параметрами: {json.dumps(params, ensure_ascii=False)}")
        response = requests.post(url, json=params)
        app.logger.info(f"Ответ от Битрикс24 (статус {response.status_code}): {response.text}")
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Сетевая ошибка при вызове {method}: {e}", exc_info=True)
        return None
    except json.JSONDecodeError as e:
        app.logger.error(f"Ошибка декодирования JSON от {method}: {e}. Ответ: {response.text}",
                         exc_info=True)
        return None
    except Exception as e:
        app.logger.error(f"Неожиданная ошибка в b24_call_method для {method}: {e}", exc_info=True)
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


# --- НОВЫЕ МАРШРУТЫ ДЛЯ КАССЫ ---
@app.route('/api/cashbox_initial_data', methods=['GET'])
def get_cashbox_initial_data():
    """Загружает списки сотрудников, подрядчиков и поля RPA для формы Кассы."""
    batch_payload = {
        'halt': 0,
        'cmd': {
            'users': 'user.get?filter[ACTIVE]=Y&admin=false',
            'sources': 'crm.status.list?filter[ENTITY_ID]=SOURCE',
            'rpa_type': f'rpa.type.get?entityTypeId={RPA_LIST_ID}'
        }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        result = response['result']['result']
        users = [{'ID': user['ID'], 'NAME': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in result.get('users', [])]
        sources = [{'ID': source['STATUS_ID'], 'NAME': source['NAME']} for source in result.get('sources', [])]

        # Извлекаем варианты для поля "Категория"
        categories = []
        rpa_type_data = result.get('rpa_type', {})
        if rpa_type_data and 'fields' in rpa_type_data:
            for field_name, field_info in rpa_type_data['fields'].items():
                # Ищем наше поле по названию. Это не очень надежно, лучше по ID, если он известен.
                # UF_RPA_2_1775649039905 - ID поля "Категория"
                if field_name == 'UF_RPA_2_1775649039905' and field_info.get('type') == 'list' and 'items' in field_info:
                    categories = field_info['items'] # items уже содержит {'id': ..., 'value': ...}

        return jsonify({'users': users, 'sources': sources, 'categories': categories})

    return jsonify({'error': 'Не удалось загрузить начальные данные для кассы'}), 500


@app.route('/api/search_contacts', methods=['GET'])
def search_contacts():
    """Ищет контакты по имени или фамилии."""
    query = request.args.get('query', '')
    if not query:
        return jsonify([])

    filter_params = {'LOGIC': 'OR', '%NAME': query, '%LAST_NAME': query}
    response = b24_call_method('crm.contact.list', {
        'filter': filter_params,
        'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME'],
        'start': 0,
        'limit': 10
    })

    if response and response.get('result'):
        contacts = [{'ID': contact['ID'],
                     'NAME': f"{contact.get('LAST_NAME', '')} {contact.get('NAME', '')} {contact.get('SECOND_NAME', '')}".strip()}
                    for contact in response['result']]
        return jsonify(contacts)
    return jsonify([])


@app.route('/api/add_expense', methods=['POST'])
def add_expense():
    """Добавляет расход в Универсальный список Битрикс24."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных для сохранения'}), 400

    # Маппинг полей из документации
    fields = {
        'UF_RPA_2_NAME': data.get('name'),
        'UF_RPA_2_1775648993353': data.get('date'),
        'UF_RPA_2_1775649025545': data.get('amount'),
        'UF_RPA_2_1775649163870': data.get('comment')
    }

    # Используем ID категории, а не текст
    if data.get('category_id'):
        fields['UF_RPA_2_1775649039905'] = data['category_id']

    if data.get('employee_id'):
        fields['UF_RPA_2_1775649074479'] = int(data['employee_id'])
    if data.get('contractor_id'):
        fields['UF_RPA_2_1775649104323'] = data['contractor_id']
    if data.get('client_id'):
        fields['UF_RPA_2_1775649130020'] = int(data['client_id'])

    try:
        response = b24_call_method('rpa.item.add', {
            'entityTypeId': RPA_LIST_ID,
            'fields': fields
        })

        if response and response.get('item'): # Метод rpa.item.add возвращает {item: {...}}
            item_id = response['item']['id']
            app.logger.info(f"RPA элемент успешно добавлен, ID: {item_id}")
            return jsonify({'success': True, 'id': item_id})
        else:
            error_from_b24 = response.get('error_description', response.get('error', 'Неизвестная ошибка Битрикс24 API'))
            app.logger.error(f"Битрикс24 API вернул ошибку при добавлении расхода: {error_from_b24}")
            return jsonify({'success': False, 'error': error_from_b24}), 500
    except Exception as e:
        app.logger.error(f"Исключение при добавлении расхода в Битрикс24: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Главный маршрут ---
@app.route('/', methods=['GET', 'POST'])
def index():
    """Отображает главную страницу приложения."""
    if request.method == 'POST':
        app.logger.info(f"Приложение открыто из Битрикс24 с данными: {request.form.to_dict()}")
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True, port=5002)