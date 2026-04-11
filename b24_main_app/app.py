import logging
from flask import Flask, request, jsonify, render_template

# Импорт функций из модулей
from core.db import init_db
from routes.api_cashbox import get_cashbox_initial_data, add_expense, get_expenses, get_single_expense, update_expense, delete_expense
from routes.api_access import get_my_permissions, handle_access_rights
from routes.api_common import search_contacts, get_initial_data_for_access
# from routes.api_statistics import ... (когда появится логика)

# --- Инициализация приложения ---
logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

# --- Словарь API-действий ---
# Ключ - это 'action' из URL, значение - функция-обработчик
api_actions = {
    # Cashbox actions
    'cashbox_initial_data': get_cashbox_initial_data,
    'add_expense': add_expense,
    'expenses': get_expenses,
    'get_single_expense': get_single_expense,
    'update_expense': update_expense,
    'delete_expense': delete_expense,
    
    # Access actions
    'my_permissions': get_my_permissions,
    'access_rights': handle_access_rights,
    
    # Common actions
    'search_contacts': search_contacts,
    'initial_data_for_access': get_initial_data_for_access,
    
    # Statistics actions (пока нет)
}

# --- Главный маршрутизатор ---
@app.route('/', methods=['GET', 'POST', 'PUT', 'DELETE'])
def router():
    # POST без action - это стандартный вход из Битрикс24
    if request.method == 'POST' and 'action' not in request.args and not request.is_json:
        return render_template('finance_index.html')

    action = request.args.get('action')
    
    # Логирование входящего запроса
    app.logger.info(f"Incoming request: method={request.method}, action={action}, args={request.args}")
    
    # Вызов функции из словаря по 'action'
    if action in api_actions:
        handler = api_actions[action]
        # Для handle_access_rights, который обрабатывает и GET, и POST
        if action == 'access_rights':
            return handler()
        # Для остальных просто вызываем
        return handler()
    
    # Если action указан, но не найден в словаре
    if action:
        return jsonify({'error': f'Action "{action}" not found'}), 404
    
    # Если action не указан и это GET-запрос, отдаем главную страницу
    return render_template('finance_index.html')


# --- Запуск приложения ---
if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(debug=True, port=5002)
