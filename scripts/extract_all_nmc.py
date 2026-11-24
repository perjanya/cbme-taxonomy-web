import pdfplumber
import re
import json
import glob
import os

SUBJECT_MAP = {
    "AN": ("Anatomy", "Phase-I", 1),
    "PY": ("Physiology", "Phase-I", 1),
    "BI": ("Biochemistry", "Phase-I", 1),
    "PA": ("Pathology", "Phase-II", 2),
    "PH": ("Pharmacology", "Phase-II", 2),
    "MI": ("Microbiology", "Phase-II", 2),
    "FM": ("Forensic Medicine", "Phase-II", 2),
    "CM": ("Community Medicine", "Phase-III-P1", 3),
    "OP": ("Ophthalmology", "Phase-III-P1", 3),
    "EN": ("Otorhinolaryngology (ENT)", "Phase-III-P1", 3),
    "IM": ("General Medicine", "Phase-III-P2", 4),
    "SU": ("General Surgery", "Phase-III-P2", 4),
    "OG": ("Obstetrics & Gynaecology", "Phase-III-P2", 4),
    "PE": ("Pediatrics", "Phase-III-P2", 4),
    "OR": ("Orthopedics", "Phase-III-P2", 4),
    "DE": ("Dermatology", "Phase-III-P2", 4),
    "PS": ("Psychiatry", "Phase-III-P2", 4),
    "RD": ("Radiodiagnosis", "Phase-III-P2", 4),
    "AS": ("Anesthesiology", "Phase-III-P2", 4),
    "AETCOM": ("AETCOM", "Phase-I", 1)
}

CODE_PATTERN = re.compile(r'^([A-Z]{2,6})\s*(\d+\.\d+)$')

def clean_text(text):
    if not text:
        return ""
    return re.sub(r'\s+', ' ', str(text)).strip()

def extract_all_pdfs(pdf_folder="scripts/*.pdf", output_json="scripts/all_extracted_nodes.json"):
    nodes = []
    seen_codes = set()
    pdf_files = sorted(glob.glob(pdf_folder))

    if not pdf_files:
        print("No PDFs found in scripts/. Place UG-Curriculum-Vol-I.pdf, Vol-II.pdf, Vol-III.pdf there.")
        return

    for pdf_path in pdf_files:
        print(f"Parsing {os.path.basename(pdf_path)}...")
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row or len(row) < 5:
                            continue

                        raw_code = clean_text(row[0]).replace(" ", "")
                        match = CODE_PATTERN.match(raw_code)
                        if not match:
                            continue

                        subject_prefix = match.group(1)
                        if subject_prefix not in SUBJECT_MAP or raw_code in seen_codes:
                            continue

                        seen_codes.add(raw_code)
                        subj_name, phase, phase_level = SUBJECT_MAP[subject_prefix]

                        title = clean_text(row[1])
                        if len(title) < 8:  # Skip malformed/empty rows
                            continue

                        domain_raw = clean_text(row[2]).upper()
                        domains = [d for d in ["K", "S", "A", "C"] if d in domain_raw] or ["K"]

                        miller = clean_text(row[3]).upper()
                        if miller not in ["K", "KH", "SH", "P"]:
                            miller = "KH"

                        is_core = clean_text(row[4]).upper().startswith("Y")
                        tlm = [t.strip() for t in clean_text(row[5]).split(",") if t.strip()] if len(row) > 5 else ["LGT"]
                        assessment = [a.strip() for a in clean_text(row[6]).split(",") if a.strip()] if len(row) > 6 else ["Written"]

                        quota_text = clean_text(row[7]) if len(row) > 7 else ""
                        quota_match = re.search(r'\d+', quota_text)
                        certifiable = bool(quota_match)
                        min_quota = int(quota_match.group(0)) if quota_match else None

                        integration_hint = clean_text(row[8]) if len(row) > 8 else ""

                        node = {
                            "id": raw_code.lower(),
                            "code": raw_code,
                            "title": title,
                            "subject": subject_prefix,
                            "subjectName": subj_name,
                            "phase": phase,
                            "phaseLevel": phase_level,
                            "domain": domains,
                            "miller": miller,
                            "isCore": is_core,
                            "certifiable": certifiable,
                            "tlm": tlm,
                            "assessment": assessment,
                            "nmcIntegrationHint": integration_hint
                        }
                        if certifiable:
                            node["minQuota"] = min_quota

                        nodes.append(node)

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(nodes, f, indent=2, ensure_ascii=False)
    print(f"Total extracted competencies across all volumes: {len(nodes)}")

if __name__ == "__main__":
    extract_all_pdfs()