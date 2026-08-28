from __future__ import annotations

import base64
import binascii
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_DEV_SECRET = base64.urlsafe_b64encode(b"local-development-key-change-me!!").decode().rstrip("=")


def decode_secret(value: str) -> bytes:
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("APP_SECRET_KEY must be URL-safe base64") from exc
    if len(decoded) < 32:
        raise ValueError("APP_SECRET_KEY must decode to at least 32 bytes")
    return decoded


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    app_env: Literal["development", "test", "production"] = Field(
        default="development", alias="APP_ENV"
    )
    database_url: str = Field(default="sqlite+aiosqlite:///./.data/poker.db", alias="DATABASE_URL")
    web_dist_dir: Path | None = Field(default=None, alias="WEB_DIST_DIR")
    app_secret_key: str = Field(default=_DEV_SECRET, alias="APP_SECRET_KEY")
    allowed_origins: Annotated[tuple[str, ...], NoDecode] = Field(
        default=("http://localhost:5173",), alias="ALLOWED_ORIGINS"
    )
    cookie_secure: bool = Field(default=False, alias="COOKIE_SECURE")
    auto_create_schema: bool = Field(default=True, alias="AUTO_CREATE_SCHEMA")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    rate_limit_create_per_minute: int = Field(
        default=20, ge=1, alias="RATE_LIMIT_CREATE_PER_MINUTE"
    )
    rate_limit_join_per_minute: int = Field(default=60, ge=1, alias="RATE_LIMIT_JOIN_PER_MINUTE")
    rate_limit_ticket_per_minute: int = Field(
        default=120, ge=1, alias="RATE_LIMIT_TICKET_PER_MINUTE"
    )

    cookie_name: str = "holdem_guest"
    cookie_max_age_seconds: int = 7 * 24 * 60 * 60
    socket_ticket_ttl_seconds: int = 30
    shuffle_timeout_seconds: int = 5
    next_hand_delay_seconds: int = 10
    host_transfer_seconds: int = 60
    empty_room_timeout_seconds: int = 15 * 60
    unstarted_room_timeout_seconds: int = 2 * 60 * 60
    audit_retention_seconds: int = 7 * 24 * 60 * 60

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(
                origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()
            )
        return value

    @field_validator("app_secret_key")
    @classmethod
    def validate_secret(cls, value: str) -> str:
        decode_secret(value)
        return value

    @model_validator(mode="after")
    def validate_production(self) -> Settings:
        if self.app_env == "production":
            if self.app_secret_key == _DEV_SECRET:
                raise ValueError("Production requires an explicit APP_SECRET_KEY")
            if not self.cookie_secure:
                raise ValueError("Production requires COOKIE_SECURE=true")
            if not self.database_url.startswith("postgresql+asyncpg://"):
                raise ValueError("Production requires a postgresql+asyncpg DATABASE_URL")
            if self.auto_create_schema:
                raise ValueError("Production requires AUTO_CREATE_SCHEMA=false")
        return self

    @property
    def secret_bytes(self) -> bytes:
        return decode_secret(self.app_secret_key)

    def ensure_local_directories(self) -> None:
        prefix = "sqlite+aiosqlite:///"
        if not self.database_url.startswith(prefix):
            return
        path = self.database_url.removeprefix(prefix)
        if path == ":memory:" or path.startswith("file:"):
            return
        Path(path).parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
