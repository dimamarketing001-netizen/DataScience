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


# =====================================================================
# ОРИГИНАЛЬНАЯ ФУНКЦИЯ — НЕ ИЗМЕНЕНА
# =====================================================================
def get_statistics():
    """Собирает, обрабатывает и возвращает статистику по лидам, сделкам и счетам."""
    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        lead_filter = {'>=DATE_CREATE': f"{date_from}T00:00:00", '<=DATE_CREATE': f"{date_to}T23:59:59"}
        if source_id:
            lead_filter['SOURCE_ID'] = source_id

        # Фильтр по отделу продаж (новое, добавлено поверх)
        sales_dept = request.args.get('sales_dept')
        if sales_dept:
            lead_filter[SALES_DEPT_FIELD] = sales_dept

        all_leads = fetch_paginated_data('crm.lead.list', {
            'filter': lead_filter,
            'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID', 'UTM_CAMPAIGN', 'UTM_CONTENT', SALES_DEPT_FIELD]
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
            query = "SELECT source_id, SUM(amount) as total_expenses FROM expenses WHERE category_val = 'marketing' AND expense_date BETWEEN %s AND %s GROUP BY source_id"
            cursor.execute(query, (date_from, date_to))
            for row in cursor.fetchall():
                if row['source_id']:
                    expenses_by_source[str(row['source_id'])] = float(row['total_expenses'])
            cursor.close()
            conn.close()

        stats_by_source = defaultdict(lambda: {
            'total': 0, 'answered': 0, 'meeting_scheduled': 0, 'arrival': 0, 'success': 0,
            'clients': set(), 'clients_with_payment': set(), 'deals': set(),
            'deals_with_payment': set(), 'invoices_sum': 0, 'expenses': 0,
            'lead_ids': []
        })

        paid_deal_ids = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
        deals_by_contact = defaultdict(list)
        for deal in deals:
            deals_by_contact[deal['CONTACT_ID']].append(deal)

        for lead in all_leads:
            sid = str(lead.get('SOURCE_ID', 'unknown'))
            stats = stats_by_source[sid]
            stats['total'] += 1
            stats['lead_ids'].append(lead['ID'])
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


# =====================================================================
# ОРИГИНАЛЬНЫЕ ХЕЛПЕРЫ — НЕ ИЗМЕНЕНЫ
# =====================================================================
def calculate_conversion(current, prev, total):
    return {
        "count": current,
        "conv_from_prev": (current / prev * 100) if prev > 0 else 0,
        "conv_from_total": (current / total * 100) if total > 0 else 0
    }

def calculate_romi(revenue, expenses):
    return ((revenue - expenses) / expenses * 100) if expenses > 0 else 0


# =====================================================================
# НОВЫЕ ENDPOINT-ФУНКЦИИ
# =====================================================================

def get_sales_dept_enum():
    """Возвращает список ENUM-значений поля 'Отдел продаж' из Битрикс24."""
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
    """Возвращает все пользовательские метки UTM из БД."""
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
    """Создаёт или обновляет пользовательское имя UTM-значения."""
    try:
        data = request.get_json()
        utm_type = data.get('utm_type')
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
    """Удаляет пользовательскую метку UTM по ID."""
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


def _build_lead_filter_with_grouping(date_from, date_to, grouping, group_value, source_id, sales_dept):
    """Вспомогательная функция: строит фильтр лида с учётом группировки."""
    lead_filter = {
        '>=DATE_CREATE': f"{date_from}T00:00:00",
        '<=DATE_CREATE': f"{date_to}T23:59:59"
    }
    if source_id:
        lead_filter['SOURCE_ID'] = source_id
    if sales_dept:
        lead_filter[SALES_DEPT_FIELD] = sales_dept

    if grouping == 'source' and group_value:
        lead_filter['SOURCE_ID'] = group_value
    elif grouping == 'utm_campaign' and group_value:
        lead_filter['UTM_CAMPAIGN'] = group_value
    elif grouping == 'utm_content' and group_value:
        lead_filter['UTM_CONTENT'] = group_value

    return lead_filter


def _load_utm_label_map(conn):
    """Загружает маппинг utm_value -> custom_name из таблицы utm_labels."""
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


def get_statistics_grouped():
    """
    Статистика с поддержкой группировок:
    - по источникам (source)
    - по utm_campaign
    - по utm_content
    Поддерживает фильтр по отделу продаж.
    """
    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')
        sales_dept = request.args.get('sales_dept')
        grouping = request.args.get('grouping', 'source')  # source | utm_campaign | utm_content

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        lead_filter = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59"
        }
        if source_id:
            lead_filter['SOURCE_ID'] = source_id
        if sales_dept:
            lead_filter[SALES_DEPT_FIELD] = sales_dept

        all_leads = fetch_paginated_data('crm.lead.list', {
            'filter': lead_filter,
            'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID',
                       'UTM_CAMPAIGN', 'UTM_CONTENT', SALES_DEPT_FIELD]
        })

        # Загружаем карту источников
        sources_result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        source_map = {str(s['STATUS_ID']): s['NAME'] for s in sources_result.get('result', [])}

        # Загружаем UTM-метки из БД
        conn = get_db_connection()
        utm_label_map = {}
        expenses_by_key = defaultdict(float)

        if conn:
            utm_label_map = _load_utm_label_map(conn)
            # Расходы группируем только по source (так хранятся в БД)
            cursor = conn.cursor(dictionary=True)
            query = """
                SELECT source_id, SUM(amount) as total_expenses
                FROM expenses
                WHERE category_val = 'marketing'
                AND expense_date BETWEEN %s AND %s
                GROUP BY source_id
            """
            cursor.execute(query, (date_from, date_to))
            for row in cursor.fetchall():
                if row['source_id']:
                    expenses_by_key[str(row['source_id'])] = float(row['total_expenses'])
            cursor.close()
            conn.close()

        # Сделки и счета
        successful_leads = [l for l in all_leads if l['STATUS_ID'] == 'CONVERTED' and l.get('CONTACT_ID')]
        contact_ids = list(set([l['CONTACT_ID'] for l in successful_leads]))
        deals = fetch_paginated_data('crm.deal.list', {
            'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
            'select': ['ID', 'CONTACT_ID']
        }) if contact_ids else []

        deal_ids = [d['ID'] for d in deals]
        invoices = fetch_paginated_data('crm.invoice.list', {
            'filter': {'UF_DEAL_ID': deal_ids},
            'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE']
        }) if deal_ids else []

        paid_deal_ids = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
        deals_by_contact = defaultdict(list)
        for deal in deals:
            deals_by_contact[deal['CONTACT_ID']].append(deal)

        # Группировка
        def get_group_key(lead):
            if grouping == 'utm_campaign':
                return lead.get('UTM_CAMPAIGN') or '(не задан)'
            elif grouping == 'utm_content':
                return lead.get('UTM_CONTENT') or '(не задан)'
            else:
                return str(lead.get('SOURCE_ID', 'unknown'))

        def get_group_display_name(key, lead):
            if grouping == 'utm_campaign':
                label = utm_label_map.get(('utm_campaign', key))
                return label if label else key
            elif grouping == 'utm_content':
                label = utm_label_map.get(('utm_content', key))
                return label if label else key
            else:
                return source_map.get(key, f"Неизвестный ({key})")

        stats_by_group = defaultdict(lambda: {
            'total': 0, 'answered': 0, 'meeting_scheduled': 0, 'arrival': 0, 'success': 0,
            'clients': set(), 'clients_with_payment': set(), 'deals': set(),
            'deals_with_payment': set(), 'invoices_sum': 0, 'expenses': 0,
            'display_name': '', 'source_id_for_expenses': None,
            'lead_ids': []
        })

        for lead in all_leads:
            key = get_group_key(lead)
            stats = stats_by_group[key]
            stats['total'] += 1
            stats['display_name'] = get_group_display_name(key, lead)
            stats['lead_ids'].append(lead['ID'])

            # Для расходов всегда берём source_id
            if not stats['source_id_for_expenses']:
                stats['source_id_for_expenses'] = str(lead.get('SOURCE_ID', ''))

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
        for key, data in stats_by_group.items():
            # Расходы: для UTM-группировок берём по source, для source — напрямую
            if grouping == 'source':
                data['expenses'] = expenses_by_key.get(key, 0)
            else:
                data['expenses'] = expenses_by_key.get(data.get('source_id_for_expenses', ''), 0)

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
                "cpl": data['expenses'] / data['total'] if data['total'] > 0 else 0,
                "cpo": data['expenses'] / len(data['deals_with_payment']) if len(data['deals_with_payment']) > 0 else 0,
                "romi": calculate_romi(data['invoices_sum'], data['expenses']),
                "lead_ids": data['lead_ids']
            })

        final_statistics.sort(key=lambda x: x['total'], reverse=True)

        # Итоговая строка
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
                "group_key": "__total__",
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
                "invoices_sum": summary['invoices_sum'],
                "expenses": summary['expenses'],
                "cpl": summary['expenses'] / summary['total'] if summary['total'] > 0 else 0,
                "cpo": summary['expenses'] / summary['deals_with_payment'] if summary['deals_with_payment'] > 0 else 0,
                "romi": calculate_romi(summary['invoices_sum'], summary['expenses']),
                "lead_ids": []
            }
            final_statistics.append(summary_row)

        return jsonify(final_statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics_grouped: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def get_lead_details():
    """
    Возвращает список лидов по списку ID.
    Используется для детализации при клике на число в таблице.
    """
    try:
        ids_raw = request.args.get('ids', '')
        if not ids_raw:
            return jsonify([])

        ids = [i.strip() for i in ids_raw.split(',') if i.strip()]
        if not ids:
            return jsonify([])

        leads = fetch_paginated_data('crm.lead.list', {
            'filter': {'ID': ids},
            'select': ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'STATUS_ID', 'SOURCE_ID', 'DATE_CREATE']
        })

        result = []
        for lead in leads:
            name = f"{lead.get('LAST_NAME', '')} {lead.get('NAME', '')}".strip() or lead.get('TITLE', f"Лид #{lead['ID']}")
            result.append({
                'id': lead['ID'],
                'name': name,
                'status_id': lead.get('STATUS_ID', ''),
                'date_create': lead.get('DATE_CREATE', ''),
                'url': f"https://b24-p41gmg.bitrix24.ru/crm/lead/show/{lead['ID']}/"
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_lead_details: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def get_comparison_data():
    """
    Режим 'Сравнение': возвращает данные по периодам (месяцы или недели) за выбранный год.
    Поддерживает группировку и выбор показателей.
    Для каждого периода возвращает count, % от пред., % от общего, Δ count, Δ конверсия.
    """
    try:
        year = request.args.get('year')
        period_type = request.args.get('period_type', 'month')  # month | week
        grouping = request.args.get('grouping', 'source')
        group_value = request.args.get('group_value', '')
        source_id = request.args.get('source_id', '')
        sales_dept = request.args.get('sales_dept', '')
        metrics_raw = request.args.get('metrics', '')

        if not year:
            return jsonify({'error': 'year обязателен'}), 400

        year = int(year)

        # Все доступные метрики
        all_metrics = [
            'expenses', 'total', 'cpl', 'answered', 'meeting_scheduled',
            'arrival', 'success', 'clients', 'clients_with_payment',
            'deals', 'deals_with_payment', 'cpo', 'invoices_sum', 'romi'
        ]
        selected_metrics = [m for m in metrics_raw.split(',') if m in all_metrics] if metrics_raw else all_metrics

        # Определяем периоды
        import calendar
        periods = []
        if period_type == 'month':
            for m in range(1, 13):
                periods.append({
                    'label': _month_name(m),
                    'date_from': f"{year}-{m:02d}-01",
                    'date_to': f"{year}-{m:02d}-{calendar.monthrange(year, m)[1]:02d}"
                })
        else:  # week
            import datetime
            d = datetime.date(year, 1, 1)
            # Найдём первый понедельник
            while d.weekday() != 0:
                d += datetime.timedelta(days=1)
            week_num = 1
            while d.year == year:
                end = d + datetime.timedelta(days=6)
                if end.year > year:
                    end = datetime.date(year, 12, 31)
                periods.append({
                    'label': f"Неделя {week_num}",
                    'date_from': d.strftime('%Y-%m-%d'),
                    'date_to': end.strftime('%Y-%m-%d')
                })
                d += datetime.timedelta(days=7)
                week_num += 1

        # Собираем данные по каждому периоду
        periods_data = []
        for period in periods:
            pdata = _compute_period_stats(
                period['date_from'], period['date_to'],
                grouping, group_value, source_id, sales_dept
            )
            periods_data.append({
                'label': period['label'],
                'date_from': period['date_from'],
                'date_to': period['date_to'],
                'stats': pdata
            })

        # Вычисляем дельты и проценты
        result_periods = []
        prev_stats = None
        total_leads_year = sum(p['stats'].get('total', 0) for p in periods_data)

        for pd_item in periods_data:
            stats = pd_item['stats']
            period_result = {
                'label': pd_item['label'],
                'date_from': pd_item['date_from'],
                'date_to': pd_item['date_to'],
                'metrics': {}
            }

            for metric in selected_metrics:
                val = stats.get(metric, 0)
                prev_val = prev_stats.get(metric, 0) if prev_stats else None

                metric_data = {'value': val}

                # % от предыдущего периода
                if prev_val is not None:
                    if prev_val > 0:
                        metric_data['pct_from_prev'] = round((val / prev_val * 100) - 100, 2)
                    else:
                        metric_data['pct_from_prev'] = None
                    metric_data['delta'] = round(val - prev_val, 2) if isinstance(val, (int, float)) else None
                else:
                    metric_data['pct_from_prev'] = None
                    metric_data['delta'] = None

                # % от общего (только для count-метрик)
                if metric == 'total' and total_leads_year > 0:
                    metric_data['pct_from_total'] = round(val / total_leads_year * 100, 2)
                else:
                    metric_data['pct_from_total'] = None

                period_result['metrics'][metric] = metric_data

            result_periods.append(period_result)
            prev_stats = stats

        return jsonify({
            'year': year,
            'period_type': period_type,
            'grouping': grouping,
            'selected_metrics': selected_metrics,
            'periods': result_periods
        })

    except Exception as e:
        current_app.logger.error(f"Error in get_comparison_data: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def _compute_period_stats(date_from, date_to, grouping, group_value, source_id, sales_dept):
    """
    Вычисляет плоскую статистику для одного периода с учётом группировки.
    Возвращает словарь с числовыми значениями всех метрик.
    """
    lead_filter = {
        '>=DATE_CREATE': f"{date_from}T00:00:00",
        '<=DATE_CREATE': f"{date_to}T23:59:59"
    }
    if source_id:
        lead_filter['SOURCE_ID'] = source_id
    if sales_dept:
        lead_filter[SALES_DEPT_FIELD] = sales_dept
    if grouping == 'source' and group_value:
        lead_filter['SOURCE_ID'] = group_value
    elif grouping == 'utm_campaign' and group_value:
        lead_filter['UTM_CAMPAIGN'] = group_value
    elif grouping == 'utm_content' and group_value:
        lead_filter['UTM_CONTENT'] = group_value

    all_leads = fetch_paginated_data('crm.lead.list', {
        'filter': lead_filter,
        'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID', 'UTM_CAMPAIGN', 'UTM_CONTENT']
    })

    total = len(all_leads)
    answered = 0
    meeting_scheduled = 0
    arrival = 0
    success_count = 0
    clients = set()
    clients_with_payment = set()
    deals_set = set()
    deals_with_payment_set = set()
    invoices_sum = 0.0

    successful_leads = [l for l in all_leads if l['STATUS_ID'] == 'CONVERTED' and l.get('CONTACT_ID')]
    contact_ids = list(set([l['CONTACT_ID'] for l in successful_leads]))

    deals = fetch_paginated_data('crm.deal.list', {
        'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
        'select': ['ID', 'CONTACT_ID']
    }) if contact_ids else []

    deal_ids = [d['ID'] for d in deals]
    invoices = fetch_paginated_data('crm.invoice.list', {
        'filter': {'UF_DEAL_ID': deal_ids},
        'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE']
    }) if deal_ids else []

    paid_deal_ids = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
    deals_by_contact = defaultdict(list)
    for deal in deals:
        deals_by_contact[deal['CONTACT_ID']].append(deal)

    for lead in all_leads:
        status_id = lead.get('STATUS_ID')
        if status_id in LEAD_STATUS_GROUPS['answered']:
            answered += 1
        if status_id in LEAD_STATUS_GROUPS['meeting_scheduled']:
            meeting_scheduled += 1
        if status_id in LEAD_STATUS_GROUPS['arrival']:
            arrival += 1
        if status_id in LEAD_STATUS_GROUPS['success']:
            success_count += 1

        if status_id == 'CONVERTED' and lead.get('CONTACT_ID'):
            contact_id = lead['CONTACT_ID']
            clients.add(contact_id)
            contact_deals = deals_by_contact.get(contact_id, [])
            deals_set.update(d['ID'] for d in contact_deals)
            for deal in contact_deals:
                if deal['ID'] in paid_deal_ids:
                    deals_with_payment_set.add(deal['ID'])
                    clients_with_payment.add(contact_id)
            for inv in invoices:
                if inv['UF_DEAL_ID'] in {d['ID'] for d in contact_deals}:
                    invoices_sum += float(inv.get('PRICE', 0))

    # Расходы
    expenses = 0.0
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            if source_id or (grouping == 'source' and group_value):
                sid = group_value if (grouping == 'source' and group_value) else source_id
                cursor.execute(
                    "SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s AND source_id=%s",
                    (date_from, date_to, sid)
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

    clients_count = len(clients)
    clients_with_payment_count = len(clients_with_payment)
    deals_count = len(deals_set)
    deals_with_payment_count = len(deals_with_payment_set)

    return {
        'total': total,
        'answered': answered,
        'meeting_scheduled': meeting_scheduled,
        'arrival': arrival,
        'success': success_count,
        'clients': clients_count,
        'clients_with_payment': clients_with_payment_count,
        'deals': deals_count,
        'deals_with_payment': deals_with_payment_count,
        'invoices_sum': round(invoices_sum, 2),
        'expenses': round(expenses, 2),
        'cpl': round(expenses / total, 2) if total > 0 else 0,
        'cpo': round(expenses / deals_with_payment_count, 2) if deals_with_payment_count > 0 else 0,
        'romi': round(calculate_romi(invoices_sum, expenses), 2)
    }


def _month_name(m):
    names = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
             'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
    return names[m - 1]