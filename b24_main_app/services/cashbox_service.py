import json
import mysql.connector
from flask import current_app

from core.db import get_db_connection
from core.b24 import _get_b24_entity_name, b24_call_method, fetch_paginated_data

def get_cashbox_initial_data_service():
    """Сервисная функция для загрузки первоначальных данных для кассы."""
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
        return {'users': users, 'sources': sources}
    raise Exception('Не удалось загрузить начальные данные для кассы')

def add_expense_service(data):
    """Сервисная функция для добавления нового расхода."""
    current_app.logger.info(f"Попытка сохранения расхода... ID юзера: {data.get('added_by_user_id')}, Данные: {json.dumps(data, ensure_ascii=False)}")

    conn = get_db_connection()
    if not conn: raise Exception('Не удалось подключиться к базе данных')
    cursor = conn.cursor()
    query = "INSERT INTO expenses (expense_date, amount, category, category_val, employee_id, source_id, contact_id, comment, added_by_user_id, paid_leads, free_leads) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    values = (
        data.get('date'), data.get('amount'), data.get('category_text'), data.get('category_val'),
        data.get('employee_id'), data.get('source_id'), data.get('contact_id'), data.get('comment'), data.get('added_by_user_id'),
        data.get('paid_leads'), data.get('free_leads')
    )
    try:
        cursor.execute(query, values)
        conn.commit()
        return {'success': True, 'id': cursor.lastrowid}
    except mysql.connector.Error as err:
        conn.rollback()
        raise err
    finally:
        cursor.close()
        conn.close()

def get_expenses_service(args):
    """Сервисная функция для получения списка расходов с фильтрами."""
    conn = get_db_connection()
    if not conn: raise Exception('Не удалось подключиться к базе данных')
    cursor = conn.cursor(dictionary=True)

    where_clauses, query_params = [], []

    if args.get('name'): where_clauses.append("`name` LIKE %s"); query_params.append(f"%{args.get('name')}%")
    if args.get('category_val'): where_clauses.append("`category_val` = %s"); query_params.append(args.get('category_val'))
    if args.get('employee_id'): where_clauses.append("`employee_id` = %s"); query_params.append(args.get('employee_id'))
    if args.get('source_id'): where_clauses.append("`source_id` = %s"); query_params.append(args.get('source_id'))
    if args.get('start_date'): where_clauses.append("`expense_date` >= %s"); query_params.append(args.get('start_date'))
    if args.get('end_date'): where_clauses.append("`expense_date` <= %s"); query_params.append(args.get('end_date'))
    if args.get('min_amount'): where_clauses.append("`amount` >= %s"); query_params.append(args.get('min_amount'))
    if args.get('max_amount'): where_clauses.append("`amount` <= %s"); query_params.append(args.get('max_amount'))

    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    limit = args.get('limit', 25, type=int)
    offset = args.get('offset', 0, type=int)

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

        return {'expenses': expenses, 'total_records': total_records, 'limit': limit, 'offset': offset}
    except mysql.connector.Error as err:
        raise err
    finally:
        cursor.close()
        conn.close()

def get_single_expense_service(expense_id):
    """Сервисная функция для получения одного расхода по ID."""
    if not expense_id: raise ValueError('Expense ID is required')
    
    conn = get_db_connection()
    if not conn: raise Exception('DB connection failed')
    cursor = conn.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT * FROM expenses WHERE id = %s", (expense_id,))
        expense = cursor.fetchone()
        if expense:
            expense['expense_date'] = expense['expense_date'].isoformat() if expense['expense_date'] else None
            expense['created_at'] = expense['created_at'].isoformat() if expense['created_at'] else None
            return expense
        return None
    except mysql.connector.Error as err:
        raise err
    finally:
        cursor.close()
        conn.close()

def update_expense_service(data):
    """Сервисная функция для обновления расхода."""
    expense_id = data.get('id')
    if not expense_id: raise ValueError('Expense ID is required')

    conn = get_db_connection()
    if not conn: raise Exception('DB connection failed')
    cursor = conn.cursor()

    query = """UPDATE expenses SET 
               expense_date = %s, amount = %s, category = %s, category_val = %s, 
               employee_id = %s, source_id = %s, contact_id = %s, comment = %s,
               paid_leads = %s, free_leads = %s
               WHERE id = %s"""
    values = (
        data.get('date'), data.get('amount'), data.get('category_text'), data.get('category_val'),
        data.get('employee_id'), data.get('source_id'), data.get('contact_id'), data.get('comment'),
        data.get('paid_leads'), data.get('free_leads'), expense_id
    )

    try:
        cursor.execute(query, values)
        conn.commit()
        return {'success': True}
    except mysql.connector.Error as err:
        conn.rollback()
        raise err
    finally:
        cursor.close()
        conn.close()

def delete_expense_service(expense_id):
    """Сервисная функция для удаления расхода."""
    if not expense_id: raise ValueError('Expense ID is required')

    conn = get_db_connection()
    if not conn: raise Exception('DB connection failed')
    cursor = conn.cursor()

    try:
        cursor.execute("DELETE FROM expenses WHERE id = %s", (expense_id,))
        conn.commit()
        if cursor.rowcount == 0:
            return None
        return {'success': True}
    except mysql.connector.Error as err:
        conn.rollback()
        raise err
    finally:
        cursor.close()
        conn.close()

# --- Новая логика для ПРИХОДОВ ---

