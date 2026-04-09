from flask import Flask, request, jsonify, render_template
import requests
import logging
import json
import mysql.connector
from mysql.connector import errorcode

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/"

# --- MySQL Database Configuration ---
DB_CONFIG = {
    'host': '192.168.136.106', # Your WSL IP Address
    'user': 'dima',
    'password': 'vRZVgh6c@@',
    'database': 'b24_data' # The database you created
}

# Настройка логирования
logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

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
    """Creates the expenses table if it doesn't exist."""
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
        app.logger.info(f"Вызов метода: {method} с параметрами: {json.dumps(params, ensure_ascii=False)}")
        response = requests.post(url, json=params)
        app.logger.info(f"Ответ от Битрикс24 (статус {response.status_code}): {response.text}")
        response.raise_for_status()
        return response.json()
    except Exception as e:
        app.logger.error(f"Ошибка в b24_call_method для {method}: {e}", exc_info=True)
        return None

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
        users = [{'ID': user['ID'], 'NAME': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in result.get('users', [])]
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
    response = b24_call_method('crm.contact.list', {'filter': {'LOGIC': 'OR', '%NAME': query, '%LAST_NAME': query}, 'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME'], 'limit': 10})
    if response and response.get('result'):
        contacts = [{'ID': contact['ID'], 'NAME': f"{contact.get('LAST_NAME', '')} {contact.get('NAME', '')} {contact.get('SECOND_NAME', '')}".strip()} for contact in response['result']]
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
        "(name, expense_date, amount, category, employee_id, source_id, contact_id, comment) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
    )
    values = (
        data.get('name'),
        data.get('date'),
        data.get('amount'),
        data.get('category_text'),
        data.get('employee_id'),
        data.get('contractor_id'), # Assuming contractor_id is the source_id
        data.get('client_id'),
        data.get('comment')
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

# --- Главный маршрут ---
@app.route('/', methods=['GET', 'POST'])
def index():
    """Отображает главную страницу приложения."""
    if request.method == 'POST':
        app.logger.info(f"Приложение открыто из Битрикс24 с данными: {request.form.to_dict()}")
    return render_template('index.html')

if __name__ == '__main__':
    with app.app_context():
        init_db() # Create the table on startup
    app.run(debug=True, port=5002)
