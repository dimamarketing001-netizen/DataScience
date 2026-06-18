import requests
import logging

# --- Конфигурация ---
B24_WEBHOOK_URL = "https://b24-p41gmg.bitrix24.ru/rest/30/6k67fjhrmukh7ql7/"
B24_ENTITY_CACHE = {}

# Настройка логгера
logger = logging.getLogger(__name__)

def b24_call_method(method, params={}):
    try:
        url = B24_WEBHOOK_URL + method
        logger.info(f"B24 REQUEST: {method} | params={params}")
        response = requests.post(url, json=params)
        response.raise_for_status()
        data = response.json()
        # Логируем только размер ответа чтобы не засорять логи большими массивами
        if data and 'result' in data:
            result = data['result']
            if isinstance(result, list):
                logger.info(f"B24 RESPONSE: {method} | result count={len(result)}")
            elif isinstance(result, dict) and 'items' in result:
                logger.info(f"B24 RESPONSE: {method} | items count={len(result['items'])}")
            else:
                logger.info(f"B24 RESPONSE: {method} | result type={type(result).__name__}")
        else:
            logger.warning(f"B24 RESPONSE: {method} | no 'result' key. data={data}")
        return data
    except Exception as e:
        logger.error(f"Ошибка в b24_call_method для {method}: {e}", exc_info=True)
        return None

def fetch_paginated_data(method, params):
    """Универсальная функция для извлечения данных с пагинацией."""
    items = []
    start = 0
    while True:
        current_params = params.copy()
        current_params['start'] = start

        result = b24_call_method(method, current_params)

        if not result or 'result' not in result:
            logger.warning(
                f"Прерывание пагинации для {method}: нет ключа 'result'. Ответ: {result}"
            )
            break

        batch = result.get('result', [])
        if not isinstance(batch, list):
            logger.warning(
                f"Прерывание пагинации для {method}: 'result' не является списком. Ответ: {result}"
            )
            break
        if not batch:
            break

        items.extend(batch)

        if 'next' in result:
            start = result['next']
        else:
            break

    logger.info(f"fetch_paginated_data: {method} | итого получено={len(items)}")
    return items


def fetch_paginated_stage_history(method, params):
    """
    Пагинация для crm.stagehistory.list — результат лежит в result.items, а не в result напрямую.
    """
    items = []
    start = 0
    while True:
        current_params = params.copy()
        current_params['start'] = start

        result = b24_call_method(method, current_params)

        if not result or 'result' not in result:
            logger.warning(
                f"Прерывание пагинации (stagehistory) для {method}: нет ключа 'result'. Ответ: {result}"
            )
            break

        batch = result['result'].get('items', [])
        if not isinstance(batch, list):
            logger.warning(
                f"Прерывание пагинации (stagehistory) для {method}: 'items' не является списком."
            )
            break
        if not batch:
            break

        items.extend(batch)

        if 'next' in result:
            start = result['next']
        else:
            break

    logger.info(f"fetch_paginated_stage_history: {method} | итого получено={len(items)}")
    return items


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
        elif entity_type == 'deal':
            response = b24_call_method('crm.deal.get', {'ID': entity_id})
            if response and response.get('result'):
                deal = response['result']
                name = deal.get('TITLE', f"Сделка #{entity_id}")
        elif entity_type == 'source':
            response = b24_call_method('crm.status.list', {'filter[ENTITY_ID]': 'SOURCE'})
            if response and response.get('result'):
                for source in response['result']:
                    if source['STATUS_ID'] == entity_id:
                        name = source['NAME']
                        break
    except Exception as e:
        logger.warning(f"Не удалось получить имя для {entity_type} с ID {entity_id}: {e}")

    if name:
        B24_ENTITY_CACHE[cache_key] = name
    else:
        name = f"Неизвестно ({entity_id})"
        B24_ENTITY_CACHE[cache_key] = name
    return name