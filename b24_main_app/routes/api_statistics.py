from flask import request, jsonify, current_app
from core.b24 import b24_call_method, fetch_paginated_data
from core.db import get_db_connection
from collections import defaultdict

LEAD_STATUS_GROUPS = {
    "answered": ["UC_JX4Z7B", "UC_XBXVYQ", "UC_VUPL02", "UC_3VLL3Y", "UC_MD85GI", "UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "meeting_scheduled": ["UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "arrival": ["UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "success": ["CONVERTED"]
}

SALES_DEPT_FIELD = "UF_CRM_1779024295"
B24_PORTAL = "https://b24-p41gmg.bitrix24.ru"
CONVERSION_METRICS = {"answered", "meeting_scheduled", "arrival", "success", "clients_with_payment"}


# =====================================================================
# ОРИГИНАЛЬНАЯ ФУНКЦИЯ — НЕ ИЗМЕНЕНА
# =====================================================================
def get_statistics():
    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        lead_filter = {'>=DATE_CREATE': f"{date_from}T00:00:00", '<=DATE_CREATE': f"{date_to}T23:59:59"}
        if source_id:
            lead_filter['SOURCE_ID'] = source_id

        all_leads = fetch_paginated_data('crm.lead.list', {
            'filter': lead_filter,
            'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID']
        })

        sources_result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        source_map = {str(s['STATUS_ID']): s['NAME'] for s in sources_result.get('result', [])}

        successful_leads = [lead for lead in all_leads if lead['STATUS_ID'] == 'CONVERTED' and lead.get('CONTACT_ID')]
        contact_ids = list(set([lead['CONTACT_ID'] for lead in successful_leads]))

        deals = fetch_paginated_data('crm.deal.list', {
            'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
            'select': ['ID', 'CONTACT_ID']
        }) if contact_ids else []

        deal_ids = [deal['ID'] for deal in deals]
        invoices = fetch_paginated_data('crm.invoice.list', {
            'filter': {'UF_DEAL_ID': deal_ids},
            'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE']
        }) if deal_ids else []

        expenses_by_source = defaultdict(float)
        conn = get_db_connection()
        if conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(
                "SELECT source_id, SUM(amount) as total_expenses FROM expenses WHERE category_val = 'marketing' AND expense_date BETWEEN %s AND %s GROUP BY source_id",
                (date_from, date_to)
            )
            for row in cursor.fetchall():
                if row['source_id']:
                    expenses_by_source[str(row['source_id'])] = float(row['total_expenses'])
            cursor.close()
            conn.close()

        stats_by_source = defaultdict(lambda: {
            'total': 0, 'answered': 0, 'meeting_scheduled': 0, 'arrival': 0, 'success': 0,
            'clients': set(), 'clients_with_payment': set(), 'deals': set(),
            'deals_with_payment': set(), 'invoices_sum': 0, 'expenses': 0
        })

        paid_deal_ids = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
        deals_by_contact = defaultdict(list)
        for deal in deals:
            deals_by_contact[deal['CONTACT_ID']].append(deal)

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
                stats['deals'].update(d['ID'] for d in contact_deals)
                for deal in contact_deals:
                    if deal['ID'] in paid_deal_ids:
                        stats['deals_with_payment'].add(deal['ID'])
                        stats['clients_with_payment'].add(contact_id)
                for inv in invoices:
                    if inv['UF_DEAL_ID'] in {d['ID'] for d in contact_deals}:
                        stats['invoices_sum'] += float(inv.get('PRICE', 0))

        final_statistics = []
        for sid, data in stats_by_source.items():
            data['expenses'] = expenses_by_source.get(sid, 0)
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
                "invoices_sum": data['invoices_sum'],
                "expenses": data['expenses'],
                "cpl": data['expenses'] / data['total'] if data['total'] > 0 else 0,
                "cpo": data['expenses'] / len(data['deals_with_payment']) if len(data['deals_with_payment']) > 0 else 0,
                "romi": calculate_romi(data['invoices_sum'], data['expenses'])
            })

        final_statistics.sort(key=lambda x: x['total'], reverse=True)

        if len(final_statistics) > 1:
            summary = {
                'total': sum(s['total'] for s in final_statistics),
                'answered_count': sum(s['answered']['count'] for s in final_statistics),
                'meeting_scheduled_count': sum(s['meeting_scheduled']['count'] for s in final_statistics),
                'arrival_count': sum(s['arrival']['count'] for s in final_statistics),
                'success_count': sum(s['success']['count'] for s in final_statistics),
                'clients': sum(s['clients'] for s in final_statistics),
                'clients_with_payment_count': sum(s['clients_with_payment']['count'] for s in final_statistics),
                'deals': sum(s['deals'] for s in final_statistics),
                'deals_with_payment': sum(s['deals_with_payment'] for s in final_statistics),
                'invoices_sum': sum(s['invoices_sum'] for s in final_statistics),
                'expenses': sum(s['expenses'] for s in final_statistics)
            }
            summary_row = {
                "source_name": "Итого", "total": summary['total'],
                "answered": calculate_conversion(summary['answered_count'], summary['total'], summary['total']),
                "meeting_scheduled": calculate_conversion(summary['meeting_scheduled_count'], summary['answered_count'], summary['total']),
                "arrival": calculate_conversion(summary['arrival_count'], summary['meeting_scheduled_count'], summary['total']),
                "success": calculate_conversion(summary['success_count'], summary['arrival_count'], summary['total']),
                "clients": summary['clients'],
                "clients_with_payment": calculate_conversion(summary['clients_with_payment_count'], summary['clients'], summary['total']),
                "deals": summary['deals'], "deals_with_payment": summary['deals_with_payment'],
                "invoices_sum": summary['invoices_sum'], "expenses": summary['expenses'],
                "cpl": summary['expenses'] / summary['total'] if summary['total'] > 0 else 0,
                "cpo": summary['expenses'] / summary['deals_with_payment'] if summary['deals_with_payment'] > 0 else 0,
                "romi": calculate_romi(summary['invoices_sum'], summary['expenses'])
            }
            final_statistics.append(summary_row)

        return jsonify(final_statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def calculate_conversion(current, prev, total):
    return {
        "count": current,
        "conv_from_prev": (current / prev * 100) if prev > 0 else 0,
        "conv_from_total": (current / total * 100) if total > 0 else 0
    }

def calculate_romi(revenue, expenses):
    return ((revenue - expenses) / expenses * 100) if expenses > 0 else 0


# =====================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =====================================================================

def _parse_list_param(param_name):
    """Получает список значений из параметров запроса."""
    vals = request.args.getlist(f'{param_name}[]')
    if not vals:
        single = request.args.get(param_name, '')
        if single:
            vals = [single]
    return vals


def _apply_period_mode_filter(lead_filter, date_from, date_to, period_mode):
    """
    period_mode='strict': лиды созданы В периоде (текущее поведение)
    period_mode='status': лиды у которых дата изменения статуса попадает в период
    """
    if period_mode == 'strict':
        lead_filter['>=DATE_CREATE'] = f"{date_from}T00:00:00"
        lead_filter['<=DATE_CREATE'] = f"{date_to}T23:59:59"
    else:
        # Режим "в разрезе периода": фильтруем по дате изменения статуса
        lead_filter['>=DATE_MODIFY'] = f"{date_from}T00:00:00"
        lead_filter['<=DATE_MODIFY'] = f"{date_to}T23:59:59"
    return lead_filter


def _filter_deals_by_period(deals, date_from, date_to):
    """Фильтрует сделки по дате создания."""
    from datetime import datetime
    dt_from = datetime.fromisoformat(f"{date_from}T00:00:00")
    dt_to   = datetime.fromisoformat(f"{date_to}T23:59:59")
    result = []
    for d in deals:
        dc = d.get('DATE_CREATE', '')
        if not dc:
            continue
        try:
            # Битрикс возвращает ISO формат
            dt = datetime.fromisoformat(dc.replace('Z', '+00:00').replace('+03:00', ''))
            if dt_from <= dt <= dt_to:
                result.append(d)
        except Exception:
            result.append(d)
    return result


def _filter_invoices_by_period(invoices, date_from, date_to):
    """Фильтрует счета по дате создания."""
    from datetime import datetime
    dt_from = datetime.fromisoformat(f"{date_from}T00:00:00")
    dt_to   = datetime.fromisoformat(f"{date_to}T23:59:59")
    result = []
    for inv in invoices:
        dc = inv.get('DATE_CREATE', '') or inv.get('DATE_BILL', '')
        if not dc:
            result.append(inv)
            continue
        try:
            dt = datetime.fromisoformat(dc.replace('Z', '+00:00').replace('+03:00', ''))
            if dt_from <= dt <= dt_to:
                result.append(inv)
        except Exception:
            result.append(inv)
    return result


def get_sales_dept_enum():
    try:
        result = b24_call_method('crm.lead.fields', {})
        if not result or 'result' not in result:
            return jsonify({'error': 'Не удалось получить поля лида'}), 500
        fields = result.get('result', {})
        field_info = fields.get(SALES_DEPT_FIELD)
        if not field_info:
            return jsonify({'error': f'Поле {SALES_DEPT_FIELD} не найдено'}), 404
        items = field_info.get('items', [])
        enum_values = [{'id': str(item['ID']), 'value': item['VALUE']} for item in items]
        return jsonify(enum_values)
    except Exception as e:
        current_app.logger.error(f"Error in get_sales_dept_enum: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def get_utm_labels():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({'error': 'DB connection failed'}), 500
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, utm_type, utm_value, custom_name FROM utm_labels ORDER BY utm_type, utm_value")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        current_app.logger.error(f"Error in get_utm_labels: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def save_utm_label():
    try:
        data = request.get_json()
        utm_type  = data.get('utm_type')
        utm_value = data.get('utm_value')
        custom_name = data.get('custom_name', '').strip()
        if not utm_type or not utm_value:
            return jsonify({'error': 'utm_type и utm_value обязательны'}), 400
        conn = get_db_connection()
        if not conn:
            return jsonify({'error': 'DB connection failed'}), 500
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO utm_labels (utm_type, utm_value, custom_name)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE custom_name = VALUES(custom_name)
        """, (utm_type, utm_value, custom_name))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error(f"Error in save_utm_label: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def delete_utm_label():
    try:
        label_id = request.args.get('id')
        if not label_id:
            return jsonify({'error': 'id обязателен'}), 400
        conn = get_db_connection()
        if not conn:
            return jsonify({'error': 'DB connection failed'}), 500
        cursor = conn.cursor()
        cursor.execute("DELETE FROM utm_labels WHERE id = %s", (label_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error(f"Error in delete_utm_label: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def _load_utm_label_map(conn):
    label_map = {}
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT utm_type, utm_value, custom_name FROM utm_labels")
        for row in cursor.fetchall():
            label_map[(row['utm_type'], row['utm_value'])] = row['custom_name']
        cursor.close()
    except Exception:
        pass
    return label_map


# =====================================================================
# ОСНОВНАЯ ГРУППИРОВАННАЯ СТАТИСТИКА
# =====================================================================

def get_statistics_grouped():
    """
    Статистика с группировками + поддержка двух режимов:
    period_mode=standard  — как сейчас (по дате создания лида)
    period_mode=strict    — все данные (статус, контакт, сделка, счёт)
                            должны быть созданы/изменены в указанном периоде
    """
    try:
        date_from   = request.args.get('date_from')
        date_to     = request.args.get('date_to')
        grouping    = request.args.get('grouping', 'source')
        period_mode = request.args.get('period_mode', 'standard')

        source_ids         = _parse_list_param('source_id')
        source_ids_exclude = _parse_list_param('source_id_exclude')
        sales_depts        = _parse_list_param('sales_dept')
        sales_depts_exclude= _parse_list_param('sales_dept_exclude')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        # --- Фильтр лидов ---
        lead_filter = {}
        lead_filter = _apply_period_mode_filter(lead_filter, date_from, date_to, period_mode)

        # Для режима strict дополнительно не ограничиваем дату создания —
        # берём лиды изменённые в периоде
        if source_ids:
            lead_filter['SOURCE_ID'] = source_ids
        if sales_depts:
            lead_filter[SALES_DEPT_FIELD] = sales_depts

        select_fields = ['ID', 'TITLE', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID',
                         'UTM_CAMPAIGN', 'UTM_CONTENT', 'DATE_CREATE', 'DATE_MODIFY',
                         SALES_DEPT_FIELD]

        all_leads = fetch_paginated_data('crm.lead.list', {
            'filter': lead_filter,
            'select': select_fields
        })

        # Исключения на стороне Python
        if source_ids_exclude:
            all_leads = [l for l in all_leads
                         if str(l.get('SOURCE_ID', '')) not in source_ids_exclude]
        if sales_depts_exclude:
            all_leads = [l for l in all_leads
                         if str(l.get(SALES_DEPT_FIELD, '')) not in sales_depts_exclude]

        # --- Источники ---
        sources_result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        source_map = {str(s['STATUS_ID']): s['NAME']
                      for s in sources_result.get('result', [])}

        # --- UTM метки и расходы ---
        conn = get_db_connection()
        utm_label_map   = {}
        expenses_by_key = defaultdict(float)

        if conn:
            utm_label_map = _load_utm_label_map(conn)
            cursor = conn.cursor(dictionary=True)
            cursor.execute("""
                SELECT source_id, SUM(amount) as total_expenses
                FROM expenses
                WHERE category_val = 'marketing'
                AND expense_date BETWEEN %s AND %s
                GROUP BY source_id
            """, (date_from, date_to))
            for row in cursor.fetchall():
                if row['source_id']:
                    expenses_by_key[str(row['source_id'])] = float(row['total_expenses'])
            cursor.close()
            conn.close()

        # --- Сделки и счета ---
        successful_leads = [l for l in all_leads
                            if l['STATUS_ID'] == 'CONVERTED' and l.get('CONTACT_ID')]
        contact_ids = list(set([l['CONTACT_ID'] for l in successful_leads]))

        deals = fetch_paginated_data('crm.deal.list', {
            'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
            'select': ['ID', 'CONTACT_ID', 'DATE_CREATE']
        }) if contact_ids else []

        # В режиме strict — фильтруем сделки по периоду создания
        if period_mode == 'strict':
            deals = _filter_deals_by_period(deals, date_from, date_to)

        deal_ids = [d['ID'] for d in deals]
        invoices = fetch_paginated_data('crm.invoice.list', {
            'filter': {'UF_DEAL_ID': deal_ids},
            'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE', 'DATE_CREATE', 'DATE_BILL']
        }) if deal_ids else []

        # В режиме strict — фильтруем счета по периоду
        if period_mode == 'strict':
            invoices = _filter_invoices_by_period(invoices, date_from, date_to)

        paid_deal_ids = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
        deals_by_contact = defaultdict(list)
        for deal in deals:
            deals_by_contact[deal['CONTACT_ID']].append(deal)

        # --- Группировка ---
        def get_group_key(lead):
            if grouping == 'utm_campaign':
                return lead.get('UTM_CAMPAIGN') or '(не задан)'
            elif grouping == 'utm_content':
                return lead.get('UTM_CONTENT') or '(не задан)'
            else:
                return str(lead.get('SOURCE_ID', 'unknown'))

        def get_group_display_name(key):
            if grouping == 'utm_campaign':
                return utm_label_map.get(('utm_campaign', key), key)
            elif grouping == 'utm_content':
                return utm_label_map.get(('utm_content', key), key)
            else:
                return source_map.get(key, f"Неизвестный ({key})")

        stats_by_group = defaultdict(lambda: {
            'total': 0,
            'answered': 0, 'meeting_scheduled': 0, 'arrival': 0, 'success': 0,
            'clients': set(), 'clients_with_payment': set(),
            'deals': set(), 'deals_with_payment': set(),
            'invoices_sum': 0, 'expenses': 0,
            'display_name': '', 'source_id_for_expenses': None,
            'ids_total': [], 'ids_answered': [], 'ids_meeting_scheduled': [],
            'ids_arrival': [], 'ids_success': [],
        })

        for lead in all_leads:
            key   = get_group_key(lead)
            stats = stats_by_group[key]
            stats['total'] += 1
            stats['display_name'] = get_group_display_name(key)
            stats['ids_total'].append(lead['ID'])

            if not stats['source_id_for_expenses']:
                stats['source_id_for_expenses'] = str(lead.get('SOURCE_ID', ''))

            status_id = lead.get('STATUS_ID')
            if status_id in LEAD_STATUS_GROUPS['answered']:
                stats['answered'] += 1
                stats['ids_answered'].append(lead['ID'])
            if status_id in LEAD_STATUS_GROUPS['meeting_scheduled']:
                stats['meeting_scheduled'] += 1
                stats['ids_meeting_scheduled'].append(lead['ID'])
            if status_id in LEAD_STATUS_GROUPS['arrival']:
                stats['arrival'] += 1
                stats['ids_arrival'].append(lead['ID'])
            if status_id in LEAD_STATUS_GROUPS['success']:
                stats['success'] += 1
                stats['ids_success'].append(lead['ID'])

            if status_id == 'CONVERTED' and lead.get('CONTACT_ID'):
                contact_id   = lead['CONTACT_ID']
                stats['clients'].add(contact_id)
                contact_deals = deals_by_contact.get(contact_id, [])
                stats['deals'].update(d['ID'] for d in contact_deals)
                for deal in contact_deals:
                    if deal['ID'] in paid_deal_ids:
                        stats['deals_with_payment'].add(deal['ID'])
                        stats['clients_with_payment'].add(contact_id)
                for inv in invoices:
                    if inv['UF_DEAL_ID'] in {d['ID'] for d in contact_deals}:
                        stats['invoices_sum'] += float(inv.get('PRICE', 0))

        final_statistics = []
        for key, data in stats_by_group.items():
            exp = expenses_by_key.get(key, 0) if grouping == 'source' \
                else expenses_by_key.get(data.get('source_id_for_expenses', ''), 0)
            data['expenses'] = exp

            final_statistics.append({
                "group_key": key,
                "source_name": data['display_name'],
                "total": data['total'],
                "answered": calculate_conversion(data['answered'], data['total'], data['total']),
                "meeting_scheduled": calculate_conversion(data['meeting_scheduled'], data['answered'], data['total']),
                "arrival": calculate_conversion(data['arrival'], data['meeting_scheduled'], data['total']),
                "success": calculate_conversion(data['success'], data['arrival'], data['total']),
                "clients": len(data['clients']),
                "clients_with_payment": calculate_conversion(len(data['clients_with_payment']), len(data['clients']), data['total']),
                "deals": len(data['deals']),
                "deals_with_payment": len(data['deals_with_payment']),
                "invoices_sum": data['invoices_sum'],
                "expenses": data['expenses'],
                "cpl":  data['expenses'] / data['total'] if data['total'] > 0 else 0,
                "cpo":  data['expenses'] / len(data['deals_with_payment']) if len(data['deals_with_payment']) > 0 else 0,
                "romi": calculate_romi(data['invoices_sum'], data['expenses']),
                "ids_total":               data['ids_total'],
                "ids_answered":            data['ids_answered'],
                "ids_meeting_scheduled":   data['ids_meeting_scheduled'],
                "ids_arrival":             data['ids_arrival'],
                "ids_success":             data['ids_success'],
                "ids_clients":             list(data['clients']),
                "ids_clients_with_payment":list(data['clients_with_payment']),
                "ids_deals":               list(data['deals']),
                "ids_deals_with_payment":  list(data['deals_with_payment']),
            })

        final_statistics.sort(key=lambda x: x['total'], reverse=True)

        if len(final_statistics) > 1:
            def _sum_ids(key):
                return [i for s in final_statistics for i in s.get(key, [])]

            summary = {
                'total':                    sum(s['total'] for s in final_statistics),
                'answered_count':           sum(s['answered']['count'] for s in final_statistics),
                'meeting_scheduled_count':  sum(s['meeting_scheduled']['count'] for s in final_statistics),
                'arrival_count':            sum(s['arrival']['count'] for s in final_statistics),
                'success_count':            sum(s['success']['count'] for s in final_statistics),
                'clients':                  sum(s['clients'] for s in final_statistics),
                'clients_with_payment_count':sum(s['clients_with_payment']['count'] for s in final_statistics),
                'deals':                    sum(s['deals'] for s in final_statistics),
                'deals_with_payment':       sum(s['deals_with_payment'] for s in final_statistics),
                'invoices_sum':             sum(s['invoices_sum'] for s in final_statistics),
                'expenses':                 sum(s['expenses'] for s in final_statistics),
            }
            final_statistics.append({
                "group_key": "__total__", "source_name": "Итого",
                "total": summary['total'],
                "answered": calculate_conversion(summary['answered_count'], summary['total'], summary['total']),
                "meeting_scheduled": calculate_conversion(summary['meeting_scheduled_count'], summary['answered_count'], summary['total']),
                "arrival": calculate_conversion(summary['arrival_count'], summary['meeting_scheduled_count'], summary['total']),
                "success": calculate_conversion(summary['success_count'], summary['arrival_count'], summary['total']),
                "clients": summary['clients'],
                "clients_with_payment": calculate_conversion(summary['clients_with_payment_count'], summary['clients'], summary['total']),
                "deals": summary['deals'], "deals_with_payment": summary['deals_with_payment'],
                "invoices_sum": summary['invoices_sum'], "expenses": summary['expenses'],
                "cpl":  summary['expenses'] / summary['total'] if summary['total'] > 0 else 0,
                "cpo":  summary['expenses'] / summary['deals_with_payment'] if summary['deals_with_payment'] > 0 else 0,
                "romi": calculate_romi(summary['invoices_sum'], summary['expenses']),
                "ids_total":               _sum_ids('ids_total'),
                "ids_answered":            _sum_ids('ids_answered'),
                "ids_meeting_scheduled":   _sum_ids('ids_meeting_scheduled'),
                "ids_arrival":             _sum_ids('ids_arrival'),
                "ids_success":             _sum_ids('ids_success'),
                "ids_clients":             _sum_ids('ids_clients'),
                "ids_clients_with_payment":_sum_ids('ids_clients_with_payment'),
                "ids_deals":               _sum_ids('ids_deals'),
                "ids_deals_with_payment":  _sum_ids('ids_deals_with_payment'),
            })

        return jsonify(final_statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics_grouped: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# =====================================================================
# ДЕТАЛИЗАЦИЯ ЛИДОВ / КОНТАКТОВ / СДЕЛОК
# =====================================================================

def get_lead_details():
    try:
        ids_raw = request.args.get('ids', '')
        if not ids_raw:
            return jsonify([])
        ids = [i.strip() for i in ids_raw.split(',') if i.strip()]
        if not ids:
            return jsonify([])

        leads = fetch_paginated_data('crm.lead.list', {
            'filter': {'ID': ids},
            'select': ['ID', 'TITLE', 'DATE_CREATE', 'CONTACT_ID']
        })

        contact_ids = list(set([l['CONTACT_ID'] for l in leads if l.get('CONTACT_ID')]))
        contact_map = {}
        if contact_ids:
            contacts = fetch_paginated_data('crm.contact.list', {
                'filter': {'ID': contact_ids},
                'select': ['ID', 'NAME', 'LAST_NAME']
            })
            for c in contacts:
                name = f"{c.get('LAST_NAME', '')} {c.get('NAME', '')}".strip()
                contact_map[c['ID']] = {
                    'id': c['ID'], 'name': name,
                    'url': f"{B24_PORTAL}/crm/contact/show/{c['ID']}/"
                }

        deal_map = {}
        if contact_ids:
            deals = fetch_paginated_data('crm.deal.list', {
                'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
                'select': ['ID', 'TITLE', 'CONTACT_ID', 'DATE_CREATE']
            })
            for d in deals:
                cid = d['CONTACT_ID']
                if cid not in deal_map:
                    deal_map[cid] = d

        result = []
        for lead in leads:
            lead_name    = lead.get('TITLE') or f"Лид #{lead['ID']}"
            contact_info = None
            deal_info    = None
            cid = lead.get('CONTACT_ID')
            if cid and cid in contact_map:
                contact_info = contact_map[cid]
                if cid in deal_map:
                    d = deal_map[cid]
                    deal_info = {
                        'id': d['ID'],
                        'title': d.get('TITLE', f"Сделка #{d['ID']}"),
                        'url': f"{B24_PORTAL}/crm/deal/show/{d['ID']}/",
                        'date_create': d.get('DATE_CREATE', '')
                    }
            result.append({
                'id': lead['ID'], 'name': lead_name,
                'date_create': lead.get('DATE_CREATE', ''),
                'url': f"{B24_PORTAL}/crm/lead/show/{lead['ID']}/",
                'contact': contact_info, 'deal': deal_info
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_lead_details: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def get_contact_details():
    try:
        ids_raw = request.args.get('ids', '')
        if not ids_raw:
            return jsonify([])
        ids = [i.strip() for i in ids_raw.split(',') if i.strip()]
        if not ids:
            return jsonify([])

        contacts = fetch_paginated_data('crm.contact.list', {
            'filter': {'ID': ids},
            'select': ['ID', 'NAME', 'LAST_NAME', 'DATE_CREATE']
        })

        deal_map = {}
        deals = fetch_paginated_data('crm.deal.list', {
            'filter': {'CONTACT_ID': ids, 'CATEGORY_ID': 0},
            'select': ['ID', 'TITLE', 'CONTACT_ID', 'DATE_CREATE']
        })
        for d in deals:
            cid = d['CONTACT_ID']
            if cid not in deal_map:
                deal_map[cid] = d

        result = []
        for c in contacts:
            name = f"{c.get('LAST_NAME', '')} {c.get('NAME', '')}".strip() or f"Контакт #{c['ID']}"
            deal_info = None
            if c['ID'] in deal_map:
                d = deal_map[c['ID']]
                deal_info = {
                    'id': d['ID'],
                    'title': d.get('TITLE', f"Сделка #{d['ID']}"),
                    'url': f"{B24_PORTAL}/crm/deal/show/{d['ID']}/",
                    'date_create': d.get('DATE_CREATE', '')
                }
            result.append({
                'id': c['ID'], 'name': name,
                'date_create': c.get('DATE_CREATE', ''),
                'url': f"{B24_PORTAL}/crm/contact/show/{c['ID']}/",
                'contact': None, 'deal': deal_info
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_contact_details: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def get_deal_details():
    try:
        ids_raw = request.args.get('ids', '')
        if not ids_raw:
            return jsonify([])
        ids = [i.strip() for i in ids_raw.split(',') if i.strip()]
        if not ids:
            return jsonify([])

        deals = fetch_paginated_data('crm.deal.list', {
            'filter': {'ID': ids},
            'select': ['ID', 'TITLE', 'CONTACT_ID', 'DATE_CREATE']
        })

        contact_ids = list(set([d['CONTACT_ID'] for d in deals if d.get('CONTACT_ID')]))
        contact_map = {}
        if contact_ids:
            contacts = fetch_paginated_data('crm.contact.list', {
                'filter': {'ID': contact_ids},
                'select': ['ID', 'NAME', 'LAST_NAME']
            })
            for c in contacts:
                name = f"{c.get('LAST_NAME', '')} {c.get('NAME', '')}".strip()
                contact_map[c['ID']] = {
                    'id': c['ID'], 'name': name,
                    'url': f"{B24_PORTAL}/crm/contact/show/{c['ID']}/"
                }

        result = []
        for d in deals:
            contact_info = None
            cid = d.get('CONTACT_ID')
            if cid and cid in contact_map:
                contact_info = contact_map[cid]
            result.append({
                'id': d['ID'],
                'name': d.get('TITLE', f"Сделка #{d['ID']}"),
                'date_create': d.get('DATE_CREATE', ''),
                'url': f"{B24_PORTAL}/crm/deal/show/{d['ID']}/",
                'contact': contact_info, 'deal': None
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_deal_details: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# =====================================================================
# СРАВНЕНИЕ
# =====================================================================

def get_comparison_data():
    try:
        year         = request.args.get('year')
        period_type  = request.args.get('period_type', 'month')
        grouping     = request.args.get('grouping', '')
        metrics_raw  = request.args.get('metrics', '')
        period_mode  = request.args.get('period_mode', 'standard')

        group_values         = _parse_list_param('group_value')
        group_values_exclude = _parse_list_param('group_value_exclude')
        source_ids           = _parse_list_param('source_id')
        sales_depts          = _parse_list_param('sales_dept')
        sales_depts_exclude  = _parse_list_param('sales_dept_exclude')

        if not year:
            return jsonify({'error': 'year обязателен'}), 400

        year = int(year)
        all_metrics = [
            'expenses', 'total', 'cpl', 'answered', 'meeting_scheduled',
            'arrival', 'success', 'clients', 'clients_with_payment',
            'deals', 'deals_with_payment', 'cpo', 'invoices_sum', 'romi'
        ]
        selected_metrics = [m for m in metrics_raw.split(',') if m in all_metrics] if metrics_raw else []

        import calendar as cal_mod
        periods = []
        if period_type == 'month':
            for m in range(1, 13):
                periods.append({
                    'label':     _month_name(m),
                    'date_from': f"{year}-{m:02d}-01",
                    'date_to':   f"{year}-{m:02d}-{cal_mod.monthrange(year, m)[1]:02d}"
                })
        else:
            import datetime
            d = datetime.date(year, 1, 1)
            while d.weekday() != 0:
                d += datetime.timedelta(days=1)
            wn = 1
            while d.year == year:
                end = d + datetime.timedelta(days=6)
                if end.year > year:
                    end = datetime.date(year, 12, 31)
                periods.append({
                    'label':     f"Нед.{wn}",
                    'date_from': d.strftime('%Y-%m-%d'),
                    'date_to':   end.strftime('%Y-%m-%d')
                })
                d += datetime.timedelta(days=7)
                wn += 1

        row_keys = group_values if group_values else ['__all__']

        result_rows = []
        for rk in row_keys:
            gv = '' if rk == '__all__' else rk
            periods_data = []
            prev_stats   = None

            for period in periods:
                pdata = _compute_period_stats(
                    period['date_from'], period['date_to'],
                    grouping, gv, source_ids, sales_depts,
                    sales_depts_exclude, group_values_exclude,
                    period_mode
                )

                period_result = {
                    'label':     period['label'],
                    'date_from': period['date_from'],
                    'date_to':   period['date_to'],
                    'metrics':   {}
                }

                for metric in selected_metrics:
                    val      = pdata.get(metric, 0)
                    prev_val = prev_stats.get(metric, 0) if prev_stats else None
                    conv     = pdata.get(f"{metric}_conv", None)
                    prev_conv= prev_stats.get(f"{metric}_conv", None) if prev_stats else None

                    mdata = {'value': val, 'conv': conv}

                    if prev_val is not None and prev_val > 0:
                        mdata['pct_from_prev'] = round((val / prev_val * 100) - 100, 2)
                    else:
                        mdata['pct_from_prev'] = None

                    if conv is not None and prev_conv is not None:
                        mdata['pct_conv_from_prev'] = round(conv - prev_conv, 2)
                    else:
                        mdata['pct_conv_from_prev'] = None

                    period_result['metrics'][metric] = mdata

                periods_data.append(period_result)
                prev_stats = pdata

            result_rows.append({'group_key': rk, 'periods': periods_data})

        group_labels = _get_group_labels(grouping, row_keys)

        return jsonify({
            'year': year, 'period_type': period_type,
            'grouping': grouping, 'selected_metrics': selected_metrics,
            'rows': result_rows, 'group_labels': group_labels,
            'period_labels': [p['label'] for p in periods]
        })

    except Exception as e:
        current_app.logger.error(f"Error in get_comparison_data: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def _get_group_labels(grouping, row_keys):
    labels = {}
    if not grouping or row_keys == ['__all__']:
        labels['__all__'] = 'Все'
        return labels
    if grouping == 'source':
        result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        sm = {str(s['STATUS_ID']): s['NAME'] for s in result.get('result', [])}
        for k in row_keys:
            labels[k] = sm.get(k, k)
    else:
        conn = get_db_connection()
        utm_map = {}
        if conn:
            utm_map = _load_utm_label_map(conn)
            conn.close()
        for k in row_keys:
            labels[k] = utm_map.get((grouping, k), k)
    return labels


def _compute_period_stats(date_from, date_to, grouping, group_value,
                           source_ids, sales_depts, sales_depts_exclude,
                           group_values_exclude, period_mode='standard'):

    lead_filter = {}
    lead_filter = _apply_period_mode_filter(lead_filter, date_from, date_to, period_mode)

    if source_ids:
        lead_filter['SOURCE_ID'] = source_ids
    if sales_depts:
        lead_filter[SALES_DEPT_FIELD] = sales_depts
    if grouping == 'source' and group_value:
        lead_filter['SOURCE_ID'] = group_value
    elif grouping == 'utm_campaign' and group_value:
        lead_filter['UTM_CAMPAIGN'] = group_value
    elif grouping == 'utm_content' and group_value:
        lead_filter['UTM_CONTENT'] = group_value

    all_leads = fetch_paginated_data('crm.lead.list', {
        'filter': lead_filter,
        'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID',
                   'UTM_CAMPAIGN', 'UTM_CONTENT', SALES_DEPT_FIELD,
                   'DATE_CREATE', 'DATE_MODIFY']
    })

    if sales_depts_exclude:
        all_leads = [l for l in all_leads
                     if str(l.get(SALES_DEPT_FIELD, '')) not in sales_depts_exclude]
    if group_values_exclude and grouping == 'source':
        all_leads = [l for l in all_leads
                     if str(l.get('SOURCE_ID', '')) not in group_values_exclude]

    total = len(all_leads)
    answered = meeting_scheduled = arrival = success_count = 0
    clients = set()
    clients_with_payment = set()
    deals_set = set()
    deals_with_payment_set = set()
    invoices_sum = 0.0

    successful_leads = [l for l in all_leads if l['STATUS_ID'] == 'CONVERTED' and l.get('CONTACT_ID')]
    contact_ids = list(set([l['CONTACT_ID'] for l in successful_leads]))

    deals = fetch_paginated_data('crm.deal.list', {
        'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
        'select': ['ID', 'CONTACT_ID', 'DATE_CREATE']
    }) if contact_ids else []

    if period_mode == 'strict':
        deals = _filter_deals_by_period(deals, date_from, date_to)

    deal_ids = [d['ID'] for d in deals]
    invoices = fetch_paginated_data('crm.invoice.list', {
        'filter': {'UF_DEAL_ID': deal_ids},
        'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE', 'DATE_CREATE', 'DATE_BILL']
    }) if deal_ids else []

    if period_mode == 'strict':
        invoices = _filter_invoices_by_period(invoices, date_from, date_to)

    paid_deal_ids = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
    deals_by_contact = defaultdict(list)
    for deal in deals:
        deals_by_contact[deal['CONTACT_ID']].append(deal)

    for lead in all_leads:
        status_id = lead.get('STATUS_ID')
        if status_id in LEAD_STATUS_GROUPS['answered']:      answered += 1
        if status_id in LEAD_STATUS_GROUPS['meeting_scheduled']: meeting_scheduled += 1
        if status_id in LEAD_STATUS_GROUPS['arrival']:       arrival += 1
        if status_id in LEAD_STATUS_GROUPS['success']:       success_count += 1

        if status_id == 'CONVERTED' and lead.get('CONTACT_ID'):
            cid = lead['CONTACT_ID']
            clients.add(cid)
            contact_deals = deals_by_contact.get(cid, [])
            deals_set.update(d['ID'] for d in contact_deals)
            for deal in contact_deals:
                if deal['ID'] in paid_deal_ids:
                    deals_with_payment_set.add(deal['ID'])
                    clients_with_payment.add(cid)
            for inv in invoices:
                if inv['UF_DEAL_ID'] in {d['ID'] for d in contact_deals}:
                    invoices_sum += float(inv.get('PRICE', 0))

    expenses = 0.0
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            if grouping == 'source' and group_value:
                cursor.execute(
                    "SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s AND source_id=%s",
                    (date_from, date_to, group_value)
                )
            elif source_ids:
                fmt = ','.join(['%s'] * len(source_ids))
                cursor.execute(
                    f"SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s AND source_id IN ({fmt})",
                    (date_from, date_to, *source_ids)
                )
            else:
                cursor.execute(
                    "SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s",
                    (date_from, date_to)
                )
            row = cursor.fetchone()
            expenses = float(row['total']) if row else 0.0
            cursor.close()
        except Exception:
            pass
        finally:
            conn.close()

    cc  = len(clients)
    cwp = len(clients_with_payment)
    dc  = len(deals_set)
    dwp = len(deals_with_payment_set)

    def conv(a, b):
        return round(a / b * 100, 2) if b > 0 else 0.0

    return {
        'total': total,
        'answered': answered,                  'answered_conv': conv(answered, total),
        'meeting_scheduled': meeting_scheduled,'meeting_scheduled_conv': conv(meeting_scheduled, answered),
        'arrival': arrival,                    'arrival_conv': conv(arrival, meeting_scheduled),
        'success': success_count,              'success_conv': conv(success_count, arrival),
        'clients': cc,
        'clients_with_payment': cwp,           'clients_with_payment_conv': conv(cwp, cc),
        'deals': dc,
        'deals_with_payment': dwp,
        'invoices_sum': round(invoices_sum, 2),
        'expenses': round(expenses, 2),
        'cpl':  round(expenses / total, 2) if total > 0 else 0,
        'cpo':  round(expenses / dwp,   2) if dwp   > 0 else 0,
        'romi': round(calculate_romi(invoices_sum, expenses), 2)
    }


def _month_name(m):
    return ['Январь','Февраль','Март','Апрель','Май','Июнь',
            'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'][m - 1]