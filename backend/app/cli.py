"""로컬 운영용 커맨드.

    python -m app.cli init-db
    python -m app.cli import-categories data/categories_sample.json
    python -m app.cli show-tree
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.core.logging import configure_logging, get_logger
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.services import category_service

logger = get_logger(__name__)


def cmd_init_db(_: argparse.Namespace) -> int:
    init_db()
    print("DB 초기화 완료")
    return 0


def cmd_import_categories(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if not path.exists():
        print(f"파일을 찾을 수 없습니다: {path}", file=sys.stderr)
        return 1
    init_db()
    raw = path.read_bytes()
    try:
        rows = category_service.parse_rows(raw, path.name)
    except Exception as exc:
        print(f"파싱 실패: {exc}", file=sys.stderr)
        return 1
    with SessionLocal() as db:
        result = category_service.import_categories(db, rows)
        db.commit()
    print(
        f"import 완료: 총 {result.received}건 / 생성 {result.created} / "
        f"갱신 {result.updated} / 건너뜀 {result.skipped}"
    )
    for err in result.errors[:20]:
        print(f"  - {err}")
    return 0


def cmd_show_tree(_: argparse.Namespace) -> int:
    with SessionLocal() as db:
        tree = category_service.build_tree(db)

    def walk(nodes, indent=0):
        for node in nodes:
            leaf = " (최하위)" if node.is_leaf else ""
            print(f"{'  ' * indent}- [{node.depth}] {node.category_name} <{node.category_code}>{leaf}")
            walk(node.children, indent + 1)

    walk(tree)
    return 0


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="테이블 생성 및 기본 설정 시드").set_defaults(func=cmd_init_db)

    p_import = sub.add_parser("import-categories", help="JSON/CSV 카테고리 import")
    p_import.add_argument("path")
    p_import.set_defaults(func=cmd_import_categories)

    sub.add_parser("show-tree", help="카테고리 트리 출력").set_defaults(func=cmd_show_tree)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
