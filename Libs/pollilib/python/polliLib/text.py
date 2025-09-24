from __future__ import annotations

from typing import Any, Dict, Optional


class TextMixin:
    def generate_text(
        self,
        prompt: str,
        *,
        model: str = "openai",
        seed: Optional[int] = None,
        system: Optional[str] = None,
        referrer: Optional[str] = None,
        token: Optional[str] = None,
        as_json: bool = False,
        timeout: Optional[float] = None,
    ) -> Any:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("prompt must be a non-empty string")
        if seed is None:
            seed = self._random_seed()
        params: Dict[str, Any] = {
            "model": model,
            "seed": seed,
            "safe": "false",
        }
        if as_json:
            params["json"] = "true"
        if system:
            params["system"] = system
        if referrer:
            params["referrer"] = referrer
        if token:
            params["token"] = token
        url = self._text_prompt_url(prompt)
        eff_timeout = self._resolve_timeout(timeout, 60.0)
        attempt = 0
        response = None
        while True:
            with self._request_lock:
                self._wait_before_attempt(attempt)
                resp = self.session.get(url, params=params, timeout=eff_timeout)
                if self._should_retry_status(resp.status_code):
                    if not self._can_retry(attempt + 1):
                        resp.raise_for_status()
                    resp.close()
                    attempt += 1
                    continue
                try:
                    resp.raise_for_status()
                except Exception:
                    resp.close()
                    raise
                self._mark_success()
                response = resp
                break
        if as_json:
            import json as _json

            txt = response.text
            try:
                return _json.loads(txt)
            except Exception:
                return txt
        return response.text

