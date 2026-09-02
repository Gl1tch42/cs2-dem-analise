"""Validate the analytics engine against a corpus of hand-annotated "golden"
demos.

Usage:
    python python/golden_demos/validate.py [--demo-dir PATH] [--corpus-dir DIR] [--json-report OUT]

See README.md in this directory for the annotation format and workflow.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

# python/ (parent of this file's directory) holds parse_demo.py.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import parse_demo  # noqa: E402

from comparators import AccuracyResult, compare_demo, merge_results, summarize_feature_versions  # noqa: E402
from schema import validate_annotation  # noqa: E402

DEFAULT_CORPUS_DIR = Path(__file__).resolve().parent / "annotations"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _run_parser(demo_path: Path) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        output_path = Path(tmp) / "summary.json"
        old_argv = sys.argv
        sys.argv = ["parse_demo.py", "--input", str(demo_path), "--output", str(output_path)]
        try:
            parse_demo.main()
        finally:
            sys.argv = old_argv
        return json.loads(output_path.read_text(encoding="utf-8"))


def _resolve_demo_dir(cli_value: str | None) -> Path:
    demo_dir = cli_value or os.environ.get("CSDA_GOLDEN_DEMOS_DIR")
    if not demo_dir:
        raise SystemExit(
            "Nenhum diretório de demos configurado. Passe --demo-dir ou defina "
            "CSDA_GOLDEN_DEMOS_DIR apontando para a pasta local com seus .dem "
            "(veja README.md)."
        )
    path = Path(demo_dir)
    if not path.is_dir():
        raise SystemExit(f"Diretório de demos não existe: {path}")
    return path


def _print_report(merged: dict, version_summary: dict) -> None:
    print("\n=== Relatório de validação ===")
    versions = version_summary.get("versions") or []
    if len(versions) == 1:
        print(f"featureModelVersion: {versions[0]}")
    elif len(versions) > 1:
        print(
            f"AVISO: demos parseadas com versões diferentes do motor analítico ({', '.join(versions)}) — "
            "accuracy/MAE agregados abaixo misturam resultados não diretamente comparáveis."
        )
    opening = merged.get("openingDuel")
    if opening is not None:
        acc = opening.accuracy
        acc_str = f"{acc:.1%}" if acc is not None else "n/a"
        print(f"{'openingDuel':28s} accuracy={acc_str:>8s}  n={opening.total}")
    for metric, result in merged.items():
        if metric == "openingDuel":
            continue
        mae = result.mae
        mae_str = f"{mae:.2f}" if mae is not None else "n/a"
        print(f"{metric:28s} MAE={mae_str:>10s}  n={result.n}")


def _write_json_report(merged: dict, version_summary: dict, path: Path) -> None:
    payload: dict = {"featureModelVersions": version_summary.get("versions") or []}
    for metric, result in merged.items():
        if isinstance(result, AccuracyResult):
            payload[metric] = {"accuracy": result.accuracy, "n": result.total, "mismatches": result.mismatches}
        else:
            payload[metric] = {"mae": result.mae, "n": result.n}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[golden_demos] relatório salvo em {path}")


def main() -> int:
    arg_parser = argparse.ArgumentParser(description=__doc__)
    arg_parser.add_argument("--demo-dir", default=None, help="Pasta com os .dem (ou defina CSDA_GOLDEN_DEMOS_DIR)")
    arg_parser.add_argument("--corpus-dir", default=str(DEFAULT_CORPUS_DIR), help="Pasta com as anotações JSON")
    arg_parser.add_argument("--json-report", default=None, help="Caminho opcional para salvar o relatório em JSON")
    args = arg_parser.parse_args()

    corpus_dir = Path(args.corpus_dir)
    annotation_files = sorted(corpus_dir.glob("*.json"))
    if not annotation_files:
        print(f"[golden_demos] Nenhuma anotação encontrada em {corpus_dir}. Nada para validar.")
        return 0

    demo_dir = _resolve_demo_dir(args.demo_dir)

    per_demo_results = []
    parsed_summaries = []
    for annotation_path in annotation_files:
        annotation = json.loads(annotation_path.read_text(encoding="utf-8"))
        errors = validate_annotation(annotation)
        if errors:
            print(f"[golden_demos] {annotation_path.name} inválido, pulando:")
            for err in errors:
                print(f"    - {err}")
            continue

        demo_path = demo_dir / annotation["demoFileName"]
        if not demo_path.is_file():
            print(f"[golden_demos] aviso: demo não encontrada para {annotation_path.name}: {demo_path} (pulando)")
            continue

        expected_hash = annotation.get("demoSha256")
        if expected_hash and _sha256(demo_path) != expected_hash:
            print(
                f"[golden_demos] aviso: hash divergente para {demo_path.name} "
                "(a anotação pode se referir a outra versão do arquivo) — pulando"
            )
            continue

        try:
            summary = _run_parser(demo_path)
        except Exception as exc:
            print(f"[golden_demos] erro ao parsear {demo_path.name}: {exc} — pulando")
            continue

        per_demo_results.append(compare_demo(annotation, summary))
        parsed_summaries.append(summary)
        print(f"[golden_demos] processado: {annotation_path.name}")

    if not per_demo_results:
        print("[golden_demos] Nenhuma demo pôde ser validada (ver avisos acima).")
        return 0

    merged = merge_results(per_demo_results)
    version_summary = summarize_feature_versions(parsed_summaries)
    _print_report(merged, version_summary)

    if args.json_report:
        _write_json_report(merged, version_summary, Path(args.json_report))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
