from flask import request, jsonify, current_app
from core.b24 import b24_call_method, fetch_paginated_data
from collections import defaultdict

LEAD_STATUS_GROUPS = {
    "answered": ["UC_JX4Z7B", "UC_XBXVYQ", "UC_VUPL02", "UC_3VLL3Y", "UC_MD85GI", "UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "meeting_scheduled": ["UC_O5Z3U3", "UC_TG2I2A", "UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "arrival": ["UC_DK6IWL", "UC_YL1CVZ", "CONVERTED"],
    "success": ["CONVERTED"]
}

def calculate_conversion(current, prev, total):
    return {
        "count": current,
        "conv_from_prev": (current / prev * 100) if prev > 0 else 0,
        "conv_from_total": (current / total * 100) if total > 0 else 0
    }

def get_statistics():

    try:

        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        source_id = request.args.get('source_id')
        sales_department = request.args.get('sales_department')

        if not date_from or not date_to:
            return jsonify({'error': 'Date range is required'}), 400

        lead_filter = {
            '>=DATE_CREATE': f"{date_from}T00:00:00",
            '<=DATE_CREATE': f"{date_to}T23:59:59"
        }

        if source_id:
            lead_filter['SOURCE_ID'] = source_id

        if sales_department:
            lead_filter['UF_CRM_1779024295'] = sales_department

        leads = fetch_paginated_data(
            'crm.lead.list',
            {
                'filter': lead_filter,
                'select': ['ID', 'SOURCE_ID', 'STATUS_ID']
            }
        )

        sources_result = b24_call_method(
            'crm.status.entity.items',
            {'entityId': 'SOURCE'}
        )

        source_map = {
            str(s['STATUS_ID']): s['NAME']
            for s in sources_result.get('result', [])
        }

        stats = defaultdict(lambda: {
            "total": 0,
            "answered": 0,
            "meeting_scheduled": 0,
            "arrival": 0,
            "success": 0
        })

        for lead in leads:

            sid = str(lead.get('SOURCE_ID', 'unknown'))
            stats[sid]["total"] += 1

            status = lead.get('STATUS_ID')

            for key, statuses in LEAD_STATUS_GROUPS.items():
                if status in statuses:
                    stats[sid][key] += 1

        result = []

        for sid, data in stats.items():

            total = data["total"]

            row = {
                "source_name": source_map.get(sid, sid),
                "total": total
            }

            row["answered"] = calculate_conversion(data["answered"], total, total)
            row["meeting_scheduled"] = calculate_conversion(
                data["meeting_scheduled"],
                row["answered"]["count"],
                total
            )
            row["arrival"] = calculate_conversion(
                data["arrival"],
                row["meeting_scheduled"]["count"],
                total
            )
            row["success"] = calculate_conversion(
                data["success"],
                row["arrival"]["count"],
                total
            )

            result.append(row)

        result.sort(key=lambda x: x["total"], reverse=True)

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(str(e))
        return jsonify({'error': str(e)}), 500