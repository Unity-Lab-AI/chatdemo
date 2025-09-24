from __future__ import annotations

from functools import lru_cache
import threading
import time
from typing import Any, Callable, Dict, Iterable, List, Literal, Optional, TypedDict
import requests

ModelType = Literal["text", "image"]


class Model(TypedDict, total=False):
    name: str
    description: str
    maxInputChars: int
    reasoning: bool
    community: bool
    tier: str
    aliases: List[str]
    input_modalities: List[str]
    output_modalities: List[str]
    tools: bool
    vision: bool
    audio: bool
    voices: List[str]
    supportsSystemMessages: bool


class BaseClient:
    def __init__(
        self,
        text_url: str = "https://text.pollinations.ai/models",
        image_url: str = "https://image.pollinations.ai/models",
        image_prompt_base: str = "https://image.pollinations.ai/prompt",
        text_prompt_base: str = "https://text.pollinations.ai",
        timeout: float = 10.0,
        session: Optional[requests.Session] = None,
        min_request_interval: float = 3.0,
        retry_initial_delay: float = 0.5,
        retry_delay_step: float = 0.1,
        retry_max_delay: float = 4.0,
        sleep: Optional[Callable[[float], None]] = None,
    ) -> None:
        self.text_url = text_url
        self.image_url = image_url
        self.image_prompt_base = image_prompt_base
        self.text_prompt_base = text_prompt_base
        self.timeout = timeout
        self.session = session or requests.Session()
        self.min_request_interval = max(0.0, float(min_request_interval))
        self.retry_initial_delay = max(0.0, float(retry_initial_delay))
        self.retry_delay_step = max(0.0, float(retry_delay_step))
        self.retry_max_delay = max(self.retry_initial_delay, float(retry_max_delay))
        if self.retry_delay_step > 0 and self.retry_max_delay > 0 and self.retry_initial_delay > 0:
            steps = int(max(0.0, (self.retry_max_delay - self.retry_initial_delay)) / self.retry_delay_step)
            self._max_retry_attempts = steps + 1
        elif self.retry_initial_delay > 0 and self.retry_max_delay > 0:
            self._max_retry_attempts = 1
        else:
            self._max_retry_attempts = 0
        self._sleep = sleep or time.sleep
        self._last_success_ts = 0.0
        self._request_lock = threading.Lock()
        self._retryable_statuses = {429, 502, 503, 504}

    @lru_cache(maxsize=4)
    def list_models(self, kind: ModelType) -> List[Model]:
        url = self._url(kind)
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return self._normalize_models(resp.json())

    def get_model_by_name(
        self,
        name: str,
        kind: Optional[ModelType] = None,
        include_aliases: bool = True,
        case_insensitive: bool = True,
    ) -> Optional[Model]:
        needle = name.casefold() if case_insensitive else name
        kinds: Iterable[ModelType] = (kind,) if kind else ("text", "image")
        for m in self._iter_models(*kinds):
            names = [m.get("name", "")]
            if include_aliases:
                names.extend(m.get("aliases", []) or [])
            if case_insensitive:
                names = [n.casefold() for n in names]
            if needle in names:
                return m
        return None

    @staticmethod
    def get(model: Model, field: str, default: Any = None) -> Any:
        return model.get(field, default)

    def refresh_cache(self) -> None:
        self.list_models.cache_clear()  # type: ignore[attr-defined]

    # ----- helpers -----
    def _url(self, kind: ModelType) -> str:
        return self.text_url if kind == "text" else self.image_url

    def _iter_models(self, *kinds: ModelType) -> Iterable[Model]:
        for k in kinds or ("text", "image"):
            yield from self.list_models(k)

    @staticmethod
    def _normalize_models(raw: Any) -> List[Model]:
        if isinstance(raw, dict) and "models" in raw and isinstance(raw["models"], list):
            raw = raw["models"]
        if not isinstance(raw, list):
            return []
        out: List[Model] = []
        for item in raw:
            if isinstance(item, str):
                out.append(
                    {
                        "name": item,
                        "aliases": [],
                        "input_modalities": [],
                        "output_modalities": [],
                        "tools": False,
                        "vision": False,
                        "audio": False,
                        "community": False,
                        "supportsSystemMessages": True,
                    }
                )
            elif isinstance(item, dict):
                m: Dict[str, Any] = dict(item)
                if "teir" in m and "tier" not in m:
                    m["tier"] = m.pop("teir")
                m.setdefault("aliases", [])
                m.setdefault("input_modalities", [])
                m.setdefault("output_modalities", [])
                m.setdefault("tools", False)
                m.setdefault("vision", False)
                m.setdefault("audio", False)
                m.setdefault("community", False)
                m.setdefault("supportsSystemMessages", True)
                out.append(m)  # type: ignore[arg-type]
        return out

    def _random_seed(self) -> int:
        import random
        n_digits = random.randint(5, 8)
        low = 10 ** (n_digits - 1)
        high = (10 ** n_digits) - 1
        return random.randint(low, high)

    def _image_prompt_url(self, prompt: str) -> str:
        from urllib.parse import quote
        return f"{self.image_prompt_base}/{quote(prompt)}"

    def _text_prompt_url(self, prompt: str) -> str:
        from urllib.parse import quote
        return f"{self.text_prompt_base}/{quote(prompt)}"

    def _retry_delay(self, attempt: int) -> float:
        if attempt <= 0 or self.retry_initial_delay <= 0:
            return 0.0
        if attempt == 1 or self.retry_delay_step <= 0:
            return min(self.retry_initial_delay, self.retry_max_delay)
        delay = self.retry_initial_delay + (attempt - 1) * self.retry_delay_step
        return min(delay, self.retry_max_delay)

    def _can_retry(self, attempt: int) -> bool:
        return attempt <= self._max_retry_attempts

    def _wait_before_attempt(self, attempt: int) -> None:
        now = time.monotonic()
        if attempt == 0:
            wait_for = (self._last_success_ts + self.min_request_interval) - now
        else:
            wait_for = self._retry_delay(attempt)
        if wait_for > 0:
            self._sleep(wait_for)

    def _mark_success(self) -> None:
        self._last_success_ts = time.monotonic()

    def _should_retry_status(self, status: int) -> bool:
        return status in self._retryable_statuses

