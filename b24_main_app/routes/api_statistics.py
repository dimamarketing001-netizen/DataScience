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

def get_statistics():
    """
    Универсальная статистика:
    group_by:
        - source (по умолчанию)
        - utm_campaign
        - utm_content
    """

    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')
        group_by = request.args.get('group_by', 'source')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        # --- Определяем поле группировки ---
        if group_by == 'utm_campaign':
            group_field = 'UTM_CAMPAIGN'
        elif group_by == 'utm_content':
            group_field = 'UTM_CONTENT'
        else:
            group_field = 'SOURCE_ID'
            group_by = 'source'  # если передали что-то левое

        # --- Фильтр лидов ---
        lead_filter = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59"
        }

        sales_department = request.args.get('sales_department')

        if sales_department:
            lead_filter['UF_CRM_1779024295'] = sales_department

        if source_id and group_by == 'source':
            lead_filter['SOURCE_ID'] = source_id

        # --- Получаем лиды ---
        all_leads = fetch_paginated_data(
            'crm.lead.list',
            {
                'filter': lead_filter,
                'select': ['ID', 'STATUS_ID', 'CONTACT_ID', group_field]
            }
        )

        # --- Получаем карту источников (если группировка по source) ---
        source_map = {}
        if group_by == 'source':
            sources_result = b24_call_method(
                'crm.status.entity.items',
                {'entityId': 'SOURCE'}
            )
            if sources_result and sources_result.get('result'):
                source_map = {
                    str(s['STATUS_ID']): s['NAME']
                    for s in sources_result['result']
                }

        # --- Группируем ---
        stats_by_group = defaultdict(lambda: {
            'total': 0,
            'success': 0
        })

        for lead in all_leads:
            group_value = str(lead.get(group_field) or 'unknown')

            stats = stats_by_group[group_value]
            stats['total'] += 1

            if lead.get('STATUS_ID') == 'CONVERTED':
                stats['success'] += 1

        # --- Загружаем пользовательские UTM-названия ---
        utm_label_map = {}

        if group_by in ['utm_campaign', 'utm_content']:
            conn = get_db_connection()
            if conn:
                cursor = conn.cursor(dictionary=True)
                try:
                    cursor.execute(
                        "SELECT utm_value, custom_name FROM utm_labels WHERE utm_type = %s",
                        (group_by,)
                    )
                    rows = cursor.fetchall()
                    utm_label_map = {
                        row['utm_value']: row['custom_name']
                        for row in rows
                    }
                finally:
                    cursor.close()
                    conn.close()

        # --- Формируем итог ---
        final_statistics = []

        for group_value, data in stats_by_group.items():

            if group_by == 'source':
                group_name = source_map.get(group_value, f"Неизвестный ({group_value})")
            elif group_by in ['utm_campaign', 'utm_content']:
                group_name = utm_label_map.get(group_value, group_value)
            else:
                group_name = group_value

            final_statistics.append({
                "group_value": group_value,
                "group_name": group_name,
                "total": data['total'],
                "success": data['success']
            })

        # сортировка по количеству лидов
        final_statistics.sort(key=lambda x: x['total'], reverse=True)

        return jsonify(final_statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def calculate_conversion(current, prev, total):
    return {"count": current, "conv_from_prev": (current / prev * 100) if prev > 0 else 0, "conv_from_total": (current / total * 100) if total > 0 else 0}

def calculate_romi(revenue, expenses):
    return ((revenue - expenses) / expenses * 100) if expenses > 0 else 0

def get_utm_values():
    """
    Возвращает список всех найденных utm_campaign или utm_content
    вместе с пользовательскими названиями (если заданы)
    """

    try:
        utm_type = request.args.get('utm_type')

        if utm_type not in ['utm_campaign', 'utm_content']:
            return jsonify({'error': 'Invalid utm_type'}), 400

        field_name = 'UTM_CAMPAIGN' if utm_type == 'utm_campaign' else 'UTM_CONTENT'

        # --- Получаем все лиды ---
        leads = fetch_paginated_data(
            'crm.lead.list',
            {
                'select': [field_name],
                'filter': {}
            }
        )

        # --- Собираем уникальные значения ---
        utm_values = set()

        for lead in leads:
            value = lead.get(field_name)
            if value:
                utm_values.add(value)

        utm_values = sorted(list(utm_values))

        # --- Загружаем пользовательские названия ---
        conn = get_db_connection()
        label_map = {}

        if conn:
            cursor = conn.cursor(dictionary=True)
            try:
                cursor.execute(
                    "SELECT utm_value, custom_name FROM utm_labels WHERE utm_type=%s",
                    (utm_type,)
                )
                rows = cursor.fetchall()
                label_map = {
                    row['utm_value']: row['custom_name']
                    for row in rows
                }
            finally:
                cursor.close()
                conn.close()

        # --- Формируем ответ ---
        result = []

        for value in utm_values:
            result.append({
                "utm_value": value,
                "custom_name": label_map.get(value, "")
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_utm_values: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def save_utm_label():
    """
    Сохраняет или обновляет пользовательское название UTM
    """

    try:
        data = request.get_json()

        utm_type = data.get('utm_type')
        utm_value = data.get('utm_value')
        custom_name = data.get('custom_name')

        if not utm_type or not utm_value:
            return jsonify({'error': 'utm_type and utm_value required'}), 400

        conn = get_db_connection()
        if not conn:
            return jsonify({'error': 'DB connection failed'}), 500

        cursor = conn.cursor()

        query = """
            INSERT INTO utm_labels (utm_type, utm_value, custom_name)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE custom_name = VALUES(custom_name)
        """

        cursor.execute(query, (utm_type, utm_value, custom_name))
        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f"Error in save_utm_label: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def get_sales_departments():
    """
    Возвращает список всех значений пользовательского поля UF_CRM_1779024295
    """

    try:
        response = b24_call_method(
            'crm.lead.userfield.get',
            {'id': 'UF_CRM_1779024295'}
        )

        if not response or not response.get('result'):
            return jsonify([])

        field = response['result']
        items = field.get('LIST', [])

        result = []

        for item in items:
            result.append({
                "id": item['ID'],
                "name": item['VALUE']
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_sales_departments: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def get_statistics_details():
    """
    Возвращает список лидов для выбранной группы
    """

    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        group_by = request.args.get('group_by', 'source')
        group_value = request.args.get('group_value')

        if not date_from or not date_to or not group_value:
            return jsonify({'error': 'Missing parameters'}), 400

        # Определяем поле группировки
        if group_by == 'utm_campaign':
            group_field = 'UTM_CAMPAIGN'
        elif group_by == 'utm_content':
            group_field = 'UTM_CONTENT'
        else:
            group_field = 'SOURCE_ID'

        lead_filter = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59",
            group_field: group_value
        }

        leads = fetch_paginated_data(
            'crm.lead.list',
            {
                'filter': lead_filter,
                'select': ['ID', 'TITLE']
            }
        )

        result = []

        for lead in leads:
            result.append({
                "id": lead['ID'],
                "title": lead.get('TITLE', f"Лид #{lead['ID']}")
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics_details: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

def get_statistics_comparison():

    try:
        year = request.args.get('year')
        group_by = request.args.get('group_by', 'source')
        metrics = request.args.getlist('metrics')
        period_type = request.args.get('period_type', 'month')

        if not year:
            return jsonify({'error': 'Year required'}), 400

        year = int(year)

        # Определяем поле группировки
        if group_by == 'utm_campaign':
            group_field = 'UTM_CAMPAIGN'
        elif group_by == 'utm_content':
            group_field = 'UTM_CONTENT'
        else:
            group_field = 'SOURCE_ID'

        stats = {}

        for month in range(1, 13):

            from datetime import datetime, timedelta

            stats = {}

            if period_type == 'week':

                # Получаем первую неделю года
                current = datetime(year, 1, 1)

                week_index = 1

                while current.year == year:

                    week_start = current - timedelta(days=current.weekday())
                    week_end = week_start + timedelta(days=6)

                    date_from = week_start.strftime("%Y-%m-%d")
                    date_to = week_end.strftime("%Y-%m-%d")

                    lead_filter = {
                        '>=DATE_CREATE': f"{date_from}T00:00:00",
                        '<=DATE_CREATE': f"{date_to}T23:59:59"
                    }

                    leads = fetch_paginated_data(
                        'crm.lead.list',
                        {
                            'filter': lead_filter,
                            'select': ['ID', 'STATUS_ID', group_field]
                        }
                    )

                    week_data = {}

                    for lead in leads:
                        group_value = str(lead.get(group_field) or 'unknown')

                        if group_value not in week_data:
                            week_data[group_value] = {
                                "total": 0,
                                "answered": 0,
                                "meeting_scheduled": 0,
                                "arrival": 0,
                                "success": 0
                            }

                        week_data[group_value]["total"] += 1

                        status = lead.get('STATUS_ID')

                        for key, statuses in LEAD_STATUS_GROUPS.items():
                            if status in statuses:
                                week_data[group_value][key] += 1

                    stats[week_index] = week_data

                    current += timedelta(days=7)
                    week_index += 1

            else:
                # ===== МЕСЯЦЫ =====

                for month in range(1, 13):

                    date_from = f"{year}-{str(month).zfill(2)}-01"

                    if month == 12:
                        date_to = f"{year}-12-31"
                    else:
                        next_month = month + 1
                        date_to = f"{year}-{str(next_month).zfill(2)}-01"

                    lead_filter = {
                        '>=DATE_CREATE': f"{date_from}T00:00:00",
                        '<=DATE_CREATE': f"{date_to}T23:59:59"
                    }

                    leads = fetch_paginated_data(
                        'crm.lead.list',
                        {
                            'filter': lead_filter,
                            'select': ['ID', 'STATUS_ID', group_field]
                        }
                    )

                    month_data = {}

                    for lead in leads:

                        group_value = str(lead.get(group_field) or 'unknown')

                        if group_value not in month_data:
                            month_data[group_value] = {
                                "total": 0,
                                "answered": 0,
                                "meeting_scheduled": 0,
                                "arrival": 0,
                                "success": 0
                            }

                        month_data[group_value]["total"] += 1

                        status = lead.get('STATUS_ID')

                        for key, statuses in LEAD_STATUS_GROUPS.items():
                            if status in statuses:
                                month_data[group_value][key] += 1

                    for group_value, data in month_data.items():
                        total = data["total"]

                        data["total"] = {
                            "count": total
                        }

                        data["answered"] = calculate_conversion(
                            data["answered"],
                            total,
                            total
                        )

                        data["meeting_scheduled"] = calculate_conversion(
                            data["meeting_scheduled"],
                            data["answered"]["count"],
                            total
                        )

                        data["arrival"] = calculate_conversion(
                            data["arrival"],
                            data["meeting_scheduled"]["count"],
                            total
                        )

                        data["success"] = calculate_conversion(
                            data["success"],
                            data["arrival"]["count"],
                            total
                        )

                    stats[month] = month_data

        # Собираем все группы
        all_groups = set()
        for month_data in stats.values():
            for group in month_data.keys():
                all_groups.add(group)

        result = []

        for group in all_groups:

            row = {
                "group_value": group,
                "values": {}
            }

            for month in range(1, 13):
                row["values"][month] = stats.get(month, {}).get(group, {
                    "total": 0,
                    "answered": 0,
                    "meeting_scheduled": 0,
                    "arrival": 0,
                    "success": 0
                })

            result.append(row)

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics_comparison: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500