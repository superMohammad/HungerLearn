"""Render every v3 family to PDF, DOCX and TXT in Arabic and English (six uploads per family) in dev/uploads/.

Run from the dataset directory (needs Google Chrome or Chromium for the PDFs and the chart images):
    uv run --no-project --with python-docx==1.2.0 --with Pillow==13.0.0 --with pypdf==6.21.4 python -m qa.v3_render

PDF: HTML printed by headless Chrome (Arabic shaping and RTL), the Hunger Learn logo top-right on every page and
page numbers in the footer. DOCX: python-docx with Word heading styles (what Mammoth reads as headings), RTL
paragraphs and tables for Arabic, the logo in the page header. TXT: the same content as plain text; figures become
a one-line caption. Charts are PNG images in every format, so their labels never enter the extracted text.

Chrome and python-docx stamp the render time into each PDF and DOCX, so a re-render changes their bytes even
when the text is the same: regenerate the gold and the freeze (`python qa/freeze.py`) after every render.
"""
from __future__ import annotations

import html
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from PIL import Image

from qa.v3_authoring.courier_pickup_wait import FAMILY as COURIER
from qa.v3_authoring.employee_delayed_order import FAMILY as EMPLOYEE
from qa.v3_authoring.partner_packing_sealing import FAMILY as PARTNER
from qa.v3_authoring.model import (
    BarChart, Bullets, Callout, Chart, FamilyV3, Figure, FlowChart, Language, LANGUAGES, Paragraph, Rules, Section,
    Subheading, Table, TimelineChart,
)
from validate import AUDIENCE, MARKERS, ROOT, header_line, load

FAMILIES: tuple[FamilyV3, ...] = (COURIER, EMPLOYEE, PARTNER)
FORMATS = ("pdf", "docx", "txt")
BRAND = "#6B2A18"
BRAND_SOFT = "#F4EAE5"
REPO = ROOT.parents[1]
LOGO = REPO / "web" / "public" / "brand" / "hungerlearn-logo.png"
PHOTOS = REPO / "web" / "public" / "brand" / "photos"
AR_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
AR_LETTERS = "أبجدهوزحطي"
EN_LETTERS = "ABCDEFGHIJ"


@dataclass(frozen=True)
class Meta:
    """What the upload header prints, taken from the family's v2 manifest entry (never typed twice)."""
    language: Language
    role: str
    organization_local: str
    branch_local: str
    title: str
    marker: str
    header: str
    audience: str


def meta_for(family: FamilyV3, language: Language) -> Meta:
    v2 = next(d for d in load("manifest.json")["documents"]
              if d["document_family"] == family.family and d["version"] == 2 and d["variant"] == "original")
    doc = {**v2, "language": language, "version": 3,
           "organization_local": family.cover.organization.get(language),
           "branch_local": family.cover.branch.get(language)}
    return Meta(language=language, role=v2["role"], organization_local=doc["organization_local"],
                branch_local=doc["branch_local"], title=family.cover.title.get(language), marker=MARKERS[language],
                header=header_line(doc), audience=AUDIENCE[language][v2["role"]])


def number(n: int, language: Language) -> str:
    return str(n).translate(AR_DIGITS) if language == "ar" else str(n)


def heading(section: Section, n: int, language: Language) -> str:
    """The section's heading line: «القسم ٦: …», "Section 6: …", «الملحق أ: …», "Appendix A: …"."""
    title = section.title.get(language)
    if section.kind == "appendix":
        letter = (AR_LETTERS if language == "ar" else EN_LETTERS)[n - 1]
        return f"الملحق {letter}: {title}" if language == "ar" else f"Appendix {letter}: {title}"
    return f"القسم {number(n, language)}: {title}" if language == "ar" else f"Section {n}: {title}"


def rule_label(section_no: int, index: int, language: Language) -> str:
    return f"{number(section_no, language)}.{number(index, language)}"


def figure_number(family: FamilyV3, figure: Figure) -> int:
    figures = [b for s in family.sections for b in s.blocks if isinstance(b, Figure)]
    return figures.index(figure) + 1


def figure_caption(family: FamilyV3, figure: Figure, language: Language) -> str:
    n = figure_number(family, figure)
    word = "الشكل" if language == "ar" else "Figure"
    return f"{word} {number(n, language)}: {figure.caption.get(language)}"


