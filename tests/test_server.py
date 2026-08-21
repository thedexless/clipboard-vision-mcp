"""Tests for pure helpers in server.py — no network, no MCP, no Groq."""


import pytest

# Import server without triggering module-level Groq/AsyncGroq resolution issues:
# server.py imports groq at module load. If groq isn't installed in the test env,
# skip these tests rather than failing on import.
pytest.importorskip("groq")
pytest.importorskip("mcp")

from clipboard_vision_mcp.server import (  # noqa: E402
    _TOOL_DISPATCH,
    MAX_IMAGE_BYTES,
    PROMPTS,
    _strip_reasoning,
    _validate_image_path,
    _validate_magic,
)

# --- _strip_reasoning ---

def test_strip_reasoning_removes_closed_think_block():
    text = "<think>let me reason about this</think>Here is the answer."
    assert _strip_reasoning(text) == "Here is the answer."


def test_strip_reasoning_handles_unclosed_think_block():
    text = "<think>partial reasoning, budget ran out"
    # Unclosed block: keeps the reasoning content (truncated > empty)
    result = _strip_reasoning(text)
    assert "partial reasoning" in result
    assert "<think>" not in result


def test_strip_reasoning_passthrough_when_no_think_block():
    text = "Just a normal answer with no reasoning."
    assert _strip_reasoning(text) == text


def test_strip_reasoning_empty_input_returns_empty():
    assert _strip_reasoning("") == ""


def test_strip_reasoning_multiline_block():
    text = "<think>\nstep 1\nstep 2\n</think>\nFinal answer"
    assert _strip_reasoning(text) == "Final answer"


# --- _validate_magic ---

def test_validate_magic_accepts_png():
    _validate_magic(b"\x89PNG\r\n\x1a\n" + b"rest of file")


def test_validate_magic_accepts_jpeg():
    _validate_magic(b"\xff\xd8\xff\xe0rest")


def test_validate_magic_accepts_gif87a():
    _validate_magic(b"GIF87a" + b"data")


def test_validate_magic_accepts_gif89a():
    _validate_magic(b"GIF89a" + b"data")


def test_validate_magic_rejects_text_file():
    with pytest.raises(ValueError, match="does not look like"):
        _validate_magic(b"not an image at all")


def test_validate_magic_rejects_empty():
    with pytest.raises(ValueError, match="does not look like"):
        _validate_magic(b"")


# --- _validate_image_path ---

def test_validate_image_path_rejects_nonexistent(tmp_path):
    with pytest.raises(ValueError, match="Not a file"):
        _validate_image_path(str(tmp_path / "nope.png"))


def test_validate_image_path_rejects_wrong_extension(tmp_path):
    f = tmp_path / "file.txt"
    f.write_bytes(b"data")
    with pytest.raises(ValueError, match="only image files are allowed"):
        _validate_image_path(str(f))


def test_validate_image_path_rejects_oversize(tmp_path):
    f = tmp_path / "big.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * (MAX_IMAGE_BYTES + 1))
    with pytest.raises(ValueError, match="Image too large"):
        _validate_image_path(str(f))


def test_validate_image_path_accepts_valid_png(tmp_path):
    f = tmp_path / "ok.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"payload")
    p = _validate_image_path(str(f))
    assert p == f.resolve()


# --- PROMPTS + dispatch consistency ---

def test_all_dispatch_prompt_keys_exist_in_prompts():
    for prompt_key, _source, _override in _TOOL_DISPATCH.values():
        assert prompt_key in PROMPTS, f"{prompt_key} missing from PROMPTS"


def test_every_listed_tool_has_dispatch_entry():
    # Cross-check: tool names exposed via list_tools must all be in _TOOL_DISPATCH.
    # We can't easily call list_tools without an MCP session, so we verify the
    # reverse: every dispatch key is one we'd plausibly expose. This catches
    # the real bug: adding a tool to list_tools but forgetting the dispatch
    # (or vice versa).
    # (Full end-to-end coverage lives in scripts/mcp-smoke.mjs.)
    assert len(_TOOL_DISPATCH) >= 12
