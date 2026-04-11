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
        try:
            cursor.execute("ALTER TABLE `expenses` ADD COLUMN `category_val` VARCHAR(255) DEFAULT NULL AFTER `category`")
            logger.info("Column 'category_val' added to 'expenses' table.")
        except mysql.connector.Error as alter_err:
            if alter_err.errno == errorcode.ER_DUP_FIELDNAME:
                logger.info("Column 'category_val' already exists in 'expenses' table.")
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
        logger.info("Table 'expenses' is ready.")
    except mysql.connector.Error as err:
        if err.errno != errorcode.ER_TABLE_EXISTS_ERROR:
             logger.error(f"Error initializing 'expenses' table: {err.msg}")

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `access_rights` (
              `id` INT AUTO_INCREMENT PRIMARY KEY, `entity_id` VARCHAR(50) NOT NULL UNIQUE, `entity_type` VARCHAR(20) NOT NULL,
              `entity_name` VARCHAR(255) NOT NULL, `permissions` JSON NOT NULL
            ) ENGINE=InnoDB
        """)
        logger.info("Table 'access_rights' is ready.")
    except mysql.connector.Error as err:
        logger.error(f"Error initializing 'access_rights' table: {err.msg}")
    
    finally:
        cursor.close()
        conn.close()