# ---- Charts (SVG drawn by Chrome, saved as PNG) ------------------------------------------------------------

def _font(language: Language) -> str:
    return "'Noto Sans Arabic','Noto Naskh Arabic'" if language == "ar" else "'Noto Sans','Liberation Sans'"


def _text(x: float, y: float, value: str, size: int, anchor: str, weight: int, fill: str) -> str:
    """SVG text. In Arabic charts the SVG is RTL, so "end" puts the text to the right of x."""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" '
            f'fill="{fill}">{html.escape(value)}</text>')


def flow_svg(chart: FlowChart, language: Language) -> tuple[str, int, int]:
    width, height, gap = 900, 200, 26
    n = len(chart.steps)
    box = (width - 40 - gap * (n - 1)) / n
    parts = []
    for i, (label, note) in enumerate(chart.steps):
        slot = n - 1 - i if language == "ar" else i
        x = 20 + slot * (box + gap)
        parts.append(f'<rect x="{x:.1f}" y="50" width="{box:.1f}" height="78" rx="10" fill="{BRAND_SOFT}" stroke="{BRAND}" stroke-width="2"/>')
        parts.append(_text(x + box / 2, 96, label.get(language), 22, "middle", 700, BRAND))
        parts.append(_text(x + box / 2, 160, note.get(language), 16, "middle", 400, "#52525B"))
        if i < n - 1:
            ax = x - gap + 4 if language == "ar" else x + box + 4
            tip = ax if language == "ar" else ax + gap - 8
            base = ax + gap - 8 if language == "ar" else ax
            parts.append(f'<line x1="{base:.1f}" y1="89" x2="{tip:.1f}" y2="89" stroke="{BRAND}" stroke-width="2"/>')
            head = 6 if language == "ar" else -6
            parts.append(f'<polyline points="{tip + head:.1f},83 {tip:.1f},89 {tip + head:.1f},95" fill="none" stroke="{BRAND}" stroke-width="2"/>')
    return "".join(parts), width, height


def timeline_svg(chart: TimelineChart, language: Language) -> tuple[str, int, int]:
    width, height, left, right, axis_y = 900, 240, 60, 840, 150

    def x_of(minute: int) -> float:
        share = minute / chart.end
        return right - share * (right - left) if language == "ar" else left + share * (right - left)

    parts = [f'<line x1="{left}" y1="{axis_y}" x2="{right}" y2="{axis_y}" stroke="#A1A1AA" stroke-width="1"/>']
    for minute in range(0, chart.end + 1, 5):
        x = x_of(minute)
        parts.append(f'<line x1="{x:.1f}" y1="{axis_y}" x2="{x:.1f}" y2="{axis_y + 6}" stroke="#A1A1AA" stroke-width="1"/>')
        parts.append(_text(x, axis_y + 26, number(minute, language), 15, "middle", 400, "#52525B"))
    for i, (minute, label) in enumerate(chart.points):
        x = x_of(minute)
        top = 62 if i % 2 == 0 else 96
        parts.append(f'<line x1="{x:.1f}" y1="{top + 8}" x2="{x:.1f}" y2="{axis_y}" stroke="#D4D4D8" stroke-width="1"/>')
        parts.append(f'<circle cx="{x:.1f}" cy="{axis_y}" r="7" fill="{BRAND}" stroke="#FFFFFF" stroke-width="2"/>')
        parts.append(_text(x, top, label.get(language), 17, "middle", 700, "#27272A"))
    parts.append(_text(width / 2, 222, chart.axis_label.get(language), 15, "middle", 400, "#52525B"))
    return "".join(parts), width, height


