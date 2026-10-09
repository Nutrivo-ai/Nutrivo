# Prompts

One file per prompt, named `<purpose>.v<N>.md`, with a header block (purpose, model class, output schema, owner).
A prompt is never edited in place once used in production: copy to v<N+1>. `app.model_calls.prompt_version`
records which file produced each output. Evaluation sets live in `worker/evals/`. See docs/07-ai.md.
