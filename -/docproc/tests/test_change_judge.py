"""The model-backed change judge: request shape, thinking off, cut-off answers, retries, fixture stand-in."""
import json

import httpx
import pytest

from docproc.config import Settings
from docproc.llm import make_change_judge
from docproc.llm.base import CHANGE_PROMPT_VERSION, estimate_change_tokens
from docproc.llm.fixture import FixtureJudge
from docproc.llm.openai_compat import OpenAICompatJudge
from docproc.models import ClauseRecord, SourceLocation

VERDICT = {"kind": "actor", "old_evidence": "courier", "new_evidence": "dispatcher", "explanation": "who calls changed"}


def _rec(quote: str, ver: str = "v1") -> ClauseRecord:
    return ClauseRecord(
        record_id=f"{ver}-0", document_id="d", version_id=ver, ordinal=0, quote=quote, statement=quote,
        audiences=["courier"], audience_source="inherited", heading="Pickup",
        location=SourceLocation(kind="text", block_index=0), content_hash=ver,
    )


OLD, NEW = _rec("The courier calls the customer."), _rec("The dispatcher calls the customer.", "v2")


def _reply(content: str, finish_reason: str = "stop") -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"finish_reason": finish_reason, "message": {"content": content}}]})


class _Server:
    """Answers with the queued responses in order and keeps every request body."""

    def __init__(self, *responses: httpx.Response):
        self.responses, self.bodies = list(responses), []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(json.loads(request.content))
        return self.responses.pop(0)


def _judge(server: _Server, **settings) -> OpenAICompatJudge:
    s = Settings(_env_file=None, llm="openai_compat", llm_base_url="http://llm.test/v1", llm_model="gemma4",
                 **settings)
    judge = make_change_judge(s)
    assert isinstance(judge, OpenAICompatJudge)
    judge.transport = httpx.MockTransport(server)
    return judge


def test_the_judge_turns_thinking_off_even_when_extraction_thinks():
    server = _Server(_reply(json.dumps(VERDICT)))
    verdict = _judge(server, llm_reasoning_effort="high").judge(OLD, NEW)
    assert verdict.kind == "actor"
    [body] = server.bodies
    assert body["reasoning_effort"] == "none"  # thinking tokens would eat the 512-token answer budget
    assert body["max_tokens"] == 512 and body["temperature"] == 0
    assert body["response_format"]["type"] == "json_schema"
    user = json.loads(body["messages"][1]["content"])
    assert user == {"heading": "Pickup", "old_quote": OLD.quote, "new_quote": NEW.quote}  # never whole documents


def test_a_cut_off_answer_is_raised_at_once_with_context():
    server = _Server(_reply('{"kind": "act', "length"))
    with pytest.raises(RuntimeError, match=r"cut off.*max_tokens=512"):
        _judge(server, llm_max_retries=2).judge(OLD, NEW)
    assert len(server.bodies) == 1  # the same request at temperature 0 would be cut off again


def test_an_invalid_answer_is_retried_with_the_error_fed_back():
    server = _Server(_reply('{"kind": "promotion"}'), _reply(json.dumps(VERDICT)))
    verdict = _judge(server).judge(OLD, NEW)
    assert verdict.new_evidence == "dispatcher"
    retry = server.bodies[1]["messages"]
    assert retry[2] == {"role": "assistant", "content": '{"kind": "promotion"}'}
    assert retry[3]["role"] == "user" and "kind" in retry[3]["content"]


def test_the_fixture_judge_and_the_prompt_version_are_available_offline():
    assert make_change_judge(Settings(_env_file=None, llm="fixture")).name == "fixture"
    assert FixtureJudge().judge(_rec("Wait 15 minutes."), _rec("Wait 10 minutes.", "v2")).kind == "threshold"
    assert CHANGE_PROMPT_VERSION
    assert estimate_change_tokens(OLD, NEW) > estimate_change_tokens(_rec("a"), _rec("b", "v2"))


def test_a_rejected_request_is_not_retried():
    server = _Server(httpx.Response(400, text="unknown field reasoning_effort"))
    with pytest.raises(RuntimeError, match=r"rejected.*HTTP 400.*reasoning_effort"):
        _judge(server, llm_max_retries=2).judge(OLD, NEW)
    assert len(server.bodies) == 1
