#!/usr/bin/env python3
"""
호환성확인 SW Excel → JSON 변환

Excel 원본(PROD_SUMMRY HTML)을 파싱하여 templates/compatibility/compatibility-software.json 을 생성한다.
생성된 JSON은 buildIndex.ts(npm run build-index)에서 읽어 SQLite에 임포트한다.

사용법:
  python3 notebooks/convert-compatibility-xlsx-to-json.py          # JSON 생성 + SQLite 임포트
  python3 notebooks/convert-compatibility-xlsx-to-json.py --json   # JSON 생성만

데이터 소스: eGovFrame 포털 (https://www.egovframe.go.kr/home/sub.do?menuNo=73)
"""

import pandas as pd
import sqlite3
import json
import re
import sys
from html import unescape
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
EXCEL_PATH = PROJECT_ROOT / "templates" / "compatibility" / "호환성확인SW-LET_TN_COMPATSW.xlsx"
JSON_PATH = PROJECT_ROOT / "templates" / "compatibility" / "compatibility-software.json"
SQLITE_PATH = PROJECT_ROOT / "knowledge-base" / "egovframe.db"

CATE_CD_MAP = {
    1: "DBMS",
    2: "WAS",
    3: "Portal Solution",
    4: "CMS Solution",
    5: "CRM Solution",
    6: "UX Solution",
    7: "Security Solution",
    8: "Framework Solution",
    9: "Development Tool",
    10: "Mobile Solution",
    11: "ECM Solution",
    12: "EDMS Solution",
    13: "Integrated Solution",
    14: "PMS Solution",
    15: "HR Solution",
    16: "GIS Solution",
    17: "Report Solution",
    18: "기타",
}


def strip_html(text):
    """HTML 태그 및 엔티티를 제거하고 평문 텍스트로 변환"""
    if pd.isna(text):
        return ""
    text = str(text)
    text = unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\\r\\n|\\r|\\n|\r\n|\r|\n", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_summary(html):
    """PROD_SUMMRY HTML <li> 항목에서 key:value 쌍을 추출"""
    if pd.isna(html):
        return {}
    items = re.findall(r"<li>(.*?)</li>", str(html), re.DOTALL)
    result = {}
    for item in items:
        item = unescape(item).strip()
        if ":" in item or "：" in item:
            parts = re.split(r"[:：]", item, 1)
            key = parts[0].strip().replace("\xa0", "").strip()
            val = parts[1].strip().replace("\xa0", "").strip() if len(parts) > 1 else ""
            result[key] = val
    return result


def normalize_level(raw):
    """호환성 레벨 값을 1 또는 2로 정규화"""
    raw = str(raw).strip().replace("`", "")
    if raw in ("1", "레벨1"):
        return 1
    if raw in ("2", "레벨2"):
        return 2
    m = re.match(r"^(\d)", raw)
    if m and m.group(1) in ("1", "2"):
        return int(m.group(1))
    return 2  # 파싱 실패 시 기본값


