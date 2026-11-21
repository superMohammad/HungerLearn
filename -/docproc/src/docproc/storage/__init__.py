from docproc.config import Settings
from docproc.storage.base import SqlRepository


def make_repository(settings: Settings, init: bool = True) -> SqlRepository:
    if settings.backend == "postgres":
        from docproc.storage.postgres import PostgresRepository

        repo: SqlRepository = PostgresRepository(settings.pg_dsn)
    else:
        from docproc.storage.sqlite import SqliteRepository

        repo = SqliteRepository(settings.sqlite_path)
    if init:
        repo.init_schema()
    return repo


__all__ = ["SqlRepository", "make_repository"]
