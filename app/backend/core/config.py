from pathlib import Path

from pydantic_settings import BaseSettings


_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    database_url: str = f"sqlite:///{_REPO_ROOT / 'data' / 'app.db'}"
    data_dir: str = str(_REPO_ROOT / "data")
    log_level: str = "INFO"
    timezone: str = "Asia/Kolkata"
    daily_post_budget: int = 1
    min_gap_minutes: int = 180

    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""
    linkedin_redirect_uri: str = "http://localhost:8000/api/auth/linkedin/callback"
    linkedin_access_token: str = ""
    linkedin_refresh_token: str = ""
    linkedin_person_urn: str = ""

    slack_webhook_url: str = ""

    llm_provider: str = "anthropic"
    anthropic_api_key: str = ""

    news_api_key: str = ""

    model_config = {
        "env_file": str(Path(__file__).resolve().parents[3] / ".env"),
        "env_file_encoding": "utf-8",
    }

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).resolve()

    def model_post_init(self, __context) -> None:
        # Resolve sqlite paths relative to the repo root so the backend
        # opens the same DB regardless of CWD (uvicorn launch dir, scripts, etc).
        prefix = "sqlite:///"
        if self.database_url.startswith(prefix):
            raw = self.database_url[len(prefix):]
            p = Path(raw)
            if not p.is_absolute():
                self.database_url = f"{prefix}{(_REPO_ROOT / p).resolve()}"


settings = Settings()
