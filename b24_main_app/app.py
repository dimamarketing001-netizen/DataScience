from flask import Flask, request, jsonify, render_template
import requests
import logging
import json
import mysql.connector
from mysql.connector import errorcode
from functools import lru_cache  # Для кэширования, хотя B24_ENTITY_CACHE будет ручным

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/"

# --- MySQL Database Configuration ---
DB_CONFIG = {
    'host': '5.141.91.138',  # Your WSL IP Address
    'port': 3001,
    'user': 'dima',
    'password': 'vRZVgh6c@@.',
    'database': 'b24_data'  # The database you created
}

# Настройка логирования
logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

# Глобальный кэш для имен сущностей Битрикс24
B24_ENTITY_CACHE = {}


# --- Database Functions ---
def get_db_connection():
    """Establishes a connection to the MySQL database."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        app.logger.info("Successfully connected to the database.")
        return conn
    except mysql.connector.Error as err:
        app.logger.error(f"Error connecting to MySQL: {err}")
        return None


def init_db():
    """Creates the expenses table if it doesn't exist and adds missing columns."""
    conn = get_db_connection()
    if not conn:
        app.logger.error("Could not connect to the database to initialize it.")
        return

    cursor = conn.cursor()
    table_name = 'expenses'
    table_description = (
        f"CREATE TABLE `{table_name}` ("
        "  `id` int(11) NOT NULL AUTO_INCREMENT,"
        "  `name` varchar(255) NOT NULL,"
        "  `expense_date` date NOT NULL,"
        "  `amount` decimal(10, 2) NOT NULL,"
        "  `category` varchar(255) DEFAULT NULL,"
        "  `employee_id` varchar(50) DEFAULT NULL,"
        "  `source_id` varchar(50) DEFAULT NULL,"
        "  `contact_id` varchar(50) DEFAULT NULL,"
        "  `comment` text,"
        "  `added_by_user_id` varchar(50) DEFAULT NULL,"  # Новая колонка
        "  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,"
        "  PRIMARY KEY (`id`)"
        ") ENGINE=InnoDB")

    try:
        app.logger.info(f"Creating table '{table_name}'...")
        cursor.execute(table_description)
        app.logger.info(f"Table '{table_name}' created successfully.")
    except mysql.connector.Error as err:
        if err.errno == errorcode.ER_TABLE_EXISTS_ERROR:
            app.logger.info(f"Table '{table_name}' already exists.")
            # Проверяем наличие новой колонки и добавляем, если ее нет
            try:
                cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `added_by_user_id` VARCHAR(50) DEFAULT NULL")
                app.logger.info(f"Column 'added_by_user_id' added to table '{table_name}'.")
            except mysql.connector.Error as alter_err:
                if alter_err.errno == errorcode.ER_DUP_FIELDNAME:
                    app.logger.info(f"Column 'added_by_user_id' already exists in table '{table_name}'.")
                else:
                    app.logger.error(f"Error altering table '{table_name}': {alter_err.msg}")
        else:
            app.logger.error(err.msg)
    finally:
        cursor.close()
        conn.close()


# --- Вспомогательные функции ---
def b24_call_method(method, params={}):
    """Универсальная функция для вызова методов REST API (for non-list methods)."""
    try:
        url = B24_WEBHOOK_URL + method
        # app.logger.info(f"Вызов метода: {method} с параметрами: {json.dumps(params, ensure_ascii=False)}") # Закомментировано для уменьшения логов
        response = requests.post(url, json=params)
        # app.logger.info(f"Ответ от Битрикс24 (статус {response.status_code}): {response.text}") # Закомментировано для уменьшения логов
        response.raise_for_status()
        return response.json()
    except Exception as e:
        app.logger.error(f"Ошибка в b24_call_method для {method}: {e}", exc_info=True)
        return None


