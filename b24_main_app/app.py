from flask import Flask, request, jsonify, render_template
import requests
import logging
import json
import mysql.connector
from mysql.connector import errorcode
from functools import wraps

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/"

# --- MySQL Database Configuration ---
DB_CONFIG = {
    'host': '5.141.91.138',
    'port': 3001,
    'user': 'dima',
    'password': 'vRZVgh6c@@.',
    'database': 'b24_data'
}

logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

B24_ENTITY_CACHE = {}


# --- Database Functions ---
def get_db_connection():
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        return conn
    except mysql.connector.Error as err:
        app.logger.error(f"Error connecting to MySQL: {err}")
        return None


def init_db():
    conn = get_db_connection()
    if not conn:
        app.logger.error("Could not connect to the database to initialize it.")
        return
    cursor = conn.cursor()
    
    try:
        try:
            cursor.execute("ALTER TABLE `expenses` ADD COLUMN `category_val` VARCHAR(255) DEFAULT NULL AFTER `category`")
            app.logger.info("Column 'category_val' added to 'expenses' table.")
        except mysql.connector.Error as alter_err:
            if alter_err.errno == errorcode.ER_DUP_FIELDNAME:
                app.logger.info("Column 'category_val' already exists in 'expenses' table.")
            else:
                raise alter_err

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `expenses` (
              `id` int(11) NOT NULL AUTO_INCREMENT, `name` varchar(255) NOT NULL, `expense_date` date NOT NULL, `amount` decimal(10, 2) NOT NULL,
              `category` varchar(255) DEFAULT NULL, `category_val` varchar(255) DEFAULT NULL, `employee_id` varchar(50) DEFAULT NULL,
              `source_id` varchar(50) DEFAULT NULL, `contact_id` varchar(50) DEFAULT NULL, `comment` text,
              `added_by_user_id` varchar(50) DEFAULT NULL, `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (`id`)
            ) ENGINE=InnoDB
        """)
        app.logger.info("Table 'expenses' is ready.")
    except mysql.connector.Error as err:
        if err.errno != errorcode.ER_TABLE_EXISTS_ERROR:
             app.logger.error(f"Error initializing 'expenses' table: {err.msg}")

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `access_rights` (
              `id` INT AUTO_INCREMENT PRIMARY KEY, `entity_id` VARCHAR(50) NOT NULL UNIQUE, `entity_type` VARCHAR(20) NOT NULL,
              `entity_name` VARCHAR(255) NOT NULL, `permissions` JSON NOT NULL
            ) ENGINE=InnoDB
        """)
        app.logger.info("Table 'access_rights' is ready.")
    except mysql.connector.Error as err:
        app.logger.error(f"Error initializing 'access_rights' table: {err.msg}")
    
    finally:
        cursor.close()
        conn.close()


# --- Вспомогательные функции ---
def b24_call_method(method, params={}):
    try:
        url = B24_WEBHOOK_URL + method
        response = requests.post(url, json=params)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        app.logger.error(f"Ошибка в b24_call_method для {method}: {e}", exc_info=True)
        return None


def _get_b24_entity_name(entity_type, entity_id):
    if not entity_id: return None
    cache_key = f"{entity_type}_{entity_id}"
    if cache_key in B24_ENTITY_CACHE: return B24_ENTITY_CACHE[cache_key]
    
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
            response = b24_call_method('crm.status.list', {'filter[ENTITY_ID]': 'SOURCE'})
            if response and response.get('result'):
                for source in response['result']:
                    if source['STATUS_ID'] == entity_id:
                        name = source['NAME']
                        break
    except Exception as e:
        app.logger.warning(f"Не удалось получить имя для {entity_type} с ID {entity_id}: {e}")

    if name:
        B24_ENTITY_CACHE[cache_key] = name
    else:
        name = f"Неизвестно ({entity_id})"
        B24_ENTITY_CACHE[cache_key] = name
    return name


# --- API Функции (внутренние) ---

def get_initial_data_for_access():
    batch_payload = {
        'halt': 0,
        'cmd': { 'users': 'user.get?filter[ACTIVE]=Y&admin=false', 'departments': 'department.get' }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        result = response['result']['result']
        users = [{'id': f"user_{user['ID']}", 'name': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in result.get('users', [])]
        departments = [{'id': f"department_{dep['ID']}", 'name': dep['NAME']} for dep in result.get('departments', [])]
        return jsonify({'users': users, 'departments': departments})
    return jsonify({'error': 'Не удалось загрузить начальные данные для доступов'}), 500


def handle_access_rights():
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'DB connection failed'}), 500
    cursor = conn.cursor(dictionary=True)

    if request.method == 'GET':
        try:
            cursor.execute("SELECT entity_id, entity_type, entity_name, permissions FROM access_rights")
            rights = cursor.fetchall()
            for right in rights:
                if isinstance(right['permissions'], str):
                    right['permissions'] = json.loads(right['permissions'])
            return jsonify(rights)
        except mysql.connector.Error as err:
            return jsonify({'error': str(err)}), 500
        finally:
            cursor.close()
            conn.close()

    if request.method == 'POST':
        data = request.get_json()
        try:
            entity_id = data['entity_id']
            entity_type = 'user' if 'user_' in entity_id else 'department'
            query = "INSERT INTO access_rights (entity_id, entity_type, entity_name, permissions) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), entity_name = VALUES(entity_name)"
            params = (entity_id, entity_type, data['entity_name'], json.dumps(data['permissions']))
            cursor.execute(query, params)
            conn.commit()
            return jsonify({'success': True})
        except mysql.connector.Error as err:
            conn.rollback()
            return jsonify({'error': str(err)}), 500
        finally:
            cursor.close()
            conn.close()


def get_my_permissions():
    user_id = request.args.get('user_id')
    department_id = request.args.get('department_id')
    if not user_id: return jsonify({'error': 'user_id is required'}), 400

    conn = get_db_connection()
    if not conn: return jsonify({'error': 'DB connection failed'}), 500
    cursor = conn.cursor(dictionary=True)

    try:
        final_permissions = {
            "can_access_app": False, "tabs": {"cashbox": False, "statistics": False, "access": False},
            "actions": {"can_save": False, "can_delete": False}
        }
        entities_to_check = [f"user_{user_id}"]
        if department_id: entities_to_check.append(f"department_{department_id}")
        
        query = "SELECT permissions FROM access_rights WHERE entity_id IN ({})".format(', '.join(['%s'] * len(entities_to_check)))
        cursor.execute(query, entities_to_check)
        
        for row in cursor.fetchall():
            perms = json.loads(row['permissions']) if isinstance(row['permissions'], str) else row['permissions']
            if perms.get('can_access_app'): final_permissions['can_access_app'] = True
            for tab, access in perms.get('tabs', {}).items():
                if access: final_permissions['tabs'][tab] = True
            for action, access in perms.get('actions', {}).items():
                if access: final_permissions['actions'][action] = True
        
        return jsonify(final_permissions)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()


def get_cashbox_initial_data():
    batch_payload = {
        'halt': 0,
        'cmd': { 'users': 'user.get?filter[ACTIVE]=Y&admin=false', 'sources': 'crm.status.list?filter[ENTITY_ID]=SOURCE' }
    }
    response = b24_call_method('batch', batch_payload)
    if response and response.get('result', {}).get('result'):
        result = response['result']['result']
        users = [{'ID': user['ID'], 'NAME': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in result.get('users', [])]
        sources = [{'ID': source['STATUS_ID'], 'NAME': source['NAME']} for source in result.get('sources', [])]
        return jsonify({'users': users, 'sources': sources})
    return jsonify({'error': 'Не удалось загрузить начальные данные для кассы'}), 500


def search_contacts():
    query = request.args.get('query', '')
    if not query: return jsonify([])
    response = b24_call_method('crm.contact.list', {'filter': {'LOGIC': 'OR', '%NAME': query, '%LAST_NAME': query}, 'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME'], 'limit': 10})
    if response and response.get('result'):
        contacts = [{'ID': contact['ID'], 'NAME': f"{contact.get('LAST_NAME', '')} {contact.get('NAME', '')} {contact.get('SECOND_NAME', '')}".strip()} for contact in response['result']]
        return jsonify(contacts)
    return jsonify([])


def add_expense():
    data = request.get_json()
    app.logger.info(f"Попытка сохранения расхода... ID юзера: {data.get('added_by_user_id')}, Данные: {json.dumps(data, ensure_ascii=False)}")
    
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500
    cursor = conn.cursor()
    query = "INSERT INTO expenses (name, expense_date, amount, category, category_val, employee_id, source_id, contact_id, comment, added_by_user_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    values = (
        data.get('name'), data.get('date'), data.get('amount'), data.get('category_text'), data.get('category_val'), data.get('employee_id'),
        data.get('contractor_id'), data.get('client_id'), data.get('comment'), data.get('added_by_user_id')
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
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'Не удалось подключиться к базе данных'}), 500
    cursor = conn.cursor(dictionary=True)

    where_clauses, query_params = [], {}
    if request.args.get('category'): where_clauses.append("`category` = %(category)s"); query_params['category'] = request.args.get('category')
    if request.args.get('employee_id'): where_clauses.append("`employee_id` = %(employee_id)s"); query_params['employee_id'] = request.args.get('employee_id')
    if request.args.get('source_id'): where_clauses.append("`source_id` = %(source_id)s"); query_params['source_id'] = request.args.get('source_id')
    if request.args.get('start_date'): where_clauses.append("`expense_date` >= %(start_date)s"); query_params['start_date'] = request.args.get('start_date')
    if request.args.get('end_date'): where_clauses.append("`expense_date` <= %(end_date)s"); query_params['end_date'] = request.args.get('end_date')

    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    limit = request.args.get('limit', 25, type=int)
    offset = request.args.get('offset', 0, type=int)

    try:
        cursor.execute(f"SELECT COUNT(*) FROM expenses {where_sql}", query_params)
        total_records = cursor.fetchone()['COUNT(*)']
        
        query_params.update({'limit': limit, 'offset': offset})
        cursor.execute(f"SELECT * FROM expenses {where_sql} ORDER BY created_at DESC LIMIT %(limit)s OFFSET %(offset)s", query_params)
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

# --- Главный маршрутизатор ---
@app.route('/api', methods=['GET', 'POST'])
def api_router():
    action = request.args.get('action')
    
    api_actions = {
        'my_permissions': get_my_permissions,
        'initial_data_for_access': get_initial_data_for_access,
        'access_rights': handle_access_rights,
        'cashbox_initial_data': get_cashbox_initial_data,
        'search_contacts': search_contacts,
        'add_expense': add_expense,
        'expenses': get_expenses,
    }

    if action in api_actions:
        return api_actions[action]()
    
    return jsonify({'error': f'Action "{action}" not found'}), 404

# --- Главный маршрут для отображения страницы ---
@app.route('/', methods=['GET', 'POST'])
def index():
    return render_template('index.html')


if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(debug=True, port=5002)