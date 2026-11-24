import json
import os
import time
from typing import Literal, List
from pydantic import BaseModel, Field
from tqdm import tqdm
from google import genai
from google.genai import types

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class VerifiedEdge(BaseModel):
    pair_id: str = Field(
        description="Exact pair_id provided in the input prompt (e.g., 'an22.2->pa27.5')"
    )
    is_valid_pedagogical_link: bool = Field(
        description="True ONLY if Source is a genuine foundational prerequisite or direct co-requisite for Target in MBBS CBME."
    )
    integration_type: Literal[
        "intra-subject",
        "horizontal-integration",
        "vertical-integration",
        "aetcom-link"
    ]
    strength: Literal["hard", "soft"]
    rationale: str = Field(
        description="Concise 1-sentence anatomical, physiological, or clinical justification explaining WHY Source underpins Target."
    )


class EdgeBatchVerification(BaseModel):
    evaluations: List[VerifiedEdge]


SYSTEM_INSTRUCTION = """You are a senior Indian Medical Education (NMC CBME) curriculum architect.
Audit candidate links between two MBBS competencies (Source -> Target).
1. Reject false positives (is_valid_pedagogical_link = false) if they only share superficial words without true conceptual, structural, physiological, or clinical dependency.
2. Respect chronological progression: Phase-I -> Phase-II -> Phase-III-P1 -> Phase-III-P2.
3. Use 'hard' for mandatory prerequisites and 'soft' for parallel horizontal alignment.
4. Keep rationales strictly factual, specific to medical science, and under 22 words."""

ACTIVE_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
]

def call_with_retry(client, prompt):
    """Rotates across separate per-model Free Tier quotas and retires exhausted models."""
    last_error = None
    for attempt in range(len(ACTIVE_MODELS) * 2):
        if not ACTIVE_MODELS:
            raise RuntimeError("All Free Tier model quotas exhausted for today. Progress is saved in checkpoint_edges.json.")

        model_to_use = ACTIVE_MODELS[attempt % len(ACTIVE_MODELS)]
        try:
            response = client.models.generate_content(
                model=model_to_use,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    response_mime_type="application/json",
                    response_schema=EdgeBatchVerification,
                    temperature=0.1
                ),
            )
            return EdgeBatchVerification.model_validate_json(response.text)
        except Exception as e:
            last_error = e
            err_str = str(e)
            # If daily quota (limit: 20) or 404 is hit, remove this model from rotation
            if "limit: 20" in err_str or "PerDay" in err_str or "404" in err_str:
                if model_to_use in ACTIVE_MODELS:
                    ACTIVE_MODELS.remove(model_to_use)
                continue
            # If per-minute rate limit (RPM) or temporary 503 spike, wait briefly and try next model
            if "429" in err_str or "503" in err_str or "UNAVAILABLE" in err_str:
                time.sleep(4)
                continue
            raise e
    raise RuntimeError(f"Batch skipped. Last error: {last_error}")



def verify_cbme_graph(
    input_path: str = "scripts/raw_full_graph.json",
    output_path: str = "src/data/cbme-graph.json",
    checkpoint_path: str = "scripts/checkpoint_edges.json",
    batch_size: int = 40
):
    if not os.environ.get("GEMINI_API_KEY"):
        raise EnvironmentError("GEMINI_API_KEY environment variable is not set.")

    client = genai.Client()

    with open(input_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    raw_links = graph["links"]

    # Load previous progress if resuming
    completed_map = {}
    if os.path.exists(checkpoint_path):
        with open(checkpoint_path, "r", encoding="utf-8") as f:
            completed_map = json.load(f)
        print(f"Resuming from checkpoint: {len(completed_map)} edges already evaluated.")

    link_lookup = {}
    pending_candidates = []

    for link in raw_links:
        src_id = link["source"]["id"] if isinstance(link["source"], dict) else link["source"]
        tgt_id = link["target"]["id"] if isinstance(link["target"], dict) else link["target"]

        src = nodes_by_id.get(src_id)
        tgt = nodes_by_id.get(tgt_id)
        if not src or not tgt:
            continue

        pair_id = f"{src_id}->{tgt_id}"
        link_lookup[pair_id] = (src_id, tgt_id, link)

        if pair_id not in completed_map:
            pending_candidates.append({
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

    batches = [
        pending_candidates[i : i + batch_size]
        for i in range(0, len(pending_candidates), batch_size)
    ]

    print(f"Evaluating {len(pending_candidates)} remaining edges in {len(batches)} batches...")

    for batch in tqdm(batches, desc="Verifying CBME Edges"):
        prompt = (
            "Evaluate each candidate competency link below and return structured evaluations:\n\n"
            + json.dumps(batch, indent=2, ensure_ascii=False)
        )

        try:
            result = call_with_retry(client, prompt)
            for item in result.evaluations:
                if item.pair_id in link_lookup:
                    completed_map[item.pair_id] = item.model_dump()

            # Save checkpoint after every successful batch
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump(completed_map, f, indent=2, ensure_ascii=False)

            time.sleep(0.4)

        except Exception as e:
            print(f"\n[Skipped batch after retries] {e}. Re-run script later to retry skipped items.")

    # Assemble final verified graph from checkpoint
    verified_links = []
    rejected_count = 0

    for pair_id, (src_id, tgt_id, orig_link) in link_lookup.items():
        eval_data = completed_map.get(pair_id)
        if eval_data:
            if not eval_data["is_valid_pedagogical_link"]:
                rejected_count += 1
                continue
            verified_links.append({
                "source": src_id,
                "target": tgt_id,
                "strength": eval_data["strength"],
                "type": eval_data["integration_type"],
                "rationale": eval_data["rationale"].strip()
            })
        else:
            # Keep un-evaluated fallback edge if any batch was skipped
            verified_links.append(orig_link)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"nodes": graph["nodes"], "links": verified_links}, f, indent=2, ensure_ascii=False)

    print(
        f"\nComplete! Saved {len(verified_links)} verified edges (pruned {rejected_count} false positives) to {output_path}."
    )


if __name__ == "__main__":
    verify_cbme_graph()