def _get_b24_entity_name(entity_type, entity_id):
    """
    Получает имя сущности Битрикс24 (пользователь, контакт, источник) по ID.
    Использует кэш для уменьшения запросов к API.
    """
    if not entity_id:
        return None

    cache_key = f"{entity_type}_{entity_id}"
    if cache_key in B24_ENTITY_CACHE:
        return B24_ENTITY_CACHE[cache_key]

    name = None
    try:
        if entity_type == 'user':
            response = b24_call_method('user.get', {'ID': entity_id})
            if response and response.get('result'):
                user = response['result'][0]
                name = f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()
        elif entity_type == 'contact':
            response = b24_call_method('crm.contact.get', {'ID': entity_id})
            if response and response.get('result'):
                contact = response['result']
                name = f"{contact.get('LAST_NAME', '')} {contact.get('NAME', '')}".strip()
        elif entity_type == 'source':
            # Источники получаем списком, так как crm.status.get не существует
            response = b24_call_method('crm.status.list', {'filter[ENTITY_ID]': 'SOURCE'})
            if response and response.get('result'):
                for source in response['result']:
                    if source['STATUS_ID'] == entity_id:
                        name = source['NAME']
                        break
        # Добавьте другие типы сущностей по мере необходимости

    except Exception as e:
        app.logger.warning(f"Не удалось получить имя для {entity_type} с ID {entity_id} из Битрикс24: {e}")

    if name:
        B24_ENTITY_CACHE[cache_key] = name
    else:
        name = f"Неизвестно ({entity_id})"  # Fallback name
        B24_ENTITY_CACHE[cache_key] = name  # Кэшируем даже неизвестные, чтобы не повторять запросы
    return name


