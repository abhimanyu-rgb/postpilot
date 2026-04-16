import logging
import sys
from pathlib import Path


def setup_logging(data_dir: str = "data", log_level: str = "INFO") -> logging.Logger:
    log_dir = Path(data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("orchestrator")
    logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    if not logger.handlers:
        fmt = logging.Formatter("%(asctime)s %(levelname)-8s %(name)s %(message)s")

        file_handler = logging.FileHandler(log_dir / "app.log")
        file_handler.setFormatter(fmt)
        logger.addHandler(file_handler)

        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(fmt)
        logger.addHandler(console_handler)

    return logger


def get_run_logger(data_dir: str, run_date: str, run_id: int) -> logging.Logger:
    log_dir = Path(data_dir) / "logs" / "runs" / run_date
    log_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(f"orchestrator.run.{run_id}")
    logger.setLevel(logging.DEBUG)

    if not logger.handlers:
        fmt = logging.Formatter("%(asctime)s %(levelname)-8s %(message)s")
        handler = logging.FileHandler(log_dir / f"{run_id}.log")
        handler.setFormatter(fmt)
        logger.addHandler(handler)

    return logger
