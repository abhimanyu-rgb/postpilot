#!/usr/bin/env python3
"""CLI helper to set API keys in the .env file securely.

Usage:
    python scripts/set_secret.py ANTHROPIC_API_KEY
    python scripts/set_secret.py LINKEDIN_ACCESS_TOKEN
    python scripts/set_secret.py LINKEDIN_PERSON_URN
    python scripts/set_secret.py SLACK_WEBHOOK_URL
    python scripts/set_secret.py NEWS_API_KEY
"""
import getpass
import sys
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

KNOWN_KEYS = {
    "ANTHROPIC_API_KEY",
    "LINKEDIN_ACCESS_TOKEN",
    "LINKEDIN_PERSON_URN",
    "SLACK_WEBHOOK_URL",
    "NEWS_API_KEY",
}


def write_env(key: str, value: str) -> None:
    lines: list[str] = []
    found = False

    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    lines.append(f"{key}={value}\n")
                    found = True
                else:
                    lines.append(line)

    if not found:
        if lines and not lines[-1].endswith("\n"):
            lines.append("\n")
        lines.append(f"{key}={value}\n")

    with open(ENV_FILE, "w") as f:
        f.writelines(lines)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/set_secret.py <KEY_NAME>")
        print(f"\nAvailable keys: {', '.join(sorted(KNOWN_KEYS))}")
        sys.exit(1)

    key = sys.argv[1].upper()
    if key not in KNOWN_KEYS:
        print(f"Warning: '{key}' is not a recognized key.")
        print(f"Known keys: {', '.join(sorted(KNOWN_KEYS))}")
        confirm = input("Continue anyway? (y/N): ").strip().lower()
        if confirm != "y":
            sys.exit(0)

    value = getpass.getpass(f"Enter value for {key}: ")
    if not value:
        print("Empty value — aborting.")
        sys.exit(1)

    write_env(key, value)
    masked = value[:4] + "****" + value[-4:] if len(value) > 8 else "****"
    print(f"Saved {key}={masked} to {ENV_FILE}")
    print("Restart the server for changes to take effect.")


if __name__ == "__main__":
    main()