def bar_svg(chart: BarChart, language: Language) -> tuple[str, int, int]:
    width, height, left, right, top, bottom = 900, 380, 70, 830, 44, 320
    peak = max(max(chart.values), chart.target) * 1.15
    step = (right - left) / len(chart.values)

    def y_of(v: float) -> float:
        return bottom - v / peak * (bottom - top)

    parts = []
    for tick in range(0, int(peak) + 1, 2):
        y = y_of(tick)
        parts.append(f'<line x1="{left}" y1="{y:.1f}" x2="{right}" y2="{y:.1f}" stroke="#E4E4E7" stroke-width="1"/>')
        tx, anchor = (right + 8, "end") if language == "ar" else (left - 8, "end")
        parts.append(_text(tx, y + 5, number(tick, language), 14, anchor, 400, "#71717A"))
    for i, (category, value) in enumerate(zip(chart.categories, chart.values)):
        slot = len(chart.values) - 1 - i if language == "ar" else i
        cx = left + step * slot + step / 2
        y, w = y_of(value), 24
        parts.append(f'<path d="M{cx - w / 2:.1f},{bottom} V{y + 4:.1f} Q{cx - w / 2:.1f},{y:.1f} {cx - w / 2 + 4:.1f},{y:.1f} '
                     f'H{cx + w / 2 - 4:.1f} Q{cx + w / 2:.1f},{y:.1f} {cx + w / 2:.1f},{y + 4:.1f} V{bottom} Z" fill="{BRAND}"/>')
        parts.append(_text(cx, bottom + 24, category.get(language), 15, "middle", 400, "#52525B"))
        if i == len(chart.values) - 1:
            shown = f"{value:g}".translate(AR_DIGITS).replace(".", "٫") if language == "ar" else f"{value:g}"
            parts.append(_text(cx, y - 10, shown, 15, "middle", 700, "#27272A"))
    ty = y_of(chart.target)
    parts.append(f'<line x1="{left}" y1="{ty:.1f}" x2="{right}" y2="{ty:.1f}" stroke="#71717A" stroke-width="1.5"/>')
    # The target is named in a key above the plot, so it never collides with a bar or its value label.
    kx = right - 30 if language == "ar" else left + 30
    parts.append(f'<line x1="{kx - 24:.1f}" y1="14" x2="{kx:.1f}" y2="14" '
                 f'stroke="#71717A" stroke-width="1.5" transform="translate({30 if language == "ar" else -6},0)"/>')
    tx = kx - 4 if language == "ar" else kx + 4
    parts.append(_text(tx, 19, chart.target_label.get(language), 14, "start", 700, "#3F3F46"))
    parts.append(_text(width / 2, 370, chart.unit.get(language), 14, "middle", 400, "#71717A"))
    return "".join(parts), width, height


def chart_svg(chart: Chart, language: Language) -> tuple[str, int, int]:
    if isinstance(chart, FlowChart):
        return flow_svg(chart, language)
    if isinstance(chart, TimelineChart):
        return timeline_svg(chart, language)
    return bar_svg(chart, language)


def chrome() -> str:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    raise FileNotFoundError("Rendering v3 uploads needs Google Chrome or Chromium on PATH (google-chrome, chromium)")


