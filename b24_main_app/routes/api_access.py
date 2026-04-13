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
    Складывает права из нескольких правил (например, личные и по отделу).
    Обеспечивает обратную совместимость со старой структурой прав.
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
            # Новая структура прав по умолчанию, включающая 'edit'
            final_permissions = {
                "tabs": {
                    "cashbox": {"view": False, "save": False, "edit": False, "delete": False},
                    "statistics": {"view": False},
                    "access": {"view": False, "save": False, "delete": False}
                }
            }
            
            entities_to_check = [f"user_{user_id}"]
            if department_id:
                entities_to_check.append(f"department_{department_id}")
            
            query_placeholders = ', '.join(['%s'] * len(entities_to_check))
            query = f"SELECT permissions FROM access_rights WHERE entity_id IN ({query_placeholders})"
            cursor.execute(query, tuple(entities_to_check))
            
            all_perms = [json.loads(row['permissions']) if isinstance(row['permissions'], str) else row['permissions'] for row in cursor.fetchall()]

            for perms in all_perms:
                # --- Обработка старой структуры для обратной совместимости ---
                if 'can_access_app' in perms:
                    if perms.get('can_access_app'):
                        for tab_name, has_access in perms.get('tabs', {}).items():
                            if has_access and tab_name in final_permissions['tabs']:
                                final_permissions['tabs'][tab_name]['view'] = True
                    
                    old_actions = perms.get('actions', {})
                    if old_actions.get('can_save'):
                        if final_permissions['tabs']['cashbox']['view']:
                            final_permissions['tabs']['cashbox']['save'] = True
                            final_permissions['tabs']['cashbox']['edit'] = True # <--- ОБНОВЛЕНО
                        if final_permissions['tabs']['access']['view']:
                            final_permissions['tabs']['access']['save'] = True
                    if old_actions.get('can_delete'):
                        if final_permissions['tabs']['cashbox']['view']:
                            final_permissions['tabs']['cashbox']['delete'] = True
                        if final_permissions['tabs']['access']['view']:
                            final_permissions['tabs']['access']['delete'] = True
                
                # --- Обработка новой структуры ---
                else:
                    for tab_name, tab_perms in perms.get('tabs', {}).items():
                        if tab_name in final_permissions['tabs']:
                            current_tab = final_permissions['tabs'][tab_name]
                            for perm_key, has_access in tab_perms.items():
                                if has_access:
                                    current_tab[perm_key] = True

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

            if data.get('sub_action') == 'delete':
                if not entity_id:
                    return jsonify({'error': 'entity_id is required for deletion'}), 400
                
                query = "DELETE FROM access_rights WHERE entity_id = %s"
                cursor.execute(query, (entity_id,))
                conn.commit()
                
                if cursor.rowcount > 0:
                    return jsonify({'success': True, 'message': 'Rule deleted'})
                else:
                    return jsonify({'success': True, 'message': 'Rule not found or already deleted'})

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
