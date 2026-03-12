from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, or_


def encode_cursor(value: str | datetime, record_id: str) -> str:
    raw_value = value.isoformat() if isinstance(value, datetime) else value
    return f"{raw_value}|{record_id}"


def decode_cursor(cursor: str) -> tuple[str, str]:
    value, separator, record_id = cursor.rpartition("|")
    if not separator or not value or not record_id:
        raise ValueError("Invalid cursor.")
    return value, record_id


def descending_cursor_filter(column, id_column, cursor_value, cursor_id):
    return or_(
        column < cursor_value,
        and_(column == cursor_value, id_column < cursor_id),
    )


def ascending_cursor_filter(column, id_column, cursor_value, cursor_id):
    return or_(
        column > cursor_value,
        and_(column == cursor_value, id_column > cursor_id),
    )


def page_rows(rows: list, limit: int) -> tuple[list, bool]:
    return rows[:limit], len(rows) > limit