# --- Маршруты API ---
@app.route('/api/cashbox_initial_data', methods=['GET'])
def get_cashbox_initial_data():
    """Загружает списки сотрудников и источников из B24."""
    batch_payload = {
        'halt': 0,
        'cmd': {
            'users': 'user.get?filter[ACTIVE]=Y&admin=false',
            'sources': 'crm.status.list?filter[ENTITY_ID]=SOURCE',
        }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        result = response['result']['result']
        users = [{'ID': user['ID'], 'NAME': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in
                 result.get('users', [])]
        sources = [{'ID': source['STATUS_ID'], 'NAME': source['NAME']} for source in result.get('sources', [])]
        return jsonify({'users': users, 'sources': sources, 'categories': []})
    return jsonify({'error': 'Не удалось загрузить начальные данные для кассы'}), 500


@app.route('/api/search_contacts', methods=['GET'])
def search_contacts():
    """Ищет контакты по имени или фамилии в B24."""
    query = request.args.get('query', '')
    if not query:
        return jsonify([])
    # This part still uses Bitrix24 API, which is fine.
    response = b24_call_method('crm.contact.list', {'filter': {'LOGIC': 'OR', '%NAME': query, '%LAST_NAME': query},
                                                    'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME'], 'limit': 10})
    if response and response.get('result'):
        contacts = [{'ID': contact['ID'],
                     'NAME': f"{contact.get('LAST_NAME', '')} {contact.get('NAME', '')} {contact.get('SECOND_NAME', '')}".strip()}
                    for contact in response['result']]
        return jsonify(contacts)
    return jsonify([])


@app.route('/api/add_expense', methods=['POST'])
def add_expense():
    """Добавляет расход в локальную базу данных MySQL."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных для сохранения'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500

    cursor = conn.cursor()
    query = (
        "INSERT INTO expenses "
        "(name, expense_date, amount, category, employee_id, source_id, contact_id, comment, added_by_user_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
    )
    values = (
        data.get('name'),
        data.get('date'),
        data.get('amount'),
        data.get('category_text'),
        data.get('employee_id'),
        data.get('contractor_id'),  # Assuming contractor_id is the source_id
        data.get('client_id'),
        data.get('comment'),
        data.get('added_by_user_id')  # Получаем ID пользователя из фронтенда
    )

    try:
        cursor.execute(query, values)
        conn.commit()
        expense_id = cursor.lastrowid
        app.logger.info(f"Расход успешно добавлен в БД, ID: {expense_id}")
        return jsonify({'success': True, 'id': expense_id})
    except mysql.connector.Error as err:
        app.logger.error(f"Ошибка при добавлении расхода в БД: {err}")
        conn.rollback()
        return jsonify({'success': False, 'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()


# --- Новые маршруты для управления расходами ---

@app.route('/api/expenses', methods=['GET'])
def get_expenses():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500

    cursor = conn.cursor(dictionary=True)  # Return results as dictionaries

    # Build WHERE clause for filtering
    where_clauses = []
    query_params = {}

    # Text fields
    for field in ['name', 'category', 'comment']:
        value = request.args.get(field)
        if value:
            where_clauses.append(f"`{field}` LIKE %({field})s")
            query_params[field] = f"%{value}%"

    # ID fields (employee, source, contact, added_by_user_id)
    # Note: employee_id, source_id, contact_id are stored as strings in DB, so direct comparison is fine
    for field in ['employee_id', 'source_id', 'contact_id', 'added_by_user_id']:
        value = request.args.get(field)
        if value:
            where_clauses.append(f"`{field}` = %({field})s")
            query_params[field] = value

    # Date range
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    if start_date:
        where_clauses.append("`expense_date` >= %(start_date)s")
        query_params['start_date'] = start_date
    if end_date:
        where_clauses.append("`expense_date` <= %(end_date)s")
        query_params['end_date'] = end_date

    # Amount range
    min_amount = request.args.get('min_amount')
    max_amount = request.args.get('max_amount')
    if min_amount:
        where_clauses.append("`amount` >= %(min_amount)s")
        query_params['min_amount'] = float(min_amount)
    if max_amount:
        where_clauses.append("`amount` <= %(max_amount)s")
        query_params['max_amount'] = float(max_amount)

    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    # Pagination
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', type=int, default=0)

    # Default limits based on requirements
    has_filters = bool(where_clauses)
    if limit is None:
        if has_filters:
            limit = 25  # If filters are applied, show last 25
        else:
            limit = 50  # If no filters, show last 50

    order_by = "ORDER BY `created_at` DESC"  # Always order by creation date descending

    try:
        # Get total records for pagination info
        count_query = f"SELECT COUNT(*) FROM expenses {where_sql}"
        cursor.execute(count_query, query_params)
        total_records = cursor.fetchone()['COUNT(*)']

        # Get expenses with limit and offset
        select_query = f"SELECT * FROM expenses {where_sql} {order_by} LIMIT %(limit)s OFFSET %(offset)s"
        query_params['limit'] = limit
        query_params['offset'] = offset

        cursor.execute(select_query, query_params)
        expenses = cursor.fetchall()

        # Resolve B24 entity names for display
        for expense in expenses:
            expense['employee_name'] = _get_b24_entity_name('user', expense['employee_id'])
            expense['source_name'] = _get_b24_entity_name('source', expense['source_id'])
            expense['contact_name'] = _get_b24_entity_name('contact', expense['contact_id'])
            expense['added_by_user_name'] = _get_b24_entity_name('user', expense['added_by_user_id'])
            # Format date for consistency
            expense['expense_date'] = expense['expense_date'].isoformat() if expense['expense_date'] else None
            expense['created_at'] = expense['created_at'].isoformat() if expense['created_at'] else None

        return jsonify({
            'expenses': expenses,
            'total_records': total_records,
            'limit': limit,
            'offset': offset
        })

    except mysql.connector.Error as err:
        app.logger.error(f"Ошибка при получении расходов из БД: {err}")
        return jsonify({'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()


# GET single expense by ID
@app.route('/api/expenses/<int:expense_id>', methods=['GET'])
def get_single_expense(expense_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500

    cursor = conn.cursor(dictionary=True)
    try:
        query = "SELECT * FROM expenses WHERE id = %s"
        cursor.execute(query, (expense_id,))
        expense = cursor.fetchone()

        if not expense:
            return jsonify({'error': 'Запись не найдена'}), 404

        # Resolve B24 entity names
        expense['employee_name'] = _get_b24_entity_name('user', expense['employee_id'])
        expense['source_name'] = _get_b24_entity_name('source', expense['source_id'])
        expense['contact_name'] = _get_b24_entity_name('contact', expense['contact_id'])
        expense['added_by_user_name'] = _get_b24_entity_name('user', expense['added_by_user_id'])
        # Format date for consistency
        expense['expense_date'] = expense['expense_date'].isoformat() if expense['expense_date'] else None
        expense['created_at'] = expense['created_at'].isoformat() if expense['created_at'] else None

        return jsonify(expense)

    except mysql.connector.Error as err:
        app.logger.error(f"Ошибка при получении расхода из БД: {err}")
        return jsonify({'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()


# PUT update expense by ID
@app.route('/api/expenses/<int:expense_id>', methods=['PUT'])
def update_expense(expense_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных для обновления'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500

    cursor = conn.cursor()
    try:
        # Construct SET clause dynamically
        set_clauses = []
        update_params = {}

        # Map incoming data keys to database column names
        field_mapping = {
            'name': 'name',
            'date': 'expense_date',
            'amount': 'amount',
            'category_text': 'category',
            'employee_id': 'employee_id',
            'contractor_id': 'source_id',  # Assuming contractor_id is source_id
            'client_id': 'contact_id',
            'comment': 'comment',
            # 'added_by_user_id' is not updated via PUT, it's set on creation
        }

        for key, db_column in field_mapping.items():
            if key in data:
                set_clauses.append(f"`{db_column}` = %({db_column})s")
                update_params[db_column] = data[key]

        if not set_clauses:
            return jsonify({'error': 'Нет полей для обновления'}), 400

        query = f"UPDATE expenses SET {', '.join(set_clauses)} WHERE id = %(id)s"
        update_params['id'] = expense_id

        cursor.execute(query, update_params)
        conn.commit()

        if cursor.rowcount == 0:
            return jsonify({'error': 'Запись не найдена или данные не изменились'}), 404

        app.logger.info(f"Расход с ID {expense_id} успешно обновлен.")
        return jsonify({'success': True, 'id': expense_id})

    except mysql.connector.Error as err:
        app.logger.error(f"Ошибка при обновлении расхода в БД: {err}")
        conn.rollback()
        return jsonify({'success': False, 'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()


# DELETE expense by ID
@app.route('/api/expenses/<int:expense_id>', methods=['DELETE'])
def delete_expense(expense_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500

    cursor = conn.cursor()
    try:
        query = "DELETE FROM expenses WHERE id = %s"
        cursor.execute(query, (expense_id,))
        conn.commit()

        if cursor.rowcount == 0:
            return jsonify({'error': 'Запись не найдена'}), 404

        app.logger.info(f"Расход с ID {expense_id} успешно удален.")
        return jsonify({'success': True})

    except mysql.connector.Error as err:
        app.logger.error(f"Ошибка при удалении расхода из БД: {err}")
        conn.rollback()
        return jsonify({'success': False, 'error': str(err)}), 500
    finally:
        cursor.close()
        conn.close()


# --- Главный маршрут ---
@app.route('/', methods=['GET', 'POST'])
def index():
    """Отображает главную страницу приложения."""
    member_id = None
    if request.method == 'POST':
        app.logger.info(f"Приложение открыто из Битрикс24 с данными: {request.form.to_dict()}")
        member_id = request.form.get('member_id')  # Получаем member_id из данных Битрикс24
    return render_template('index.html', member_id=member_id)


if __name__ == '__main__':
    with app.app_context():
        init_db()  # Create the table on startup
    app.run(debug=True, port=5002)