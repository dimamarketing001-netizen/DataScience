import json
import mysql.connector
from flask import current_app
from datetime import datetime

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
    current_app.logger.info(f"add_income_service START: date={data.get('date')}, amount={data.get('amount')}, contact_id={data.get('contact_id')}, deal_id={data.get('deal_id')}")

    conn = get_db_connection()
    if not conn:
        raise Exception('Не удалось подключиться к базе данных')
    cursor = conn.cursor()
    query = """
            INSERT INTO incomes (income_date, amount, contact_id, deal_id, deal_type_id, deal_type_name, comment, \
                                 added_by_user_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) \
            """
    try:
        cursor.execute(query, (
            data['date'], data['amount'], data.get('contact_id'),
            data.get('deal_id'), data.get('deal_type_id'), data.get('deal_type_name'),
            data.get('comment'), data.get('added_by_user_id')
        ))
        conn.commit()
        new_income_id = cursor.lastrowid
        current_app.logger.info(f"add_income_service: INSERT OK, new_income_id={new_income_id}")
    except Exception as e:
        conn.rollback()
        current_app.logger.error(f"add_income_service: INSERT FAILED: {e}", exc_info=True)
        raise
    finally:
        cursor.close()
        conn.close()

    # --- Создаём смарт-счёт в Б24 ---
    invoice_result = None
    if data.get('deal_id') and data.get('contact_id'):
        current_app.logger.info(f"add_income_service: starting invoice creation for deal_id={data.get('deal_id')}")
        try:
            invoice_result = create_b24_invoice_service(
                income_data={
                    'deal_id': data.get('deal_id'),
                    'contact_id': data.get('contact_id'),
                    'amount': data.get('amount'),
                    'date': data.get('date'),
                    'deal_type_name': data.get('deal_type_name', ''),
                    'income_db_id': new_income_id
                },
                file_data=data.get('file_data')
            )
            current_app.logger.info(f"add_income_service: invoice result={invoice_result}")

            # Сохраняем b24_invoice_id и b24_file_id в БД
            if invoice_result.get('success'):
                conn2 = get_db_connection()
                if conn2:
                    try:
                        cur2 = conn2.cursor()
                        cur2.execute(
                            "UPDATE incomes SET b24_invoice_id=%s, b24_file_id=%s, b24_file_url=%s WHERE id=%s",
                            (
                                str(invoice_result.get('invoice_id', '')),
                                invoice_result.get('b24_file_id'),
                                invoice_result.get('b24_file_url'),
                                new_income_id
                            )
                        )
                        current_app.logger.info(
                            f"add_income_service: saved invoice_id={invoice_result.get('invoice_id')}, file_id={invoice_result.get('b24_file_id')}, file_url saved={bool(invoice_result.get('b24_file_url'))}")
                        conn2.commit()
                    except Exception as db_err:
                        current_app.logger.warning(f"add_income_service: failed to save invoice/file ids: {db_err}")
                    finally:
                        cur2.close()
                        conn2.close()
        except Exception as e:
            current_app.logger.error(f"add_income_service: invoice FAILED: {e}", exc_info=True)
            invoice_result = {'success': False, 'error': str(e)}
    else:
        current_app.logger.info("add_income_service: skipping invoice — no deal_id or contact_id")

    return {
        'success': True,
        'id': new_income_id,
        'invoice': invoice_result
    }

