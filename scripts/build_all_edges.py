import json
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

with open("scripts/all_extracted_nodes.json", "r", encoding="utf-8") as f:
    nodes = json.load(f)

# Combine title + integration hints for rich keyword matching
corpus = [
    f"{n['title']} {n.get('nmcIntegrationHint', '')}" for n in nodes
]

# Lightweight TF-IDF vectorizer (no model downloads, runs in <1 second)
vectorizer = TfidfVectorizer(
    stop_words="english",
    ngram_range=(1, 2),
    min_df=2,
    max_df=0.85,
    sublinear_tf=True
)
tfidf_matrix = vectorizer.fit_transform(corpus)
similarity_matrix = cosine_similarity(tfidf_matrix)

links = []
for i, src in enumerate(nodes):
    scores = similarity_matrix[i].copy()
    scores[i] = 0  # Exclude self-link

    # Boost score slightly if target subject is explicitly mentioned in NMC's Integration column
    hint = src.get("nmcIntegrationHint", "").lower()
    if hint:
        for j, tgt in enumerate(nodes):
            if i != j and tgt["subjectName"].lower() in hint:
                scores[j] += 0.08

    top_indices = np.argsort(-scores)[:10]
    added_for_node = 0

    for j in top_indices:
        if added_for_node >= 3:
            break
        score = float(scores[j])
        if score < 0.24:  # Optimal TF-IDF threshold for medical term overlap
            continue

        tgt = nodes[j]

        # Enforce chronological phase order (Phase I -> II -> III-P1 -> III-P2)
        if src["phaseLevel"] > tgt["phaseLevel"]:
            continue
        if src["phaseLevel"] == tgt["phaseLevel"] and src["id"] > tgt["id"]:
            continue

        is_same_subject = src["subject"] == tgt["subject"]
        is_same_phase = src["phaseLevel"] == tgt["phaseLevel"]

        if is_same_subject:
            link_type, strength = "intra-subject", "hard"
        elif is_same_phase:
            link_type, strength = "horizontal-integration", "soft"
        else:
            link_type, strength = "vertical-integration", "hard"

        links.append({
            "source": src["id"],
            "target": tgt["id"],
            "strength": strength,
            "type": link_type,
            "rationale": f"Shared clinical/anatomical terminology ({round(min(score, 1.0)*100)}%) between {src['code']} and {tgt['code']}."
        })
        added_for_node += 1

with open("scripts/raw_full_graph.json", "w", encoding="utf-8") as f:
    json.dump({"nodes": nodes, "links": links}, f, indent=2, ensure_ascii=False)

print(f"Built raw graph in seconds: {len(nodes)} nodes, {len(links)} candidate links.")