def normalize_date(raw):
    """다양한 날짜 형식을 ISO 8601(YYYY-MM-DD)로 변환"""
    raw = str(raw).strip().replace(" ", "")
    m = re.match(r"(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return raw


def normalize_fw_version(raw):
    """프레임워크 버전 문자열 정규화 (순수 버전 번호만 추출)"""
    raw = str(raw).strip()
    m = re.match(r"^(\d+\.\d+)", raw)
    if m:
        return m.group(1)
    return raw


def parse_excel_to_records():
    """Excel을 파싱하여 정제된 레코드 리스트를 반환"""
    if not Path(EXCEL_PATH).exists():
        print(f"❌ Excel 파일이 없습니다: {EXCEL_PATH}")
        sys.exit(1)

    df = pd.read_excel(EXCEL_PATH, usecols=range(15))
    df = df[df["USE_YN"] == "Y"].copy()
    print(f"✅ Excel 로드 완료: {len(df)} rows (USE_YN=Y)\n")

    records = []
    skipped = []

    for idx, row in df.iterrows():
        parsed = parse_summary(row["PROD_SUMMRY"])

        product_name = parsed.get("제품명", "").strip()
        product_version = parsed.get("버전", "").strip()
        fw_version = parsed.get(
            "표준프레임워크 버전", parsed.get("프레임워크 버전", "")
        ).strip()
        level_raw = parsed.get("호환성확인 레벨", "2").strip()
        vendor = parsed.get("업체명", "").strip()
        verified_date_raw = parsed.get("호환성확인 일자", "").strip()
        category = CATE_CD_MAP.get(row["CATE_CD"], "기타")

        if not product_name:
            skipped.append((row["COMPAT_SW_ID"], "제품명 없음"))
            continue
        if not fw_version or not re.match(r"\d", fw_version):
            skipped.append((row["COMPAT_SW_ID"], f"프레임워크 버전 불명: {fw_version}"))
            continue

        desc_text = strip_html(row["PROD_DESC"])
        description = desc_text[:500] if desc_text else None

        records.append({
            "product_name": product_name,
            "product_version": product_version or product_name,
            "framework_version": normalize_fw_version(fw_version),
            "category": category,
            "compatibility_level": normalize_level(level_raw),
            "vendor": vendor or "Unknown",
            "verified_date": normalize_date(verified_date_raw) if verified_date_raw else "1970-01-01",
            "description": description,
            "url": f"https://www.egovframe.go.kr/home/compatsw/compatswRead.do?compatSwId={row['COMPAT_SW_ID']}",
        })

    print(f"📊 파싱 결과: {len(records)} 건 변환 / {len(skipped)} 건 스킵")
    if skipped:
        print(f"   스킵 사유 (처음 5건):")
        for sid, reason in skipped[:5]:
            print(f"     ID={sid}: {reason}")

    # 중복 제거 (product_name + product_version + framework_version)
    seen = set()
    unique_records = []
    dup_count = 0
    for r in records:
        key = (r["product_name"], r["product_version"], r["framework_version"])
        if key not in seen:
            seen.add(key)
            unique_records.append(r)
        else:
            dup_count += 1
    if dup_count:
        print(f"   중복 제거: {dup_count} 건")

    return unique_records


def export_json(records):
    """레코드를 JSON 파일로 내보내기 (buildIndex.ts용)"""
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    print(f"\n✅ JSON 내보내기 완료: {JSON_PATH}")
    print(f"   {len(records)} 건")


def import_sqlite(records):
    """레코드를 SQLite에 직접 임포트"""
    if not SQLITE_PATH.exists():
        print(f"❌ DB 파일이 없습니다: {SQLITE_PATH}")
        print("   npm run build-index 를 먼저 실행하세요.")
        sys.exit(1)

    conn = sqlite3.connect(str(SQLITE_PATH))
    existing = conn.execute("SELECT COUNT(*) FROM compatibility_software").fetchone()[0]
    if existing > 0:
        print(f"\n⚠️  기존 데이터 {existing} 건이 있습니다. 삭제 후 재삽입합니다.")
        conn.execute("DELETE FROM compatibility_software")
        conn.execute("DELETE FROM compatibility_fts")
        conn.commit()

    insert_sql = """
        INSERT OR IGNORE INTO compatibility_software
        (product_name, product_version, framework_version, category,
         compatibility_level, vendor, verified_date, description, url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    inserted = 0
    for r in records:
        try:
            conn.execute(insert_sql, (
                r["product_name"], r["product_version"], r["framework_version"],
                r["category"], r["compatibility_level"], r["vendor"],
                r["verified_date"], r["description"], r["url"],
            ))
            inserted += 1
        except sqlite3.IntegrityError:
            pass

    conn.commit()

    final_count = conn.execute("SELECT COUNT(*) FROM compatibility_software").fetchone()[0]
    fts_count = conn.execute("SELECT COUNT(*) FROM compatibility_fts").fetchone()[0]

    print(f"\n{'='*60}")
    print(f"✅ SQLite 임포트 완료!")
    print(f"   삽입: {inserted} 건")
    print(f"   compatibility_software: {final_count} rows")
    print(f"   compatibility_fts: {fts_count} rows")

    print(f"\n📊 카테고리별 분포:")
    df_stats = pd.read_sql("""
        SELECT category, COUNT(*) as cnt
        FROM compatibility_software
        GROUP BY category ORDER BY cnt DESC
    """, conn)
    for _, s in df_stats.iterrows():
        print(f"   {s['category']:35s} {s['cnt']:>4d}")

    conn.close()


def main():
    print(f"📂 Excel: {EXCEL_PATH}")
    json_only = "--json" in sys.argv

    records = parse_excel_to_records()

    # JSON 내보내기 (항상)
    export_json(records)

    # SQLite 직접 임포트 (--json 플래그 없을 때만)
    if not json_only:
        import_sqlite(records)

    print(f"\n🎉 Done!")


if __name__ == "__main__":
    main()