def run_chrome(args: list[str]) -> None:
    result = subprocess.run([chrome(), "--headless", "--disable-gpu", "--no-sandbox", *args],
                            capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(f"Chrome failed ({result.returncode}) for {args}: {result.stderr[-2000:]}")


def render_chart(chart: Chart, language: Language, out: Path) -> None:
    body, width, height = chart_svg(chart, language)
    page = out.with_suffix(".html")
    page.write_text(
        f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;background:#fff}}'
        f'svg{{font-family:{_font(language)};display:block;direction:{"rtl" if language == "ar" else "ltr"}}}'
        f'</style></head><body>'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f'{body}</svg></body></html>', encoding="utf-8")
    run_chrome(["--hide-scrollbars", "--force-device-scale-factor=2", f"--window-size={width},{height}",
                f"--screenshot={out}", page.as_uri()])


def build_assets(family: FamilyV3, build: Path) -> dict[str, Path]:
    """Every image the family's documents use: per-language charts and JPEG copies of photos (DOCX has no WebP)."""
    assets = {"logo": build / "logo.png"}
    shutil.copyfile(LOGO, assets["logo"])
    figures = {b.image: b for s in family.sections for b in s.blocks if isinstance(b, Figure)}
    for name, figure in figures.items():
        if figure.localized:
            for language in LANGUAGES:
                out = build / f"{name}-{language}.png"
                render_chart(family.charts[name], language, out)
                assets[f"{name}-{language}"] = out
        else:
            out = build / f"{name}.jpg"
            with Image.open(PHOTOS / f"{name}.webp") as img:
                img.convert("RGB").save(out, "JPEG", quality=88)
            assets[name] = out
    if family.cover.photo not in assets:
        out = build / f"{family.cover.photo}.jpg"
        with Image.open(PHOTOS / f"{family.cover.photo}.webp") as img:
            img.convert("RGB").save(out, "JPEG", quality=88)
        assets[family.cover.photo] = out
    return assets


def asset_key(figure: Figure, language: Language) -> str:
    return f"{figure.image}-{language}" if figure.localized else figure.image


# ---- PDF ------------------------------------------------------------------------------------------------------

CSS = """
@page { size: A4; margin: 24mm 19mm 20mm;
  @top-right { content: ""; width: 32mm; background: url(logo.png) no-repeat right center / auto 10mm; }
  @bottom-center { content: %(page_label)s; font: 9pt %(font)s; color: #71717A; } }
@page :first { @top-right { content: none; } }
body { font: 11pt/1.75 %(font)s; color: #27272A; margin: 0; }
h1 { font: 700 17pt/1.4 %(head)s; color: %(brand)s; break-before: page; margin: 0 0 6mm;
     padding-bottom: 2mm; border-bottom: 2px solid %(brand)s; }
.sub { font: 700 11.5pt %(head)s; color: %(brand)s; margin: 5mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2.5mm; }
.rule { display: flex; gap: 3mm; margin: 0 0 2.2mm; break-inside: avoid; }
.rule b { color: %(brand)s; min-width: 9mm; }
ul { margin: 0 0 2mm; padding-inline-start: 6mm; } li { margin-bottom: 1mm; }
table { width: 100%%; border-collapse: collapse; margin: 1mm 0 5mm; font-size: 10pt; break-inside: avoid; }
caption { caption-side: top; text-align: start; font: 700 10pt %(head)s; color: #3F3F46; padding-bottom: 1.5mm; }
th { background: %(soft)s; color: %(brand)s; font-weight: 700; text-align: start; }
th, td { border: 1px solid #D9C4BA; padding: 1.6mm 2.6mm; vertical-align: top; }
.callout { background: #FAF6F3; border-inline-start: 3px solid %(brand)s; padding: 3mm 4mm; margin: 5mm 0 3mm; break-inside: avoid; }
.callout .title { font: 700 10.5pt %(head)s; color: %(brand)s; margin-bottom: 1mm; }
figure { margin: 4mm 0 5mm; break-inside: avoid; text-align: center; }
figure img { max-width: 100%%; max-height: 95mm; }
figcaption { font-size: 9.5pt; color: #52525B; margin-top: 1.5mm; }
.cover { text-align: center; padding-top: 14mm; }
.cover .logo { width: 62mm; margin-bottom: 16mm; }
.cover .title { font: 700 25pt/1.35 %(head)s; color: %(brand)s; margin-bottom: 3mm; }
.cover .subtitle { font: 400 14pt %(head)s; color: #3F3F46; margin-bottom: 10mm; }
.cover .line { margin: 0 0 1.5mm; font-size: 11pt; }
.cover .marker { display: inline-block; border: 1px solid %(brand)s; color: %(brand)s; padding: 0.8mm 4mm;
                 border-radius: 4mm; font-size: 9.5pt; margin-bottom: 6mm; }
.cover .photo { width: 120mm; height: 72mm; object-fit: cover; border-radius: 4mm; margin-top: 10mm; }
"""


ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
DATE_CELL = ' style="white-space:nowrap"'


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def html_block(block, family: FamilyV3, section_no: int, language: Language) -> str:
    if isinstance(block, Paragraph):
        return f"<p>{esc(block.text.get(language))}</p>"
    if isinstance(block, Subheading):
        return f'<div class="sub">{esc(block.text.get(language))}</div>'
    if isinstance(block, Bullets):
        return "<ul>" + "".join(f"<li>{esc(i.get(language))}</li>" for i in block.items) + "</ul>"
    if isinstance(block, Rules):
        return "".join(f'<div class="rule"><b>{rule_label(section_no, i, language)}</b><span>{esc(r.text.get(language))}</span></div>'
                       for i, r in enumerate(block.rules, start=1))
    if isinstance(block, Table):
        head = "".join(f"<th>{esc(h.get(language))}</th>" for h in block.header)
        rows = "".join("<tr>" + "".join(f"<td{DATE_CELL if ISO_DATE.fullmatch(c.get(language)) else ''}>{esc(c.get(language))}</td>"
                                         for c in row) + "</tr>" for row in block.rows)
        return f"<table><caption>{esc(block.caption.get(language))}</caption><tr>{head}</tr>{rows}</table>"
    if isinstance(block, Callout):
        return (f'<div class="callout"><div class="title">{esc(block.title.get(language))}</div>'
                f"<p>{esc(block.text.get(language))}</p></div>")
    if isinstance(block, Figure):
        key = asset_key(block, language)
        return (f'<figure><img src="{key}{".png" if block.localized else ".jpg"}" alt="">'
                f"<figcaption>{esc(figure_caption(family, block, language))}</figcaption></figure>")
    raise TypeError(f"Unknown block type: {type(block).__name__}")


def html_document(family: FamilyV3, language: Language, meta: Meta) -> str:
    cover = family.cover
    font = "'Noto Naskh Arabic','Noto Sans Arabic'" if language == "ar" else "'Noto Serif','Liberation Serif'"
    head = "'Noto Kufi Arabic','Noto Sans Arabic'" if language == "ar" else "'Noto Sans','Liberation Sans'"
    page_label = ('"صفحة " counter(page) " من " counter(pages)' if language == "ar"
                  else '"Page " counter(page) " of " counter(pages)')
    css = CSS % {"font": font, "head": head, "brand": BRAND, "soft": BRAND_SOFT, "page_label": page_label}
    details = (f"رقم الوثيقة: {cover.document_number} | تاريخ السريان: {cover.effective_date}" if language == "ar"
               else f"Document number: {cover.document_number} | Effective date: {cover.effective_date}")
    parts = [f'<!doctype html><html lang="{language}" dir="{"rtl" if language == "ar" else "ltr"}"><head>'
             f'<meta charset="utf-8"><title>{esc(meta.title)}</title><style>{css}</style></head><body>',
             '<div class="cover"><img class="logo" src="logo.png" alt="">',
             f'<p class="title">{esc(meta.title)}</p>',
             f'<p class="marker">{esc(meta.marker)}</p>',
             f'<p class="line">{esc(meta.header)}</p>',
             f'<p class="line">{esc(meta.audience)}</p>',
             f'<p class="subtitle">{esc(cover.subtitle.get(language))}</p>',
             f'<p class="line">{esc(details)}</p>',
             f'<img class="photo" src="{cover.photo}.jpg" alt=""></div>']
    for n, section in family.numbered():
        parts.append(f"<h1>{esc(heading(section, n, language))}</h1>")
        parts.extend(html_block(b, family, n, language) for b in section.blocks)
    parts.append("</body></html>")
    return "".join(parts)


def write_pdf(family: FamilyV3, language: Language, meta: Meta, build: Path, out: Path) -> None:
    page = build / f"{family.family}-{language}.html"
    page.write_text(html_document(family, language, meta), encoding="utf-8")
    run_chrome(["--no-pdf-header-footer", f"--print-to-pdf={out}", page.as_uri()])


# ---- DOCX -----------------------------------------------------------------------------------------------------

DOCX_FONT = "Arial"


def _rtl_paragraph(paragraph, language: Language) -> None:
    if language == "ar":
        paragraph._p.get_or_add_pPr().append(OxmlElement("w:bidi"))


def _run(paragraph, text: str, language: Language, size: float, bold: bool, color: str):
    run = paragraph.add_run(text)
    if bold:
        run.bold = True
    run.font.size = Pt(size)
    run.font.name = DOCX_FONT
    run.font.color.rgb = RGBColor.from_string(color.lstrip("#"))
    rpr = run._r.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    fonts.set(qn("w:cs"), DOCX_FONT)
    size_cs = OxmlElement("w:szCs")
    size_cs.set(qn("w:val"), str(int(size * 2)))
    rpr.append(size_cs)
    if bold:
        rpr.append(OxmlElement("w:bCs"))
    if language == "ar":
        rpr.append(OxmlElement("w:rtl"))
    return run


def _para(doc, text: str, language: Language, size: float, bold: bool, color: str, align):
    p = doc.add_paragraph()
    _rtl_paragraph(p, language)
    if align is not None:
        p.alignment = align
    _run(p, text, language, size, bold, color)
    return p


def _shade(element, fill: str) -> None:
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill.lstrip("#"))
    element.append(shd)