def add_income_service(data):
    """Сервисная функция для добавления нового прихода в БД."""
    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
        INSERT INTO incomes (income_date, amount, contact_id, deal_id, comment, added_by_user_id)
        VALUES (%s, %s, %s, %s, %s, %s)
    """
    try:
        cursor.execute(query, (
            data['date'], data['amount'], data.get('contact_id'), 
            data.get('deal_id'), data.get('comment'), data.get('added_by_user_id')
        ))
        conn.commit()
        current_app.logger.info(f"Income added with ID: {cursor.lastrowid}")
        return {'success': True, 'id': cursor.lastrowid}
    except Exception as e:
        conn.rollback()
        current_app.logger.error(f"Error adding income: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

def get_incomes_service(args):
    """Сервисная функция для получения списка приходов с фильтрацией и пагинацией."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    base_query = "FROM incomes i"
    count_query = "SELECT COUNT(*) as total " + base_query
    data_query = "SELECT i.* " + base_query

    filters = []
    filter_params = []

    if args.get('start_date'):
        filters.append("i.income_date >= %s")
        filter_params.append(args['start_date'])
    if args.get('end_date'):
        filters.append("i.income_date <= %s")
        filter_params.append(args['end_date'])

    if filters:
        data_query += " WHERE " + " AND ".join(filters)
        count_query += " WHERE " + " AND ".join(filters)

    cursor.execute(count_query, tuple(filter_params))
    total_records = cursor.fetchone()['total']

    limit = args.get('limit', 25, type=int)
    offset = args.get('offset', 0, type=int)
    data_query += " ORDER BY i.income_date DESC, i.id DESC LIMIT %s OFFSET %s"
    filter_params.extend([limit, offset])
    
    cursor.execute(data_query, tuple(filter_params))
    incomes = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    for income in incomes:
        income['contact_name'] = _get_b24_entity_name('contact', income['contact_id'])
        income['deal_name'] = _get_b24_entity_name('deal', income['deal_id'])
        income['added_by_user_name'] = _get_b24_entity_name('user', income['added_by_user_id'])
        income['income_date'] = income['income_date'].isoformat() if income['income_date'] else None
    
    return {
        "incomes": incomes,
        "total_records": total_records,
        "limit": limit,
        "offset": offset
    }

def get_single_income_service(income_id):
    """Сервисная функция для получения одного прихода по ID."""
    if not income_id: raise ValueError('Income ID is required')
    
    conn = get_db_connection()
    if not conn: raise Exception('DB connection failed')
    cursor = conn.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT * FROM incomes WHERE id = %s", (income_id,))
        income = cursor.fetchone()
        if income:
            income['income_date'] = income['income_date'].isoformat() if income['income_date'] else None
            income['contact_name'] = _get_b24_entity_name('contact', income['contact_id'])
            return income
        return None
    except mysql.connector.Error as err:
        raise err
    finally:
        cursor.close()
        conn.close()

def update_income_service(data):
    """Сервисная функция для обновления прихода."""
    income_id = data.get('id')
    if not income_id: raise ValueError('Income ID is required')

    conn = get_db_connection()
    if not conn: raise Exception('DB connection failed')
    cursor = conn.cursor()

    query = """UPDATE incomes SET 
               income_date = %s, amount = %s, contact_id = %s, 
               deal_id = %s, comment = %s
               WHERE id = %s"""
    values = (
        data.get('date'), data.get('amount'), data.get('contact_id'),
        data.get('deal_id'), data.get('comment'), income_id
    )

    try:
        cursor.execute(query, values)
        conn.commit()
        current_app.logger.info(f"Income with ID {income_id} updated.")
        return {'success': True}
    except mysql.connector.Error as err:
        conn.rollback()
        raise err
    finally:
        cursor.close()
        conn.close()

def delete_income_service(income_id):
    """Сервисная функция для удаления прихода."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM incomes WHERE id = %s", (income_id,))
        conn.commit()
        current_app.logger.info(f"Income with ID {income_id} deleted.")
        return {'success': cursor.rowcount > 0}
    except Exception as e:
        conn.rollback()
        current_app.logger.error(f"Error deleting income {income_id}: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

def get_client_deals_service(contact_id):
    """Получает список сделок для указанного контакта, используя их тип в качестве названия."""
    if not contact_id:
        return []

    # Пакетный запрос: получаем сделки и справочник типов сделок
    batch_payload = {
        'halt': 0,
        'cmd': {
            'deals': f"crm.deal.list?filter[CONTACT_ID]={contact_id}&filter[CATEGORY_ID]=0&select[]=ID&select[]=TYPE_ID",
            'deal_types': "crm.dealtype.list"
        }
    }
    
    response = b24_call_method('batch', batch_payload)
    
    if not response or not response.get('result', {}).get('result'):
        current_app.logger.error("Failed to fetch deals or deal types from Bitrix24.")
        return []

    result = response['result']['result']
    deals = result.get('deals', [])
    deal_type_info = result.get('deal_types', [])
    
    type_map = {item['ID']: item['NAME'] for item in deal_type_info}

    formatted_deals = []
    for deal in deals:
        type_id = deal.get('TYPE_ID')
        deal_name = type_map.get(type_id, f"Сделка #{deal['ID']}")
        formatted_deals.append({'id': deal['ID'], 'name': deal_name})

    current_app.logger.info(f"Found {len(formatted_deals)} deals for contact_id {contact_id}")
    
    return formatted_deals
