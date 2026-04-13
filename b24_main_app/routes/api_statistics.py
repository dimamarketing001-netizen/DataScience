from flask import request, jsonify, current_app
from core.b24 import b24_call_method

# Примечание: ID статусов могут отличаться в вашем портале.
# Это примерные ID для стандартных статусов лидов в Битрикс24.
# 'PROCESSED' - это системный ID для успешного лида.
LEAD_STATUS_GROUPS = {
    "answered": ["2", "3", "14", "15", "4", "5", "6", "7", "8", "PROCESSED"],
    "meeting_scheduled": ["4", "5", "6", "7", "8", "PROCESSED"],
    "arrival": ["5", "6", "7", "8", "PROCESSED"],
    "success": ["PROCESSED"]
}

def fetch_all_leads_sync(filter_params):
    """Синхронно извлекает все лиды по заданным фильтрам, обрабатывая пагинацию."""
    leads = []
    start = 0
    while True:
        params = {
            'filter': filter_params,
            'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'DATE_CREATE'],
            'order': {'DATE_CREATE': 'ASC'},
            'start': start
        }
        result = b24_call_method('crm.lead.list', params)
        
        if not result or 'result' not in result:
            break
        
        batch = result.get('result', [])
        if not batch:
            break
            
        leads.extend(batch)
        
        if 'next' in result:
            start = result['next']
        else:
            break
    return leads

def get_statistics():
    """Собирает, обрабатывает и возвращает статистику по лидам."""
    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        filter_params = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59"
        }
        if source_id:
            filter_params['SOURCE_ID'] = source_id

        all_leads = fetch_all_leads_sync(filter_params)

        sources_result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        source_map = {str(s['STATUS_ID']): s['NAME'] for s in sources_result.get('result', [])}

        leads_by_source = {}
        for lead in all_leads:
            sid = str(lead.get('SOURCE_ID', 'unknown'))
            if sid not in leads_by_source:
                leads_by_source[sid] = []
            leads_by_source[sid].append(lead)

        statistics = []
        for sid, leads in leads_by_source.items():
            source_name = source_map.get(sid, f"Неизвестный ({sid})")
            
            counts = {group: 0 for group in LEAD_STATUS_GROUPS}
            counts['total'] = len(leads)

            for lead in leads:
                status_id = lead.get('STATUS_ID')
                for group, statuses in LEAD_STATUS_GROUPS.items():
                    if status_id in statuses:
                        counts[group] += 1
            
            stats_row = {
                "source_name": source_name,
                "total": counts['total'],
                "answered": calculate_conversion(counts['answered'], counts['total'], counts['total']),
                "meeting_scheduled": calculate_conversion(counts['meeting_scheduled'], counts['answered'], counts['total']),
                "arrival": calculate_conversion(counts['arrival'], counts['meeting_scheduled'], counts['total']),
                "success": calculate_conversion(counts['success'], counts['arrival'], counts['total']),
            }
            statistics.append(stats_row)
        
        statistics.sort(key=lambda x: x['total'], reverse=True)

        return jsonify(statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def calculate_conversion(current_val, prev_val, total_val):
    """Рассчитывает конверсии и возвращает структурированный объект."""
    return {
        "count": current_val,
        "conv_from_prev": (current_val / prev_val * 100) if prev_val > 0 else 0,
        "conv_from_total": (current_val / total_val * 100) if total_val > 0 else 0
    }