def _field(paragraph, instruction: str, language: Language) -> None:
    for kind, text in (("begin", None), (None, instruction), ("end", None)):
        run = _run(paragraph, "", language, 9, False, "#71717A")
        if kind:
            fld = OxmlElement("w:fldChar")
            fld.set(qn("w:fldCharType"), kind)
            run._r.append(fld)
        else:
            instr = OxmlElement("w:instrText")
            instr.set(qn("xml:space"), "preserve")
            instr.text = f" {text} "
            run._r.append(instr)


def _docx_table(doc, table: Table, language: Language) -> None:
    _para(doc, table.caption.get(language), language, 10, True, "#3F3F46", None).paragraph_format.keep_with_next = True
    cols = len(table.header)
    grid = doc.add_table(rows=1 + len(table.rows), cols=cols)
    grid.style = "Table Grid"
    tbl_pr = grid._tbl.tblPr
    if language == "ar":
        tbl_pr.append(OxmlElement("w:bidiVisual"))
    width = Cm(16.5)
    for r, row in enumerate((table.header, *table.rows)):
        for c, value in enumerate(row):
            cell = grid.cell(r, c)
            cell.width = int(width / cols)
            p = cell.paragraphs[0]
            _rtl_paragraph(p, language)
            _run(p, value.get(language), language, 10, r == 0, "#6B2A18" if r == 0 else "#27272A")
            if r == 0:
                _shade(cell._tc.get_or_add_tcPr(), BRAND_SOFT)
    doc.add_paragraph()


