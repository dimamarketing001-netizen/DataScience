from flask import Blueprint, request, jsonify, current_app
import json
import mysql.connector

from core.db import get_db_connection

# Blueprint для API, связанного с правами доступа
access_api = Blueprint('api_access', __name__)

def get_my_permissions():
    """
    Определяет и возвращает права доступа для текущего пользователя.
    Складывает права из нескольких правил и обеспечивает обратную совместимость.
    """
    try:
        user_id = request.args.get('user_id')
        department_id = request.args.get('department_id')

        if not user_id:
            return jsonify({'error': 'user_id is required'}), 400
        
        conn = get_db_connection()
        if not conn:
            return jsonify({'error': 'DB connection failed'}), 500
        cursor = conn.cursor(dictionary=True)

        try:
            # Новая, более детальная структура прав по умолчанию
            final_permissions = {
                "tabs": {
                    "cashbox": {
                        "view": False,
                        "income": {"view": False, "save": False, "delete": False},
                        "expense": {"view": False, "save": False, "edit": False, "delete": False}
                    },
                    "statistics": {"view": False},
                    "access": {"view": False, "save": False, "delete": False}
                }
            }
            
            entities_to_check = [f"user_{user_id}"]
            if department_id and department_id != 'undefined':
                entities_to_check.append(f"department_{department_id}")
            
            query_placeholders = ', '.join(['%s'] * len(entities_to_check))
            query = f"SELECT permissions FROM access_rights WHERE entity_id IN ({query_placeholders})"
            cursor.execute(query, tuple(entities_to_check))
            
            all_perms = [json.loads(row['permissions']) if isinstance(row['permissions'], str) else row['permissions'] for row in cursor.fetchall()]

            for perms in all_perms:
                # --- Обработка старой структуры для обратной совместимости ---
                if 'can_access_app' in perms:
                    if perms.get('tabs', {}).get('cashbox'):
                        final_permissions['tabs']['cashbox']['view'] = True
                        # Даем полный доступ к подразделам для старых правил
                        for key in final_permissions['tabs']['cashbox']['income']: final_permissions['tabs']['cashbox']['income'][key] = True
                        for key in final_permissions['tabs']['cashbox']['expense']: final_permissions['tabs']['cashbox']['expense'][key] = True
                    if perms.get('tabs', {}).get('statistics'):
                        final_permissions['tabs']['statistics']['view'] = True
                    if perms.get('tabs', {}).get('access'):
                        final_permissions['tabs']['access']['view'] = True
                        if perms.get('actions', {}).get('can_save'): final_permissions['tabs']['access']['save'] = True
                        if perms.get('actions', {}).get('can_delete'): final_permissions['tabs']['access']['delete'] = True
                
                # --- Обработка новой структуры ---
                elif perms.get('tabs'):
                    # Слияние прав на Кассу
                    cashbox_perms = perms.get('tabs', {}).get('cashbox', {})
                    if cashbox_perms.get('view'): final_permissions['tabs']['cashbox']['view'] = True
                    for sub_cat in ['income', 'expense']:
                        for action in final_permissions['tabs']['cashbox'][sub_cat]:
                            if cashbox_perms.get(sub_cat, {}).get(action):
                                final_permissions['tabs']['cashbox'][sub_cat][action] = True
                    
                    # Слияние прав на Статистику и Доступы
                    if perms.get('tabs', {}).get('statistics', {}).get('view'):
                        final_permissions['tabs']['statistics']['view'] = True
                    for action in final_permissions['tabs']['access']:
                        if perms.get('tabs', {}).get('access', {}).get(action):
                            final_permissions['tabs']['access'][action] = True

            return jsonify(final_permissions)
        finally:
            if conn and conn.is_connected():
                cursor.close()
                conn.close()
    except Exception as e:
        current_app.logger.error(f"Error in get_my_permissions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def handle_access_rights():
    # ... (Этот код не требует изменений, т.к. он просто сохраняет переданный JSON)
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
                if not entity_id: return jsonify({'error': 'entity_id is required for deletion'}), 400
                cursor.execute("DELETE FROM access_rights WHERE entity_id = %s", (entity_id,))
                conn.commit()
                return jsonify({'success': True, 'message': 'Rule deleted' if cursor.rowcount > 0 else 'Rule not found'})
            entity_type = 'user' if 'user_' in entity_id else 'department'
            query = "INSERT INTO access_rights (entity_id, entity_type, entity_name, permissions) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), entity_name = VALUES(entity_name)"
            params = (entity_id, entity_type, data['entity_name'], json.dumps(data['permissions']))
            cursor.execute(query, params)
            conn.commit()
            return jsonify({'success': True, 'message': 'Rule saved'})
    except Exception as e:
        current_app.logger.error(f"Error in handle_access_rights: {e}", exc_info=True)
        if conn and conn.is_connected(): conn.rollback()
        return jsonify({'error': 'An internal error occurred'}), 500
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()
    return jsonify({'error': 'Invalid request method'}), 405
