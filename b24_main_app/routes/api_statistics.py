from flask import request, jsonify, current_app
from core.b24 import b24_call_method
from collections import defaultdict

# Статусы лидов, соответствующие каждой группе
LEAD_STATUS_GROUPS = {
    "answered": ["UC_JX4Z7B", "UC_XBXVYQ", "UC_VUPL02", "UC_3VLL3Y", "UC_MD85GI", "UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "meeting_scheduled": ["UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "arrival": ["UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "success": ["CONVERTED"]
}

def fetch_paginated_data(method, params):
    """Универсальная функция для извлечения данных с пагинацией."""
    items = []
    start = 0
    while True:
        params['start'] = start
        result = b24_call_method(method, params)
        if not result or 'result' not in result: break
        batch = result.get('result', [])
        if not batch: break
        items.extend(batch)
        start = result.get('next', None)
        if start is None: break
    return items

def get_statistics():
    """Собирает, обрабатывает и возвращает статистику по лидам, сделкам и счетам."""
    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        # 1. Получаем все лиды за период
        lead_filter = {'>=DATE_CREATE': f"{date_from}T00:00:00", '<=DATE_CREATE': f"{date_to}T23:59:59"}
        if source_id: lead_filter['SOURCE_ID'] = source_id
        all_leads = fetch_paginated_data('crm.lead.list', {'filter': lead_filter, 'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID']})

        # 2. Получаем источники и создаем карту
        sources_result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        source_map = {str(s['STATUS_ID']): s['NAME'] for s in sources_result.get('result', [])}

        # 3. Фильтруем успешные лиды и собираем ID контактов
        successful_leads = [lead for lead in all_leads if lead['STATUS_ID'] == 'CONVERTED' and lead.get('CONTACT_ID')]
        contact_ids = list(set([lead['CONTACT_ID'] for lead in successful_leads]))

        # 4. Получаем сделки для этих контактов
        deals = []
        if contact_ids:
            deals = fetch_paginated_data('crm.deal.list', {'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0}, 'select': ['ID', 'CONTACT_ID']})
        
        deal_ids = [deal['ID'] for deal in deals]

        # 5. Получаем счета для этих сделок
        invoices = []
        if deal_ids:
            invoices = fetch_paginated_data('crm.invoice.list', {'filter': {'UF_DEAL_ID': deal_ids}, 'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE']})

        # --- Агрегация данных ---
        stats_by_source = defaultdict(lambda: {
            'total': 0, 'answered': 0, 'meeting_scheduled': 0, 'arrival': 0, 'success': 0,
            'clients': set(), 'clients_with_payment': set(), 'deals': set(), 'deals_with_payment': set(), 'invoices_sum': 0
        })

        paid_deal_ids = set(inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P')

        # Агрегируем сделки и счета по контактам
        deals_by_contact = defaultdict(list)
        for deal in deals:
            deals_by_contact[deal['CONTACT_ID']].append(deal)
        
        for deal_id in paid_deal_ids:
            for deal in deals:
                if deal['ID'] == deal_id:
                    stats_by_source[source_id]['clients_with_payment'].add(deal['CONTACT_ID'])
                    break

        # Основной цикл агрегации по лидам
        for lead in all_leads:
            sid = str(lead.get('SOURCE_ID', 'unknown'))
            stats = stats_by_source[sid]
            stats['total'] += 1
            
            status_id = lead.get('STATUS_ID')
            for group, statuses in LEAD_STATUS_GROUPS.items():
                if status_id in statuses:
                    stats[group] += 1
            
            if status_id == 'CONVERTED' and lead.get('CONTACT_ID'):
                contact_id = lead['CONTACT_ID']
                stats['clients'].add(contact_id)
                
                contact_deals = deals_by_contact.get(contact_id, [])
                stats['deals'].update([d['ID'] for d in contact_deals])
                
                for deal in contact_deals:
                    if deal['ID'] in paid_deal_ids:
                        stats['deals_with_payment'].add(deal['ID'])
                
                for inv in invoices:
                    if inv['UF_DEAL_ID'] in [d['ID'] for d in contact_deals]:
                        stats['invoices_sum'] += float(inv.get('PRICE', 0))

        # --- Формирование финального ответа ---
        final_statistics = []
        for sid, data in stats_by_source.items():
            final_statistics.append({
                "source_name": source_map.get(sid, f"Неизвестный ({sid})"),
                "total": data['total'],
                "answered": calculate_conversion(data['answered'], data['total'], data['total']),
                "meeting_scheduled": calculate_conversion(data['meeting_scheduled'], data['answered'], data['total']),
                "arrival": calculate_conversion(data['arrival'], data['meeting_scheduled'], data['total']),
                "success": calculate_conversion(data['success'], data['arrival'], data['total']),
                "clients": len(data['clients']),
                "clients_with_payment": calculate_conversion(len(data['clients_with_payment']), len(data['clients']), data['total']),
                "deals": len(data['deals']),
                "deals_with_payment": len(data['deals_with_payment']),
                "invoices_sum": data['invoices_sum']
            })

        final_statistics.sort(key=lambda x: x['total'], reverse=True)
        
        # Добавление итоговой строки
        if len(final_statistics) > 1:
            summary = {
                'source_name': 'Итого',
                'total': sum(s['total'] for s in final_statistics),
                'answered_count': sum(s['answered']['count'] for s in final_statistics),
                'meeting_scheduled_count': sum(s['meeting_scheduled']['count'] for s in final_statistics),
                'arrival_count': sum(s['arrival']['count'] for s in final_statistics),
                'success_count': sum(s['success']['count'] for s in final_statistics),
                'clients': sum(s['clients'] for s in final_statistics),
                'clients_with_payment_count': sum(s['clients_with_payment']['count'] for s in final_statistics),
                'deals': sum(s['deals'] for s in final_statistics),
                'deals_with_payment': sum(s['deals_with_payment'] for s in final_statistics),
                'invoices_sum': sum(s['invoices_sum'] for s in final_statistics)
            }
            summary_row = {
                "source_name": "Итого",
                "total": summary['total'],
                "answered": calculate_conversion(summary['answered_count'], summary['total'], summary['total']),
                "meeting_scheduled": calculate_conversion(summary['meeting_scheduled_count'], summary['answered_count'], summary['total']),
                "arrival": calculate_conversion(summary['arrival_count'], summary['meeting_scheduled_count'], summary['total']),
                "success": calculate_conversion(summary['success_count'], summary['arrival_count'], summary['total']),
                "clients": summary['clients'],
                "clients_with_payment": calculate_conversion(summary['clients_with_payment_count'], summary['clients'], summary['total']),
                "deals": summary['deals'],
                "deals_with_payment": summary['deals_with_payment'],
                "invoices_sum": summary['invoices_sum']
            }
            final_statistics.append(summary_row)

        return jsonify(final_statistics)

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
