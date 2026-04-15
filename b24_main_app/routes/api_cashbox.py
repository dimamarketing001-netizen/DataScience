from flask import Blueprint, request, jsonify

# Импортируем функции из нового сервисного слоя
from services.cashbox_service import (
    get_cashbox_initial_data_service,
    add_expense_service,
    get_expenses_service,
    get_single_expense_service,
    update_expense_service,
    delete_expense_service,
    # Новые сервисы для приходов
    add_income_service,
    get_incomes_service,
    update_income_service,
    delete_income_service,
    get_client_deals_service
)

# Blueprint остается, но теперь он вызывает сервисные функции
cashbox_api = Blueprint('cashbox_api_v2', __name__)

# --- Контроллеры для РАСХОДОВ ---

def get_cashbox_initial_data():
    """Контроллер для получения начальных данных кассы."""
    try:
        data = get_cashbox_initial_data_service()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def add_expense():
    """Контроллер для добавления нового расхода."""
    try:
        data = request.get_json()
        result = add_expense_service(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def get_expenses():
    """Контроллер для получения списка расходов."""
    try:
        data = get_expenses_service(request.args)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_single_expense():
    """Контроллер для получения одного расхода по ID."""
    try:
        expense_id = request.args.get('id')
        expense = get_single_expense_service(expense_id)
        if expense:
            return jsonify(expense)
        return jsonify({'error': 'Expense not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def update_expense():
    """Контроллер для обновления расхода."""
    try:
        data = request.get_json()
        result = update_expense_service(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def delete_expense():
    """Контроллер для удаления расхода."""
    try:
        expense_id = request.args.get('id')
        result = delete_expense_service(expense_id)
        if result:
            return jsonify(result)
        return jsonify({'error': 'Expense not found or already deleted'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# --- Новые контроллеры для ПРИХОДОВ ---

def add_income():
    """Контроллер для добавления нового прихода."""
    try:
        data = request.get_json()
        result = add_income_service(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def get_incomes():
    """Контроллер для получения списка приходов."""
    try:
        data = get_incomes_service(request.args)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def update_income():
    """Контроллер для обновления прихода."""
    try:
        data = request.get_json()
        result = update_income_service(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def delete_income():
    """Контроллер для удаления прихода."""
    try:
        income_id = request.args.get('id')
        result = delete_income_service(income_id)
        if result:
            return jsonify(result)
        return jsonify({'error': 'Income not found or already deleted'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_client_deals():
    """Контроллер для получения сделок клиента."""
    try:
        contact_id = request.args.get('contact_id')
        deals = get_client_deals_service(contact_id)
        return jsonify(deals)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
