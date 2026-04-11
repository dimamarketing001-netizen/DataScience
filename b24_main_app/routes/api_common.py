from flask import Blueprint, request, jsonify
from core.b24 import b24_call_method

# Blueprint для общих API-методов
common_api = Blueprint('api_common', __name__)

def search_contacts():
    """Ищет контакты в Битрикс24 по строке запроса."""
    query = request.args.get('query', '')
    if not query:
        return jsonify([])
    
    response = b24_call_method('crm.contact.list', {
        'filter': {'LOGIC': 'OR', '%NAME': query, '%LAST_NAME': query},
        'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME'],
        'limit': 10
    })
    
    if response and response.get('result'):
        contacts = [{'ID': contact['ID'], 'NAME': f"{contact.get('LAST_NAME', '')} {contact.get('NAME', '')} {contact.get('SECOND_NAME', '')}".strip()} for contact in response['result']]
        return jsonify(contacts)
    
    return jsonify([])

def get_initial_data_for_access():
    """Загружает пользователей и отделы для формы настройки прав доступа."""
    batch_payload = {
        'halt': 0,
        'cmd': {
            'users': 'user.get?filter[ACTIVE]=Y&admin=false',
            'departments': 'department.get'
        }
    }
    response = b24_call_method('batch', batch_payload)
    
    if response and response.get('result', {}).get('result'):
        result = response['result']['result']
        users = [{'id': f"user_{user['ID']}", 'name': f"{user.get('LAST_NAME', '')} {user.get('NAME', '')}".strip()} for user in result.get('users', [])]
        departments = [{'id': f"department_{dep['ID']}", 'name': dep['NAME']} for dep in result.get('departments', [])]
        return jsonify({'users': users, 'departments': departments})
        
    return jsonify({'error': 'Не удалось загрузить начальные данные для доступов'}), 500
