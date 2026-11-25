from __future__ import annotations

import pytest

from docproc.loaders import detect_format
from docproc.loaders.text import load_text


def test_txt_upload_loads_utf8_with_bom_and_crlf(tmp_path):
    f = tmp_path / "sop.txt"
    f.write_bytes("﻿عنوان\r\n\r\n١. عند الوصول\r\nابدأ الانتظار.\r\n".encode("utf-8"))
    assert detect_format(f) == "txt"
    assert [b.text for b in load_text(f)] == ["عنوان", "١. عند الوصول", "ابدأ الانتظار."]
    f.write_bytes("caf\xe9".encode("latin-1"))
    with pytest.raises(ValueError, match="not UTF-8"):
        load_text(f)
