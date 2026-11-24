import json
import re
from collections import defaultdict

# Granular anatomical-to-clinical bridge concepts (Phase I structure/function -> Phase II/III clinical)
BRIDGE_CONCEPTS = [
    ("Coronary & Myocardial Circulation", r"coronary|myocardi|angina|infarct|stemi|ischemi|ecg|cardiac cycle|heart sound|murmur|valve|valvular|endocardi|pericardi"),
    ("Hemodynamics & Blood Pressure Regulation", r"blood pressure|hypertension|shock|cardiac output|renin|angiotensin|aldosterone|baroreceptor|vascular|aorta|aneurysm|varicose|thrombosis|embolism"),
    ("Pulmonary Ventilation, Pleura & Gas Exchange", r"lung|pulmonary|pleura|pneumothorax|effusion|bronch|asthma|copd|respirat|ventilation|surfactant|hypoxia|cyanosis|tuberculosis|pneumonia|mediastin"),
    ("Cranial Nerves & Brainstem Pathways", r"cranial nerve|brainstem|medulla|pons|midbrain|oculomotor|trigeminal|facial nerve|vagus|hypoglossal|optic|diplopia|dysphagia|bell.?s palsy"),
    ("Cerebral Cortex, Stroke & Motor/Sensory Tracts", r"cerebr|cortex|internal capsule|pyramidal|corticospinal|stroke|hemiplegia|aphasia|basal ganglia|parkinson|cerebell|ataxia|mening|csf|hydrocephalus"),
    ("Spinal Cord & Peripheral Nerve Plexuses", r"spinal cord|brachial plexus|radial nerve|ulnar nerve|median nerve|sciatic|femoral nerve|wrist drop|claw hand|foot drop|erb|klumpke|dermatome|reflex"),
    ("Ocular & Auditory-Vestibular Apparatus", r"eye|orbit|retina|cornea|lens|aqueous|glaucoma|cataract|refraction|ear|tympanic|ossicle|cochlea|vestibular|hearing|deafness|vertigo|larynx|vocal|sinus|tonsil"),
    ("Hepatobiliary, Portal System & Jaundice", r"liver|hepat|portal|biliary|gallbladder|bilirubin|jaundice|cirrhosis|ascites|pancrea|amylase|lipase|choledoch"),
    ("Gastrointestinal Tract, Peritoneum & Hernias", r"stomach|gastric|peptic|duoden|intestin|ileum|colon|appendix|appendicitis|rectum|anal|peritone|inguinal|femoral canal|hernia|esophag|dysphagia"),
    ("Upper & Lower Limb Osteology & Joints", r"humerus|radius|ulna|scaphoid|clavicle|scapula|shoulder|elbow|wrist|femur|tibia|fibula|hip|knee|ankle|fracture|dislocation|meniscus|cruciate|arthritis"),
    ("Vertebral Column & Pelvis", r"vertebra|intervertebral|disc|sciatica|scoliosis|pelvis|sacrum|pelvic floor|perineum|ischioanal"),
    ("Nephron Function, Electrolytes & Acid-Base", r"kidney|renal|nephron|glomerul|tubular|gfr|nephrotic|nephritic|ureter|bladder|urethra|urine|acid-base|metabolic acidosis|potassium|sodium|hyperkalemia"),
    ("Hypothalamic-Pituitary, Thyroid & Adrenal Axis", r"thyroid|thyroxine|goiter|hyperthyroidism|hypothyroidism|parathyroid|calcium|pituitary|acromegaly|adrenal|cortisol|cushing|addison"),
    ("Glucose Metabolism & Diabetes Mellitus", r"insulin|glucagon|glucose|glycolysis|ketone|ketoacidosis|diabetes|glycated|hba1c"),
    ("Reproductive Tract, Embryology & Pregnancy", r"ovary|uterus|cervix|endometri|placenta|fetus|embryo|neural tube|congenital|malformation|teratogen|menstrual|pregnancy|preeclampsia|testis|scrotum|prostate"),
    ("Hematopoiesis, Coagulation & Immunology", r"hemoglobin|anemia|iron|vitamin b12|folate|erythropoie|platelet|coagulation|clotting|hemophilia|bleeding|immun|hypersensitivity|autoimmune|lymph|spleen")
]

