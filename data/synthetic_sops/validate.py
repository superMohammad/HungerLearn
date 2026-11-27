"""Validate HungerLearn's upload corpus and gold fixtures without running models."""

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream


ROOT = Path(__file__).resolve().parent
ROLES = ("courier", "employee", "partner")
SPLITS = ("dev", "held_out")
MARKERS = {"ar": "بيانات تدريب اصطناعية", "en": "Synthetic training data"}
MIN_SCAN_DPI = 150
EXTENSIONS = {"pdf": ".pdf", "image_pdf": ".pdf", "docx": ".docx", "txt": ".txt", "png": ".png"}
SCOPE_FIELDS = ("role", "organization", "document_family")
W = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
AUDIENCE = {
    "ar": {"courier": "إلى: مندوب التوصيل", "employee": "إلى: موظف الشركة", "partner": "إلى: موظف المطعم الشريك"},
    "en": {"courier": "To: Courier", "employee": "To: Company employee", "partner": "To: Partner restaurant staff"},
}


FOLD_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
# A wait or deadline must say when its clock starts ("7 minutes after you send the request", "١٥ دقيقة من تسجيل الوصول").
TIMER_ANCHOR = re.compile(
    r"\d+\s+(?:minutes?|hours?)\s+(?:past|after\s+(?:the|you|sending|opening|check-in)|of\s+(?:opening|the|sending)|on\s+the|since)\b"
    r"|[0-9٠-٩]+\s+(?:دقيقة|دقائق|ساعة|ساعات)\s+من\s+\S+")


ARABIC = re.compile(r"[؀-ۿ]")
CONDITION_MARKERS = ("if ", "when ", "before ", "after ", "for ")
# "Do not ...", "never ...", and the Arabic prohibitive لا / ولا followed by a jussive verb (لا تغادر، ولا تطلب).
PROHIBITION = re.compile(r"\b[Dd]o not\b|\b[Nn]ever\b|(?:^|[\s.،])و?لا ت\w")


def restates_quote(field, quote):
    # Facts are normalized English labels. Arabic text, or a span copied from the quote with its "If/When ..."
    # marker or 10+ words long, is a restatement of the source rather than a label a scorer can compare.
    norm = lambda text: " ".join(re.sub(r"[^\w\s'-]", " ", text.lower()).split())
    value = norm(field)
    copied = value in norm(quote)
    return bool(ARABIC.search(field)) or (copied and (value.startswith(CONDITION_MARKERS) or len(value.split()) >= 10))


# Tatweel (ـ) is deleted, not turned into a space: «التوزيـــع» is the same word as «التوزيع».
MATCH_FOLD = str.maketrans("٠١٢٣٤٥٦٧٨٩أإآى", "0123456789اااي", "ـ")


# v3 uploads: a word bag compares text regardless of line order, which a PDF text layer scrambles for right-to-left
# lines (runs come out in visual order and Arabic glyphs as presentation forms). NFKC folds those forms back.
WORD = re.compile(r"[^\W\d_]+|\d+")
# Marks are dropped. NFKC turns a presentation-form mark (ﱠ shadda with fatha) into a space plus the marks, so the
# space goes too, and pypdf returns NUL for a mark glyph with no Unicode mapping.
HARAKAT = re.compile(r"\s?[ً-ْـ\x00]")
# Section and appendix headings of a v3 upload, and the rule number printed before each v3 rule ("6.1", "٦.١").
V3_HEADING = re.compile(r"^(?:القسم [٠-٩]+|الملحق [أ-ي]|Section \d+|Appendix [A-Z]): ")
V3_RULE_NO = r"[0-9٠-٩]+\.[0-9٠-٩]+ "
V3_VARIANTS = ("original", "format_copy", "translation")


def word_bag(text):
    # A digit run inside right-to-left text can come out reversed (١٠ as ٠١), so numbers compare by their digits.
    folded = HARAKAT.sub("", unicodedata.normalize("NFKC", text)).translate(FOLD_DIGITS).lower()
    return Counter("".join(sorted(w)) if w.isdigit() else w for w in WORD.findall(folded))


def section_title(section):
    # "٢. تأخر التجهيز" (v1, v2) or "القسم ٨: تأخر التجهيز" / "Section 8: Preparation delay" (v3).
    return V3_HEADING.sub("", re.sub(r"^\d+\. ", "", section))


def match_key(text):
    # Normalization used only to decide whether two versions of a rule say the same thing.
    text = re.sub(r"[ً-ْ]", "", text.translate(MATCH_FOLD))
    return " ".join(re.sub(r"[«»\"“”'’.,،:;]", " ", text).split()).lower()


def trigram_similarity(a, b):
    grams = lambda t: {t[i:i + 3] for i in range(len(t) - 2)}
    x, y = grams(match_key(a)), grams(match_key(b))
    return len(x & y) / max(len(x | y), 1)


# Gold identifiers (clause, training item, assessment case, gate, learner) must never appear in an upload.
GOLD_LABEL = re.compile(r"\b(?:CW|CH|CD|ED|EC|EG|PP|PS|PV)-\d{2}\b|training-[a-z]{2}-\d{2}|\bA-[CEP]\d\b|\bG-\d{2}\b|\bHL-\d{3}\b")


def upload_metadata(path, fmt):
    if fmt == "docx":
        with ZipFile(path) as archive:
            return " ".join(archive.read(name).decode("utf-8", "replace")
                            for name in ("docProps/core.xml", "docProps/app.xml", "docProps/custom.xml") if name in archive.namelist())
    if fmt in {"pdf", "image_pdf"}:
        return " ".join(str(value) for value in (PdfReader(path).metadata or {}).values())
    if fmt == "png":
        with Image.open(path) as img:
            return " ".join(str(value) for value in img.info.values())
    return ""


