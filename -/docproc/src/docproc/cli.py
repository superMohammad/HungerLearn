"""`docproc` command-line interface (Typer)."""
from __future__ import annotations

import json
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Optional

import typer

from docproc.config import Settings, get_settings

app = typer.Typer(add_completion=False, help="Bilingual policy understanding and version comparison.")

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def _utf8_stdout() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")  # PowerShell defaults to a legacy code page
        except Exception:
            pass


def _app(settings: Settings | None = None, ocr_json: str | None = None):
    from docproc.ocr import make_ocr
    from docproc.pipeline import App

    s = settings or get_settings()
    return App(s, ocr=make_ocr(s, ocr_json))


def _print_report(report, out: Path | None) -> None:
    data = report.model_dump(mode="json")
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        typer.echo(f"report written to {out}")
    typer.echo(f"{report.document_id}: {report.old_version_id} -> {report.new_version_id}  complete={report.complete}")
    for k, v in report.summary.items():
        typer.echo(f"  {k:<13}{v}")
    for c in report.clauses:
        side = c.new or c.old
        quote = side.quote.replace("\n", " ")[:70] if side else ""
        extra = "; ".join(c.change_reasons) or (c.review_reason or "")
        typer.echo(f"  [{c.status.value:<12}] {str(c.stable_id)[:8]:<8}  {quote}  {('(' + extra + ')') if extra else ''}")
    for r in report.incomplete_reasons:
        typer.echo(f"  INCOMPLETE: {r}")


@app.command("init-db")
def init_db() -> None:
    """Create tables in the configured backend (SQLite file or PostgreSQL+pgvector)."""
    from docproc.storage import make_repository

    s = get_settings()
    make_repository(s, init=True).close()
    typer.echo(f"schema ready ({s.backend}: {s.sqlite_path if s.backend == 'sqlite' else s.pg_dsn})")


@app.command()
def ingest(
    file: Path,
    doc: str = typer.Option(..., "--doc", help="Document ID; reuse it for every version of the same policy"),
    version: str = typer.Option(..., "--version", help="Version ID (re-running the same one is safe)"),
    ocr_json: Optional[str] = typer.Option(None, help="OCR results JSON to import for scanned pages"),
) -> None:
    """Workflow 1: extract, validate and store clauses for one document version."""
    _utf8_stdout()
    state = _app(ocr_json=ocr_json).ingest(file, doc, version)
    typer.echo(f"{len(state['records'])} clauses stored for {doc}@{version}; failed pages: {state.get('failed_pages') or 'none'}")
    for i in state.get("issues", []):
        typer.echo(f"  issue[{i.kind}] page={i.page} {i.detail}")


@app.command()
def compare(
    doc: str = typer.Option(..., "--doc"),
    version: str = typer.Option(..., "--version"),
    links: Optional[Path] = typer.Option(None, help="JSON mapping stable IDs to lesson/badge IDs"),
    out: Optional[Path] = typer.Option(None, help="Write the JSON report here"),
) -> None:
    """Workflow 2: compare a stored version with the previous version of the same document."""
    _utf8_stdout()
    _print_report(_app().compare(doc, version, links), out)


@app.command()
def process(
    file: Path,
    doc: str = typer.Option(..., "--doc"),
    version: str = typer.Option(..., "--version"),
    ocr_json: Optional[str] = typer.Option(None),
    links: Optional[Path] = typer.Option(None),
    out: Optional[Path] = typer.Option(None),
) -> None:
    """Ingest + compare in one go."""
    _utf8_stdout()
    a = _app(ocr_json=ocr_json)
    a.ingest(file, doc, version)
    _print_report(a.compare(doc, version, links), out)


@app.command()
def report(doc: str = typer.Option(..., "--doc"), version: str = typer.Option(..., "--version"),
           out: Optional[Path] = typer.Option(None)) -> None:
    """Print (or save) a stored comparison report."""
    _utf8_stdout()
    from docproc.storage import make_repository

    r = make_repository(get_settings()).get_report(doc, version)
    if r is None:
        raise typer.BadParameter(f"no report for {doc}@{version}")
    _print_report(r, out)