def get_incomes_service(args):
    """Сервисная функция для получения списка приходов с фильтрацией и пагинацией."""
    conn = get_db_connection()
    if not conn:
        raise Exception('Не удалось подключиться к базе данных')
    cursor = conn.cursor(dictionary=True)

    base_query = "FROM incomes i"
    count_query = "SELECT COUNT(*) as total " + base_query
    data_query  = "SELECT i.* " + base_query

    filters = []
    filter_params = []

    if args.get('start_date'):
        filters.append("i.income_date >= %s")
        filter_params.append(args['start_date'])
    if args.get('end_date'):
        filters.append("i.income_date <= %s")
        filter_params.append(args['end_date'])
    if args.get('is_confirmed') is not None and args.get('is_confirmed') != '':
        filters.append("i.is_confirmed = %s")
        filter_params.append(int(args['is_confirmed']))

    if filters:
        where = " WHERE " + " AND ".join(filters)
        data_query  += where
        count_query += where

    cursor.execute(count_query, tuple(filter_params))
    total_records = cursor.fetchone()['total']

    limit  = args.get('limit',  25, type=int)
    offset = args.get('offset',  0, type=int)
    data_query += " ORDER BY i.income_date DESC, i.id DESC LIMIT %s OFFSET %s"
    filter_params.extend([limit, offset])

    cursor.execute(data_query, tuple(filter_params))
    incomes = cursor.fetchall()

    cursor.close()
    conn.close()

    for income in incomes:
        income['contact_name']         = _get_b24_entity_name('contact', income['contact_id'])
        income['deal_name']            = income.get('deal_type_name') or '—'
        income['added_by_user_name']   = _get_b24_entity_name('user', income['added_by_user_id'])
        # Имя подтвердившего
        income['confirmed_by_user_name'] = _get_b24_entity_name('user', income['confirmed_by_user_id']) \
                                           if income.get('confirmed_by_user_id') else None
        income['income_date']          = income['income_date'].isoformat() if income['income_date'] else None
        income['is_confirmed']         = bool(income.get('is_confirmed', 0))
        income['b24_invoice_id']       = str(income['b24_invoice_id'])  if income.get('b24_invoice_id')  else None
        income['b24_file_id']          = str(income['b24_file_id'])     if income.get('b24_file_id')     else None
        income['b24_file_url']         = income.get('b24_file_url')     or None
        income['contact_id']           = str(income['contact_id'])      if income.get('contact_id')      else None
        income['deal_id']              = str(income['deal_id'])         if income.get('deal_id')         else None
        income['confirmed_by_user_id'] = str(income['confirmed_by_user_id']) \
                                         if income.get('confirmed_by_user_id') else None

    return {
        "incomes":       incomes,
        "total_records": total_records,
        "limit":         limit,
        "offset":        offset
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

def update_income_service(data, file_data=None):
    """Обновление прихода. Если изменился deal/contact — пересоздаёт счёт.
    Если передан file_data — заменяет файл в счёте Б24.
    """
    income_id = data.get('id')
    if not income_id:
        raise ValueError('Income ID is required')

    conn = get_db_connection()
    if not conn:
        raise Exception('DB connection failed')
    cursor = conn.cursor(dictionary=True)

    try:
        cursor.execute(
            "SELECT deal_id, contact_id, b24_invoice_id, amount, income_date, deal_type_name FROM incomes WHERE id = %s",
            (income_id,)
        )
        old_income = cursor.fetchone()
        if not old_income:
            raise ValueError(f'Income {income_id} not found')

        old_deal_id    = str(old_income['deal_id'])        if old_income.get('deal_id')        else None
        old_contact_id = str(old_income['contact_id'])     if old_income.get('contact_id')     else None
        old_invoice_id = str(old_income['b24_invoice_id']) if old_income.get('b24_invoice_id') else None

        new_deal_id    = str(data.get('deal_id'))    if data.get('deal_id')    else None
        new_contact_id = str(data.get('contact_id')) if data.get('contact_id') else None

        deal_changed = (old_deal_id != new_deal_id) or (old_contact_id != new_contact_id)

        current_app.logger.info(
            f"update_income_service: id={income_id}, old_deal={old_deal_id}, new_deal={new_deal_id}, "
            f"deal_changed={deal_changed}, has_new_file={file_data is not None}"
        )

        query = """UPDATE incomes
                   SET income_date    = %s,
                       amount         = %s,
                       contact_id     = %s,
                       deal_id        = %s,
                       deal_type_id   = %s,
                       deal_type_name = %s,
                       comment        = %s
                   WHERE id = %s"""
        cursor.execute(query, (
            data.get('date'), data.get('amount'), data.get('contact_id'),
            data.get('deal_id'), data.get('deal_type_id'), data.get('deal_type_name'),
            data.get('comment'), income_id
        ))
        conn.commit()

    except Exception as e:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    invoice_result = None

    if deal_changed and new_deal_id and new_contact_id:
        # Удаляем старый счёт
        if old_invoice_id:
            try:
                delete_b24_invoice_service(old_invoice_id)
                current_app.logger.info(f"update_income_service: old invoice {old_invoice_id} deleted")
            except Exception as e:
                current_app.logger.warning(f"update_income_service: failed to delete old invoice: {e}")

        # Создаём новый счёт (с новым файлом если есть)
        try:
            invoice_result = create_b24_invoice_service(
                income_data={
                    'deal_id':        new_deal_id,
                    'contact_id':     new_contact_id,
                    'amount':         data.get('amount'),
                    'date':           data.get('date'),
                    'deal_type_name': data.get('deal_type_name', ''),
                    'income_db_id':   income_id
                },
                file_data=file_data  # передаём новый файл если есть
            )
            if invoice_result.get('success'):
                conn2 = get_db_connection()
                if conn2:
                    try:
                        cur2 = conn2.cursor()
                        cur2.execute(
                            "UPDATE incomes SET b24_invoice_id=%s, b24_file_id=%s, b24_file_url=%s, is_confirmed=0 WHERE id=%s",
                            (
                                str(invoice_result.get('invoice_id', '')),
                                invoice_result.get('b24_file_id'),
                                invoice_result.get('b24_file_url'),
                                income_id
                            )
                        )
                        conn2.commit()
                    finally:
                        cur2.close()
                        conn2.close()
        except Exception as e:
            current_app.logger.error(f"update_income_service: failed to create new invoice: {e}", exc_info=True)
            invoice_result = {'success': False, 'error': str(e)}

    elif deal_changed and old_invoice_id:
        # Сделку убрали — удаляем счёт
        try:
            delete_b24_invoice_service(old_invoice_id)
            conn3 = get_db_connection()
            if conn3:
                try:
                    cur3 = conn3.cursor()
                    cur3.execute(
                        "UPDATE incomes SET b24_invoice_id=NULL, b24_file_id=NULL, b24_file_url=NULL, is_confirmed=0 WHERE id=%s",
                        (income_id,)
                    )
                    conn3.commit()
                finally:
                    cur3.close()
                    conn3.close()
        except Exception as e:
            current_app.logger.warning(f"update_income_service: failed to delete invoice: {e}")

    elif not deal_changed and file_data and old_invoice_id:
        # Сделка не менялась, но загружен новый файл — обновляем файл в существующем счёте
        try:
            import base64
            file_content_b64 = base64.b64encode(file_data['content']).decode('utf-8')
            filename = file_data.get('filename', 'document.pdf')
            FILE_CUSTOM_FIELD = "UF_CRM_SMART_INVOICE_1776360197269"
            SMART_INVOICE_ENTITY_TYPE_ID = 31

            update_params = {
                'entityTypeId': SMART_INVOICE_ENTITY_TYPE_ID,
                'id': old_invoice_id,
                'fields': {
                    FILE_CUSTOM_FIELD: [filename, file_content_b64]
                },
                'useOriginalUfNames': 'Y'
            }
            current_app.logger.info(f"update_income_service: updating file in invoice {old_invoice_id}")
            update_res = b24_call_method('crm.item.update', update_params)
            current_app.logger.info(f"update_income_service: file update result={update_res}")

            # Получаем обновлённый URL файла
            get_res = b24_call_method('crm.item.get', {
                'entityTypeId': SMART_INVOICE_ENTITY_TYPE_ID,
                'id': old_invoice_id
            })
            if get_res and get_res.get('result', {}).get('item'):
                item = get_res['result']['item']
                # Б24 может вернуть поле в разных форматах ключа
                file_field = (
                        item.get('UF_CRM_SMART_INVOICE_1776360197269') or
                        item.get('ufCrmSmartInvoice1776360197269')
                )
                current_app.logger.info(f"update_income_service: file_field after update = {file_field}")

                new_file_id = None
                new_file_url = None

                if isinstance(file_field, dict):
                    new_file_id = str(file_field.get('id', '')) or None
                    new_file_url = file_field.get('urlMachine') or file_field.get('url') or None
                elif file_field:
                    new_file_id = str(file_field)

                conn4 = get_db_connection()
                if conn4:
                    try:
                        cur4 = conn4.cursor()
                        cur4.execute(
                            "UPDATE incomes SET b24_file_id=%s, b24_file_url=%s WHERE id=%s",
                            (new_file_id, new_file_url, income_id)
                        )
                        conn4.commit()
                        current_app.logger.info(
                            f"update_income_service: file saved in DB: id={new_file_id}, url_set={bool(new_file_url)}"
                        )
                    finally:
                        cur4.close()
                        conn4.close()

            invoice_result = {'success': True, 'file_updated': True}
        except Exception as e:
            current_app.logger.error(f"update_income_service: file update failed: {e}", exc_info=True)
            invoice_result = {'success': False, 'error': str(e)}

    return {
        'success': True,
        'invoice_recreated': deal_changed,
        'invoice': invoice_result
    }

def delete_income_service(income_id):
    """Сервисная функция для удаления прихода и связанного счёта в Б24."""
    if not income_id:
        raise ValueError('Income ID is required')

    conn = get_db_connection()
    if not conn:
        raise Exception('DB connection failed')
    cursor = conn.cursor(dictionary=True)

    try:
        # Сначала получаем b24_invoice_id чтобы удалить счёт
        cursor.execute("SELECT b24_invoice_id FROM incomes WHERE id = %s", (income_id,))
        income = cursor.fetchone()
        b24_invoice_id = income.get('b24_invoice_id') if income else None
        current_app.logger.info(f"delete_income_service: income_id={income_id}, b24_invoice_id={b24_invoice_id}")

        # Удаляем из БД
        cursor.execute("DELETE FROM incomes WHERE id = %s", (income_id,))
        conn.commit()
        deleted = cursor.rowcount > 0
        current_app.logger.info(f"delete_income_service: DB delete ok, rows_deleted={deleted}")
    except Exception as e:
        conn.rollback()
        current_app.logger.error(f"delete_income_service: DB error: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

    # Удаляем счёт из Б24 если он был создан
    invoice_deleted = False
    if b24_invoice_id and deleted:
        try:
            invoice_result = delete_b24_invoice_service(b24_invoice_id)
            invoice_deleted = invoice_result.get('success', False)
            current_app.logger.info(f"delete_income_service: B24 invoice delete result={invoice_result}")
        except Exception as e:
            # Запись из БД уже удалена — не откатываем, просто логируем
            current_app.logger.error(f"delete_income_service: B24 invoice delete failed: {e}")

    return {
        'success': deleted,
        'invoice_deleted': invoice_deleted,
        'b24_invoice_id': b24_invoice_id
    }

def get_client_deals_service(contact_id):
    """Получает список сделок для указанного контакта, используя их тип в качестве названия."""
    if not contact_id:
        return []

    # Пакетный запрос: получаем сделки и справочник типов сделок
    batch_payload = {
        'halt': 0,
        'cmd': {
            'deals': f"crm.deal.list?filter[CONTACT_ID]={contact_id}&filter[CATEGORY_ID]=0&select[]=ID&select[]=TYPE_ID",
            'deal_types': "crm.status.list?filter[ENTITY_ID]=DEAL_TYPE"
        }
    }

    response = b24_call_method('batch', batch_payload)

    if not response or not response.get('result', {}).get('result'):
        current_app.logger.error("Failed to fetch deals or deal types from Bitrix24.")
        return []

    result = response['result']['result']
    deals = result.get('deals', [])
    deal_type_info = result.get('deal_types', [])

    current_app.logger.info(f"deal_type_info raw: {deal_type_info}")

    # Ключ теперь STATUS_ID (например 'SALE'), значение NAME (например 'БФЛ')
    type_map = {item['STATUS_ID']: item['NAME'] for item in deal_type_info}

    current_app.logger.info(f"type_map built: {type_map}")

    formatted_deals = []
    for deal in deals:
        type_id = deal.get('TYPE_ID')
        deal_name = type_map.get(type_id, f"Тип неизвестен ({type_id})")
        current_app.logger.info(f"Deal ID={deal['ID']}, TYPE_ID='{type_id}', name='{deal_name}'")
        formatted_deals.append({
            'id': deal['ID'],  # 2086
            'type_id': type_id,  # SALE
            'name': deal_name  # БФЛ
        })

    current_app.logger.info(f"Found {len(formatted_deals)} deals for contact_id {contact_id}")

    return formatted_deals


def create_b24_invoice_service(income_data, file_data=None):
    """
    Создаёт смарт-счёт в Битрикс24, привязывает к сделке и прикрепляет файл.

    income_data:
        - deal_id, contact_id, amount, date, deal_type_name, income_db_id
    file_data (опционально):
        - filename: имя файла
        - content: bytes содержимое файла
        - mimetype: MIME тип
    """

    SMART_INVOICE_ENTITY_TYPE_ID = 31
    MY_COMPANY_ID = 8
    FINAL_INVOICE_STAGE_ID = 'DT31_2:N'
    PAYMENT_DATE_CUSTOM_FIELD = "UF_CRM_SMART_INVOICE_1776220509400"

    deal_id = income_data.get('deal_id')
    contact_id = income_data.get('contact_id')
    amount = income_data.get('amount')
    date = income_data.get('date')
    deal_type_name = income_data.get('deal_type_name', '')
    income_db_id = income_data.get('income_db_id', '')

    if not deal_id or not contact_id or not amount or not date:
        raise ValueError(f"Недостаточно данных для создания счёта: deal_id={deal_id}, contact_id={contact_id}")

    # Дата из YYYY-MM-DD в DD.MM.YYYY
    try:
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        date_for_api = date_obj.strftime('%d.%m.%Y')
    except ValueError:
        date_for_api = date

    title = f"Приход #{income_db_id} | {deal_type_name} | {date_for_api} | {float(amount):.2f} руб."

    # --- Шаг 1: Подготавливаем файл для передачи в поле счёта ---
    # Поле типа "Файл" в смарт-процессе принимает base64 напрямую в crm.item.add
    FILE_CUSTOM_FIELD = "UF_CRM_SMART_INVOICE_1776360197269"
    file_b64_for_field = None

    if file_data and file_data.get('content'):
        try:
            import base64
            file_content_b64 = base64.b64encode(file_data['content']).decode('utf-8')
            filename = file_data.get('filename', 'document.pdf')

            # Битрикс24 принимает файл в UF-поле в формате массива массивов
            file_b64_for_field = [filename, file_content_b64]

            current_app.logger.info(
                f"INVOICE STEP 1: file prepared for field '{FILE_CUSTOM_FIELD}', "
                f"name='{filename}', size={len(file_data['content'])} bytes"
            )
        except Exception as e:
            current_app.logger.warning(f"INVOICE STEP 1 ERROR: {e}", exc_info=True)
            file_b64_for_field = None
    else:
        current_app.logger.info("INVOICE STEP 1: no file_data")

    # --- Шаг 2: Создаём смарт-счёт ---
    invoice_fields = {
        'title': title,
        'parentId2': deal_id,
        'contactIds': [contact_id],
        'mycompanyId': MY_COMPANY_ID,
        'opportunity': float(amount),
        PAYMENT_DATE_CUSTOM_FIELD: date_for_api,
        'stageId': FINAL_INVOICE_STAGE_ID
    }

    # Прикрепляем файл напрямую в пользовательское поле типа "Файл"
    if file_b64_for_field:
        invoice_fields[FILE_CUSTOM_FIELD] = file_b64_for_field
        current_app.logger.info(f"INVOICE STEP 2: file attached to field {FILE_CUSTOM_FIELD}")

    invoice_params = {
        'entityTypeId': SMART_INVOICE_ENTITY_TYPE_ID,
        'fields': invoice_fields,
        'useOriginalUfNames': 'Y'
    }

    current_app.logger.info(f"INVOICE STEP 2: crm.item.add params={invoice_params}")
    invoice_res = b24_call_method('crm.item.add', invoice_params)
    current_app.logger.info(f"INVOICE STEP 2 response: {invoice_res}")

    if not invoice_res or 'result' not in invoice_res:
        raise Exception(f"INVOICE STEP 2 FAILED: crm.item.add bad response: {invoice_res}")

    item_result = invoice_res.get('result', {}).get('item')
    if not item_result or not item_result.get('id'):
        raise Exception(f"INVOICE STEP 2 FAILED: no invoice ID in response: {invoice_res}")

    new_invoice_id = item_result['id']
    # Поле файла возвращает ID файла (integer) после успешной загрузки
    file_field_value = item_result.get('UF_CRM_SMART_INVOICE_1776360197269') or \
                       item_result.get('ufCrmSmartInvoice1776360197269')

    b24_file_id = None
    b24_file_url = None

    if isinstance(file_field_value, dict):
        # Б24 вернул объект: {'id': 142346, 'url': '...', 'urlMachine': '...'}
        b24_file_id = str(file_field_value.get('id', '')) or None
        # urlMachine работает через REST без токена сессии браузера
        b24_file_url = file_field_value.get('urlMachine') or file_field_value.get('url') or None
    elif file_field_value and file_field_value != 0:
        # Вернул просто ID числом
        b24_file_id = str(file_field_value)

    current_app.logger.info(
        f"INVOICE STEP 2 OK: invoice_id={new_invoice_id}, b24_file_id={b24_file_id}, b24_file_url={b24_file_url[:80] if b24_file_url else None}")

    # --- Шаг 3: Добавляем строку товара ---
    product_params = {
        'fields': {
            'ownerType': 'SI',
            'ownerId': new_invoice_id,
            'productName': f"Оплата {deal_type_name} от {date_for_api}",
            'price': float(amount),
            'quantity': 1
        }
    }

    current_app.logger.info(f"INVOICE STEP 3: crm.item.productrow.add params={product_params}")
    product_res = b24_call_method('crm.item.productrow.add', product_params)
    current_app.logger.info(f"INVOICE STEP 3 response: {product_res}")

    if not product_res or 'error' in product_res:
        current_app.logger.warning(f"INVOICE STEP 3 WARN: product not added: {product_res}")
        return {
            'success': True,
            'invoice_id': new_invoice_id,
            'b24_file_id': b24_file_id,
            'b24_file_url': b24_file_url,
            'product_added': False,
            'file_uploaded': file_b64_for_field is not None
        }

    current_app.logger.info(f"INVOICE STEP 3 OK: product added to invoice #{new_invoice_id}")
    return {
        'success': True,
        'invoice_id': new_invoice_id,
        'b24_file_id': b24_file_id,
        'b24_file_url': b24_file_url,
        'product_added': True,
        'file_uploaded': file_b64_for_field is not None
    }

def delete_b24_invoice_service(invoice_id):
    """Удаляет смарт-счёт из Битрикс24."""
    if not invoice_id:
        return {'success': False, 'error': 'invoice_id не передан'}

    SMART_INVOICE_ENTITY_TYPE_ID = 31

    params = {
        'entityTypeId': SMART_INVOICE_ENTITY_TYPE_ID,
        'id': invoice_id
    }

    current_app.logger.info(f"delete_b24_invoice: deleting invoice_id={invoice_id}")
    result = b24_call_method('crm.item.delete', params)
    current_app.logger.info(f"delete_b24_invoice: response={result}")

    if result and result.get('result'):
        return {'success': True}
    else:
        return {'success': False, 'error': str(result)}

def toggle_income_confirmation_service(income_id, confirm: bool, confirmed_by_user_id=None):
    """Подтверждает или отменяет подтверждение прихода, меняя статус счёта в Б24."""
    if not income_id:
        raise ValueError('Income ID is required')

    SMART_INVOICE_ENTITY_TYPE_ID = 31
    CONFIRMED_STAGE_ID   = 'DT31_2:P'
    UNCONFIRMED_STAGE_ID = 'DT31_2:N'

    conn = get_db_connection()
    if not conn:
        raise Exception('DB connection failed')
    cursor = conn.cursor(dictionary=True)

    try:
        cursor.execute("SELECT b24_invoice_id FROM incomes WHERE id = %s", (income_id,))
        income = cursor.fetchone()
        if not income:
            raise ValueError(f'Income {income_id} not found')

        b24_invoice_id = income.get('b24_invoice_id')

        if confirm:
            cursor.execute(
                "UPDATE incomes SET is_confirmed = 1, confirmed_by_user_id = %s WHERE id = %s",
                (confirmed_by_user_id, income_id)
            )
        else:
            cursor.execute(
                "UPDATE incomes SET is_confirmed = 0, confirmed_by_user_id = NULL WHERE id = %s",
                (income_id,)
            )

        conn.commit()
        current_app.logger.info(
            f"toggle_income_confirmation: income_id={income_id}, confirm={confirm}, "
            f"confirmed_by={confirmed_by_user_id}, DB updated"
        )
    except Exception as e:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    # Обновляем статус смарт-счёта в Б24
    b24_result = None
    if b24_invoice_id:
        target_stage = CONFIRMED_STAGE_ID if confirm else UNCONFIRMED_STAGE_ID
        params = {
            'entityTypeId': SMART_INVOICE_ENTITY_TYPE_ID,
            'id': b24_invoice_id,
            'fields': {'stageId': target_stage}
        }
        current_app.logger.info(
            f"toggle_income_confirmation: updating B24 invoice {b24_invoice_id} → stageId={target_stage}"
        )
        b24_result = b24_call_method('crm.item.update', params)
        current_app.logger.info(f"toggle_income_confirmation: B24 result={b24_result}")

    return {
        'success': True,
        'is_confirmed': confirm,
        'b24_updated': b24_result is not None and 'error' not in (b24_result or {})
    }