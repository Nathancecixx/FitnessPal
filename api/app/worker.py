from __future__ import annotations

import logging
import time

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import session_scope
from app.core.jobs import claim_next_job, complete_job, ensure_daily_jobs, fail_job
from app.modules import load_manifests


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fitnesspal.worker")


JOB_HANDLERS = {}
for manifest in load_manifests():
    JOB_HANDLERS.update(manifest.job_handlers)


def run_once() -> bool:
    with session_scope() as session:
        ensure_daily_jobs(session)
    with session_scope() as session:
        job = claim_next_job(session)
        if not job:
            return False
        handler = JOB_HANDLERS.get(job.job_type)
        if not handler:
            fail_job(session, job, f"No handler registered for {job.job_type}")
            logger.warning("No handler for job type %s", job.job_type)
            return True
        try:
            result = handler(session, job.payload_json)
            complete_job(session, job, result)
            logger.info("Completed job %s (%s)", job.id, job.job_type)
        except Exception as exc:
            fail_job(session, job, str(exc))
            logger.exception("Job %s failed", job.id)
        return True


def main() -> None:
    logger.info("Worker started")
    while True:
        try:
            did_work = run_once()
            if not did_work:
                time.sleep(5)
        except SQLAlchemyError as exc:
            logger.warning("Database not ready for worker loop yet: %s", exc)
            time.sleep(5)


if __name__ == "__main__":
    main()
