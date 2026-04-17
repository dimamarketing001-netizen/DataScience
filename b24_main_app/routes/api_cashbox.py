from flask import Blueprint, request, jsonify

# Импортируем функции из нового сервисного слоя
from services.cashbox_service import (
    get_cashbox_initial_data_service,
    add_expense_service,
    get_expenses_service,
    get_single_expense_service,
    update_expense_service,
    delete_expense_service,
    add_income_service,
    get_incomes_service,
    get_single_income_service,
    update_income_service,
    delete_income_service,
    get_client_deals_service,
    create_b24_invoice_service,
    delete_b24_invoice_service,
    toggle_income_confirmation_service
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
    from flask import current_app
    try:
        current_app.logger.info(f"add_income: content_type={request.content_type}")

        data = request.get_json()
        if not data:
            current_app.logger.error("add_income: no JSON body received")
            return jsonify({'success': False, 'error': 'No JSON body'}), 400

        current_app.logger.info(f"add_income: received keys={list(data.keys())}")
        current_app.logger.info(f"add_income: date={data.get('date')}, amount={data.get('amount')}, contact_id={data.get('contact_id')}, deal_id={data.get('deal_id')}")

        # Обрабатываем файл из base64
        file_data_raw = data.get('file_data')
        if file_data_raw and file_data_raw.get('content_b64'):
            import base64
            try:
                file_bytes = base64.b64decode(file_data_raw['content_b64'])
                data['file_data'] = {
                    'filename': file_data_raw.get('filename', 'document.pdf'),
                    'content':  file_bytes,
                    'mimetype': file_data_raw.get('mimetype', 'application/octet-stream')
                }
                current_app.logger.info(f"add_income: file decoded OK, name={data['file_data']['filename']}, size={len(file_bytes)} bytes")
            except Exception as e:
                current_app.logger.warning(f"add_income: file base64 decode failed: {e}")
                data['file_data'] = None
        else:
            current_app.logger.info("add_income: no file in payload")
            data['file_data'] = None

        result = add_income_service(data)
        current_app.logger.info(f"add_income: success, result={result}")
        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"add_income EXCEPTION: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

def get_incomes():
    """Контроллер для получения списка приходов."""
    try:
        data = get_incomes_service(request.args)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_single_income():
    """Контроллер для получения одного прихода по ID."""
    try:
        income_id = request.args.get('id')
        income = get_single_income_service(income_id)
        if income:
            return jsonify(income)
        return jsonify({'error': 'Income not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def update_income():
    """Контроллер для обновления прихода."""
    from flask import current_app
    try:
        data = request.get_json()

        # Обрабатываем новый файл если передан
        file_data = None
        file_data_raw = data.get('file_data')
        if file_data_raw and file_data_raw.get('content_b64'):
            import base64
            try:
                file_bytes = base64.b64decode(file_data_raw['content_b64'])
                file_data = {
                    'filename': file_data_raw.get('filename', 'document.pdf'),
                    'content':  file_bytes,
                    'mimetype': file_data_raw.get('mimetype', 'application/octet-stream')
                }
                current_app.logger.info(
                    f"update_income: new file decoded: name={file_data['filename']}, size={len(file_bytes)} bytes"
                )
            except Exception as e:
                current_app.logger.warning(f"update_income: file decode failed: {e}")

        result = update_income_service(data, file_data=file_data)
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

def toggle_income_confirmation():
    """Контроллер для подтверждения/отмены подтверждения прихода."""
    from flask import current_app
    try:
        data = request.get_json()
        income_id           = data.get('id')
        confirm             = data.get('confirm')
        confirmed_by_user_id = data.get('confirmed_by_user_id')
        result = toggle_income_confirmation_service(income_id, confirm, confirmed_by_user_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500