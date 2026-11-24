import json
import numpy as np
from sentence_transformers import SentenceTransformer, util

# Load free local biomedical/general sentence embedder
model = SentenceTransformer('BAAI/bge-base-en-v1.5')

with open("extracted_nodes.json", "r", encoding="utf-8") as f:
    nodes = json.load(f)

texts = [f"{n['subjectName']} ({n['code']}): {n['title']}" for n in nodes]
embeddings = model.encode(texts, convert_to_tensor=True, normalize_embeddings=True)

# Compute pairwise cosine similarity matrix
cosine_scores = util.cos_sim(embeddings, embeddings).cpu().numpy()

links = []
for i, src in enumerate(nodes):
    # Find top semantic neighbors
    top_indices = np.argsort(-cosine_scores[i])[1:8]
    for j in top_indices:
        score = float(cosine_scores[i][j])
        if score < 0.76:
            continue
        tgt = nodes[j]

        # Enforce DAG chronological phase rule (no backward edges in time)
        if src["phaseLevel"] > tgt["phaseLevel"]:
            continue

        # Avoid duplicate bidirectional horizontal edges
        if src["phaseLevel"] == tgt["phaseLevel"] and src["id"] > tgt["id"]:
            continue

        is_same_subject = src["subject"] == tgt["subject"]
        is_same_phase = src["phaseLevel"] == tgt["phaseLevel"]

        if is_same_subject:
            link_type = "intra-subject"
            strength = "hard"
        elif is_same_phase:
            link_type = "horizontal-integration"
            strength = "soft"
        else:
            link_type = "vertical-integration"
            strength = "hard"

        links.append({
            "source": src["id"],
            "target": tgt["id"],
            "strength": strength,
            "type": link_type,
            "similarity": round(score, 3),
            "rationale": f"Semantic & curricular alignment ({round(score*100)}%) between {src['code']} and {tgt['code']}."
        })

graph = {"nodes": nodes, "links": links}
with open("src/data/cbme-graph.json", "w", encoding="utf-8") as f:
    json.dump(graph, f, indent=2, ensure_ascii=False)

print(f"Generated graph with {len(nodes)} nodes and {len(links)} taxonomic edges.")