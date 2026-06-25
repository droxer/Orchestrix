from __future__ import annotations

import logging
import os
import sys
from typing import Any

from loguru import logger


class InterceptHandler(logging.Handler):
    """Route standard-library logging records into loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = str(record.levelno)

        # Skip this handler frame and any frames inside the standard logging module
        # so the reported source file/line points at the original caller.
        frame, depth = logging.currentframe(), 2
        while frame and (frame.f_code.co_filename == logging.__file__ or frame.f_code.co_filename == __file__):
            frame = frame.f_back  # type: ignore[assignment]
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level,
            record.getMessage(),
        )


def setup_logging(
    *,
    level: str | None = None,
    sink: Any = sys.stderr,
) -> None:
    """Configure loguru for the Relay backend.

    Reads ``RELAY_LOG_LEVEL`` from the environment (default ``INFO``) and
    redirects the standard-library ``logging`` module into loguru so that
    uvicorn/fastapi/alembic output is unified.
    """
    level = (level or os.environ.get("RELAY_LOG_LEVEL", "INFO")).upper()

    logger.remove()
    logger.add(
        sink,
        level=level,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
        colorize=True,
    )

    logging.basicConfig(handlers=[InterceptHandler()], level=level)

    # Propagate logs from third-party packages through the intercept handler.
    for module in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi", "alembic"):
        module_logger = logging.getLogger(module)
        module_logger.handlers = [InterceptHandler()]
        module_logger.propagate = False
