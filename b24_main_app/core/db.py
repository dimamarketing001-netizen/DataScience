import mysql.connector
from mysql.connector import errorcode
import logging

# --- MySQL Database Configuration ---
DB_CONFIG = {
    'host': '5.141.91.138',
    'port': 3001,
    'user': 'dima',
    'password': 'vRZVgh6c@@.',
    'database': 'b24_data'
}

# Настройка логгера для этого модуля
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

def get_db_connection():
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        return conn
    except mysql.connector.Error as err:
        logger.error(f"Error connecting to MySQL: {err}")
        return None

def init_db():
    conn = get_db_connection()
    if not conn:
        logger.error("Could not connect to the database to initialize it.")
        return
    cursor = conn.cursor()
    
    try:
        # --- Инициализация таблицы расходов ---
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `expenses` (
              `id` int(11) NOT NULL AUTO_INCREMENT, `expense_date` date NOT NULL, `amount` decimal(10, 2) NOT NULL,
              `category` varchar(255) DEFAULT NULL, `category_val` varchar(255) DEFAULT NULL, `employee_id` varchar(50) DEFAULT NULL,
              `source_id` varchar(50) DEFAULT NULL, `contact_id` varchar(50) DEFAULT NULL, `comment` text,
              `paid_leads` INT DEFAULT NULL, `free_leads` INT DEFAULT NULL,
              `added_by_user_id` varchar(50) DEFAULT NULL, `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (`id`)
            ) ENGINE=InnoDB
        """)
        logger.info("Table 'expenses' is ready.")

        # --- Инициализация таблицы приходов ---
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS `incomes`
                       (
                           `id`
                           int
                       (
                           11
                       ) NOT NULL AUTO_INCREMENT,
                           `income_date` date NOT NULL,
                           `amount` decimal
                       (
                           10,
                           2
                       ) NOT NULL,
                           `contact_id` varchar
                       (
                           50
                       ) DEFAULT NULL,
                           `deal_id` varchar
                       (
                           50
                       ) DEFAULT NULL,
                           `deal_type_id` varchar
                       (
                           100
                       ) DEFAULT NULL,
                           `deal_type_name` varchar
                       (
                           255
                       ) DEFAULT NULL,
                           `comment` text,
                           `added_by_user_id` varchar
                       (
                           50
                       ) DEFAULT NULL,
                           `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
                           PRIMARY KEY
                       (
                           `id`
                       )
                           ) ENGINE=InnoDB
                       """)
        logger.info("Table 'incomes' is ready.")

        # Для уже существующей БД — добавляем столбцы если их нет
        for col_sql in [
            "ALTER TABLE `incomes` ADD COLUMN `deal_type_id` varchar(100) DEFAULT NULL",
            "ALTER TABLE `incomes` ADD COLUMN `deal_type_name` varchar(255) DEFAULT NULL",
            "ALTER TABLE `incomes` ADD COLUMN `b24_invoice_id` varchar(50) DEFAULT NULL",
            "ALTER TABLE `incomes` ADD COLUMN `b24_file_id` varchar(50) DEFAULT NULL",
            "ALTER TABLE `incomes` ADD COLUMN `b24_file_url` text DEFAULT NULL",
            "ALTER TABLE `incomes` MODIFY COLUMN `b24_file_id` varchar(50) DEFAULT NULL",
            "ALTER TABLE `incomes` ADD COLUMN `is_confirmed` TINYINT(1) DEFAULT 0 NOT NULL",
        ]:
            try:
                cursor.execute(col_sql)
                logger.info(f"Column added: {col_sql}")
            except mysql.connector.Error as e:
                if e.errno == 1060:  # Duplicate column — уже есть, пропускаем
                    pass
                else:
                    raise

        # --- Инициализация таблицы прав доступа ---
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `access_rights` (
              `id` INT AUTO_INCREMENT PRIMARY KEY, `entity_id` VARCHAR(50) NOT NULL UNIQUE, `entity_type` VARCHAR(20) NOT NULL,
              `entity_name` VARCHAR(255) NOT NULL, `permissions` JSON NOT NULL
            ) ENGINE=InnoDB
        """)
        logger.info("Table 'access_rights' is ready.")

    except mysql.connector.Error as err:
        logger.error(f"Error during DB initialization: {err.msg}")
    
    finally:
        cursor.close()
        conn.close()