STOPWORDS = {
    "describe", "explain", "discuss", "demonstrate", "enumerate", "identify", "classify",
    "outline", "state", "define", "list", "mention", "perform", "interpret", "clinical",
    "features", "management", "diagnosis", "treatment", "causes", "types", "anatomy",
    "physiology", "biochemistry", "pathology", "pharmacology", "medicine", "surgery",
    "patient", "patients", "disease", "disorder", "syndrome", "acute", "chronic", "normal",
    "abnormal", "structure", "function", "functions", "mechanism", "basis", "applied",
    "importance", "significance", "role", "changes", "effects", "principles", "factors"
}


def extract_concepts_and_terms(text: str):
    matched_concepts = []
    for label, pattern in BRIDGE_CONCEPTS:
        if re.search(pattern, text, re.IGNORECASE):
            matched_concepts.append(label)
    words = {
        w for w in re.findall(r"[a-z]{4,}", text.lower())
        if w not in STOPWORDS
    }
    return matched_concepts, words


def build_offline_vertical_bridges(graph_path="src/data/cbme-graph.json"):
    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph["nodes"]
    existing_links = graph["links"]
    existing_pairs = {f"{l['source']}->{l['target']}" for l in existing_links}

    node_meta = {}
    for n in nodes:
        full_text = f"{n['title']} {n.get('nmcIntegrationHint', '')}"
        concepts, words = extract_concepts_and_terms(full_text)
        node_meta[n["id"]] = {
            "concepts": set(concepts),
            "words": words,
            "hint": n.get("nmcIntegrationHint", "").lower()
        }

    phase1_nodes = [n for n in nodes if n["phaseLevel"] == 1]
    phase2_nodes = [n for n in nodes if n["phaseLevel"] == 2]
    phase3_nodes = [n for n in nodes if n["phaseLevel"] >= 3]

    new_links = []

    def link_layer(sources, targets, max_per_target=2):
        added = 0
        for tgt in targets:
            t_meta = node_meta[tgt["id"]]
            if not t_meta["concepts"]:
                continue

            scored = []
            for src in sources:
                if src["phaseLevel"] >= tgt["phaseLevel"]:
                    continue
                pair_key = f"{src['id']}->{tgt['id']}"
                if pair_key in existing_pairs:
                    continue

                s_meta = node_meta[src["id"]]
                shared_concepts = t_meta["concepts"] & s_meta["concepts"]
                if not shared_concepts:
                    continue

                shared_words = t_meta["words"] & s_meta["words"]
                hint_bonus = 2 if (tgt["subjectName"].lower() in s_meta["hint"] or src["subjectName"].lower() in t_meta["hint"]) else 0
                score = (len(shared_concepts) * 4) + (len(shared_words) * 2) + hint_bonus

                # Require either direct term overlap OR NMC integration column match
                if len(shared_words) >= 1 or hint_bonus > 0:
                    scored.append((score, src, list(shared_concepts)[0], sorted(shared_words)[:3]))

            scored.sort(key=lambda x: -x[0])
            for score, src, concept_label, key_terms in scored[:max_per_target]:
                pair_key = f"{src['id']}->{tgt['id']}"
                existing_pairs.add(pair_key)
                terms_str = f" ({', '.join(key_terms)})" if key_terms else ""
                new_links.append({
                    "source": src["id"],
                    "target": tgt["id"],
                    "strength": "hard" if score >= 6 else "soft",
                    "type": "vertical-integration",
                    "rationale": f"{concept_label}{terms_str}: {src['subjectName']} ({src['code']}) underpins {tgt['subjectName']} ({tgt['code']})."
                })
                added += 1
        return added

    # 1. Connect Phase I (AN, PY, BI) -> Phase II (PA, PH, MI, FM)
    p1_to_p2 = link_layer(phase1_nodes, phase2_nodes, max_per_target=2)
    # 2. Connect Phase I (AN, PY, BI) -> Phase III (IM, SU, OG, PE, OR, OP, EN, CM)
    p1_to_p3 = link_layer(phase1_nodes, phase3_nodes, max_per_target=2)
    # 3. Connect Phase II (PA, PH, MI) -> Phase III clinical subjects
    p2_to_p3 = link_layer(phase2_nodes, phase3_nodes, max_per_target=1)

    all_links = existing_links + new_links
    with open(graph_path, "w", encoding="utf-8") as f:
        json.dump({"nodes": nodes, "links": all_links}, f, indent=2, ensure_ascii=False)

    print(
        f"Done in <2 seconds!\n"
        f"  Phase I -> Phase II links added:  {p1_to_p2}\n"
        f"  Phase I -> Phase III links added: {p1_to_p3}\n"
        f"  Phase II -> Phase III links added: {p2_to_p3}\n"
        f"  Total graph links now: {len(all_links)}"
    )


if __name__ == "__main__":
    build_offline_vertical_bridges()