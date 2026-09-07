# Local model evaluation

This is a bounded preflight evaluation, not model certification. The test set has four source-grounded JSON questions covering source IDs, a hard duration/privacy constraint, schema validity, and support grounding. A deterministic baseline answers all four with valid grounding. The target context limit is 8,192 tokens.

The installed Ollama fallback store contains Gemma4 E2B and E4B MLX manifests. The default endpoint was confirmed idle, then the corrected four-question smoke completed sequentially for each candidate through `/api/show` and `/api/generate` (eight calls total). Both models reported their own identities. E2B passed source, constraint, and support checks; its schema answer used invalid numeric source IDs. E4B showed the same schema grounding defect. Median observed per-call latency was 1.86s for E2B and 3.92s for E4B. This is a preflight smoke, not held-out certification.

Run the bounded check with:

```text
python3 scripts/evaluate_local_models.py --run > docs/evidence/local-models.json
```

The output records manifest presence, endpoint probe, deterministic baseline, per-question latency/model identity when available, and JSON/grounding validation results.

Evaluation limitation: the schema question does not explicitly provide the complete allowed source-ID universe, although its validator enforces one. Those two failures must not be used to rank model quality without repairing the evaluation contract. No stronger fallback is justified or selected by this smoke.
