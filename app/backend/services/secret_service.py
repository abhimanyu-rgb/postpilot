import os
from pathlib import Path

from sqlalchemy.orm import Session

from app.backend.models.secret_ref import SecretRef

# Path to .env file — project root
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def store_secret(db: Session, name: str, value: str, storage_type: str = "env") -> SecretRef:
    """Store a secret in the environment AND persist it to .env file."""
    # Set in current process
    os.environ[name.upper()] = value

    # Persist to .env file so it survives restarts
    _write_to_env_file(name.upper(), value)

    # Store reference (not the value) in DB
    existing = db.query(SecretRef).filter(SecretRef.secret_name == name).first()
    if existing:
        existing.storage_type = storage_type
        db.commit()
        db.refresh(existing)
        return existing

    ref = SecretRef(secret_name=name, storage_type=storage_type)
    db.add(ref)
    db.commit()
    db.refresh(ref)
    return ref


def get_secret(name: str) -> str:
    """Retrieve a secret value from the environment."""
    return os.environ.get(name.upper(), "")


def redact(value: str) -> str:
    """Return a masked version of a secret for display."""
    if len(value) <= 8:
        return "****"
    return value[:4] + "****" + value[-4:]


def _write_to_env_file(key: str, value: str) -> None:
    """Write or update a key=value pair in the .env file.

    Reads the existing file, replaces the key if found, or appends it.
    Never removes other keys.
    """
    lines: list[str] = []
    found = False

    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            for line in f:
                stripped = line.strip()
                # Match lines like KEY=value or KEY=
                if stripped.startswith(f"{key}="):
                    lines.append(f"{key}={value}\n")
                    found = True
                else:
                    lines.append(line)

    if not found:
        # Append with a newline separator if file doesn't end with one
        if lines and not lines[-1].endswith("\n"):
            lines.append("\n")
        lines.append(f"{key}={value}\n")

    with open(ENV_FILE, "w") as f:
        f.writelines(lines)
