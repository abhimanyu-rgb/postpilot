from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///data/app.db"
    data_dir: str = "data"
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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).resolve()


settings = Settings()
