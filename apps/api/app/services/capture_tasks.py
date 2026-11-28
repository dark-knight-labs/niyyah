"""What a capture device may read and change after it created a task: only tasks that device made (device_captures), only its owner's rows.

Reads and writes go through planner_items, so a pipeline item keeps the pipeline's rules (done moves it to the Done lane). Writes flush; the caller commits."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import Task
from app.models.user import DeviceCapture
from app.services import device_tokens, planner_items


def capture_task(task: Task, client_id: str) -> dict:
    item = planner_items.written_task(task)
    return {
        "client_id": client_id, "id": task.id, "text": item["title"], "status": item["status"], "done": task.done,
        "link": task.link, "deadline_at": item["deadline_at"], "tracked_seconds": item["tracked_seconds"],
        "timer_started_at": item["timer_started_at"], "due_on": task.due_on, "scheduled_on": task.scheduled_on,
        "lane": task.lane, "stream": task.stream, "products": list(task.products or []),
    }


async def list_for_device(db: AsyncSession, user_id: int, token_id: int, include_done: bool, limit: int) -> list[dict]:
    """This device's tasks, newest capture first. The join on user_id is a second lock: a mapping never exposes another user's task."""
    query = (select(Task, DeviceCapture.client_id)
             .join(DeviceCapture, DeviceCapture.task_id == Task.id)
             .where(DeviceCapture.device_token_id == token_id, Task.user_id == user_id))
    if not include_done:
        query = query.where(Task.done.is_(False), Task.status == "open")
    rows = (await db.execute(query.order_by(DeviceCapture.id.desc()).limit(limit))).all()
    return [capture_task(task, client_id) for task, client_id in rows]


async def patch_for_device(db: AsyncSession, user_id: int, token_id: int, client_id: str, fields: dict, today: date) -> dict | None:
    """Change the fields sent on the task this device created for `client_id`; None when this device has no such task."""
    task = await device_tokens.captured_task(db, user_id, token_id, client_id)
    if task is None:
        return None
    changes = {k: v for k, v in fields.items() if k != "done"}
    if "done" in fields and not (fields["done"] and task.done):  # ticking a done task again changes nothing (done_on stays)
        changes["status"] = "done" if fields["done"] else "open"
    task = await planner_items.update_item(db, user_id, task.id, changes, today)
    return capture_task(task, client_id)