def write_docx(family: FamilyV3, language: Language, meta: Meta, assets: dict[str, Path], out: Path) -> None:
    doc = Document()
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name, normal.font.size = DOCX_FONT, Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    h1 = styles["Heading 1"]
    h1.font.name, h1.font.size, h1.font.bold = DOCX_FONT, Pt(16), True
    h1.font.color.rgb = RGBColor.from_string(BRAND.lstrip("#"))
    h1.paragraph_format.space_before, h1.paragraph_format.space_after = Pt(0), Pt(12)
    h1.paragraph_format.keep_with_next = True
    h1.paragraph_format.page_break_before = True
    h1_fonts = h1.element.get_or_add_rPr().get_or_add_rFonts()
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        h1_fonts.set(qn(attr), DOCX_FONT)
    props = doc.core_properties
    props.title, props.author, props.last_modified_by = meta.title, meta.organization_local, meta.organization_local
    props.comments = props.keywords = props.subject = ""

    section = doc.sections[0]
    section.page_height, section.page_width = Cm(29.7), Cm(21)
    section.left_margin = section.right_margin = Cm(2)
    section.top_margin, section.bottom_margin = Cm(2.4), Cm(2)
    section.different_first_page_header_footer = True
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    header.add_run().add_picture(str(assets["logo"]), width=Cm(3.2))
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _field(footer, "PAGE", language)
    _run(footer, " / ", language, 9, False, "#71717A")
    _field(footer, "NUMPAGES", language)

    cover = family.cover
    center = WD_ALIGN_PARAGRAPH.CENTER
    logo = doc.add_paragraph()
    logo.alignment = center
    logo.add_run().add_picture(str(assets["logo"]), width=Cm(6))
    _para(doc, meta.title, language, 24, True, BRAND, center)
    _para(doc, meta.marker, language, 10, True, BRAND, center)
    _para(doc, meta.header, language, 11, False, "#27272A", center)
    _para(doc, meta.audience, language, 11, False, "#27272A", center)
    _para(doc, cover.subtitle.get(language), language, 14, False, "#3F3F46", center)
    details = (f"رقم الوثيقة: {cover.document_number} | تاريخ السريان: {cover.effective_date}" if language == "ar"
               else f"Document number: {cover.document_number} | Effective date: {cover.effective_date}")
    _para(doc, details, language, 11, False, "#27272A", center)
    photo = doc.add_paragraph()
    photo.alignment = center
    photo.add_run().add_picture(str(assets[cover.photo]), width=Cm(12))

    for n, sec in family.numbered():
        h = doc.add_heading(level=1)
        _rtl_paragraph(h, language)
        _run(h, heading(sec, n, language), language, 16, True, BRAND)
        for block in sec.blocks:
            if isinstance(block, Paragraph):
                _para(doc, block.text.get(language), language, 11, False, "#27272A", None)
            elif isinstance(block, Subheading):
                _para(doc, block.text.get(language), language, 11.5, True, BRAND, None).paragraph_format.keep_with_next = True
            elif isinstance(block, Bullets):
                for item in block.items:
                    p = doc.add_paragraph(style="List Bullet")
                    _rtl_paragraph(p, language)
                    _run(p, item.get(language), language, 11, False, "#27272A")
            elif isinstance(block, Rules):
                for i, rule in enumerate(block.rules, start=1):
                    p = doc.add_paragraph()
                    _rtl_paragraph(p, language)
                    p.paragraph_format.keep_together = True
                    _run(p, f"{rule_label(n, i, language)} {rule.text.get(language)}", language, 11, False, "#27272A")
            elif isinstance(block, Table):
                _docx_table(doc, block, language)
            elif isinstance(block, Callout):
                _para(doc, block.title.get(language), language, 10.5, True, BRAND, None).paragraph_format.keep_with_next = True
                p = _para(doc, block.text.get(language), language, 11, False, "#27272A", None)
                _shade(p._p.get_or_add_pPr(), "#FAF6F3")
            elif isinstance(block, Figure):
                pic = doc.add_paragraph()
                pic.alignment = center
                pic.paragraph_format.keep_with_next = True
                pic.add_run().add_picture(str(assets[asset_key(block, language)]), width=Cm(15))
                _para(doc, figure_caption(family, block, language), language, 9.5, False, "#52525B", center)
            else:
                raise TypeError(f"Unknown block type: {type(block).__name__}")
    doc.save(out)


