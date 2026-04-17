import logging
from flask import Flask, request, jsonify, render_template

# Импорт функций из модулей
from core.db import init_db
from routes.api_access import get_my_permissions, handle_access_rights
from routes.api_common import search_contacts, get_initial_data_for_access
from routes.api_statistics import get_statistics
from routes.api_cashbox import get_cashbox_initial_data, add_expense, get_expenses, get_single_expense, update_expense, delete_expense, add_income, get_incomes, get_single_income, update_income, delete_income, get_client_deals, toggle_income_confirmation

# --- Инициализация приложения ---
logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

# --- Словарь API-действий ---
# Ключ - это 'action' из URL, значение - функция-обработчикa
api_actions = {
    # Cashbox actions
    'cashbox_initial_data': get_cashbox_initial_data,
    'add_expense': add_expense,
    'expenses': get_expenses,
    'get_single_expense': get_single_expense,
    'update_expense': update_expense,
    'delete_expense': delete_expense,
    'add_income': add_income,
    'get_incomes': get_incomes,
    'get_single_income': get_single_income,
    'update_income': update_income,
    'delete_income': delete_income,
    'get_client_deals': get_client_deals,
    'toggle_income_confirmation': toggle_income_confirmation,
    
    # Access actions
    'my_permissions': get_my_permissions,
    'access_rights': handle_access_rights,
    
    # Common actions
    'search_contacts': search_contacts,
    'initial_data_for_access': get_initial_data_for_access,
    
    # Statistics actions
    'get_statistics': get_statistics,
}

# --- Главный маршрутизатор ---
@app.route('/', methods=['GET', 'POST', 'PUT', 'DELETE'])
def router():
    app.logger.info(f"ROUTER: method={request.method}, action={request.args.get('action')}, content_type={request.content_type}, is_json={request.is_json}, has_action_in_args={'action' in request.args}")

    # POST без action - это стандартный вход из Битрикс24
    if request.method == 'POST' and 'action' not in request.args and not request.is_json:
        app.logger.info("ROUTER: rendering finance_index.html (B24 entry)")
        return render_template('finance_index.html')

    action = request.args.get('action')

    app.logger.info(f"ROUTER: dispatching action='{action}'")

    if action in api_actions:
        handler = api_actions[action]
        app.logger.info(f"ROUTER: calling handler={handler.__name__}")
        return handler()

    if action:
        app.logger.warning(f"ROUTER: action '{action}' not found in api_actions")
        app.logger.warning(f"ROUTER: available actions={list(api_actions.keys())}")
        return jsonify({'error': f'Action "{action}" not found'}), 404

    return "<h1>Access Denied</h1><p>This application can only be accessed from within Bitrix24.</p>", 403

# --- Запуск приложения ---
if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(debug=True, port=5002)
