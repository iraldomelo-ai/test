import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

def emit_event(conn, event_type: str, entity_id, payload: dict):
    """
    Emit an event into the events table (and log). Use parameterized queries to avoid injection.
    - conn: DB connection object (psycopg2 or similar supporting cursor/execute).
    """
    occurred_at = datetime.now(timezone.utc).isoformat()

    event_record = {
        "event_type": event_type,
        "entity_id": entity_id,
        "payload": payload,
        "occurred_at": occurred_at
    }

    # Parameterized insert; adjust placeholders for your DB driver:
    # - psycopg2: %s
    # - sqlite3: ?
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO events (type, entity_id, payload, occurred_at) VALUES (%s, %s, %s, %s)",
                (event_type, entity_id, json.dumps(payload), occurred_at)
            )
        conn.commit()
        logger.info("Evento %s disparado para %s", event_type, entity_id)
    except Exception:
        conn.rollback()
        logger.exception("Falha ao gravar evento %s para %s", event_type, entity_id)
        raise

def handle_movement_imported(movement, create_task, calculate_deadline):
    """
    Handler example: when a movement mentions a 'prazo', create a review task.
    - movement: object/dict with at least 'descricao' and 'process_id' fields.
    - create_task: callable(process_id, title, due_at=...)
    - calculate_deadline: callable() -> datetime
    """
    descricao = ''
    if isinstance(movement, dict):
        descricao = movement.get('descricao', '') or ''
        process_id = movement.get('process_id')
    else:
        descricao = getattr(movement, 'descricao', '') or ''
        process_id = getattr(movement, 'process_id', None)

    if not process_id:
        logger.warning("Movement without process_id received; skipping task creation.")
        return

    if 'prazo' in descricao.lower():
        due = calculate_deadline()
        create_task(process_id, "Revisar Prazo", due_at=due)
        logger.info("Criada tarefa 'Revisar Prazo' para processo %s", process_id)
