import json
import os
import time
import numpy as np
from typing import Literal, List
from pydantic import BaseModel, Field
from tqdm import tqdm
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from google import genai
from google.genai import types

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class VerticalBridge(BaseModel):
    pair_id: str
    is_valid_vertical_link: bool = Field(
        description="True ONLY if Source (earlier MBBS phase) provides essential anatomical, physiological, biochemical, or pathological foundation for Target (later MBBS phase)."
    )
    strength: Literal["hard", "soft"] = Field(
        description="'hard' if direct clinical/pathological foundation; 'soft' if supporting context."
    )
    rationale: str = Field(
        description="1-sentence explanation connecting the basic/para-clinical mechanism (Source) to the clinical disease/skill (Target)."
    )


class VerticalBatch(BaseModel):
    evaluations: List[VerticalBridge]


SYSTEM_INSTRUCTION = """You are a senior NMC CBME medical curriculum integrator.
Evaluate candidate VERTICAL INTEGRATION links from earlier MBBS phases (Phase-I / Phase-II) to later clinical phases (Phase-II / Phase-III).
1. Accept (is_valid_vertical_link = true) when basic structure, physiology, biochemistry, pathology, or pharmacology directly underpins the clinical presentation, diagnosis, or management in Target.
2. Reject superficial keyword overlaps that lack true mechanistic or clinical linkage.
3. Keep rationales sharp, medically accurate, and under 22 words."""

ACTIVE_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
]


def call_with_retry(client, prompt):
    last_error = None
    for attempt in range(len(ACTIVE_MODELS) * 2):
        if not ACTIVE_MODELS:
            raise RuntimeError("All Free Tier daily quotas exhausted. Re-run tomorrow to finish remaining batches.")
        model_to_use = ACTIVE_MODELS[attempt % len(ACTIVE_MODELS)]
        try:
            response = client.models.generate_content(
                model=model_to_use,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    response_mime_type="application/json",
                    response_schema=VerticalBatch,
                    temperature=0.1
                ),
            )
            return VerticalBatch.model_validate_json(response.text)
        except Exception as e:
            last_error = e
            err_str = str(e)
            if "limit: 20" in err_str or "PerDay" in err_str or "404" in err_str:
                if model_to_use in ACTIVE_MODELS:
                    ACTIVE_MODELS.remove(model_to_use)
                continue
            if "429" in err_str or "503" in err_str or "UNAVAILABLE" in err_str:
                time.sleep(4)
                continue
            raise e
    raise RuntimeError(f"Batch failed: {last_error}")


def build_vertical_bridges(
    graph_path="src/data/cbme-graph.json",
    checkpoint_path="scripts/checkpoint_vertical.json",
    batch_size=40
):
    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph["nodes"]
    existing_links = graph["links"]
    existing_pairs = {
        f"{l['source']}->{l['target']}" for l in existing_links
    }

    # Build TF-IDF matrix across all nodes
    corpus = [f"{n['title']} {n.get('nmcIntegrationHint', '')}" for n in nodes]
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=2, sublinear_tf=True)
    sim_matrix = cosine_similarity(vectorizer.fit_transform(corpus))

    candidates = []
    pair_lookup = {}

    for i, src in enumerate(nodes):
        # Only look from Phase I -> Phase II/III, or Phase II -> Phase III
        if src["phaseLevel"] >= 4:
            continue

        scores = sim_matrix[i].copy()
        hint = src.get("nmcIntegrationHint", "").lower()

        # Restrict strictly to HIGHER phases (Vertical Integration only)
        for j, tgt in enumerate(nodes):
            if tgt["phaseLevel"] <= src["phaseLevel"]:
                scores[j] = 0
                continue
            # Prefer adjacent phase jumps (Phase I -> II, Phase II -> III) & direct Phase I -> III clinical links
            if hint and tgt["subjectName"].lower() in hint:
                scores[j] += 0.10

        top_indices = np.argsort(-scores)[:5]
        added = 0
        for j in top_indices:
            if added >= 2:  # Top 2 vertical candidates per pre/para-clinical node
                break
            score = float(scores[j])
            if score < 0.20:
                continue

            tgt = nodes[j]
            pair_id = f"{src['id']}->{tgt['id']}"
            if pair_id in existing_pairs or pair_id in pair_lookup:
                continue

            pair_lookup[pair_id] = (src["id"], tgt["id"])
            candidates.append({
                "pair_id": pair_id,
                "source": {
                    "code": src["code"],
                    "subject": src["subjectName"],
                    "phase": src["phase"],
                    "competency": src["title"]
                },
                "target": {
                    "code": tgt["code"],
                    "subject": tgt["subjectName"],
                    "phase": tgt["phase"],
                    "competency": tgt["title"]
                }
            })
            added += 1

    print(f"Identified {len(candidates)} cross-phase vertical integration candidates.")

    completed_map = {}
    if os.path.exists(checkpoint_path):
        with open(checkpoint_path, "r", encoding="utf-8") as f:
            completed_map = json.load(f)

    pending = [c for c in candidates if c["pair_id"] not in completed_map]
    batches = [pending[i : i + batch_size] for i in range(0, len(pending), batch_size)]

    if batches:
        client = genai.Client()
        for batch in tqdm(batches, desc="Verifying Vertical Bridges"):
            prompt = "Evaluate these cross-phase vertical integration candidates:\n\n" + json.dumps(batch, indent=2, ensure_ascii=False)
            try:
                result = call_with_retry(client, prompt)
                for item in result.evaluations:
                    if item.pair_id in pair_lookup:
                        completed_map[item.pair_id] = item.model_dump()
                with open(checkpoint_path, "w", encoding="utf-8") as f:
                    json.dump(completed_map, f, indent=2, ensure_ascii=False)
                time.sleep(0.4)
            except Exception as e:
                print(f"\n[Paused] {e}")
                break

    new_vertical_links = []
    for pair_id, (src_id, tgt_id) in pair_lookup.items():
        eval_data = completed_map.get(pair_id)
        if eval_data and eval_data["is_valid_vertical_link"]:
            new_vertical_links.append({
                "source": src_id,
                "target": tgt_id,
                "strength": eval_data["strength"],
                "type": "vertical-integration",
                "rationale": eval_data["rationale"].strip()
            })

    merged_links = existing_links + new_vertical_links
    with open(graph_path, "w", encoding="utf-8") as f:
        json.dump({"nodes": nodes, "links": merged_links}, f, indent=2, ensure_ascii=False)

    print(f"Done! Added {len(new_vertical_links)} verified vertical bridges. Total graph links: {len(merged_links)}.")


if __name__ == "__main__":
    build_vertical_bridges()