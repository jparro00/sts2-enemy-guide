"""A translation engine for tools/l10n: the Claude API, through the official anthropic package.

An engine is any command that takes a work file and writes answers (see tools/l10n/translate.mjs):

    python tools/l10n/engines/claude.py <work.json> <answers.json> [--model=claude-opus-5-5] [--effort=high] [--batch=60]

The work file says its step (pending.mjs: "translation"; review.mjs blind: "back-translation"; review.mjs pairs:
"judge"), the brief for it and the items. Each batch of items goes in one request with the brief as the system
prompt, and the answer comes back as JSON in a fixed shape (structured outputs). The answers file:
{"engine": "claude-api", "model": ..., "answers": {"<n>": answer}}, which tools/l10n/fill.mjs writes into the work
file. A back-translation request carries only what the blind file has (no English): the passes stay independent.

Credentials: ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile). Refusals fall back
server-side to the model the API picks (fallbacks "default"); a batch still refused is an error.
"""
import json
import sys

import anthropic

FALLBACK_BETA = "server-side-fallback-2026-07-01"


def option(name, default):
    prefix = f"--{name}="
    return next((a[len(prefix):] for a in sys.argv[1:] if a.startswith(prefix)), default)


def answer_schema(step):
    if step == "judge":
        item = {
            "type": "object",
            "properties": {"n": {"type": "integer"}, "verdict": {"type": "string", "enum": ["ok", "drift"]}, "note": {"type": "string"}},
            "required": ["n", "verdict", "note"],
            "additionalProperties": False,
        }
    else:
        item = {
            "type": "object",
            "properties": {"n": {"type": "integer"}, "text": {"type": "string"}},
            "required": ["n", "text"],
            "additionalProperties": False,
        }
    return {
        "type": "object",
        "properties": {"answers": {"type": "array", "items": item}},
        "required": ["answers"],
        "additionalProperties": False,
    }


# What each step's items carry to the model (never more than the work file gives it)
def payload(step, item):
    drop = {"translation"} if step == "translation" else {"back"} if step == "back-translation" else {"verdict", "note"}
    return {k: v for k, v in item.items() if k not in drop and k != "id"}


TASK = {
    "translation": 'Translate every item\'s "english" into the language. Answer each item by its "n" with "text": the translation.',
    "back-translation": 'Write for every item what its "translation" says, in English. Answer each item by its "n" with "text".',
    "judge": 'Judge every item. Answer each by its "n" with "verdict" ("ok" or "drift") and "note" (empty when ok).',
}


def run_batch(client, model, effort, work, items):
    step = work["step"]
    system = f"Language: {work.get('language', work.get('lang'))}\n\n" + "\n".join(f"- {line}" for line in work["brief"])
    user = TASK[step] + "\n\nItems (JSON):\n" + json.dumps([payload(step, i) for i in items], ensure_ascii=False, indent=1)
    response = client.beta.messages.create(
        model=model,
        max_tokens=32000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": answer_schema(step)}},
        betas=[FALLBACK_BETA],
        extra_body={"fallbacks": "default"},
    )
    if response.stop_reason == "refusal":
        raise RuntimeError(f"refused ({getattr(response.stop_details, 'category', None)}) for items {items[0]['n']}-{items[-1]['n']}")
    if response.stop_reason == "max_tokens":
        raise RuntimeError(f"ran out of tokens for items {items[0]['n']}-{items[-1]['n']}: use a smaller --batch")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)["answers"], response.model


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    work_file, answers_file = args
    model, effort, batch = option("model", "claude-opus-5-5"), option("effort", "high"), int(option("batch", "60"))
    with open(work_file, encoding="utf-8") as f:
        work = json.load(f)
    client = anthropic.Anthropic()
    answers, served_by = {}, set()
    items = work["items"]
    for start in range(0, len(items), batch):
        chunk = items[start:start + batch]
        for attempt in range(2):
            got, served = run_batch(client, model, effort, work, chunk)
            served_by.add(served)
            for a in got:
                answers[str(a["n"])] = {"verdict": a["verdict"], "note": a["note"]} if work["step"] == "judge" else a["text"]
            chunk = [i for i in chunk if str(i["n"]) not in answers]
            if not chunk:
                break
        if chunk:
            raise RuntimeError(f"no answer for items {[i['n'] for i in chunk]}")
        print(f"claude.py: {min(start + batch, len(items))}/{len(items)}", file=sys.stderr)
    with open(answers_file, "w", encoding="utf-8") as f:
        json.dump({"engine": "claude-api", "model": "+".join(sorted(served_by)), "answers": answers}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
