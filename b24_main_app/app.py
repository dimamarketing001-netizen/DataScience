from flask import Flask, request, jsonify, render_template
import requests
import logging
import json

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/"  # <--- ВАШ ВЕБХУК ЗДЕСЬ

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
            f"Вызов метода: {method} с параметрами: {json.dumps(params, ensure_ascii=False)}")  # Добавлено логирование параметров
        response = requests.post(url, json=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Сетевая ошибка при вызове {method}: {e}", exc_info=True)  # Добавлено exc_info
        return None
    except json.JSONDecodeError as e:
        app.logger.error(f"Ошибка декодирования JSON от {method}: {e}. Ответ: {response.text}",
                         exc_info=True)  # Добавлено exc_info и response.text
        return None
    except Exception as e:  # Общий перехват для любых других неожиданных ошибок
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
    """Загружает списки сотрудников и подрядчиков для формы Кассы."""
    batch_payload = {
        'halt': 0,
        'cmd': {
            'users': 'user.get?filter[ACTIVE]=Y&admin=false',  # Только активные пользователи, не админы
            'sources': 'crm.status.list?filter[ENTITY_ID]=SOURCE'  # CRM Источники
        }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        users = [{'ID': user['ID'], 'NAME': f"{user['LAST_NAME']} {user['NAME']}"} for user in
                 response['result']['result']['users']]
        sources = [{'ID': source['STATUS_ID'], 'NAME': source['NAME']} for source in
                   response['result']['result']['sources']]
        return jsonify({'users': users, 'sources': sources})
    return jsonify({'error': 'Не удалось загрузить начальные данные для кассы'}), 500


@app.route('/api/search_contacts', methods=['GET'])
def search_contacts():
    """Ищет контакты по имени или фамилии."""
    query = request.args.get('query', '')
    if not query:
        return jsonify([])

    # Поиск по имени и фамилии
    filter_params = {
        'LOGIC': 'OR',
        '%NAME': query,
        '%LAST_NAME': query
    }

    response = b24_call_method('crm.contact.list', {
        'filter': filter_params,
        'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME'],
        'start': 0,
        'limit': 10  # Ограничиваем количество результатов
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

    # ID вашего Универсального списка
    RPA_LIST_ID = 2

    # Маппинг полей Универсального списка
    # UF_RPA_2_NAME - Название
    # UF_RPA_2_1775648993353 - Дата
    # UF_RPA_2_1775649025545 - Сумма
    # UF_RPA_2_1775649039905 - Категория
    # UF_RPA_2_1775649074479 - ID Сотрудника
    # UF_RPA_2_1775649104323 - ID Источника (Подрядчика)
    # UF_RPA_2_1775649130020 - ID Контакта (Клиента)
    # UF_RPA_2_1775649163870 - Комментарий

    fields = {
        'UF_RPA_2_NAME': data.get('name'),
        'UF_RPA_2_1775648993353': data.get('date'),
        'UF_RPA_2_1775649025545': data.get('amount'),
        'UF_RPA_2_1775649039905': data.get('category_text'),
        'UF_RPA_2_1775649163870': data.get('comment')
    }

    # Добавляем ID в зависимости от категории
    if data.get('employee_id'):
        # Преобразуем в int, так как ID пользователей обычно целые числа в Битрикс24
        fields['UF_RPA_2_1775649074479'] = int(data['employee_id'])
    if data.get('contractor_id'):
        # ID источников (CRM-статусов) часто являются строками (например, 'SOURCE_1')
        fields['UF_RPA_2_1775649104323'] = data['contractor_id']
    if data.get('client_id'):
        # Преобразуем в int, так как ID контактов обычно целые числа в Битрикс24
        fields['UF_RPA_2_1775649130020'] = int(data['client_id'])

    # Дополнительно можно добавить поле для типа выплаты сотруднику, если оно есть в списке
    # if data.get('payment_type'):
    #     fields['UF_RPA_2_ТИП_ВЫПЛАТЫ'] = data['payment_type']

    try:
        app.logger.info(
            f"Попытка добавить RPA элемент в список {RPA_LIST_ID} с полями: {json.dumps(fields, ensure_ascii=False)}")
        response = b24_call_method('rpa.item.add', {
            'entityTypeId': RPA_LIST_ID,
            'fields': fields
        })

        if response and response.get('result'):
            app.logger.info(f"RPA элемент успешно добавлен, ID: {response['result']['id']}")
            return jsonify({'success': True, 'id': response['result']['id']})
        else:
            # Если response == None, значит, b24_call_method не смог получить ответ
            if response is None:
                app.logger.error(
                    "b24_call_method вернул None при добавлении расхода. Проверьте URL вебхука и доступность Битрикс24.")
                return jsonify({'success': False, 'error': 'Ошибка связи с Битрикс24 или некорректный ответ.'}), 500
            else:
                # response не None, но нет ключа 'result' или он false
                error_from_b24 = response.get('error', 'Неизвестная ошибка Битрикс24 API')
                app.logger.error(f"Битрикс24 API вернул ошибку при добавлении расхода: {error_from_b24}")
                return jsonify({'success': False, 'error': error_from_b24}), 500
    except Exception as e:
        app.logger.error(f"Исключение при добавлении расхода в Битрикс24: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


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