# ---- TXT ------------------------------------------------------------------------------------------------------

def txt_document(family: FamilyV3, language: Language, meta: Meta) -> str:
    cover = family.cover
    details = (f"رقم الوثيقة: {cover.document_number} | تاريخ السريان: {cover.effective_date}" if language == "ar"
               else f"Document number: {cover.document_number} | Effective date: {cover.effective_date}")
    lines = [meta.title, meta.marker, meta.header, meta.audience, cover.subtitle.get(language), details]
    for n, sec in family.numbered():
        lines += ["", "", heading(sec, n, language), ""]
        for block in sec.blocks:
            if isinstance(block, Paragraph):
                lines += [block.text.get(language), ""]
            elif isinstance(block, Subheading):
                lines += [block.text.get(language)]
            elif isinstance(block, Bullets):
                lines += [f"- {i.get(language)}" for i in block.items] + [""]
            elif isinstance(block, Rules):
                lines += [f"{rule_label(n, i, language)} {r.text.get(language)}" for i, r in enumerate(block.rules, start=1)] + [""]
            elif isinstance(block, Table):
                lines += [block.caption.get(language)]
                lines += ["| " + " | ".join(c.get(language) for c in row) + " |" for row in (block.header, *block.rows)]
                lines += [""]
            elif isinstance(block, Callout):
                lines += [block.title.get(language), block.text.get(language), ""]
            elif isinstance(block, Figure):
                lines += [f"[{figure_caption(family, block, language)}]", ""]
            else:
                raise TypeError(f"Unknown block type: {type(block).__name__}")
    return "\n".join(lines).rstrip() + "\n"


# ---- Entry point ---------------------------------------------------------------------------------------------

def upload_path(family: FamilyV3, language: Language, fmt: str) -> Path:
    return ROOT / "dev" / "uploads" / f"{family.family}-v3-{language}.{fmt}"


def render_family(family: FamilyV3) -> list[Path]:
    written: list[Path] = []
    with tempfile.TemporaryDirectory(prefix=f"v3-{family.family}-") as tmp:
        build = Path(tmp)
        assets = build_assets(family, build)
        for language in LANGUAGES:
            meta = meta_for(family, language)
            pdf, docx, txt = (upload_path(family, language, f) for f in FORMATS)
            write_pdf(family, language, meta, build, pdf)
            write_docx(family, language, meta, assets, docx)
            txt.write_text(txt_document(family, language, meta), encoding="utf-8")
            written += [pdf, docx, txt]
    return written


def main() -> None:
    for family in FAMILIES:
        for path in render_family(family):
            print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