@app.command("export-ocr-pages")
def export_ocr_pages(
    file: Path,
    doc: str = typer.Option(..., "--doc"),
    version: str = typer.Option(..., "--version"),
    out: Path = typer.Option(Path("out/ocr_pages.zip")),
    all_pages: bool = typer.Option(False, "--all", help="Export every page, not only pages lacking text"),
    dpi: int = typer.Option(200),
) -> None:
    """Render pages that need OCR to PNG + manifest.json, zipped for the Colab OvisOCR3 runner."""
    from docproc.loaders import detect_format
    from docproc.loaders.pdf import probe_pdf, render_page_png

    s = get_settings()
    tmp = out.parent / (out.stem + "_tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    pages = []
    if detect_format(file) == "image":
        shutil.copy(file, tmp / file.name)
        pages.append({"page": 1, "file": file.name, "key": file.name})
    else:
        for p in probe_pdf(file, s.min_page_chars, s.min_letter_ratio):
            if p.needs_ocr or all_pages:
                name = f"page_{p.page:04d}.png"
                render_page_png(file, p.page, tmp / name, dpi=dpi)
                pages.append({"page": p.page, "file": name, "key": str(p.page)})
    manifest = {"document_id": doc, "version_id": version, "source_file": file.name, "pages": pages}
    (tmp / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in tmp.iterdir():
            z.write(f, f.name)
    shutil.rmtree(tmp, ignore_errors=True)
    typer.echo(f"{len(pages)} page(s) exported to {out}. Upload it to colab/ovis_ocr_runner.ipynb, then run:")
    typer.echo(f"  docproc ingest {file} --doc {doc} --version {version} --ocr-json <downloaded ocr_{version}.json>")


@app.command()
def history(stable_id: str) -> None:
    """Show every stored version of one stable clause."""
    _utf8_stdout()
    from docproc.storage import make_repository

    for r in make_repository(get_settings()).clause_history(stable_id):
        typer.echo(f"{r.version_id:<10} {r.location.page or '-':<3} {r.quote[:90]}")


@app.command("export-schema")
def export_schema(out: Path = typer.Option(Path("docs/report.schema.json"))) -> None:
    """Write the JSON Schema of the comparison report (the team contract)."""
    from docproc.models import ComparisonReport

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(ComparisonReport.model_json_schema(), ensure_ascii=False, indent=2), encoding="utf-8")
    typer.echo(f"schema written to {out}")


@app.command()
def demo(
    fmt: str = typer.Option("docx", "--format", help="docx | pdf | scanned (scanned page 2 via OCR JSON)"),
    real: bool = typer.Option(False, help="Use the configured LLM/embeddings instead of fixtures"),
    out_dir: Path = typer.Option(Path("out")),
) -> None:
    """Run v1 -> v2 on the bundled bilingual fixtures and write out/report_v2.json."""
    _utf8_stdout()
    from docproc.ocr import JsonImportOCR

    base = get_settings()
    db = out_dir / f"demo_{fmt}.sqlite3"
    db.unlink(missing_ok=True)
    over = {"backend": "sqlite", "sqlite_path": str(db)}
    if not real:
        over.update(llm="fixture", embeddings="fixture")
    s = base.model_copy(update=over)
    a = _app(s)
    v1 = FIXTURES / ("policy_v1.docx" if fmt == "docx" else "policy_v1.pdf")
    v2 = FIXTURES / {"docx": "policy_v2.docx", "pdf": "policy_v2.pdf", "scanned": "policy_v2_scanned.pdf"}[fmt]
    ocr = JsonImportOCR(FIXTURES / "ocr_v2_scanned.json") if fmt == "scanned" else None
    v2_id = "v2-scan" if fmt == "scanned" else "v2"
    doc = f"policy-leave-expense-{fmt}"
    a.ingest(v1, doc, "v1", work_dir=out_dir / "pages")
    a.compare(doc, "v1")
    a.ingest(v2, doc, v2_id, ocr=ocr, work_dir=out_dir / "pages")
    rep = a.compare(doc, v2_id, FIXTURES / "links.json")
    typer.echo(f"LLM={s.llm} embeddings={a.embedder.model_id} backend=sqlite ({db})")
    _print_report(rep, out_dir / f"report_{v2_id}.json")


if __name__ == "__main__":
    app()
