from flask import Blueprint, request, jsonify, current_app
import json
import mysql.connector

from core.db import get_db_connection
from core.b24 import _get_b24_entity_name, b24_call_method

# Blueprint для всех API-методов, связанных с кассой
cashbox_api = Blueprint('api_cashbox', __name__)

def get_cashbox_initial_data():
    """Загружает первоначальные данные для кассы (сотрудники, источники)."""
    batch_payload = {
        'halt': 0,
        'cmd': {
            'users': 'user.get?filter[ACTIVE]=Y&admin=false',
            'sources': 'crm.status.list?filter[ENTITY_ID]=SOURCE'
        }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        result = response['result']['result']
        users = [{'ID': user['ID'], 'NAME': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in result.get('users', [])]
        sources = [{'ID': source['STATUS_ID'], 'NAME': source['NAME']} for source in result.get('sources', [])]
        return jsonify({'users': users, 'sources': sources})
    return jsonify({'error': 'Не удалось загрузить начальные данные для кассы'}), 500

def add_expense():
    """Добавляет новый расход в базу данных."""
    data = request.get_json()
    current_app.logger.info(f"Попытка сохранения расхода... ID юзера: {data.get('added_by_user_id')}, Данные: {json.dumps(data, ensure_ascii=False)}")
    
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500
    cursor = conn.cursor()
    query = "INSERT INTO expenses (name, expense_date, amount, category, category_val, employee_id, source_id, contact_id, comment, added_by_user_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    values = (
        data.get('name'), data.get('date'), data.get('amount'), data.get('category_text'), data.get('category_val'),
        data.get('employee_id'), data.get('source_id'), data.get('contact_id'), data.get('comment'), data.get('added_by_user_id')
    )
    try:
        cursor.execute(query, values)
        conn.commit()
        return jsonify({'success': True, 'id': cursor.lastrowid})
    except mysql.connector.Error as err:
        conn.rollback()
        return jsonify({'success': False, 'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()

def get_expenses():
    """Возвращает список расходов с учетом фильтров и пагинации."""
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500
    cursor = conn.cursor(dictionary=True)

    where_clauses, query_params = [], []
    
    if request.args.get('name'): where_clauses.append("`name` LIKE %s"); query_params.append(f"%{request.args.get('name')}%")
    if request.args.get('category_val'): where_clauses.append("`category_val` = %s"); query_params.append(request.args.get('category_val'))
    if request.args.get('employee_id'): where_clauses.append("`employee_id` = %s"); query_params.append(request.args.get('employee_id'))
    if request.args.get('source_id'): where_clauses.append("`source_id` = %s"); query_params.append(request.args.get('source_id'))
    if request.args.get('start_date'): where_clauses.append("`expense_date` >= %s"); query_params.append(request.args.get('start_date'))
    if request.args.get('end_date'): where_clauses.append("`expense_date` <= %s"); query_params.append(request.args.get('end_date'))
    if request.args.get('min_amount'): where_clauses.append("`amount` >= %s"); query_params.append(request.args.get('min_amount'))
    if request.args.get('max_amount'): where_clauses.append("`amount` <= %s"); query_params.append(request.args.get('max_amount'))

    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    limit = request.args.get('limit', 25, type=int)
    offset = request.args.get('offset', 0, type=int)

    try:
        count_query = f"SELECT COUNT(*) as total FROM expenses {where_sql}"
        cursor.execute(count_query, tuple(query_params))
        total_records = cursor.fetchone()['total']
        
        data_query = f"SELECT * FROM expenses {where_sql} ORDER BY created_at DESC LIMIT %s OFFSET %s"
        cursor.execute(data_query, tuple(query_params + [limit, offset]))
        expenses = cursor.fetchall()

        for expense in expenses:
            expense['employee_name'] = _get_b24_entity_name('user', expense['employee_id'])
            expense['source_name'] = _get_b24_entity_name('source', expense['source_id'])
            expense['contact_name'] = _get_b24_entity_name('contact', expense['contact_id'])
            expense['added_by_user_name'] = _get_b24_entity_name('user', expense['added_by_user_id'])
            expense['expense_date'] = expense['expense_date'].isoformat() if expense['expense_date'] else None
            expense['created_at'] = expense['created_at'].isoformat() if expense['created_at'] else None
        
        return jsonify({'expenses': expenses, 'total_records': total_records, 'limit': limit, 'offset': offset})
    except mysql.connector.Error as err:
        return jsonify({'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()

def get_single_expense():
    """Возвращает один расход по его ID."""
    expense_id = request.args.get('id')
    if not expense_id: return jsonify({'error': 'Expense ID is required'}), 400
    
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'DB connection failed'}), 500
    cursor = conn.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT * FROM expenses WHERE id = %s", (expense_id,))
        expense = cursor.fetchone()
        if expense:
            expense['expense_date'] = expense['expense_date'].isoformat() if expense['expense_date'] else None
            expense['created_at'] = expense['created_at'].isoformat() if expense['created_at'] else None
            return jsonify(expense)
        return jsonify({'error': 'Expense not found'}), 404
    except mysql.connector.Error as err:
        return jsonify({'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()

def update_expense():
    """Обновляет существующий расход."""
    data = request.get_json()
    expense_id = data.get('id')
    if not expense_id: return jsonify({'error': 'Expense ID is required'}), 400

    conn = get_db_connection()
    if not conn: return jsonify({'error': 'DB connection failed'}), 500
    cursor = conn.cursor()

    query = """UPDATE expenses SET 
               name = %s, expense_date = %s, amount = %s, category = %s, category_val = %s, 
               employee_id = %s, source_id = %s, contact_id = %s, comment = %s
               WHERE id = %s"""
    values = (
        data.get('name'), data.get('date'), data.get('amount'), data.get('category_text'), data.get('category_val'),
        data.get('employee_id'), data.get('source_id'), data.get('contact_id'), data.get('comment'), expense_id
    )
    
    try:
        cursor.execute(query, values)
        conn.commit()
        return jsonify({'success': True})
    except mysql.connector.Error as err:
        conn.rollback()
        return jsonify({'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()

def delete_expense():
    """Удаляет расход по ID."""
    expense_id = request.args.get('id')
    if not expense_id: return jsonify({'error': 'Expense ID is required'}), 400

    conn = get_db_connection()
    if not conn: return jsonify({'error': 'DB connection failed'}), 500
    cursor = conn.cursor()

    try:
        cursor.execute("DELETE FROM expenses WHERE id = %s", (expense_id,))
        conn.commit()
        if cursor.rowcount == 0:
            return jsonify({'error': 'Expense not found or already deleted'}), 404
        return jsonify({'success': True})
    except mysql.connector.Error as err:
        conn.rollback()
        return jsonify({'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()
