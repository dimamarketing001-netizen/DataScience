import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
    port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

/**
 * Найти пользователя по max_user_id
 */
export async function findUserByMaxId(maxUserId) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE max_user_id = ?',
    [maxUserId]
  );
  return rows[0] || null;
}

/**
 * Сохранить пользователя в БД
 */
export async function saveUser({ maxUserId, bitrixContactId, bitrixLeadId, phone }) {
  await pool.execute(
    `INSERT INTO users (max_user_id, bitrix_contact_id, bitrix_lead_id, phone)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       bitrix_contact_id = VALUES(bitrix_contact_id),
       bitrix_lead_id = VALUES(bitrix_lead_id),
       phone = VALUES(phone),
       updated_at = CURRENT_TIMESTAMP`,
    [maxUserId, bitrixContactId || null, bitrixLeadId || null, phone]
  );
}

export default pool;