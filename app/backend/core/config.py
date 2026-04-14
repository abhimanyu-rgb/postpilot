from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///data/app.db"
    timezone: str = "Asia/Kolkata"
    daily_post_budget: int = 1
    min_gap_minutes: int = 180

    linkedin_access_token: str = ""
    linkedin_person_urn: str = ""

    slack_webhook_url: str = ""

    llm_provider: str = "anthropic"
    anthropic_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
