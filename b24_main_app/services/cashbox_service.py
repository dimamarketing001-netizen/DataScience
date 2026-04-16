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
        INSERT INTO incomes (income_date, amount, contact_id, deal_id, deal_type_id, deal_type_name, comment, added_by_user_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """
    try:
        current_app.logger.info("add_income_service: executing INSERT...")
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
                    'deal_id':        data.get('deal_id'),
                    'contact_id':     data.get('contact_id'),
                    'amount':         data.get('amount'),
                    'date':           data.get('date'),
                    'deal_type_name': data.get('deal_type_name', ''),
                    'income_db_id':   new_income_id
                },
                file_data=data.get('file_data')
            )
            current_app.logger.info(f"add_income_service: invoice result={invoice_result}")
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
        # Берём название типа сделки прямо из БД — без запроса в Битрикс24
        income['deal_name'] = income.get('deal_type_name') or '—'
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

    query = """UPDATE incomes \
               SET income_date    = %s, \
                   amount         = %s, \
                   contact_id     = %s, \
                   deal_id        = %s, \
                   deal_type_id   = %s, \
                   deal_type_name = %s, \
                   comment        = %s
               WHERE id = %s"""
    values = (
        data.get('date'), data.get('amount'), data.get('contact_id'),
        data.get('deal_id'), data.get('deal_type_id'), data.get('deal_type_name'),
        data.get('comment'), income_id
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
    FINAL_INVOICE_STAGE_ID = 'DT31_2:P'
    PAYMENT_DATE_CUSTOM_FIELD = "UF_CRM_SMART_INVOICE_1776220509400"
    # ID папки на диске Б24 для хранения файлов приходов (папка "Приходы" в корне диска компании)
    # Если папки нет — файл загружается в корень диска (folder_id=0 означает корень)
    B24_FOLDER_ID = 0

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

    # --- Шаг 1: Загружаем файл на диск Б24 ---
    uploaded_file_id = None
    if file_data and file_data.get('content'):
        try:
            import base64
            file_content_b64 = base64.b64encode(file_data['content']).decode('utf-8')
            filename = file_data.get('filename', 'document.pdf')

            upload_params = {
                'id': B24_FOLDER_ID,
                'data': {'NAME': filename},
                'fileContent': [filename, file_content_b64]
            }

            current_app.logger.info(
                f"INVOICE STEP 1: uploading file '{filename}' size={len(file_data['content'])} bytes to disk folder_id={B24_FOLDER_ID}")
            upload_res = b24_call_method('disk.folder.uploadfile', upload_params)
            current_app.logger.info(f"INVOICE STEP 1 response: {upload_res}")

            if upload_res and upload_res.get('result') and upload_res['result'].get('ID'):
                uploaded_file_id = upload_res['result']['ID']
                current_app.logger.info(f"INVOICE STEP 1 OK: file uploaded, disk_file_id={uploaded_file_id}")
            else:
                current_app.logger.warning(f"INVOICE STEP 1 WARN: unexpected response, file not uploaded: {upload_res}")
        except Exception as e:
            current_app.logger.warning(f"INVOICE STEP 1 ERROR: {e}", exc_info=True)
    else:
        current_app.logger.info("INVOICE STEP 1: no file_data, skipping upload")

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
    if uploaded_file_id:
        invoice_fields['fileIds'] = [uploaded_file_id]

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
    current_app.logger.info(f"INVOICE STEP 2 OK: invoice_id={new_invoice_id}")

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
            'product_added': False,
            'file_uploaded': uploaded_file_id is not None
        }

    current_app.logger.info(f"INVOICE STEP 3 OK: product added to invoice #{new_invoice_id}")
    return {
        'success': True,
        'invoice_id': new_invoice_id,
        'product_added': True,
        'file_uploaded': uploaded_file_id is not None
    }