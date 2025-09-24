import json
import tempfile
from typing import Dict

from polliLib import PolliClient
from .conftest import FakeResponse, FakeSession


def test_random_seed_range():
    c = PolliClient(session=FakeSession())
    seeds = [c._random_seed() for _ in range(20)]
    assert all(10000 <= s <= 99999999 for s in seeds)
    assert any(s < 10**6 for s in seeds) and any(s >= 10**7 for s in seeds)


def test_generate_text_as_json_and_params():
    fs = FakeSession()
    c = PolliClient(session=fs)

    def fake_get(url, **kw):
        fs.last_get = (url, kw)
        return FakeResponse(text='{"answer": 42}', status=200)

    fs.get = fake_get
    out = c.generate_text("hello", as_json=True, referrer="app", token="tok")
    assert out == {"answer": 42}
    url, kw = fs.last_get
    assert kw["params"]["referrer"] == "app"
    assert kw["params"]["token"] == "tok"
    assert kw["params"]["safe"] == "false"


def test_chat_completion_payload_and_extract():
    fs = FakeSession()
    c = PolliClient(session=fs)
    resp = c.chat_completion([{"role": "user", "content": "hi"}], referrer="r", token="t")
    assert resp == "ok"
    url, headers, payload, kw = fs.last_post
    assert payload["referrer"] == "r" and payload["token"] == "t"
    assert payload["safe"] is False


def test_chat_completion_stream_sse():
    lines = [
        'event: message',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: [DONE]'
    ]
    fs = FakeSession()
    fs.post = lambda url, **kw: FakeResponse(stream_lines=lines)
    c = PolliClient(session=fs)
    chunks = list(c.chat_completion_stream([{"role": "user", "content": "x"}]))
    assert "".join(chunks) == "Hello"


def test_chat_completion_tools_one_round():
    # First call returns tool_call; second returns final message
    first_data: Dict = {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {
                            "id": "tc1",
                            "function": {
                                "name": "get_current_weather",
                                "arguments": json.dumps({"location": "Tokyo", "unit": "celsius"}),
                            },
                        }
                    ]
                }
            }
        ]
    }
    second_data: Dict = {
        "choices": [
            {
                "message": {
                    "content": "Weather is Cloudy"
                }
            }
        ]
    }

    class SeqSession(FakeSession):
        def __init__(self):
            super().__init__()
            self.count = 0
            self.posts = []

        def post(self, url, headers=None, json=None, **kw):
            self.count += 1
            self.last_post = (url, headers or {}, json or {}, kw)
            self.posts.append(self.last_post)
            return FakeResponse(json_data=(first_data if self.count == 1 else second_data))

    fs = SeqSession()
    c = PolliClient(session=fs)

    def get_current_weather(location: str, unit: str = "celsius"):
        return {"location": location, "temperature": "15", "unit": unit, "description": "Cloudy"}

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_current_weather",
                "description": "mock",
                "parameters": {"type": "object", "properties": {"location": {"type": "string"}}},
            },
        }
    ]
    msg = [{"role": "user", "content": "What's weather?"}]
    out = c.chat_completion_tools(msg, tools=tools, functions={"get_current_weather": get_current_weather})
    assert out == "Weather is Cloudy"
    assert len(fs.posts) == 2
    assert all(post[2].get("safe") is False for post in fs.posts)


def test_generate_text_spacing_enforced():
    class SeqSession(FakeSession):
        def __init__(self):
            super().__init__()
            self.responses = [
                FakeResponse(text="one"),
                FakeResponse(text="two"),
            ]

        def get(self, url, **kw):
            self.last_get = (url, kw)
            return self.responses.pop(0)

    sleeps = []
    c = PolliClient(session=SeqSession(), sleep=lambda seconds: sleeps.append(seconds))
    first = c.generate_text("hello")
    second = c.generate_text("world")
    assert first == "one" and second == "two"
    assert any(delay >= 2.99 for delay in sleeps)


def test_generate_text_retry_backoff():
    class SeqSession(FakeSession):
        def __init__(self):
            super().__init__()
            self.responses = [
                FakeResponse(status=429, text="limit"),
                FakeResponse(status=503, text="busy"),
                FakeResponse(text="done"),
            ]

        def get(self, url, **kw):
            self.last_get = (url, kw)
            return self.responses.pop(0)

    sleeps = []
    c = PolliClient(session=SeqSession(), sleep=lambda seconds: sleeps.append(seconds))
    out = c.generate_text("retry")
    assert out == "done"
    rounded = [round(delay, 1) for delay in sleeps[:2]]
    assert rounded == [0.5, 0.6]

