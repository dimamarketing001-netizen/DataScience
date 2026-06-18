from flask import request, jsonify, current_app
from core.b24 import b24_call_method, fetch_paginated_data, fetch_paginated_stage_history
from core.db import get_db_connection
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

LEAD_STATUS_GROUPS = {
    "answered": ["UC_JX4Z7B", "UC_XBXVYQ", "UC_VUPL02", "UC_3VLL3Y", "UC_MD85GI",
                 "UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "meeting_scheduled": ["UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "arrival": ["UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "success": ["CONVERTED"]
}

# Порядок групп от низшей к высшей (для first_touch логики)
LEAD_STATUS_GROUP_ORDER = ["answered", "meeting_scheduled", "arrival", "success"]

SALES_DEPT_FIELD = "UF_CRM_1779024295"
B24_PORTAL = "https://b24-p41gmg.bitrix24.ru"
CONVERSION_METRICS = {"answered", "meeting_scheduled", "arrival", "success", "clients_with_payment"}


# =====================================================================
# ОРИГИНАЛЬНАЯ ФУНКЦИЯ — НЕ ИЗМЕНЕНА
# =====================================================================
def get_statistics():
    try:
        date_from = request.args.get('date_from')
        date_to   = request.args.get('date_to')
        source_id = request.args.get('source_id')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        lead_filter = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59"
        }
        if source_id:
            lead_filter['SOURCE_ID'] = source_id

        all_leads = fetch_paginated_data('crm.lead.list', {
            'filter': lead_filter,
            'select': ['ID', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID']
        })

        sources_result = b24_call_method('crm.status.entity.items', {'entityId': 'SOURCE'})
        source_map = {str(s['STATUS_ID']): s['NAME'] for s in sources_result.get('result', [])}

        successful_leads = [l for l in all_leads
                            if l['STATUS_ID'] == 'CONVERTED' and l.get('CONTACT_ID')]
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

        expenses_by_source = defaultdict(float)
        conn = get_db_connection()
        if conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(
                "SELECT source_id, SUM(amount) as total_expenses FROM expenses "
                "WHERE category_val = 'marketing' AND expense_date BETWEEN %s AND %s "
                "GROUP BY source_id",
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

        paid_deal_ids    = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
        deals_by_contact = defaultdict(list)
        for deal in deals:
            deals_by_contact[deal['CONTACT_ID']].append(deal)

        for lead in all_leads:
            sid   = str(lead.get('SOURCE_ID', 'unknown'))
            stats = stats_by_source[sid]
            stats['total'] += 1
            status_id = lead.get('STATUS_ID')
            for group, statuses in LEAD_STATUS_GROUPS.items():
                if status_id in statuses:
                    stats[group] += 1

            if status_id == 'CONVERTED' and lead.get('CONTACT_ID'):
                cid = lead['CONTACT_ID']
                stats['clients'].add(cid)
                contact_deals = deals_by_contact.get(cid, [])
                stats['deals'].update(d['ID'] for d in contact_deals)
                for deal in contact_deals:
                    if deal['ID'] in paid_deal_ids:
                        stats['deals_with_payment'].add(deal['ID'])
                        stats['clients_with_payment'].add(cid)
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
                "cpl":  data['expenses'] / data['total'] if data['total'] > 0 else 0,
                "cpo":  data['expenses'] / len(data['deals_with_payment']) if len(data['deals_with_payment']) > 0 else 0,
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
            final_statistics.append({
                "source_name": "Итого", "total": summary['total'],
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
                "romi": calculate_romi(summary['invoices_sum'], summary['expenses'])
            })

        return jsonify(final_statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def calculate_conversion(current, prev, total):
    return {
        "count": current,
        "conv_from_prev":  (current / prev  * 100) if prev  > 0 else 0,
        "conv_from_total": (current / total * 100) if total > 0 else 0
    }

def calculate_romi(revenue, expenses):
    return ((revenue - expenses) / expenses * 100) if expenses > 0 else 0


# =====================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =====================================================================

def _parse_list_param(param_name):
    vals = request.args.getlist(f'{param_name}[]')
    if not vals:
        single = request.args.get(param_name, '')
        if single:
            vals = [single]
    return vals


def _dt_from_str(s):
    """Парсит строку даты Битрикс24 в datetime (naive, без timezone)."""
    from datetime import datetime
    if not s:
        return None
    try:
        clean = s[:19]
        return datetime.strptime(clean, '%Y-%m-%dT%H:%M:%S')
    except Exception:
        return None


def _date_in_period(dt_str, dt_from, dt_to):
    """Проверяет, попадает ли дата из строки в период [dt_from, dt_to]."""
    dt = _dt_from_str(dt_str)
    if dt is None:
        return False
    return dt_from <= dt <= dt_to


def _get_period_datetimes(date_from, date_to):
    from datetime import datetime
    dt_from = datetime.strptime(f"{date_from}T00:00:00", '%Y-%m-%dT%H:%M:%S')
    dt_to   = datetime.strptime(f"{date_to}T23:59:59",   '%Y-%m-%dT%H:%M:%S')
    return dt_from, dt_to


def get_sales_dept_enum():
    try:
        result = b24_call_method('crm.lead.fields', {})
        if not result or 'result' not in result:
            return jsonify({'error': 'Не удалось получить поля лида'}), 500
        field_info = result.get('result', {}).get(SALES_DEPT_FIELD)
        if not field_info:
            return jsonify({'error': f'Поле {SALES_DEPT_FIELD} не найдено'}), 404
        items = field_info.get('items', [])
        return jsonify([{'id': str(i['ID']), 'value': i['VALUE']} for i in items])
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
        data        = request.get_json()
        utm_type    = data.get('utm_type')
        utm_value   = data.get('utm_value')
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
# ИСТОРИЯ СТАТУСОВ: ПОСЛЕДНЕЕ КАСАНИЕ (last_touch)
# Берём последний статус лида в периоде
# =====================================================================

def _get_leads_effective_statuses_in_period(lead_ids, date_from, date_to):
    """
    Получает историю статусов лидов за период через crm.stagehistory.list.
    Возвращает {lead_id: last_status_id_in_period}
    Если у лида нет записей истории в периоде — его нет в словаре → '__CREATED_ONLY__'
    """
    if not lead_ids:
        return {}

    result_map     = {}
    history_by_lead = defaultdict(list)
    batch_size     = 50
    lead_ids_list  = list(lead_ids)

    logger.info(
        f"_get_leads_effective_statuses_in_period (last_touch): "
        f"всего лидов={len(lead_ids_list)}, period={date_from} — {date_to}"
    )

    for i in range(0, len(lead_ids_list), batch_size):
        batch = lead_ids_list[i:i + batch_size]
        logger.info(
            f"  Батч {i//batch_size + 1}: запрашиваем историю для {len(batch)} лидов"
        )
        params = {
            'entityTypeId': 1,
            'order': {'ID': 'ASC'},
            'filter': {
                '@OWNER_ID': batch,
                '>=CREATED_TIME': f"{date_from}T00:00:00",
                '<=CREATED_TIME': f"{date_to}T23:59:59",
            },
            'select': ['ID', 'OWNER_ID', 'STATUS_ID', 'CREATED_TIME']
        }
        items = fetch_paginated_stage_history('crm.stagehistory.list', params)
        logger.info(f"  Получено записей в батче: {len(items)}")
        for item in items:
            owner_id = str(item.get('OWNER_ID', ''))
            if owner_id:
                history_by_lead[owner_id].append({
                    'id':        item.get('ID'),
                    'status_id': item.get('STATUS_ID', ''),
                    'created':   item.get('CREATED_TIME', '')
                })

    for lead_id, records in history_by_lead.items():
        if records:
            last = records[-1]  # уже отсортировано по ID ASC
            result_map[lead_id] = last['status_id']
            logger.debug(
                f"  Лид {lead_id}: last_touch статус={last['status_id']} "
                f"(время={last['created']})"
            )

    logger.info(
        f"  Итого лидов с историей в периоде: {len(result_map)} из {len(lead_ids_list)}"
    )
    return result_map


# =====================================================================
# ИСТОРИЯ СТАТУСОВ: ПЕРВОЕ КАСАНИЕ (first_touch)
# Для каждой группы статусов берём дату ПЕРВОГО попадания в группу
# Запрашиваем ПОЛНУЮ историю лида (без фильтра по дате),
# находим первое вхождение в каждую группу и проверяем попадает ли оно в период
# =====================================================================

def _get_leads_first_touch_statuses(lead_ids, date_from, date_to):
    """
    Для каждого лида определяет какие группы статусов были достигнуты
    ВПЕРВЫЕ в указанном периоде.

    Возвращает:
    {
        lead_id: {
            'answered': True/False,          # первое попадание в группу было в периоде
            'meeting_scheduled': True/False,
            'arrival': True/False,
            'success': True/False,
            'last_status_in_period': 'STATUS_ID' или None  # последний статус в периоде
        }
    }

    Логика:
    1. Запрашиваем ПОЛНУЮ историю лида (без фильтра дат) — чтобы найти ПЕРВОЕ вхождение
    2. Для каждой группы находим запись с минимальным ID (самая ранняя)
    3. Проверяем: дата этой записи попадает в период?
    4. Если да — лид засчитывается в эту группу за данный период
    5. Также определяем последний статус лида В периоде (для CONVERTED → сделки)
    """
    if not lead_ids:
        return {}

    result_map      = {}
    full_history    = defaultdict(list)  # {lead_id: все записи истории}
    batch_size      = 50
    lead_ids_list   = list(lead_ids)

    logger.info(
        f"_get_leads_first_touch_statuses: "
        f"всего лидов={len(lead_ids_list)}, period={date_from} — {date_to}"
    )

    dt_from, dt_to = _get_period_datetimes(date_from, date_to)

    # Запрашиваем ПОЛНУЮ историю (без фильтра по дате)
    for i in range(0, len(lead_ids_list), batch_size):
        batch = lead_ids_list[i:i + batch_size]
        logger.info(
            f"  Батч {i//batch_size + 1}: полная история для {len(batch)} лидов"
        )
        params = {
            'entityTypeId': 1,
            'order': {'ID': 'ASC'},
            'filter': {
                '@OWNER_ID': batch,
            },
            'select': ['ID', 'OWNER_ID', 'STATUS_ID', 'CREATED_TIME']
        }
        items = fetch_paginated_stage_history('crm.stagehistory.list', params)
        logger.info(f"  Получено записей в батче: {len(items)}")
        for item in items:
            owner_id = str(item.get('OWNER_ID', ''))
            if owner_id:
                full_history[owner_id].append({
                    'id':        int(item.get('ID', 0)),
                    'status_id': item.get('STATUS_ID', ''),
                    'created':   item.get('CREATED_TIME', '')
                })

    # Обрабатываем историю каждого лида
    for lead_id in lead_ids_list:
        records = full_history.get(lead_id, [])
        # Сортируем по ID (хронологически)
        records_sorted = sorted(records, key=lambda r: r['id'])

        lead_result = {
            'answered':          False,
            'meeting_scheduled': False,
            'arrival':           False,
            'success':           False,
            'last_status_in_period': None
        }

        # Для каждой группы ищем ПЕРВОЕ вхождение любого статуса из группы
        for group in LEAD_STATUS_GROUP_ORDER:
            group_statuses = set(LEAD_STATUS_GROUPS[group])
            # Первая запись истории где статус входит в группу
            first_in_group = None
            for rec in records_sorted:
                if rec['status_id'] in group_statuses:
                    first_in_group = rec
                    break  # нашли первое — дальше не смотрим

            if first_in_group:
                # Проверяем: дата первого вхождения попадает в период?
                first_dt = _dt_from_str(first_in_group['created'])
                if first_dt and dt_from <= first_dt <= dt_to:
                    lead_result[group] = True
                    logger.debug(
                        f"  Лид {lead_id}: группа '{group}' — первое вхождение "
                        f"статус={first_in_group['status_id']} "
                        f"время={first_in_group['created']} → В ПЕРИОДЕ ✓"
                    )
                else:
                    logger.debug(
                        f"  Лид {lead_id}: группа '{group}' — первое вхождение "
                        f"статус={first_in_group['status_id']} "
                        f"время={first_in_group['created']} → ВНЕ ПЕРИОДА ✗"
                    )

        # Определяем последний статус лида В периоде (для CONVERTED → сделки)
        in_period = [r for r in records_sorted
                     if _date_in_period(r['created'], dt_from, dt_to)]
        if in_period:
            lead_result['last_status_in_period'] = in_period[-1]['status_id']

        result_map[lead_id] = lead_result

    converted_count = sum(
        1 for v in result_map.values()
        if v.get('last_status_in_period') == 'CONVERTED'
    )
    logger.info(
        f"  first_touch: обработано лидов={len(result_map)}, "
        f"CONVERTED в периоде={converted_count}"
    )
    return result_map


# =====================================================================
# ОСНОВНАЯ ГРУППИРОВАННАЯ СТАТИСТИКА
# =====================================================================

def get_statistics_grouped():
    """
    Два режима:
    standard  — берём лиды по DATE_CREATE, текущие статусы без доп. фильтров
    strict    — берём лиды по DATE_CREATE, статусы только изменённые в периоде

    Атрибут (только для strict):
    last_touch — последний статус лида в периоде (как раньше)
    first_touch — для каждой группы берём дату первого попадания в группу
    """
    try:
        date_from    = request.args.get('date_from')
        date_to      = request.args.get('date_to')
        grouping     = request.args.get('grouping', 'source')
        period_mode  = request.args.get('period_mode', 'standard')
        attribution  = request.args.get('attribution', 'last_touch')

        source_ids          = _parse_list_param('source_id')
        source_ids_exclude  = _parse_list_param('source_id_exclude')
        sales_depts         = _parse_list_param('sales_dept')
        sales_depts_exclude = _parse_list_param('sales_dept_exclude')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        logger.info(
            f"get_statistics_grouped: date_from={date_from}, date_to={date_to}, "
            f"period_mode={period_mode}, attribution={attribution}, "
            f"grouping={grouping}, source_ids={source_ids}, sales_depts={sales_depts}"
        )

        dt_from, dt_to = _get_period_datetimes(date_from, date_to)

        # --- Лиды по DATE_CREATE ---
        lead_filter = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59"
        }
        if source_ids:
            lead_filter['SOURCE_ID'] = source_ids
        if sales_depts:
            lead_filter[SALES_DEPT_FIELD] = sales_depts

        all_leads = fetch_paginated_data('crm.lead.list', {
            'filter': lead_filter,
            'select': ['ID', 'TITLE', 'SOURCE_ID', 'STATUS_ID', 'CONTACT_ID',
                       'UTM_CAMPAIGN', 'UTM_CONTENT', 'DATE_CREATE', 'DATE_MODIFY',
                       SALES_DEPT_FIELD]
        })

        logger.info(f"Получено лидов: {len(all_leads)}")

        if source_ids_exclude:
            before = len(all_leads)
            all_leads = [l for l in all_leads
                         if str(l.get('SOURCE_ID', '')) not in source_ids_exclude]
            logger.info(f"После исключения источников: {len(all_leads)} (было {before})")

        if sales_depts_exclude:
            before = len(all_leads)
            all_leads = [l for l in all_leads
                         if str(l.get(SALES_DEPT_FIELD, '')) not in sales_depts_exclude]
            logger.info(f"После исключения отделов: {len(all_leads)} (было {before})")

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

        all_lead_ids = [l['ID'] for l in all_leads]

        # ---------------------------------------------------------------
        # Определяем статусы в зависимости от режима и атрибута
        # ---------------------------------------------------------------
        # Для standard — просто текущий статус
        # Для strict + last_touch — последний статус в периоде из истории
        # Для strict + first_touch — специальная структура по группам
        # ---------------------------------------------------------------

        # Для last_touch и standard: {lead_id: status_id или '__CREATED_ONLY__'}
        lead_effective_statuses = {}
        # Для first_touch: {lead_id: {group: True/False, last_status_in_period: ...}}
        lead_first_touch_data   = {}

        if period_mode == 'strict':
            if attribution == 'first_touch':
                logger.info(
                    f"Режим STRICT + FIRST_TOUCH: "
                    f"запрашиваем полную историю для {len(all_lead_ids)} лидов"
                )
                lead_first_touch_data = _get_leads_first_touch_statuses(
                    all_lead_ids, date_from, date_to
                )
            else:
                # last_touch
                logger.info(
                    f"Режим STRICT + LAST_TOUCH: "
                    f"запрашиваем историю в периоде для {len(all_lead_ids)} лидов"
                )
                history_map = _get_leads_effective_statuses_in_period(
                    all_lead_ids, date_from, date_to
                )
                for lead in all_leads:
                    lid = lead['ID']
                    lead_effective_statuses[lid] = (
                        history_map[lid] if lid in history_map else '__CREATED_ONLY__'
                    )
        else:
            # standard
            for lead in all_leads:
                lead_effective_statuses[lead['ID']] = lead.get('STATUS_ID')

        # --- Контакты конвертированных лидов ---
        if period_mode == 'strict' and attribution == 'first_touch':
            contact_ids_for_deals = list(set([
                l['CONTACT_ID'] for l in all_leads
                if lead_first_touch_data.get(l['ID'], {}).get('last_status_in_period') == 'CONVERTED'
                and l.get('CONTACT_ID')
            ]))
        elif period_mode == 'strict':
            contact_ids_for_deals = list(set([
                l['CONTACT_ID'] for l in all_leads
                if lead_effective_statuses.get(l['ID']) == 'CONVERTED'
                and l.get('CONTACT_ID')
            ]))
        else:
            contact_ids_for_deals = list(set([
                l['CONTACT_ID'] for l in all_leads
                if l.get('STATUS_ID') == 'CONVERTED' and l.get('CONTACT_ID')
            ]))

        logger.info(f"Контактов для поиска сделок: {len(contact_ids_for_deals)}")

        # --- Сделки ---
        deals = fetch_paginated_data('crm.deal.list', {
            'filter': {'CONTACT_ID': contact_ids_for_deals, 'CATEGORY_ID': 0},
            'select': ['ID', 'CONTACT_ID', 'DATE_CREATE', 'STAGE_ID']
        }) if contact_ids_for_deals else []

        logger.info(f"Получено сделок до фильтрации: {len(deals)}")

        if period_mode == 'strict':
            deals_before = len(deals)
            deals = [d for d in deals
                     if _date_in_period(d.get('DATE_CREATE', ''), dt_from, dt_to)]
            logger.info(
                f"STRICT: сделок после фильтрации по периоду: "
                f"{len(deals)} (было {deals_before})"
            )

        deal_ids = [d['ID'] for d in deals]

        # --- Счета ---
        invoices = fetch_paginated_data('crm.invoice.list', {
            'filter': {'UF_DEAL_ID': deal_ids},
            'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE', 'DATE_CREATE', 'DATE_BILL']
        }) if deal_ids else []

        logger.info(f"Получено счетов до фильтрации: {len(invoices)}")

        if period_mode == 'strict':
            inv_before = len(invoices)
            invoices = [inv for inv in invoices
                        if _date_in_period(
                            inv.get('DATE_CREATE', '') or inv.get('DATE_BILL', ''),
                            dt_from, dt_to
                        )]
            logger.info(
                f"STRICT: счетов после фильтрации: {len(invoices)} (было {inv_before})"
            )

        paid_deal_ids    = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
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

            # -------------------------------------------------------
            # Подсчёт статусов в зависимости от режима и атрибута
            # -------------------------------------------------------
            if period_mode == 'strict' and attribution == 'first_touch':
                ft = lead_first_touch_data.get(lead['ID'], {})

                # Если у лида вообще нет истории в периоде — пропускаем
                # (проверяем есть ли хоть одна True группа или last_status)
                has_any = any([
                    ft.get('answered'), ft.get('meeting_scheduled'),
                    ft.get('arrival'),  ft.get('success'),
                    ft.get('last_status_in_period')
                ])
                if not has_any:
                    logger.debug(f"Лид {lead['ID']}: нет истории в периоде (first_touch)")
                    continue

                if ft.get('answered'):
                    stats['answered'] += 1
                    stats['ids_answered'].append(lead['ID'])
                if ft.get('meeting_scheduled'):
                    stats['meeting_scheduled'] += 1
                    stats['ids_meeting_scheduled'].append(lead['ID'])
                if ft.get('arrival'):
                    stats['arrival'] += 1
                    stats['ids_arrival'].append(lead['ID'])
                if ft.get('success'):
                    stats['success'] += 1
                    stats['ids_success'].append(lead['ID'])

                # Сделки и клиенты — по last_status_in_period (CONVERTED)
                if ft.get('last_status_in_period') == 'CONVERTED' and lead.get('CONTACT_ID'):
                    cid = lead['CONTACT_ID']
                    stats['clients'].add(cid)
                    contact_deals = deals_by_contact.get(cid, [])
                    stats['deals'].update(d['ID'] for d in contact_deals)
                    for deal in contact_deals:
                        if deal['ID'] in paid_deal_ids:
                            stats['deals_with_payment'].add(deal['ID'])
                            stats['clients_with_payment'].add(cid)
                    for inv in invoices:
                        if inv['UF_DEAL_ID'] in {d['ID'] for d in contact_deals}:
                            stats['invoices_sum'] += float(inv.get('PRICE', 0))

            else:
                # standard или strict + last_touch
                eff_status = lead_effective_statuses.get(lead['ID'])

                if eff_status == '__CREATED_ONLY__' or eff_status is None:
                    logger.debug(f"Лид {lead['ID']}: только создан, статусы не считаем")
                    continue

                if eff_status in LEAD_STATUS_GROUPS['answered']:
                    stats['answered'] += 1
                    stats['ids_answered'].append(lead['ID'])
                if eff_status in LEAD_STATUS_GROUPS['meeting_scheduled']:
                    stats['meeting_scheduled'] += 1
                    stats['ids_meeting_scheduled'].append(lead['ID'])
                if eff_status in LEAD_STATUS_GROUPS['arrival']:
                    stats['arrival'] += 1
                    stats['ids_arrival'].append(lead['ID'])
                if eff_status in LEAD_STATUS_GROUPS['success']:
                    stats['success'] += 1
                    stats['ids_success'].append(lead['ID'])

                if eff_status == 'CONVERTED' and lead.get('CONTACT_ID'):
                    cid = lead['CONTACT_ID']
                    stats['clients'].add(cid)
                    contact_deals = deals_by_contact.get(cid, [])
                    stats['deals'].update(d['ID'] for d in contact_deals)
                    for deal in contact_deals:
                        if deal['ID'] in paid_deal_ids:
                            stats['deals_with_payment'].add(deal['ID'])
                            stats['clients_with_payment'].add(cid)
                    for inv in invoices:
                        if inv['UF_DEAL_ID'] in {d['ID'] for d in contact_deals}:
                            stats['invoices_sum'] += float(inv.get('PRICE', 0))

        # --- Формируем результат ---
        final_statistics = []
        for key, data in stats_by_group.items():
            exp = (expenses_by_key.get(key, 0) if grouping == 'source'
                   else expenses_by_key.get(data.get('source_id_for_expenses', ''), 0))
            data['expenses'] = exp

            t   = data['total']
            an  = data['answered']
            ms  = data['meeting_scheduled']
            ar  = data['arrival']
            su  = data['success']
            cl  = len(data['clients'])
            cwp = len(data['clients_with_payment'])
            dl  = len(data['deals'])
            dwp = len(data['deals_with_payment'])

            logger.info(
                f"Группа '{data['display_name']}' ({key}): "
                f"total={t}, answered={an}, meeting={ms}, "
                f"arrival={ar}, success={su}, clients={cl}, "
                f"deals={dl}, deals_with_payment={dwp}"
            )

            final_statistics.append({
                "group_key":   key,
                "source_name": data['display_name'],
                "total": t,
                "answered":          calculate_conversion(an,  t,  t),
                "meeting_scheduled": calculate_conversion(ms,  an, t),
                "arrival":           calculate_conversion(ar,  ms, t),
                "success":           calculate_conversion(su,  ar, t),
                "clients": cl,
                "clients_with_payment": calculate_conversion(cwp, cl, t),
                "deals": dl,
                "deals_with_payment": dwp,
                "invoices_sum": data['invoices_sum'],
                "expenses":    data['expenses'],
                "cpl":  exp / t   if t   > 0 else 0,
                "cpo":  exp / dwp if dwp > 0 else 0,
                "romi": calculate_romi(data['invoices_sum'], exp),
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
            def _sum_ids(k):
                return [i for s in final_statistics for i in s.get(k, [])]

            s = {
                'total': sum(x['total'] for x in final_statistics),
                'an':    sum(x['answered']['count'] for x in final_statistics),
                'ms':    sum(x['meeting_scheduled']['count'] for x in final_statistics),
                'ar':    sum(x['arrival']['count'] for x in final_statistics),
                'su':    sum(x['success']['count'] for x in final_statistics),
                'cl':    sum(x['clients'] for x in final_statistics),
                'cwp':   sum(x['clients_with_payment']['count'] for x in final_statistics),
                'dl':    sum(x['deals'] for x in final_statistics),
                'dwp':   sum(x['deals_with_payment'] for x in final_statistics),
                'inv':   sum(x['invoices_sum'] for x in final_statistics),
                'exp':   sum(x['expenses'] for x in final_statistics),
            }
            final_statistics.append({
                "group_key": "__total__", "source_name": "Итого",
                "total": s['total'],
                "answered":          calculate_conversion(s['an'],  s['total'], s['total']),
                "meeting_scheduled": calculate_conversion(s['ms'],  s['an'],    s['total']),
                "arrival":           calculate_conversion(s['ar'],  s['ms'],    s['total']),
                "success":           calculate_conversion(s['su'],  s['ar'],    s['total']),
                "clients": s['cl'],
                "clients_with_payment": calculate_conversion(s['cwp'], s['cl'], s['total']),
                "deals": s['dl'], "deals_with_payment": s['dwp'],
                "invoices_sum": s['inv'], "expenses": s['exp'],
                "cpl":  s['exp'] / s['total'] if s['total'] > 0 else 0,
                "cpo":  s['exp'] / s['dwp']   if s['dwp']   > 0 else 0,
                "romi": calculate_romi(s['inv'], s['exp']),
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

        logger.info(f"Итого строк в результате: {len(final_statistics)}")
        return jsonify(final_statistics)

    except Exception as e:
        current_app.logger.error(f"Error in get_statistics_grouped: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# =====================================================================
# ДЕТАЛИЗАЦИЯ
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
            name = f"{c.get('LAST_NAME', '')} {c.get('NAME', '')}".strip() \
                   or f"Контакт #{c['ID']}"
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
        year        = request.args.get('year')
        period_type = request.args.get('period_type', 'month')
        grouping    = request.args.get('grouping', '')
        metrics_raw = request.args.get('metrics', '')
        period_mode = request.args.get('period_mode', 'standard')
        attribution = request.args.get('attribution', 'last_touch')

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
        selected_metrics = [m for m in metrics_raw.split(',')
                            if m in all_metrics] if metrics_raw else []

        logger.info(
            f"get_comparison_data: year={year}, period_type={period_type}, "
            f"grouping='{grouping}', period_mode={period_mode}, "
            f"attribution={attribution}, metrics={selected_metrics}"
        )

        if not selected_metrics:
            return jsonify({'error': 'Не выбраны метрики'}), 400

        import calendar as cal_mod
        import datetime as dt_mod

        today = dt_mod.date.today()

        periods = []
        if period_type == 'month':
            for m in range(1, 13):
                date_from_p = f"{year}-{m:02d}-01"
                date_to_p   = f"{year}-{m:02d}-{cal_mod.monthrange(year, m)[1]:02d}"
                # Пропускаем периоды в будущем (начало периода > сегодня)
                if dt_mod.date.fromisoformat(date_from_p) > today:
                    logger.info(f"Пропускаем будущий период: {_month_name(m)} {year}")
                    continue
                periods.append({
                    'label':     _month_name(m),
                    'date_from': date_from_p,
                    'date_to':   date_to_p
                })
        else:
            d = dt_mod.date(year, 1, 1)
            while d.weekday() != 0:
                d += dt_mod.timedelta(days=1)
            wn = 1
            while d.year == year:
                end = d + dt_mod.timedelta(days=6)
                if end.year > year:
                    end = dt_mod.date(year, 12, 31)
                # Пропускаем недели в будущем
                if d > today:
                    logger.info(f"Пропускаем будущую неделю: Нед.{wn} ({d})")
                    d += dt_mod.timedelta(days=7)
                    wn += 1
                    continue
                periods.append({
                    'label': f"Нед.{wn} ({d.strftime('%d.%m')}–{end.strftime('%d.%m')})",
                    'date_from': d.strftime('%Y-%m-%d'),
                    'date_to': end.strftime('%Y-%m-%d')
                })
                d += dt_mod.timedelta(days=7)
                wn += 1

        logger.info(f"get_comparison_data: периодов после фильтрации будущих={len(periods)}")

        row_keys = group_values if group_values else ['__all__']

        result_rows = []
        for rk in row_keys:
            gv           = '' if rk == '__all__' else rk
            periods_list = []
            prev_stats   = None

            for period in periods:
                logger.info(
                    f"  Период: {period['label']} "
                    f"({period['date_from']} — {period['date_to']}), "
                    f"group='{gv}'"
                )
                try:
                    pdata = _compute_period_stats(
                        period['date_from'], period['date_to'],
                        grouping, gv, source_ids, sales_depts,
                        sales_depts_exclude, group_values_exclude,
                        period_mode, attribution
                    )
                    logger.info(f"  Результат {period['label']}: {pdata}")
                except Exception as pe:
                    logger.error(
                        f"  Ошибка _compute_period_stats {period['label']}: {pe}",
                        exc_info=True
                    )
                    pdata = _empty_period_stats()

                period_result = {
                    'label':     period['label'],
                    'date_from': period['date_from'],
                    'date_to':   period['date_to'],
                    'metrics':   {}
                }

                for metric in selected_metrics:
                    val       = pdata.get(metric, 0)
                    prev_val  = prev_stats.get(metric, 0) if prev_stats else None
                    conv      = pdata.get(f"{metric}_conv", None)
                    prev_conv = prev_stats.get(f"{metric}_conv", None) if prev_stats else None

                    mdata = {'value': val, 'conv': conv}

                    if prev_val is not None and prev_val > 0:
                        mdata['pct_from_prev'] = round((val / prev_val * 100) - 100, 2)
                    elif prev_val == 0 and val > 0:
                        mdata['pct_from_prev'] = None
                    else:
                        mdata['pct_from_prev'] = None

                    if conv is not None and prev_conv is not None:
                        mdata['pct_conv_from_prev'] = round(conv - prev_conv, 2)
                    else:
                        mdata['pct_conv_from_prev'] = None

                    period_result['metrics'][metric] = mdata

                periods_list.append(period_result)
                prev_stats = pdata

            result_rows.append({'group_key': rk, 'periods': periods_list})

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


def _empty_period_stats():
    return {
        'total': 0,
        'answered': 0,           'answered_conv': 0.0,
        'meeting_scheduled': 0,  'meeting_scheduled_conv': 0.0,
        'arrival': 0,            'arrival_conv': 0.0,
        'success': 0,            'success_conv': 0.0,
        'clients': 0,
        'clients_with_payment': 0, 'clients_with_payment_conv': 0.0,
        'deals': 0,
        'deals_with_payment': 0,
        'invoices_sum': 0.0,
        'expenses': 0.0,
        'cpl': 0.0, 'cpo': 0.0, 'romi': 0.0
    }


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
        conn    = get_db_connection()
        utm_map = {}
        if conn:
            utm_map = _load_utm_label_map(conn)
            conn.close()
        for k in row_keys:
            labels[k] = utm_map.get((grouping, k), k)
    return labels


def _compute_period_stats(date_from, date_to, grouping, group_value,
                           source_ids, sales_depts, sales_depts_exclude,
                           group_values_exclude, period_mode='standard',
                           attribution='last_touch'):
    """
    Считает статистику за один период с поддержкой атрибута first_touch/last_touch.
    """
    dt_from, dt_to = _get_period_datetimes(date_from, date_to)

    logger.info(
        f"_compute_period_stats: {date_from}—{date_to}, "
        f"mode={period_mode}, attribution={attribution}, "
        f"grouping='{grouping}', group_value='{group_value}'"
    )

    lead_filter = {
        '>=DATE_CREATE': f"{date_from}T00:00:00",
        '<=DATE_CREATE': f"{date_to}T23:59:59"
    }
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
    logger.info(f"  Лидов: {total}")

    all_lead_ids = [l['ID'] for l in all_leads]

    # Определяем статусы
    lead_effective_statuses = {}
    lead_first_touch_data   = {}

    if period_mode == 'strict':
        if attribution == 'first_touch':
            lead_first_touch_data = _get_leads_first_touch_statuses(
                all_lead_ids, date_from, date_to
            )
        else:
            history_map = _get_leads_effective_statuses_in_period(
                all_lead_ids, date_from, date_to
            )
            for lead in all_leads:
                lid = lead['ID']
                lead_effective_statuses[lid] = (
                    history_map[lid] if lid in history_map else '__CREATED_ONLY__'
                )
    else:
        for lead in all_leads:
            lead_effective_statuses[lead['ID']] = lead.get('STATUS_ID')

    answered = meeting_scheduled = arrival = success_count = 0
    clients = set()
    clients_with_payment = set()
    deals_set = set()
    deals_with_payment_set = set()
    invoices_sum = 0.0

    # Контакты
    if period_mode == 'strict' and attribution == 'first_touch':
        contact_ids = list(set([
            l['CONTACT_ID'] for l in all_leads
            if lead_first_touch_data.get(l['ID'], {}).get('last_status_in_period') == 'CONVERTED'
            and l.get('CONTACT_ID')
        ]))
    elif period_mode == 'strict':
        contact_ids = list(set([
            l['CONTACT_ID'] for l in all_leads
            if lead_effective_statuses.get(l['ID']) == 'CONVERTED'
            and l.get('CONTACT_ID')
        ]))
    else:
        contact_ids = list(set([
            l['CONTACT_ID'] for l in all_leads
            if l.get('STATUS_ID') == 'CONVERTED' and l.get('CONTACT_ID')
        ]))

    deals = fetch_paginated_data('crm.deal.list', {
        'filter': {'CONTACT_ID': contact_ids, 'CATEGORY_ID': 0},
        'select': ['ID', 'CONTACT_ID', 'DATE_CREATE']
    }) if contact_ids else []

    if period_mode == 'strict':
        deals = [d for d in deals
                 if _date_in_period(d.get('DATE_CREATE', ''), dt_from, dt_to)]

    deal_ids = [d['ID'] for d in deals]
    invoices = fetch_paginated_data('crm.invoice.list', {
        'filter': {'UF_DEAL_ID': deal_ids},
        'select': ['ID', 'UF_DEAL_ID', 'STATUS_ID', 'PRICE', 'DATE_CREATE', 'DATE_BILL']
    }) if deal_ids else []

    if period_mode == 'strict':
        invoices = [inv for inv in invoices
                    if _date_in_period(
                        inv.get('DATE_CREATE', '') or inv.get('DATE_BILL', ''),
                        dt_from, dt_to
                    )]

    paid_deal_ids    = {inv['UF_DEAL_ID'] for inv in invoices if inv['STATUS_ID'] == 'P'}
    deals_by_contact = defaultdict(list)
    for deal in deals:
        deals_by_contact[deal['CONTACT_ID']].append(deal)

    for lead in all_leads:
        if period_mode == 'strict' and attribution == 'first_touch':
            ft = lead_first_touch_data.get(lead['ID'], {})
            has_any = any([
                ft.get('answered'), ft.get('meeting_scheduled'),
                ft.get('arrival'),  ft.get('success'),
                ft.get('last_status_in_period')
            ])
            if not has_any:
                continue

            if ft.get('answered'):           answered += 1
            if ft.get('meeting_scheduled'):  meeting_scheduled += 1
            if ft.get('arrival'):            arrival += 1
            if ft.get('success'):            success_count += 1

            if ft.get('last_status_in_period') == 'CONVERTED' and lead.get('CONTACT_ID'):
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
        else:
            eff_status = lead_effective_statuses.get(lead['ID'])
            if eff_status == '__CREATED_ONLY__' or eff_status is None:
                continue

            if eff_status in LEAD_STATUS_GROUPS['answered']:      answered += 1
            if eff_status in LEAD_STATUS_GROUPS['meeting_scheduled']: meeting_scheduled += 1
            if eff_status in LEAD_STATUS_GROUPS['arrival']:       arrival += 1
            if eff_status in LEAD_STATUS_GROUPS['success']:       success_count += 1

            if eff_status == 'CONVERTED' and lead.get('CONTACT_ID'):
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

    # Расходы
    expenses = 0.0
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            if grouping == 'source' and group_value:
                cursor.execute(
                    "SELECT COALESCE(SUM(amount),0) as total FROM expenses "
                    "WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s "
                    "AND source_id=%s",
                    (date_from, date_to, group_value)
                )
            elif source_ids:
                fmt = ','.join(['%s'] * len(source_ids))
                cursor.execute(
                    f"SELECT COALESCE(SUM(amount),0) as total FROM expenses "
                    f"WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s "
                    f"AND source_id IN ({fmt})",
                    (date_from, date_to, *source_ids)
                )
            else:
                cursor.execute(
                    "SELECT COALESCE(SUM(amount),0) as total FROM expenses "
                    "WHERE category_val='marketing' AND expense_date BETWEEN %s AND %s",
                    (date_from, date_to)
                )
            row = cursor.fetchone()
            expenses = float(row['total']) if row else 0.0
            cursor.close()
        except Exception as db_err:
            logger.error(f"  Ошибка расходов: {db_err}", exc_info=True)
        finally:
            conn.close()

    cc  = len(clients)
    cwp = len(clients_with_payment)
    dc  = len(deals_set)
    dwp = len(deals_with_payment_set)

    def conv(a, b):
        return round(a / b * 100, 2) if b > 0 else 0.0

    result = {
        'total': total,
        'answered': answered,                   'answered_conv': conv(answered, total),
        'meeting_scheduled': meeting_scheduled, 'meeting_scheduled_conv': conv(meeting_scheduled, answered),
        'arrival': arrival,                     'arrival_conv': conv(arrival, meeting_scheduled),
        'success': success_count,               'success_conv': conv(success_count, arrival),
        'clients': cc,
        'clients_with_payment': cwp,            'clients_with_payment_conv': conv(cwp, cc),
        'deals': dc,
        'deals_with_payment': dwp,
        'invoices_sum': round(invoices_sum, 2),
        'expenses': round(expenses, 2),
        'cpl':  round(expenses / total, 2) if total > 0 else 0,
        'cpo':  round(expenses / dwp,   2) if dwp   > 0 else 0,
        'romi': round(calculate_romi(invoices_sum, expenses), 2)
    }

    logger.info(
        f"  Итог: total={total}, answered={answered}, meeting={meeting_scheduled}, "
        f"arrival={arrival}, success={success_count}, clients={cc}, dwp={dwp}"
    )
    return result


def _month_name(m):
    return ['Январь','Февраль','Март','Апрель','Май','Июнь',
            'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'][m - 1]