def header_line(doc):
    # The visible metadata line every upload prints under its title and data marker.
    if doc["language"] == "ar":
        return f"{doc['organization_local']} | فرع {doc['branch_local']} | الإصدار {doc['version']}"
    return f"{doc['organization_local']} | {doc['branch_local']} branch | Version {doc['version']}"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def load(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def indexed(rows, key):
    by_key = {row[key]: row for row in rows}
    check(len(by_key) == len(rows), f"Duplicate {key}")
    return by_key


def fields(row, names):
    return {key: row[key] for key in names}


def compact(text):
    # PDF line wrapping and TXT/DOCX line separators are layout whitespace.
    return " ".join(text.split())


def files_in(directory):
    return {p.relative_to(ROOT).as_posix() for p in (ROOT / directory).rglob("*") if p.is_file()}


def validate_manifest():
    manifest = load("manifest.json")
    docs = indexed(manifest["documents"], "document_id")
    paths = indexed(manifest["documents"], "path")
    check(manifest["schema_version"] == 2, "Unsupported manifest schema")
    corpus = {k: d for k, d in docs.items() if d["version"] < 3}
    check(len(corpus) == 15, f"Found {len(corpus)} v1/v2 manifest documents, expected 15")
    check(set(paths) == set.union(*(files_in(f"{split}/uploads") for split in SPLITS)),
          "Manifest paths differ from upload files on disk")
    check({d["format"] for d in docs.values()} == set(EXTENSIONS), "All five formats must be present")
    family_groups = defaultdict(list)
    for doc_id, doc in docs.items():
        fmt, split, family = doc["format"], doc["split"], doc["document_family"]
        check(split in SPLITS and doc["role"] in ROLES and doc["language"] in MARKERS, f"Invalid scope: {doc_id}")
        check((doc["version"] in (1, 2) and doc["variant"] in ("original", "scan"))
              or (doc["version"] == 3 and doc["variant"] in V3_VARIANTS), f"Invalid version/variant: {doc_id}")
        check(all(doc.get(k) for k in ("organization", "organization_local", "branch", "branch_local", "document_family")),
              f"Missing organization, branch, or family: {doc_id}")
        check(doc["language"] == "ar" or doc["branch_local"] == doc["branch"],
              f"English uploads print the manifest branch name: {doc_id}")
        path = Path(doc["path"])
        check(path.parent.as_posix() == f"{split}/uploads" and path.suffix == EXTENSIONS[fmt],
              f"Path, format, or split mismatch: {doc_id}")
        check((doc["variant"] == "scan") == (fmt in {"png", "image_pdf"}), f"Wrong scan format: {doc_id}")
        check(10 <= doc["procedure_count"] <= 20, f"Expected 10 to 20 procedures: {doc_id}")
        family_groups[family].append(doc)
    for family, group in family_groups.items():
        # A v3 translation is the one upload allowed to change language inside a family.
        fingerprint = {(g["split"], g["role"], g["organization"], g["branch"], g["language"])
                       for g in group if g["variant"] != "translation"}
        check(len(fingerprint) == 1, f"Document family crosses splits or scopes: {family}")
        versions = sorted((d["version"], d["variant"]) for d in group if d["version"] < 3)
        check(versions in ([(1, "original")], [(1, "original"), (1, "scan"), (2, "original")]),
              f"Invalid version or scan set: {family}")
        v3 = [d for d in group if d["version"] == 3]
        if v3:
            validate_v3_family(family, group, v3, docs)
        for scan in (d for d in group if d["variant"] == "scan"):
            source = docs[scan["source_document_id"]]
            check(source in group and source["version"] == 1 and source["variant"] == "original",
                  f"Scan does not point to its original v1: {scan['document_id']}")
    for role in ROLES:
        rows = [doc for doc in corpus.values() if doc["role"] == role]
        v1 = [d for d in rows if (d["split"], d["version"], d["variant"]) == ("dev", 1, "original")]
        check(len(rows) == 5 and Counter(d["language"] for d in v1) == {"ar": 1, "en": 1},
              f"Expected five files and two bilingual dev originals for {role}")
        check(sum(d["variant"] == "scan" for d in rows) == 1
              and sum(d["split"] == "held_out" for d in rows) == 1, f"Wrong scan or held-out count for {role}")
    held_out = [d for d in docs.values() if d["split"] == "held_out"]
    check(all(d["version"] < 3 for d in held_out), "v3 uploads belong to dev only")
    check({d["language"] for d in held_out} == set(MARKERS), "Held-out set must have both languages")
    scans = [d for d in docs.values() if d["variant"] == "scan"]
    check(Counter(d["language"] for d in scans) == {"ar": 2, "en": 1}, "Expected two Arabic scans and one English scan")
    profiles = {d["scan_quality"]["profile"] for d in scans}
    check({"clean", "mild_skew_and_noise"} <= profiles, "Missing scan quality profiles")
    demo = docs[manifest["live_demo_document_id"]]
    check(demo["split"] == "held_out" and demo["format"] == "pdf", "Demo must be a held-out text PDF")
    return docs, demo


def validate_v3_family(family, group, v3, docs):
    # Six v3 uploads: both languages in PDF, DOCX and TXT. The original is in the family language and v2's format;
    # every other upload is a copy of it (same language) or a translation (the other language).
    originals = [d for d in v3 if d["variant"] == "original"]
    v2 = [d for d in group if (d["version"], d["variant"]) == (2, "original")]
    check(len(originals) == 1 and len(v2) == 1, f"v3 needs one original and a v2 to update: {family}")
    original = originals[0]
    check((original["language"], original["format"]) == (v2[0]["language"], v2[0]["format"]),
          f"The v3 original must keep v2's language and format: {family}")
    check(sorted((d["language"], d["format"]) for d in v3) == sorted((l, f) for l in MARKERS for f in ("docx", "pdf", "txt")),
          f"v3 needs PDF, DOCX and TXT in Arabic and English: {family}")
    for doc in v3:
        if doc is original:
            check("source_document_id" not in doc, f"The v3 original has no source document: {doc['document_id']}")
            continue
        expected = "format_copy" if doc["language"] == original["language"] else "translation"
        check(doc["variant"] == expected and doc.get("source_document_id") == original["document_id"]
              and doc["procedure_count"] == original["procedure_count"], f"Wrong v3 copy metadata: {doc['document_id']}")
    for doc in v3:
        # Each upload prints the names in its own language: v2's names in the family language, the manifest's
        # English names in English, and Arabic-script names in Arabic.
        names = (doc["organization_local"], doc["branch_local"])
        if doc["language"] == v2[0]["language"]:
            expected = names == (v2[0]["organization_local"], v2[0]["branch_local"])
        elif doc["language"] == "en":
            expected = names == (doc["organization"], doc["branch"])
        else:
            expected = all(ARABIC.search(name) for name in names)
        check(expected, f"A v3 upload prints the organization and branch in its own language: {doc['document_id']}")


def word_text(path, language):
    with ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    body = document.find("w:body", W)
    if language == "ar":
        for para in body.findall(".//w:p", W):
            if para.findall(".//w:t", W):
                check(para.find("w:pPr/w:bidi", W) is not None, f"Arabic paragraph needs bidirectional text: {path.name}")
    p_tag = f"{{{W['w']}}}p"
    table_tag = f"{{{W['w']}}}tbl"

    def paragraph(para):
        return "".join(t.text or "" for t in para.findall(".//w:t", W))

    rows = []
    lines = []
    for node in body:
        if node.tag == p_tag:
            lines.append(paragraph(node))
        if node.tag == table_tag:
            if language == "ar":
                check(node.find("w:tblPr/w:bidiVisual", W) is not None, f"Arabic table needs RTL columns: {path.name}")
            for row in node.findall("w:tr", W):
                cells = ["\n".join(paragraph(para) for para in cell.findall("w:p", W))
                         for cell in row.findall("w:tc", W)]
                rows.append(cells)
                lines.extend(cells)
    return lines, rows


def image_page_count(path, fmt):
    if fmt == "png":
        with Image.open(path) as img:
            check(img.format == "PNG" and img.n_frames == 1, f"Expected a single-page PNG: {path.name}")
            check(img.width >= 1000 and img.height >= 1000, f"Scan is too small: {path.name}")
            # The PNG scan stands for a US Letter page; below MIN_SCAN_DPI it is too coarse for reliable OCR.
            check(img.width / 8.5 >= MIN_SCAN_DPI, f"Scan resolution below {MIN_SCAN_DPI} dpi: {path.name}")
            img.load()
            check(not img.text, f"PNG contains embedded text metadata: {path.name}")
            check(not {"exif", "xmp", "XML:com.adobe.xmp", "comment"} & set(img.info) and not img.getexif(),
                  f"PNG carries EXIF, XMP, or comment metadata that could hide text: {path.name}")
        return 1
    reader = PdfReader(path)
    for page in reader.pages:
        check(not page.extract_text().strip(), f"Scan has a text layer: {path.name}")
        resources = page.get("/Resources").get_object()
        check(not resources.get("/Font"), f"Scan contains font resources: {path.name}")
        image_objects = resources.get("/XObject").get_object()
        check(len(image_objects) == 1, f"Expected one page raster: {path.name}")
        for image_ref in image_objects.values():
            image = image_ref.get_object()
            check(image["/Subtype"] == "/Image" and image["/Width"] >= 1000 and image["/Height"] >= 1000,
                  f"Invalid page raster: {path.name}")
            check(image["/Width"] / (float(page.mediabox.width) / 72) >= MIN_SCAN_DPI,
                  f"Scan resolution below {MIN_SCAN_DPI} dpi: {path.name}")
        operators = [op for _, op in ContentStream(page.get_contents(), reader).operations]
        check(operators.count(b"Do") == 1 and not ({b"BT", b"Tj", b"TJ", b"'", b'"'} & set(operators)),
              f"Page must draw only the scan image as content: {path.name}")
    return len(reader.pages)


def validate_scan(doc, origin_pages, extraction, count):
    doc_id = doc["document_id"]
    path = ROOT / doc["path"]
    transcription = load(f"dev/gold/transcriptions/{doc_id}.json")
    check(transcription["document_id"] == doc_id and transcription["source_document_id"] == doc["source_document_id"],
          f"Wrong transcription reference: {doc_id}")
    check(transcription["scan_sha256"] == sha256(path.read_bytes()).hexdigest(),
          f"Scan differs from the visually reviewed artifact: {doc_id}")
    pages = transcription["pages"]
    check(len(pages) == count == len(origin_pages)
          and [p["page"] for p in pages] == list(range(1, count + 1)), f"Incomplete scanned pages: {doc_id}")
    for entry, original in zip(pages, origin_pages):
        check(entry["lines"] and all(line.strip() for line in entry["lines"]), f"Blank reference line: {doc_id}")
        check("\n".join(entry["lines"]) == entry["text"], f"Transcript fields disagree: {doc_id}")
        check(compact(entry["text"]) == compact("\n".join(original)), f"Transcript differs from the original page: {doc_id}")
    origin = extraction[doc["source_document_id"]]
    scanned = extraction[doc_id]
    check(fields(scanned, ("title", "scope_quote")) == fields(origin, ("title", "scope_quote")),
          f"Scan and original document scope differs: {doc_id}")
    scans = [
        {**procedure, "locator": {key: value for key, value in procedure["locator"].items() if key != "page"}}
        for procedure in scanned["procedures"]
    ]
    originals = [
        {**procedure, "locator": {key: value for key, value in procedure["locator"].items() if key != "page"}}
        for procedure in origin["procedures"]
    ]
    check(scans == originals, f"Scan and original procedures differ: {doc_id}")
    return [p["lines"] for p in pages]


def validate_v1_quote(pages, section_names, section, quote, locator, table_rows, context):
    # v1/v2: the rule is the whole text between its section line and the next section line.
    page = pages[locator.get("page", 1) - 1]
    lines = [line.strip().removeprefix("[ ] ") for line in page if line.strip()]
    check(lines.count(section) == 1, f"Unmatched or ambiguous section: {context}")
    start = lines.index(section) + 1
    end = next((index for index in range(start, len(lines)) if lines[index] in section_names), len(lines))
    check(compact(" ".join(lines[start:end])) == quote, f"Exact quote mismatch at locator: {context}")
    if "table_row" in locator:
        row = locator["table_row"]
        check(2 <= row <= len(table_rows) and table_rows[row - 1] == [section, quote], f"Wrong table row: {context}")


def validate_v3_quote(fmt, pages, section, quote, locator, context):
    # v3: a section holds context, rules, tables and examples, so a rule is one numbered line inside its section.
    if fmt == "pdf":
        page = locator["page"]
        check(word_bag(quote) <= word_bag(" ".join(pages[page - 1])), f"Quote not on its locator page: {context}")
        heading_pages = [n for n, lines in enumerate(pages, start=1) if word_bag(section) <= word_bag(" ".join(lines))]
        check(heading_pages and heading_pages[0] <= page, f"Section heading missing before its rule: {context}")
        return
    lines = [line.strip() for line in pages[0] if line.strip()]
    check(lines.count(section) == 1, f"Unmatched or ambiguous section: {context}")
    start = lines.index(section) + 1
    end = next((i for i in range(start, len(lines)) if V3_HEADING.match(lines[i])), len(lines))
    check(any(re.fullmatch(V3_RULE_NO + re.escape(quote), line) for line in lines[start:end]),
          f"Quote is not a numbered rule line in its section: {context}")


def validate_v3_copy(doc, label, origin):
    # Copies and translations carry the original's clauses and facts in the same order; translations change the
    # quote's language, copies keep it word for word.
    doc_id = doc["document_id"]
    check([c["clause_id"] for c in label["clauses"]] == [c["clause_id"] for c in origin["clauses"]]
          and [p["procedure_id"] for p in label["procedures"]] == [p["procedure_id"] for p in origin["procedures"]]
          and [p["clause_ids"] for p in label["procedures"]] == [p["clause_ids"] for p in origin["procedures"]],
          f"v3 copy clauses or procedures differ from the original: {doc_id}")
    check(all(a["facts"] == b["facts"] for a, b in zip(label["clauses"], origin["clauses"])),
          f"v3 copy facts differ from the original: {doc_id}")
    if doc["variant"] == "format_copy":
        check(all(a["quote"] == b["quote"] and a["locator"]["section"] == b["locator"]["section"]
                  for a, b in zip(label["clauses"], origin["clauses"])) and label["title"] == origin["title"],
              f"A format copy must quote the original word for word: {doc_id}")


def validate_procedures(doc, label, clauses, visible):
    doc_id, family = doc["document_id"], doc["document_family"]
    check(visible(label["title"]) and visible(label["scope_quote"]), f"Document scope differs from source: {doc_id}")
    procedures = indexed(label["procedures"], "procedure_id")
    check(len(procedures) == doc["procedure_count"], f"Procedure count differs from manifest: {doc_id}")
    sections, covered = set(), []
    for key, procedure in procedures.items():
        supporting = procedure["clause_ids"]
        locator = procedure["locator"]
        section = locator["section"]
        check(supporting and all(cid in clauses for cid in supporting), f"Missing procedure clauses: {doc_id}/{key}")
        check(key == f"{family}:{supporting[0]}", f"Invalid stable procedure ID: {doc_id}/{key}")
        check(section not in sections and section_title(section) == procedure["title"],
              f"Duplicate or mismatched procedure title: {doc_id}/{key}")
        check(locator == clauses[supporting[0]]["locator"], f"Procedure citation differs from its rule: {doc_id}/{key}")
        sections.add(section)
        covered.extend(supporting)
    check(covered == list(clauses), f"Procedure mapping does not cover the clauses in source order: {doc_id}")


def validate_extraction(docs):
    extraction = {}
    for split in SPLITS:
        rows = indexed(load(f"{split}/gold/extraction.json"), "document_id")
        check(set(rows) == {key for key, doc in docs.items() if doc["split"] == split},
              f"Extraction coverage or isolation failure: {split}")
        extraction.update(rows)
    source_pages, source_tables, body_signatures, clause_index, clause_families = {}, {}, {}, {}, {}
    for doc_id, doc in sorted(docs.items(), key=lambda item: item[1]["variant"] == "scan"):
        path, fmt = ROOT / doc["path"], doc["format"]
        table_rows = []
        if doc["variant"] == "scan":
            origin_id = doc["source_document_id"]
            pages = validate_scan(doc, source_pages[origin_id], extraction, image_page_count(path, fmt))
            table_rows = source_tables[origin_id]
        elif fmt == "docx":
            lines, table_rows = word_text(path, doc["language"])
            pages = [lines]
        elif fmt == "pdf":
            pages = [(page.extract_text() or "").splitlines() for page in PdfReader(path).pages]
        else:
            pages = [path.read_text(encoding="utf-8").splitlines()]
        source_pages[doc_id] = pages
        source_tables[doc_id] = table_rows
        whole = compact(" ".join(line for page in pages for line in page))
        if doc["version"] == 3 and fmt == "pdf":
            bag = word_bag(whole)
            visible = lambda text, bag=bag: word_bag(text) <= bag
        else:
            visible = lambda text, whole=whole: compact(text) in whole
        check(visible(MARKERS[doc["language"]]) and visible(doc["organization_local"]),
              f"Missing visible data marker or organization: {doc_id}")
        leaked = GOLD_LABEL.findall(whole + " " + upload_metadata(path, fmt))
        check(not leaked, f"Gold label {sorted(set(leaked))} leaked into upload text or metadata: {doc_id}")
        check(visible(header_line(doc)), f"Visible header disagrees with manifest organization, branch, or version: {doc_id}")
        check(visible(AUDIENCE[doc["language"]][doc["role"]]), f"Visible audience line disagrees with manifest role: {doc_id}")
        label = extraction[doc_id]
        clauses = indexed(label["clauses"], "clause_id")
        clause_index[doc_id] = clauses
        validate_procedures(doc, label, clauses, visible)
        signature = tuple(c["quote"] for c in clauses.values())
        prior_split = body_signatures.setdefault(signature, doc["split"])
        check(prior_split == doc["split"], f"Identical rule text appears across splits: {doc_id}")
        if doc["variant"] == "scan":
            origin_clauses = clause_index[doc["source_document_id"]]
            check(list(clauses) == list(origin_clauses), f"Scan and origin clause coverage differs: {doc_id}")
        if doc["variant"] in ("format_copy", "translation"):
            validate_v3_copy(doc, label, extraction[doc["source_document_id"]])
        section_names = {clause["locator"]["section"] for clause in clauses.values()}
        for cid, clause in clauses.items():
            context = f"{doc_id}/{cid}"
            family = doc["document_family"]
            check(clause_families.setdefault(cid, family) == family, f"Clause ID reused across families: {context}")
            locator, quote, facts = (clause[key] for key in ("locator", "quote", "facts"))
            section = locator["section"]
            check(section and quote and facts["responsible_role"] == doc["role"], f"Incomplete clause: {context}")
            check("action" in facts or "negation" in facts, f"Clause facts state no action or prohibition: {context}")
            check(not PROHIBITION.search(quote) or "negation" in facts, f"Explicit prohibition missing from facts: {context}")
            for key in ("trigger", "action", "negation", "actor"):
                check(key not in facts or not restates_quote(facts[key], quote),
                      f"Fact '{key}' restates the source instead of a normalized label: {context}")
            check(facts.get("exception_to", next(iter(clauses))) in clauses, f"exception_to names a missing clause: {context}")
            if fmt in {"pdf", "image_pdf", "png"}:
                check(1 <= locator["page"] <= len(pages), f"Bad page locator: {context}")
            if doc["version"] == 3:
                validate_v3_quote(fmt, pages, section, quote, locator, context)
            else:
                validate_v1_quote(pages, section_names, section, quote, locator, table_rows, context)
            if doc["variant"] == "scan":
                old = origin_clauses[cid]
                check(old["quote"] == quote and old["facts"] == facts and
                      {k: v for k, v in locator.items() if k != "page"} ==
                      {k: v for k, v in old["locator"].items() if k != "page"}, f"Wrong origin clause mapping: {context}")
            if "threshold" in facts:
                threshold = facts["threshold"]
                # source_value (unchanged meaning) names a threshold written as a word ("one", "كيسين").
                # printed_value records a threshold written in digits exactly as printed (١٥ vs 15) and is required
                # then, so digit-glyph loss between source and label is caught.
                digits = quote.translate(FOLD_DIGITS)
                source_value = threshold.get("source_value", str(threshold["value"]))
                visible = re.search(rf"\b{re.escape(source_value)}\b", digits)
                if "source_value" not in threshold:
                    printed = threshold.get("printed_value", "")
                    check(printed and re.search(rf"(?<!\w){re.escape(printed)}(?!\w)", quote)
                          and printed.translate(FOLD_DIGITS) == str(threshold["value"]),
                          f"printed_value must reproduce the threshold digits exactly as printed: {context}")
                check(visible and threshold["unit"] and threshold["operator"] in {"=", ">=", "<="},
                      f"Malformed numeric threshold: {context}")
                if threshold["unit"] in {"minute", "hour"} and threshold["operator"] != "=":
                    check(TIMER_ANCHOR.search(quote), f"Deadline or wait has no stated start event: {context}")
    transcriptions = {f"dev/gold/transcriptions/{doc_id}.json" for doc_id, d in docs.items() if d["variant"] == "scan"}
    check(transcriptions == files_in("dev/gold/transcriptions"), "Unexpected or missing transcription file")
    return clause_index, source_pages


def reference(ref, clauses):
    return clauses[ref["document_id"]][ref["clause_id"]]


def validate_retrieval(docs, clauses):
    total = cross_total = 0
    for split in SPLITS:
        queries = indexed(load(f"{split}/gold/retrieval.json"), "query_id")
        counts, cross = Counter(), Counter()
        languages = defaultdict(set)
        for qid, query in queries.items():
            scope = query["scope"]
            role = scope["role"]
            check(query["query"].strip() and query["query_language"] in MARKERS, f"Empty query or invalid language: {qid}")
            check(query["expected"] and query["wrong_matches"], f"Missing positive or negative: {qid}")
            positives = set()
            cross_matches = []
            for ref in query["expected"]:
                reference(ref, clauses)
                doc = docs[ref["document_id"]]
                check(doc["split"] == split and doc["variant"] == "original"
                      and fields(doc, (*SCOPE_FIELDS, "version")) == scope, f"Retrieval scope mismatch: {qid}")
                positives.add((ref["document_id"], ref["clause_id"]))
                cross_matches.append(doc["language"] != query["query_language"])
            for ref in query["wrong_matches"]:
                reference(ref, clauses)
                pair = (ref["document_id"], ref["clause_id"])
                check(pair not in positives and docs[pair[0]]["split"] == split and ref["reason"],
                      f"Invalid retrieval distractor: {qid}")
            check(query["cross_language"] == all(cross_matches), f"Incorrect cross-language label: {qid}")
            # The same rule in the family's other version is only separable by the version filter, so it must be
            # listed as a distractor or nothing tests that filter for this query.
            listed = {(ref["document_id"], ref["clause_id"]) for ref in query["wrong_matches"]}
            for doc_id, clause_id in positives:
                for other_id, other in docs.items():
                    if (other["document_family"] == scope["document_family"] and other["variant"] == "original"
                            and other["version"] != scope["version"] and clause_id in clauses[other_id]):
                        check((other_id, clause_id) in listed, f"Missing other-version distractor {other_id}/{clause_id}: {qid}")
            counts[role] += 1
            cross[role] += query["cross_language"]
            languages[role].add(query["query_language"])
        minimum, minimum_cross = (8, 2) if split == "dev" else (2, 1)
        for role in ROLES:
            check(counts[role] >= minimum and cross[role] >= minimum_cross
                  and languages[role] == set(MARKERS), f"Insufficient bilingual retrieval coverage: {split}/{role}")
        total += len(queries)
        cross_total += sum(cross.values())
    return total, cross_total


NUMBER_WORDS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen "
                                            "fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}


def scenario_numbers(text):
    # Elapsed times and counts in a scenario; IDs such as TF-418 or SD-286 are not numbers.
    found = [int(m.group(0).translate(FOLD_DIGITS)) for m in re.finditer(r"(?<![\w-])[0-9٠-٩]+(?![\w-])", text)]
    return found + [NUMBER_WORDS[w] for w in re.findall(r"[a-z]+", text.lower()) if w in NUMBER_WORDS]


def check_scenario_thresholds(cid, case, doc_clauses, diff_entries):
    # A case citing a wait threshold must actually reach it, must not sit on the boundary unless it says so,
    # and a case built on a changed threshold must get different answers under the old and new versions.
    for clause_id in case["supporting_clause_ids"]:
        threshold = doc_clauses[clause_id]["facts"].get("threshold")
        if not threshold or threshold["operator"] != ">=" or threshold["unit"] not in {"minute", "hour"}:
            continue
        numbers = scenario_numbers(case["scenario"])
        check(any(n >= threshold["value"] for n in numbers), f"Scenario never reaches the {clause_id} threshold: {cid}")
        on_boundary = threshold["value"] in numbers
        check(on_boundary == bool(case.get("threshold_boundary")),
              f"Scenario {'sits on' if on_boundary else 'is off'} the {clause_id} threshold but threshold_boundary says otherwise: {cid}")
        old = diff_entries.get(clause_id, {}).get("changed_facts", {}).get("threshold", {}).get("before")
        if old:
            check(not any(n >= old["value"] for n in numbers),
                  f"Scenario triggers {clause_id} under the superseded threshold too, so it cannot test the update: {cid}")


def validate_assessments(docs, clauses):
    cases = indexed(load("dev/gold/assessments.json"), "case_id")
    diffs = {d["to_document_id"]: {e["clause_id"]: e for e in d["clauses"]} for d in load("dev/gold/version_diffs.json")}
    check(Counter(c["role"] for c in cases.values()) == dict.fromkeys(ROLES, 2), "Expected two assessment cases per role")
    for cid, case in cases.items():
        doc = docs[case["document_id"]]
        check(doc["split"] == "dev" and doc["role"] == case["role"], f"Invalid assessment scope: {cid}")
        check(case["language"] in MARKERS and all(case[key].strip() for key in ("scenario", "correct_action", "explanation")),
              f"Incomplete assessment: {cid}")
        supporting = case["supporting_clause_ids"]
        check(supporting and set(supporting) <= clauses[case["document_id"]].keys(), f"Invalid assessment citations: {cid}")
        wrong = case["wrong_answer"]
        check(wrong["text"].strip() and wrong["text"] != case["correct_action"]
              and wrong["expected_route"] == "remedial_practice" and wrong["practice_items"]
              and set(wrong["practice_items"]) <= {f"training-{x.lower()}" for x in supporting}, f"Invalid remedial route: {cid}")
        # Remediation must cover exactly the cited rules the wrong answer breaks.
        check(wrong.get("violates") and set(wrong["violates"]) <= set(supporting)
              and sorted(wrong["practice_items"]) == sorted(f"training-{x.lower()}" for x in wrong["violates"]),
              f"Remediation does not match the rules the wrong answer violates: {cid}")
        check_scenario_thresholds(cid, case, clauses[case["document_id"]], diffs.get(case["document_id"], {}))
    draft = load("dev/gold/flagged_draft.json")
    citation = draft["citation"]
    check(docs[citation["document_id"]]["split"] == "dev"
          and docs[citation["document_id"]]["role"] == draft["role"]
          and reference(citation, clauses)["locator"] == citation["locator"], "Invalid flagged draft citation")
    check(draft["expected_decision"] == "block_publication" and draft["claim"] and draft["reason"]
          and draft["state"] == "awaiting_trainer_approval", "Invalid publication gate fixture")
    return cases


STRICT_COMPARATOR = re.compile(r"\bmore than\b|\bover\b|\bexceeds?\b|أكثر من|يزيد على")


def validate_publication_gates(docs, clauses):
    # Each gate's decision is re-derived from evidence: the cited version must be current, and a claim about a
    # threshold must state the same value (any digit glyphs) without turning an inclusive rule into a strict one.
    gates = indexed(load("dev/gold/publication_gates.json"), "gate_id")
    latest = defaultdict(int)
    for doc in docs.values():
        if doc["variant"] == "original":
            latest[doc["document_family"]] = max(latest[doc["document_family"]], doc["version"])
    codes = Counter()
    for gid, gate in gates.items():
        citation = gate["citation"]
        doc, clause = docs[citation["document_id"]], reference(citation, clauses)
        check(doc["split"] == "dev" and doc["variant"] == "original" and doc["role"] == gate["role"]
              and gate["language"] in MARKERS and gate["claim"].strip() and gate["reason"].strip()
              and clause["locator"] == citation["locator"], f"Invalid publication gate: {gid}")
        threshold = clause["facts"].get("threshold")
        if doc["version"] < latest[doc["document_family"]]:
            derived = "superseded_version"
        else:
            check(threshold is not None, f"Gate claim has no threshold to test against: {gid}")
            numbers = scenario_numbers(gate["claim"])
            check(numbers, f"Gate claim states no number: {gid}")
            if any(n != threshold["value"] for n in numbers):
                derived = "threshold_mismatch"
            elif STRICT_COMPARATOR.search(gate["claim"].lower()) and threshold["operator"] == ">=":
                derived = "operator_mismatch"
            else:
                derived = "supported"
        check(gate["reason_code"] == derived, f"Gate {gid} should be {derived}, labelled {gate['reason_code']}")
        expected = "allow_trainer_review" if derived == "supported" else "block_publication"
        check(gate["expected_decision"] == expected, f"Gate {gid} decision should be {expected}")
        codes[derived] += 1
    check(set(codes) == {"supported", "threshold_mismatch", "operator_mismatch", "superseded_version"},
          "Publication gates must cover supported, threshold, operator, and superseded-version cases")
    check({g["language"] for g in gates.values()} == set(MARKERS), "Publication gates need Arabic and English claims")
    return len(gates)


ROUTING_ACTIONS = {"reassess", "update_in_progress_assignment", "unaffected_no_assignment", "unaffected_out_of_scope"}


def expected_learner_action(learner, scope, source_version):
    match = ("role", "organization", "branch")
    if fields(learner, match) != fields(scope, match):
        return "unaffected_out_of_scope"
    for mastery in learner["mastery"]:
        if (mastery["document_family"], mastery["version"]) == (scope["document_family"], source_version):
            return "reassess" if mastery["state"] == "mastered" else "update_in_progress_assignment"
    return "unaffected_no_assignment"


def validate_updates(docs, clauses, cases):
    learners = indexed(load("dev/gold/learners.json")["learners"], "learner_id")
    for lid, learner in learners.items():
        check(learner["language"] in MARKERS and learner["role"] in ROLES
              and learner["branch"] and learner["device_type"], f"Incomplete learner profile: {lid}")
        for mastery in learner["mastery"]:
            check(any(d["split"] == "dev" and fields(d, SCOPE_FIELDS) == {**fields(learner, ("role", "organization")),
                      "document_family": mastery["document_family"]} and d["version"] == mastery["version"]
                      for d in docs.values()), f"Invalid learner assignment: {lid}")
            check(mastery["state"] in {"mastered", "in_progress", "needs_practice"} and 0 <= mastery["score"] <= 1,
                  f"Invalid mastery state or score: {lid}")
    updates = indexed(load("dev/gold/version_diffs.json"), "to_document_id")
    check(set(updates) == {doc_id for doc_id, d in docs.items() if d["version"] == 2
                           or (d["version"] == 3 and d["variant"] == "original")}, "Incomplete v2/v3 diff coverage")
    types, actions, changed_facts = set(), set(), set()
    moved = False
    for new_id, update in updates.items():
        old_id = update["from_document_id"]
        old, new = docs[old_id], docs[new_id]
        scope_fields = (*SCOPE_FIELDS, "branch")
        scope = update["scope"]
        check(new["version"] == old["version"] + 1 and old["variant"] == new["variant"] == "original"
              and old["split"] == new["split"] == "dev"
              and scope == fields(old, scope_fields) == fields(new, scope_fields), f"Wrong revision pairing: {new_id}")
        before, after = clauses[old_id], clauses[new_id]
        entries = indexed(update["clauses"], "clause_id")
        check(set(entries) == before.keys() | after.keys(), f"Incomplete change set: {new_id}")
        reassess = set()
        for cid, entry in entries.items():
            prior, current = before.get(cid), after.get(cid)
            previous_loc = prior["locator"] if prior else None
            current_loc = current["locator"] if current else None
            check(entry["before"] == previous_loc and entry["after"] == current_loc, f"Stale diff locators: {new_id}/{cid}")
            if prior is None:
                kind, decision = "added", "approve_new"
            elif current is None:
                kind, decision = "removed", "retire"
            elif prior["quote"] != current["quote"]:
                kind, decision = "changed", "reapprove"
                changed_facts.update(
                    key for key in ("threshold", "actor", "exceptions")
                    if prior["facts"].get(key) != current["facts"].get(key)
                )
            else:
                kind, decision = "unchanged", "remains_valid"
            is_moved = bool(prior and current and previous_loc["section"] != current_loc["section"])
            moved |= is_moved and kind == "unchanged"
            types.add(kind)
            check((entry["change"], entry["moved"]) == (kind, is_moved) and entry["reason"], f"Incorrect diff label: {cid}")
            # match_basis records what evidence links the two versions; changed_facts states the rule change itself.
            if kind in {"added", "removed"}:
                basis = "none"
            elif match_key(prior["quote"]) == match_key(current["quote"]):
                basis = "identical_text"
            else:
                check(kind == "changed", f"Quote differs only in matching-irrelevant ways but is labelled {kind}: {cid}")
                basis = ("similar_text" if trigram_similarity(prior["quote"], current["quote"]) >= 0.5 else
                         "same_section_low_similarity" if previous_loc["section"] == current_loc["section"] else "unsupported")
            check(entry.get("match_basis") == basis, f"Diff match_basis should be {basis}: {new_id}/{cid}")
            if kind == "changed":
                expected_facts = {key: {"before": prior["facts"].get(key), "after": current["facts"].get(key)}
                                  for key in sorted(set(prior["facts"]) | set(current["facts"]))
                                  if prior["facts"].get(key) != current["facts"].get(key)}
                check(expected_facts and entry.get("changed_facts") == expected_facts,
                      f"changed_facts disagree with the extraction labels: {new_id}/{cid}")
            else:
                check("changed_facts" not in entry, f"changed_facts on a {kind} clause: {new_id}/{cid}")
            item = entry["training_item"]
            check(item["item_id"] == f"training-{cid.lower()}" and item["decision"] == decision
                  and item["update_citation"] == bool(current and (kind != "unchanged" or previous_loc != current_loc)),
                  f"Wrong training decision: {cid}")
            expected_cases = {key for key, case in cases.items() if case["document_id"] == new_id and cid in case["supporting_clause_ids"]}
            check(set(item["assessment_case_ids"]) == expected_cases, f"Wrong updated assessment links: {cid}")
            if kind in {"changed", "added"}:
                reassess.add(cid)
        check(set(update["reassessment_clause_ids"]) == reassess, f"Wrong reassessment clause set: {new_id}")
        impacts = indexed(update["learner_impacts"], "learner_id")
        check(set(impacts) == set(learners), f"Missing learner impacts: {new_id}")
        per_update = set()
        for lid, impact in impacts.items():
            action = impact["expected_action"]
            check(action == expected_learner_action(learners[lid], scope, old["version"]), f"Wrong learner routing: {new_id}/{lid}")
            actions.add(action)
            per_update.add(action)
        check(per_update == ROUTING_ACTIONS, f"Update must exercise every routing outcome, missing {sorted(ROUTING_ACTIONS - per_update)}: {new_id}")
    check(types == {"unchanged", "changed", "added", "removed"} and moved
          and "threshold" in changed_facts and {"actor", "exceptions"} & changed_facts,
          "Diffs must cover every change type, a moved rule, a threshold, and an actor or exception change")
    check({"reassess", "unaffected_no_assignment", "unaffected_out_of_scope", "update_in_progress_assignment"} <= actions,
          "Missing reassessment routing scenarios")
    return len(updates), len(learners)


# ---- Clause-level change-detection pairs ------------------------------------------------------------------
CHANGE_TYPES = ("cosmetic", "wording", "threshold", "negation", "modality", "actor", "condition", "order")
CHANGE_SEVERITY = {"cosmetic": "none", "wording": "low", "order": "medium", "condition": "medium", "modality": "medium",
                   "negation": "high", "actor": "high", "threshold": "high"}
EN_ACTORS = ("dispatch desk", "duty supervisor", "on-call backup", "duty lead", "support agent", "partner support",
             "branch lead", "branch manager", "restaurant cashier", "cancellations desk", "service quality queue",
             "case owner", "prep station", "building staff", "dispatch", "customer", "courier", "supervisor")
AR_ACTORS = ("موظف نقطة الاستلام", "فريق تسوية الطلبات", "مسؤول التوزيع", "مراجع المدفوعات", "موظف الاستقبال",
             "موظف الفرع", "مشرف التحضير", "مشرف الفرع", "مشرف", "مندوب", "عميل")
WEAK_MODALS = {"may", "should", "can", "could", "might", "optional", "يمكن", "يجوز", "يفضل", "ينبغي", "بإمكانك"}
AR_BOUND = r"(?:^|(?<=[\s،.,؛]))"
AR_END = r"(?=[\s،.,؛]|$)"


def change_features(text):
    t = re.sub(r"[ً-ْ]", "", text).replace("ـ", "").lower()
    def lexicon(terms):
        found, rest = set(), t
        for term in terms:  # longest terms listed first, so "dispatch desk" is not also counted as "dispatch"
            if term in rest:
                found.add(term)
                rest = rest.replace(term, " ")
        return found
    return {
        "numbers": sorted(scenario_numbers(text)),
        "negation": len(re.findall(r"\b(?:not|never|no|cannot|without)\b|n't", t))
                    + len(re.findall(AR_BOUND + r"و?(?:لا|لم|لن|ليس|دون|بدون)" + AR_END, t))
                    - t.count("ما لم"),  # «ما لم» means "unless": a condition, not a negation
        "modals": {m for m in ("must", "should", "may", "can", "could", "might", "optional", "required")
                   if re.search(rf"\b{m}\b", t)} | {m for m in ("يجب", "ينبغي", "يمكن", "يجوز", "يفضل", "عليك", "بإمكانك") if m in t},
        "actors": lexicon(EN_ACTORS) | lexicon(AR_ACTORS),
        "conditions": len(re.findall(r"\b(?:if|unless|except|when|while|until|whenever)\b", t))
                      + len(re.findall(AR_BOUND + r"[وف]?(?:إذا|اذا|إلا|الا|عند|حتى|طالما|لو)" + AR_END, t))
                      + t.count("ما لم"),
        "order": Counter(re.findall(r"\b(?:before|after|then|first|next)\b", t))
                 + Counter(re.findall(AR_BOUND + r"[و]?(قبل|بعد|ثم)" + AR_END, t)),
        "tokens": Counter(match_key(text).split()),
    }


def check_change_pair(pid, pair):
    # Re-derive the evidence for a pair from its two texts; the label must be the change the text actually shows.
    b, a, kind = change_features(pair["before"]), change_features(pair["after"]), pair["change_type"]
    same = lambda *keys: all(b[k] == a[k] for k in keys)
    surface_equal = match_key(pair["before"]) == match_key(pair["after"])
    check(pair["before"] != pair["after"], f"Change pair does not change anything: {pid}")
    check((kind == "cosmetic") == surface_equal, f"Only cosmetic pairs may be identical after normalization: {pid}")
    evidence = pair["evidence"]
    if kind == "wording":
        check(same("numbers", "negation", "modals", "actors", "conditions", "order"),
              f"Wording pair changes a number, negation, modal, actor, condition or step order: {pid}")
    elif kind == "threshold":
        mask = lambda s: match_key(re.sub(r"[0-9٠-٩]+", "#", s))
        check(b["numbers"] != a["numbers"] and mask(pair["before"]) == mask(pair["after"]),
              f"Threshold pair must change only the number: {pid}")
        check(evidence["before"] in pair["before"] and evidence["after"] in pair["after"]
              and int(evidence["after"].translate(FOLD_DIGITS)) in a["numbers"], f"Threshold evidence does not match the text: {pid}")
    elif kind == "negation":
        delta = a["negation"] - b["negation"]
        check(delta and same("numbers") and evidence["direction"] == ("added" if delta > 0 else "removed"),
              f"Negation pair must add or remove a negation, as labelled: {pid}")
    elif kind == "modality":
        check(b["modals"] != a["modals"] and same("numbers", "negation"), f"Modality pair must change only the modal force: {pid}")
        check(evidence["direction"] != "weakened" or bool((a["modals"] - b["modals"]) & WEAK_MODALS),
              f"Weakened modality pair adds no weak modal: {pid}")
    elif kind == "actor":
        added = change_features(evidence["after"])["actors"]
        check(b["actors"] != a["actors"] and same("numbers", "negation", "conditions", "modals")
              and added and added <= a["actors"] - b["actors"],
              f"Actor pair must hand the step to the labelled new actor: {pid}")
    elif kind == "condition":
        delta = a["conditions"] - b["conditions"]
        check(delta and same("numbers", "negation") and evidence["direction"] == ("added" if delta > 0 else "removed"),
              f"Condition pair must add or remove a condition, as labelled: {pid}")
    elif kind == "order":
        reordered = b["order"] != a["order"] or (b["tokens"] == a["tokens"])
        check(reordered and same("numbers", "negation", "modals", "actors", "conditions"),
              f"Order pair must change step order and nothing else: {pid}")


def validate_change_pairs(docs, clauses):
    totals = {}
    for split in SPLITS:
        pairs = indexed(load(f"{split}/gold/change_pairs.json"), "pair_id")
        coverage = defaultdict(set)
        for pid, pair in pairs.items():
            base = pair["base"]
            doc = docs[base["document_id"]]
            check(doc["split"] == split and doc["variant"] == "original", f"Change pair base is outside its split: {pid}")
            check(pair["before"] == reference(base, clauses)["quote"], f"Change pair 'before' is not the exact gold quote: {pid}")
            check(pair["language"] == doc["language"] and pair["role"] == doc["role"], f"Change pair scope mismatch: {pid}")
            check(not GOLD_LABEL.search(pair["after"]), f"Change pair text contains a gold label: {pid}")
            kind = pair["change_type"]
            check(kind in CHANGE_TYPES, f"Unknown change type: {pid}")
            material = kind not in ("cosmetic", "wording")
            expected_severity = "high" if pair["safety_tag"] and material else CHANGE_SEVERITY[kind]
            handling = {"cosmetic": "carry_forward", "wording": "refresh_text"}.get(kind, "regenerate_and_reassess")
            check(pair["material"] == material and pair["severity"] == expected_severity and pair["expected_handling"] == handling,
                  f"Change pair materiality, severity or handling disagrees with its type: {pid}")
            check_change_pair(pid, pair)
            coverage[kind].add(pair["language"])
            coverage[kind + "#"].add(pid)
        minimum = 10 if split == "dev" else 3
        for kind in CHANGE_TYPES:
            check(len(coverage[kind + "#"]) >= minimum and coverage[kind] == set(MARKERS),
                  f"{split} change pairs need >= {minimum} '{kind}' pairs in Arabic and English")
        totals[split] = len(pairs)
    return totals


def validate_freeze():
    # FREEZE.sha256 pins every data file (see qa/freeze.py). Absent file = unfrozen working copy.
    freeze = ROOT / "FREEZE.sha256"
    if not freeze.exists():
        return "not frozen"
    pinned = dict(reversed(line.split("  ", 1)) for line in freeze.read_text(encoding="utf-8").splitlines() if line)
    current = {p.relative_to(ROOT).as_posix(): p for p in
               [ROOT / "manifest.json"] + [p for s in SPLITS for p in (ROOT / s).rglob("*") if p.is_file()]}
    check(set(current) == set(pinned), f"Frozen file set changed: {sorted(set(current) ^ set(pinned))}")
    for rel, path in current.items():
        check(sha256(path.read_bytes()).hexdigest() == pinned[rel], f"Frozen file changed after freeze: {rel}")
    return f"frozen, {len(pinned)} files match FREEZE.sha256"


def main():
    docs, demo = validate_manifest()
    clauses, pages = validate_extraction(docs)
    check(len(pages[demo["document_id"]]) == 1, "The live demo SOP must fit on one page")
    queries, cross = validate_retrieval(docs, clauses)
    cases = validate_assessments(docs, clauses)
    gates = validate_publication_gates(docs, clauses)
    change_pairs = validate_change_pairs(docs, clauses)
    updates, learners = validate_updates(docs, clauses, cases)
    freeze = validate_freeze()
    print("PASS: HungerLearn fixture validation")
    for label in ("role", "language", "format", "split"):
        counts = Counter(doc[label] for doc in docs.values())
        print(f"  {label}: " + ", ".join(f"{name}={count}" for name, count in sorted(counts.items())))
    procedure_counts = [doc["procedure_count"] for doc in docs.values()]
    print(f"  {min(procedure_counts)}-{max(procedure_counts)} procedures per file, {sum(procedure_counts)} procedure occurrences")
    print(f"  {len(docs)} files, {sum(map(len, clauses.values()))} clause occurrences, 3 transcribed scan pages")
    print(f"  {queries} retrieval queries ({cross} cross-language), {len(cases)} assessment cases, 1 blocked draft, "
          f"{gates} publication gates")
    print(f"  {updates} version diffs, {learners} learner profiles, "
          f"{change_pairs['dev']} dev + {change_pairs['held_out']} held-out clause change pairs")
    print(f"  Live demo upload: {demo['path']}")
    print(f"  Freeze: {freeze}")
    print("  Model evaluations run: 0")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError) as error:
        sys.exit(f"FAIL: {error}")
