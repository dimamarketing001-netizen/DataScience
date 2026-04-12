from flask import Blueprint, request, jsonify, current_app
import json
import mysql.connector

from core.db import get_db_connection

# Blueprint для API, связанного с правами доступа
access_api = Blueprint('api_access', __name__)

def get_my_permissions():
    """
    Определяет и возвращает права доступа для текущего пользователя,
    основываясь на его ID и ID отдела.
    """
    try:
        user_id = request.args.get('user_id')
        department_id = request.args.get('department_id')

        if not user_id:
            return jsonify({'error': 'user_id is required'}), 400
        if department_id == 'undefined' or department_id is None:
            department_id = None

        conn = get_db_connection()
        if not conn:
            return jsonify({'error': 'DB connection failed'}), 500
        cursor = conn.cursor(dictionary=True)

        try:
            final_permissions = {
                "can_access_app": False,
                "tabs": {"cashbox": False, "statistics": False, "access": False},
                "actions": {"can_save": False, "can_delete": False}
            }
            entities_to_check = [f"user_{user_id}"]
            if department_id:
                entities_to_check.append(f"department_{department_id}")
            
            query_placeholders = ', '.join(['%s'] * len(entities_to_check))
            query = f"SELECT permissions FROM access_rights WHERE entity_id IN ({query_placeholders})"
            cursor.execute(query, tuple(entities_to_check))
            
            for row in cursor.fetchall():
                perms = json.loads(row['permissions']) if isinstance(row['permissions'], str) else row['permissions']
                if perms.get('can_access_app'):
                    final_permissions['can_access_app'] = True
                for tab, access in perms.get('tabs', {}).items():
                    if access:
                        final_permissions['tabs'][tab] = True
                for action, access in perms.get('actions', {}).items():
                    if access:
                        final_permissions['actions'][action] = True
            
            return jsonify(final_permissions)
        finally:
            if conn and conn.is_connected():
                cursor.close()
                conn.close()
    except Exception as e:
        current_app.logger.error(f"Error in get_my_permissions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def handle_access_rights():
    """Обрабатывает GET (чтение), POST (создание/обновление) и DELETE (удаление) прав доступа."""
    conn = get_db_connection()
    if not conn: return jsonify({'error': 'DB connection failed'}), 500
    cursor = conn.cursor(dictionary=True)

    try:
        if request.method == 'GET':
            cursor.execute("SELECT entity_id, entity_type, entity_name, permissions FROM access_rights")
            rights = cursor.fetchall()
            for right in rights:
                if isinstance(right['permissions'], str):
                    right['permissions'] = json.loads(right['permissions'])
            return jsonify(rights)

        if request.method == 'POST':
            data = request.get_json()
            entity_id = data.get('entity_id')

            # Проверяем, является ли это запросом на удаление
            if data.get('sub_action') == 'delete':
                if not entity_id:
                    return jsonify({'error': 'entity_id is required for deletion'}), 400
                
                query = "DELETE FROM access_rights WHERE entity_id = %s"
                cursor.execute(query, (entity_id,))
                conn.commit()
                
                if cursor.rowcount > 0:
                    return jsonify({'success': True, 'message': 'Rule deleted'})
                else:
                    # Это не ошибка, просто правило могло быть уже удалено
                    return jsonify({'success': True, 'message': 'Rule not found or already deleted'})

            # Если не удаление, то это создание/обновление
            entity_type = 'user' if 'user_' in entity_id else 'department'
            query = "INSERT INTO access_rights (entity_id, entity_type, entity_name, permissions) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), entity_name = VALUES(entity_name)"
            params = (entity_id, entity_type, data['entity_name'], json.dumps(data['permissions']))
            cursor.execute(query, params)
            conn.commit()
            return jsonify({'success': True, 'message': 'Rule saved'})
            
    except mysql.connector.Error as err:
        current_app.logger.error(f"Database error in handle_access_rights: {err}")
        if conn and conn.is_connected():
            conn.rollback()
        return jsonify({'error': str(err)}), 500
    except Exception as e:
        current_app.logger.error(f"General error in handle_access_rights: {e}")
        if conn and conn.is_connected():
            conn.rollback()
        return jsonify({'error': 'An internal error occurred'}), 500
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()
    
    return jsonify({'error': 'Invalid request method'}), 405
