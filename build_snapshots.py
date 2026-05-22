"""
build_snapshots.py — generate per-entity static HTML pages for SEO.

For every enemy / encounter / event in the CSVs, emit a self-contained
HTML page at /<entity>/<slug>/index.html with:
  - per-page <title>, meta description, OG tags, canonical, JSON-LD
  - <base href="{siteBase}/"> so relative asset paths resolve correctly
  - pre-rendered detail panel content (so crawlers + deep-link visitors
    see real content before the SPA hydrates over the top)
  - the same <script> tags as index.html, so the SPA boots, reads the URL,
    and re-renders the panel with no visible flash.

Also regenerates 404.html (siteBase-aware) and sitemap.xml (master only).

Usage:
  python build_snapshots.py
  python build_snapshots.py --base-url=/test --noindex
"""
import csv
import json
import os
import re
import shutil
import sys
from html import escape as html_escape

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
SITE_ORIGIN = "https://spirecodex.com"

# ─── Config ────────────────────────────────────────────────────────────
with open(os.path.join(BASE, "site-config.json"), encoding="utf-8") as f:
    CONFIG = json.load(f)
SITE_BASE = CONFIG.get("siteBase", "") or ""
NOINDEX = bool(CONFIG.get("noindex", False))
OUT_DIR = BASE  # default: write into project root (so rsync picks them up)

for arg in sys.argv[1:]:
    if arg.startswith("--base-url="):
        SITE_BASE = arg.split("=", 1)[1].rstrip("/")
    elif arg == "--noindex":
        NOINDEX = True
    elif arg.startswith("--out="):
        OUT_DIR = arg.split("=", 1)[1]

# Normalise: empty string for root, "/test" otherwise (no trailing slash)
if SITE_BASE and not SITE_BASE.startswith("/"):
    SITE_BASE = "/" + SITE_BASE

# Used inside <base href="..."> — must end with "/"
BASE_HREF = (SITE_BASE + "/") if SITE_BASE else "/"
# Used in absolute URLs (canonical, og:url, sitemap)
SITE_PREFIX = SITE_ORIGIN + SITE_BASE  # e.g. https://spirecodex.com/test


# ─── CSV loaders (mirror data.js) ──────────────────────────────────────
def load_csv(name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


monsters_raw = load_csv("monsters.csv")
moves_raw = load_csv("monster_moves.csv")
encounters_raw = load_csv("encounters.csv")
events_raw = load_csv("events.csv")
choices_raw = load_csv("event_choices.csv")
powers_raw = load_csv("powers.csv")
cards_raw = load_csv("cards.csv")
relics_raw = load_csv("relics.csv")
potions_raw = load_csv("potions.csv")
enchantments_raw = load_csv("enchantments.csv")

# ─── Build lookups ─────────────────────────────────────────────────────
enemy_db = {}
for m in monsters_raw:
    enemy_db[m["Name"]] = {
        "hp": m["HP"],
        "pattern": m["Pattern"],
        "notes": m.get("Notes", ""),
        "starts_with": m.get("StartsWith", ""),
        "powers": [p.strip() for p in (m.get("Powers", "") or "").split(";") if p.strip()],
        "references": [r.strip() for r in (m.get("References", "") or "").split(",") if r.strip()],
        "moves": [],
    }
for mv in moves_raw:
    if mv["Enemy"] in enemy_db:
        enemy_db[mv["Enemy"]]["moves"].append({
            "name": mv["Move"],
            "effects": mv["Effects"],
            "intent": mv["Intent"],
            "notes": mv.get("Notes", ""),
            "references": mv.get("References", ""),
        })

powers_ref = {p["Key"]: {"name": p["Name"], "image": p["Image"], "desc": p["Description"]} for p in powers_raw}

items_ref = {}
for c in cards_raw:
    items_ref[c["Key"]] = {"category": "card", "key": c["Key"], "name": c["Name"],
                           "rarity": c.get("Rarity", ""), "type": c.get("Type", ""),
                           "cost": c.get("Cost", ""), "desc": c.get("Description", "")}
for r in relics_raw:
    items_ref[r["Key"]] = {"category": "relic", "key": r["Key"], "name": r["Name"],
                           "image": r.get("Image", ""), "desc": r.get("Description", "")}
for p in potions_raw:
    items_ref[p["Key"]] = {"category": "potion", "key": p["Key"], "name": p["Name"],
                           "image": p.get("Image", ""), "desc": p.get("Description", "")}
for e in enchantments_raw:
    items_ref[e["Key"]] = {"category": "enchantment", "key": e["Key"], "name": e["Name"],
                           "image": e.get("Image", ""), "desc": e.get("Description", "")}
for k, v in powers_ref.items():
    items_ref[k] = {"category": "power", "key": k, "name": v["name"],
                    "image": v["image"], "desc": v["desc"]}

# Encounters by zone/cat
ZONE_MAP = {"Overgrowth": "overgrowth", "Underdocks": "underdocks", "Hive": "hive", "Glory": "glory"}
encs_by_zone = {}
all_encounters = []
for enc in encounters_raw:
    zone_key = ZONE_MAP.get(enc.get("Zone", ""), enc.get("Zone", "").lower())
    cat = enc.get("Category", "")
    enemy_list = [e.strip() for e in (enc.get("Enemies", "") or "").split(";") if e.strip()]
    rec = {
        "name": enc["Encounter"],
        "enemies": enemy_list,
        "multi": enc.get("Multi", ""),
        "emoji": enc.get("Emoji", ""),
        "composition": enc.get("Composition", ""),
        "alt_image": enc.get("AltImage", ""),
        "zone": zone_key,
        "cat": cat,
    }
    encs_by_zone.setdefault(zone_key, {}).setdefault(cat, []).append(rec)
    all_encounters.append(rec)

# Events
EVENT_ACT_MAP = {"Overgrowth": "overgrowth", "Underdocks": "underdocks",
                 "Hive": "hive", "Glory": "glory", "Shared": "shared"}
events_by_act = {}
all_events = []
for ev in events_raw:
    act_key = EVENT_ACT_MAP.get(ev.get("Act", ""), ev.get("Act", "").lower())
    rec = {
        "key": ev["Key"], "name": ev["Name"], "act": act_key,
        "notes": ev.get("Notes", ""), "image": ev.get("Image", ""),
        "lore": ev.get("Lore", ""),
    }
    events_by_act.setdefault(act_key, []).append(rec)
    all_events.append(rec)

choices_by_event = {}
for c in choices_raw:
    choices_by_event.setdefault(c["Event"], []).append({
        "choice": c["Choice"],
        "effect": c["Effect"],
        "notes": c.get("Notes", ""),
        "references": c.get("References", ""),
    })


# ─── Helpers (mirror renderers.js) ─────────────────────────────────────
def slugify(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)
    return s


CARD_RARITY_ICONS = {
    "Curse": "media/cards/curse_icon_card.webp",
    "Event": "media/cards/event_icon_card.webp",
    "Quest": "media/cards/quest_icon_card.webp",
    "Colorless": "media/cards/colorless_icon_card.webp",
    "Status": "media/cards/status_icon_card.webp",
}
LORE_COLORS = {
    "green": "#5de82e", "aqua": "#2ee8a5", "blue": "#5eaade", "red": "#e85454",
    "gold": "#d4a843", "orange": "#e08830", "purple": "#d462e8", "pink": "#d462e8",
}
INTENT_KEYS = {"attack", "multi_attack", "block", "buff", "debuff", "add_statuses",
               "affliction", "summon", "sleeping", "deathblow", "escape",
               "heal", "stun", "unknown"}


def render_intents(intent_str):
    if not intent_str:
        return ""
    out = []
    for raw in intent_str.split(","):
        key = raw.strip()
        img_key = key if key in INTENT_KEYS else "unknown"
        out.append(
            f'<span class="intent-icon intent-{key}" title="{key}">'
            f'<img src="media/intents/{img_key}.webp" alt="{key}" title="{key}"></span>'
        )
    return "".join(out)


def render_move_refs(text, enemy_name=None):
    if not text:
        return text or ""
    return re.sub(r"<([A-Z][^>]*)>", lambda m: f'<span class="move-ref">{m.group(1)}</span>', text)


def render_power_refs(text, enemy_name=None):
    if not text:
        return text or ""
    text = render_move_refs(text, enemy_name)

    def repl(match):
        key = match.group(1)
        ref = powers_ref.get(key)
        if not ref:
            return match.group(0)
        return (
            f'<span class="power-ref">'
            f'<img class="power-icon-inline" src="media/powers/{ref["image"]}" alt="{ref["name"]}" '
            f'onerror="this.style.display=\'none\'">'
            f'<span class="starts-with-power">{ref["name"]}</span></span>'
        )
    return re.sub(r"\{(\w+)\}", repl, text)


def render_lore(text):
    if not text:
        return ""
    html = text
    # Bold
    html = re.sub(r"\[b\](.*?)\[/b\]", r"<strong>\1</strong>", html, flags=re.S)
    # Strip animation tags but keep their content (no animation in static)
    for tag in ("jitter", "sine", "fade_in", "thinky_dots"):
        html = re.sub(rf"\[{tag}\](.*?)\[/{tag}\]", r"\1", html, flags=re.S)
    html = re.sub(r"\[rainbow[^\]]*\](.*?)\[/rainbow\]", r"\1", html, flags=re.S)

    # Color tags
    def color_repl(m):
        tag = m.group(1).lower()
        content = m.group(2)
        color = LORE_COLORS.get(tag)
        return f'<span style="color:{color}">{content}</span>' if color else content
    html = re.sub(r"\[(\w+)\](.*?)\[/\1\]", color_repl, html, flags=re.S)

    parts = html.split("|")
    return "".join(f"<p>{p.strip()}</p>" for p in parts)


def render_starts_with(text, enemy_name):
    if not text:
        return ""
    return (f'<div class="starts-with-section"><strong>STARTS WITH:</strong> '
            f'{render_power_refs(text, enemy_name)}</div>')


def render_notes(notes_text, enemy_name=None):
    if not notes_text:
        return ""
    parts = re.split(r"(?=\[info\])|(?=\[bug\])|(?=\[req\])|(?=\[coop\])|\n", notes_text)
    coop, reqs, infos, bugs = [], [], [], []
    for part in parts:
        trimmed = part.strip()
        if not trimmed:
            continue
        if part.startswith("    ") or part.startswith("\t"):
            target = infos if infos else (bugs if bugs else reqs)
            if target:
                target[-1] += f'<div class="note-sub">{trimmed}</div>'
        elif trimmed.startswith("[coop]"):
            coop.append(trimmed.replace("[coop]", "").strip())
        elif trimmed.startswith("[req]"):
            reqs.append(trimmed.replace("[req]", "").strip())
        elif trimmed.startswith("[info]"):
            infos.append(trimmed.replace("[info]", "").strip())
        elif trimmed.startswith("[bug]"):
            bugs.append(trimmed.replace("[bug]", "").strip())
        else:
            infos.append(trimmed)

    out = ""
    if coop:
        out += '<div class="note-badges">' + "".join(
            f'<span class="note-badge note-coop">\U0001F91D {render_power_refs(c, enemy_name)}</span>' for c in coop
        ) + "</div>"
    if reqs:
        out += '<div class="note-reqs">' + "".join(
            f'<div class="note-req">✦ {render_power_refs(r, enemy_name)}</div>' for r in reqs
        ) + "</div>"
    if infos:
        out += '<div class="note-infos">' + "".join(
            f'<div class="note-info">\U0001F4A1 {render_power_refs(i, enemy_name)}</div>' for i in infos
        ) + "</div>"
    if bugs:
        out += '<div class="note-bugs">' + "".join(
            f'<div class="note-bug">⚠️ {render_power_refs(b, enemy_name)}</div>' for b in bugs
        ) + "</div>"
    return out


def render_reference_sections(keys, exclude=None):
    exclude = set(exclude or [])
    seen = set()
    unique = []
    for k in keys:
        if k in exclude or k in seen:
            continue
        seen.add(k)
        unique.append(k)

    groups = {"card": [], "power": [], "relic": [], "potion": [], "enchantment": []}
    for k in unique:
        item = items_ref.get(k)
        if item and item["category"] in groups:
            groups[item["category"]].append(item)

    out = ""
    if groups["card"]:
        rows = []
        for c in groups["card"]:
            icon_src = CARD_RARITY_ICONS.get(c["rarity"], "")
            icon_html = (f'<img src="{icon_src}" alt="{c["rarity"]}" '
                         f'style="width:24px;height:24px;vertical-align:middle;" title="{c["rarity"]}">'
                         if icon_src else c["rarity"])
            cost_display = "-" if c["cost"] == "Unplayable" else c["cost"]
            rows.append(
                f'<tr><td style="text-align:center">{icon_html}</td>'
                f'<td><strong>{c["name"]}</strong></td>'
                f'<td style="text-align:center">{cost_display}</td>'
                f'<td>{render_lore(c["desc"])}</td></tr>'
            )
        out += "<h3>Cards</h3><table>" + "".join(rows) + "</table>"

    def _ref_table(items, folder, heading):
        rows = []
        for it in items:
            img_html = (f'<img src="media/{folder}/{it["image"]}" alt="{it["name"]}" '
                        f'style="width:28px;height:28px;vertical-align:middle;">' if it.get("image") else "")
            rows.append(f'<tr><td style="text-align:center">{img_html}</td>'
                        f'<td><strong>{it["name"]}</strong></td>'
                        f'<td>{render_lore(it["desc"])}</td></tr>')
        return (f"<h3>{heading}</h3><table>"
                f'<tr><th style="width:36px"></th><th>Name</th><th>Description</th></tr>'
                + "".join(rows) + "</table>")

    if groups["relic"]:
        out += _ref_table(groups["relic"], "relics", "Relic Reference")
    if groups["potion"]:
        out += _ref_table(groups["potion"], "potions", "Potion Reference")
    if groups["enchantment"]:
        out += _ref_table(groups["enchantment"], "enchantments", "Enchantment Reference")

    if groups["power"]:
        rows = []
        for p in groups["power"]:
            rows.append(
                f'<div class="power-row">'
                f'<img class="power-icon" src="media/powers/{p["image"]}" alt="{p["name"]}" '
                f'onerror="this.style.display=\'none\'">'
                f'<div class="power-info"><span class="power-name">{p["name"]}</span>'
                f'<span class="power-desc">{p["desc"]}</span></div></div>'
            )
        out += '<div class="powers-section"><h3>Powers</h3>' + "".join(rows) + "</div>"

    return out


def render_enemy_section(name, collapsible=False):
    data = enemy_db.get(name)
    if not data:
        return (f'<div class="enemy-section"><div class="enemy-section-name">{name}</div>'
                f'<p style="color:#666;">No data available.</p></div>')

    move_rows = []
    for m in data["moves"]:
        intents = render_intents(m["intent"])
        effect = render_power_refs(m["effects"].replace(";", "<br>"), name)
        note_html = (f'<br><span class="move-note">{render_power_refs(m["notes"], name)}</span>'
                     if m["notes"] else "")
        move_rows.append(
            f'<tr><td><span class="intent-icons">{intents}</span></td>'
            f'<td><strong>{m["name"]}</strong></td>'
            f'<td>{effect}{note_html}</td></tr>'
        )
    notes_html = render_notes(data["notes"], name) if data["notes"] else ""
    img_src = f'media/enemies/{name}.webp'
    collapse_btn = ('<button class="collapse-toggle" onclick="toggleEnemySection(this)" '
                    'title="Collapse/Expand">−</button>' if collapsible else "")
    minion_badge = (f'<img class="minion-badge" src="media/powers/minion_power.webp" '
                    f'alt="Minion" title="Minion — abandons combat without their leader">'
                    if "minion" in data["powers"] else "")
    starts_with = render_starts_with(data["starts_with"], name)
    pattern = render_power_refs(data["pattern"].replace("\n", "<br>"), name)

    refs_keys = list(data["powers"]) + list(data["references"])
    for m in data["moves"]:
        if m["references"]:
            refs_keys += [r.strip() for r in m["references"].split(",") if r.strip()]
    refs_html = render_reference_sections(refs_keys) if refs_keys else ""

    cls = "enemy-section collapsible" if collapsible else "enemy-section"
    return (
        f'<div class="{cls}">'
        f'<div class="enemy-section-header">'
        f'<div class="enemy-section-info">'
        f'<div class="enemy-section-name">{name}</div>'
        f'<div class="hp-row">{collapse_btn}<div class="hp-bar">❤️ HP: {data["hp"]}</div></div>'
        f"</div>"
        f"{minion_badge}"
        f'<img class="enemy-section-img" src="{img_src}" alt="{name}" onerror="this.style.display=\'none\'">'
        f"</div>"
        f'<div class="enemy-section-body">'
        f"<h3>Attack Pattern</h3>"
        f'<div class="pattern-text">{pattern}</div>'
        f"{starts_with}"
        f"<h3>Moves</h3>"
        f"<table>"
        f'<tr><th style="width:40px;">Intent</th><th>Move</th><th>Effect</th></tr>'
        f'{"".join(move_rows)}'
        f"</table>"
        f"{notes_html}"
        f"{refs_html}"
        f"</div>"
        f"</div>"
    )


PANEL_FEEDBACK_LINK = (
    '<div class="feedback-link" style="margin-top: 20px; padding-top: 16px; '
    'border-top: 1px solid #2a2a3a;">'
    '<a href="https://github.com/jparro00/sts2-enemy-guide/issues/new/choose" target="_blank">'
    "Submit feedback or report an issue</a></div>"
)


def render_encounter_panel(enc):
    composition_html = (
        f'<div class="encounter-composition">'
        f'<span class="composition-label">Composition</span>'
        f'<span class="composition-text">{enc["composition"]}</span></div>'
        if enc.get("composition") else ""
    )
    enemies = enc.get("enemies") or []
    if enemies:
        seen, unique = set(), []
        for n in enemies:
            if n not in seen:
                seen.add(n)
                unique.append(n)
        collapsible = len(unique) > 1
        sections = "".join(render_enemy_section(n, collapsible) for n in unique)
        return composition_html + sections + PANEL_FEEDBACK_LINK
    return composition_html + render_enemy_section(enc["name"]) + PANEL_FEEDBACK_LINK


def render_event_panel(ev):
    choices = choices_by_event.get(ev["key"], [])
    if choices:
        rows = []
        for c in choices:
            note_line = (f'<br><span style="color:#f0c040;font-size:0.85em;">{render_lore(c["notes"])}</span>'
                         if c["notes"] else "")
            rows.append(
                f"<tr><td><strong>{c['choice']}</strong></td>"
                f"<td>{render_lore(c['effect'])}{note_line}</td></tr>"
            )
        choices_html = (
            "<h3>Choices</h3><table>"
            "<tr><th>Choice</th><th>Effect</th></tr>"
            + "".join(rows) + "</table>"
        )
    else:
        choices_html = ""

    notes_html = render_notes(ev["notes"]) if ev["notes"] else ""
    img_html = (f'<img class="enemy-section-img" src="media/events/{ev["image"]}" alt="{ev["name"]}" '
                f'onerror="this.style.display=\'none\'">' if ev["image"] else "")
    lore_html = f'<div class="event-lore">{render_lore(ev["lore"])}</div>' if ev["lore"] else ""

    all_ref_keys = []
    for c in choices:
        if c["references"]:
            all_ref_keys += [r.strip() for r in c["references"].split(",") if r.strip()]
    refs_html = render_reference_sections(all_ref_keys) if all_ref_keys else ""

    return (
        f'<div class="enemy-section">'
        f'<div class="enemy-section-header">'
        f'<div class="enemy-section-info">'
        f'<div class="enemy-section-name">{ev["name"]}</div>'
        f"</div>"
        f"{img_html}"
        f"</div>"
        f"{lore_html}"
        f"{choices_html}"
        f"{notes_html}"
        f"{refs_html}"
        f"</div>" + PANEL_FEEDBACK_LINK
    )


# ─── Shell template ─────────────────────────────────────────────────────
with open(os.path.join(BASE, "index.html"), encoding="utf-8") as f:
    INDEX_HTML = f.read()


def render_banner_html():
    """SSR the version banner so it's in the initial HTML (mirrors data.js).
    Eliminates CLS from JS injecting the banner after page load.
    Master with no active beta returns '' — banner stays hidden."""
    beta_version = CONFIG.get("betaVersion", "") or ""
    game_version = CONFIG.get("gameVersion", "") or ""
    is_beta = bool(CONFIG.get("isBeta"))
    if not beta_version:
        return ""
    if is_beta:
        return (
            '<div id="version-banner" class="beta-banner">'
            f'<span class="banner-full">BETA — This page reflects <strong>beta v{beta_version}</strong> '
            f'balance changes. <a href="../">View stable version</a></span>'
            f'<span class="banner-short">BETA <strong>v{beta_version}</strong> — '
            f'<a href="../">View stable version</a></span>'
            "</div>"
        )
    return (
        '<div id="version-banner" class="stable-banner">'
        f'<span class="banner-full">This site is also available for the latest '
        f'<strong>beta patch v{beta_version}</strong>. <a href="beta/">Switch to beta</a></span>'
        f'<span class="banner-mobile">v{game_version} · <a href="beta/">Switch to beta</a></span>'
        "</div>"
    )


BANNER_HTML = render_banner_html()

# Idempotently swap whatever's currently in <div id="version-banner">…</div>
# for the SSR'd banner (or back to empty if no banner is needed).
INDEX_HTML = re.sub(
    r'<div id="version-banner"[^>]*>.*?</div>',
    BANNER_HTML or '<div id="version-banner"></div>',
    INDEX_HTML,
    count=1,
    flags=re.S,
)

# Set <base href> to the deploy root so relative URLs (media/, css/, js/, data/)
# keep resolving from there even after the SPA pushState's the URL to a deep
# panel route like /encounter/foo/. Without this, re-renders after navigation
# request /encounter/foo/media/intents/attack.webp and get the 404 fallback.
_base_tag = f'<base href="{BASE_HREF}">'
if re.search(r"<base\s[^>]*>", INDEX_HTML):
    INDEX_HTML = re.sub(r"<base\s[^>]*>", _base_tag, INDEX_HTML, count=1)
else:
    INDEX_HTML = INDEX_HTML.replace(
        '<meta charset="UTF-8">',
        f'<meta charset="UTF-8">\n{_base_tag}',
        1,
    )


def build_page(title, description, og_image, canonical, json_ld, panel_name, panel_html):
    """Produce a full snapshot HTML by adapting index.html."""
    html = INDEX_HTML

    # Replace title
    html = re.sub(r"<title>.*?</title>", f"<title>{html_escape(title)}</title>", html, count=1)
    # Replace description
    html = re.sub(
        r'<meta name="description"[^>]*>',
        f'<meta name="description" content="{html_escape(description, quote=True)}">',
        html, count=1,
    )
    # Replace canonical
    html = re.sub(r'<link rel="canonical"[^>]*>',
                  f'<link rel="canonical" href="{canonical}">', html, count=1)
    # Replace OG tags
    html = re.sub(r'<meta property="og:title"[^>]*>',
                  f'<meta property="og:title" content="{html_escape(title, quote=True)}">',
                  html, count=1)
    html = re.sub(r'<meta property="og:description"[^>]*>',
                  f'<meta property="og:description" content="{html_escape(description, quote=True)}">',
                  html, count=1)
    if og_image:
        html = re.sub(r'<meta property="og:image"[^>]*>',
                      f'<meta property="og:image" content="{og_image}">', html, count=1)
    html = re.sub(r'<meta property="og:url"[^>]*>',
                  f'<meta property="og:url" content="{canonical}">', html, count=1)
    # Replace JSON-LD
    json_ld_str = json.dumps(json_ld, ensure_ascii=False, indent=2)
    html = re.sub(
        r'<script type="application/ld\+json">.*?</script>',
        f'<script type="application/ld+json">\n{json_ld_str}\n</script>',
        html, flags=re.S, count=1,
    )

    # Inject noindex if needed
    if NOINDEX:
        html = html.replace(
            '<meta name="viewport"',
            '<meta name="robots" content="noindex">\n<meta name="viewport"',
            1,
        )

    # Make body open with the panel pre-rendered
    html = html.replace("<body>", '<body class="panel-open">', 1)
    # Backdrop visible
    html = html.replace(
        '<div class="backdrop" id="backdrop"',
        '<div class="backdrop open" id="backdrop"',
        1,
    )
    # Detail overlay opens
    html = html.replace(
        '<div class="detail-overlay" id="detail-panel">',
        '<div class="detail-overlay open" id="detail-panel">',
        1,
    )
    # Panel name
    html = html.replace(
        '<h2 id="detail-name">Enemy Name</h2>',
        f'<h2 id="detail-name">{html_escape(panel_name)}</h2>',
        1,
    )
    # Panel body content
    html = html.replace(
        '<div class="detail-body" id="detail-body"></div>',
        f'<div class="detail-body" id="detail-body">{panel_html}</div>',
        1,
    )
    return html


def write_page(rel_dir, page_html):
    out_path = os.path.join(OUT_DIR, rel_dir, "index.html")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(page_html)


def first_sentence(text, fallback=""):
    if not text:
        return fallback
    cleaned = re.sub(r"\[/?[^\]]+\]", "", text)  # strip bbcode tags
    cleaned = cleaned.replace("|", " ").strip()
    m = re.match(r"^(.+?[.!?])(\s|$)", cleaned)
    sentence = m.group(1) if m else cleaned[:160]
    return sentence.strip() or fallback


# ─── Generate pages ─────────────────────────────────────────────────────
sitemap_urls = []
generated = 0


def jsonld_for(entity_type, name, description, url, image=None):
    obj = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": name,
        "description": description,
        "url": url,
        "about": {"@type": "VideoGame", "name": "Slay the Spire 2",
                  "applicationCategory": "Game"},
    }
    if image:
        obj["image"] = image
    return obj


# Enemies
for name, data in enemy_db.items():
    slug = slugify(name)
    if not slug:
        continue
    rel = f"enemy/{slug}"
    url = f"{SITE_PREFIX}/enemy/{slug}/"
    pattern_summary = re.sub(r"\s+", " ", (data["pattern"] or "").replace("\n", " "))[:160]
    description = (f"{name} attack pattern, HP, and moves in Slay the Spire 2. "
                   f"{pattern_summary}").strip()
    title = f"{name} — Slay the Spire 2 Enemy Guide"
    image = f"{SITE_ORIGIN}{SITE_BASE}/media/enemies/{name}.webp"
    panel_html = render_enemy_section(name)
    page = build_page(
        title=title,
        description=description,
        og_image=image,
        canonical=url,
        json_ld=jsonld_for("enemy", name, description, url, image),
        panel_name=name,
        panel_html=panel_html,
    )
    write_page(rel, page)
    if not NOINDEX:
        sitemap_urls.append(url)
    generated += 1

# Encounter slug counts (for disambiguating colliding names like "Seapunk" easy/hard)
enc_slug_counts = {}
for enc in all_encounters:
    base = slugify(enc["name"])
    enc_slug_counts[base] = enc_slug_counts.get(base, 0) + 1

# Encounters
for enc in all_encounters:
    base_slug = slugify(enc["name"])
    if not base_slug:
        continue
    slug = base_slug if enc_slug_counts[base_slug] == 1 else f"{base_slug}-{enc['cat']}"
    rel = f"encounter/{slug}"
    url = f"{SITE_PREFIX}/encounter/{slug}/"
    enemies_str = ", ".join(enc["enemies"]) if enc["enemies"] else enc["name"]
    description = (f"{enc['name']} encounter in Slay the Spire 2: {enemies_str}. "
                   f"HP, attack patterns, and strategy.").strip()
    title = f"{enc['name']} — Slay the Spire 2 Encounter Guide"
    primary = enc["enemies"][0] if enc["enemies"] else enc["name"]
    image = f"{SITE_ORIGIN}{SITE_BASE}/media/enemies/{primary}.webp"
    panel_html = render_encounter_panel(enc)
    page = build_page(
        title=title,
        description=description,
        og_image=image,
        canonical=url,
        json_ld=jsonld_for("encounter", enc["name"], description, url, image),
        panel_name=enc["name"],
        panel_html=panel_html,
    )
    write_page(rel, page)
    if not NOINDEX:
        sitemap_urls.append(url)
    generated += 1

# Events
for ev in all_events:
    slug = slugify(ev["name"])
    if not slug:
        continue
    rel = f"event/{slug}"
    url = f"{SITE_PREFIX}/event/{slug}/"
    description_src = ev["lore"] or ev["notes"] or ev["name"]
    description = first_sentence(description_src,
                                 fallback=f"{ev['name']} event in Slay the Spire 2.")
    description = f"{ev['name']} — {description}".strip()[:300]
    title = f"{ev['name']} — Slay the Spire 2 Event Guide"
    image = f"{SITE_ORIGIN}{SITE_BASE}/media/events/{ev['image']}" if ev["image"] else None
    panel_html = render_event_panel(ev)
    page = build_page(
        title=title,
        description=description,
        og_image=image,
        canonical=url,
        json_ld=jsonld_for("event", ev["name"], description, url, image),
        panel_name=ev["name"],
        panel_html=panel_html,
    )
    write_page(rel, page)
    if not NOINDEX:
        sitemap_urls.append(url)
    generated += 1

# ─── 404.html (siteBase-aware SPA shell with noindex) ──────────────────
not_found_html = INDEX_HTML
not_found_html = re.sub(
    r"<title>.*?</title>",
    "<title>Page not found — Spire Codex</title>",
    not_found_html, count=1,
)
not_found_html = re.sub(
    r'<meta name="description"[^>]*>',
    '<meta name="description" content="Page not found on Spire Codex.">',
    not_found_html, count=1,
)
not_found_html = not_found_html.replace(
    '<meta name="viewport"',
    '<meta name="robots" content="noindex">\n<meta name="viewport"',
    1,
)
with open(os.path.join(OUT_DIR, "404.html"), "w", encoding="utf-8") as f:
    f.write(not_found_html)

# Root index.html: write back the (possibly banner-injected) shell so the
# homepage ships with the banner pre-rendered too — no CLS at first paint.
# When BANNER_HTML is empty (e.g. master with no active beta), the version-
# banner div stays empty, matching prior behavior. Re-runs are idempotent.
with open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8") as f:
    f.write(INDEX_HTML)

# Note: <base href> is set above so relative paths keep resolving from the
# deploy root (/, /test/, /beta/) even after the SPA pushState's the URL.
# The SPA's JS reads siteConfig.noindex at runtime to inject the noindex meta
# tag.

# ─── sitemap.xml (master only — empty file otherwise) ──────────────────
sitemap_path = os.path.join(OUT_DIR, "sitemap.xml")
if NOINDEX:
    # Branch deploys: minimal sitemap with no URLs (still valid XML)
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
else:
    sitemap_urls.insert(0, f"{SITE_PREFIX}/")
    body = "\n".join(f"  <url><loc>{u}</loc></url>" for u in sitemap_urls)
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )
with open(sitemap_path, "w", encoding="utf-8") as f:
    f.write(sitemap)

# ─── Summary ───────────────────────────────────────────────────────────
print(f"build_snapshots.py: generated {generated} entity pages")
print(f"  enemies={len(enemy_db)}  encounters={len(all_encounters)}  events={len(all_events)}")
print(f"  siteBase={SITE_BASE!r}  noindex={NOINDEX}  out={OUT_DIR}")
print(f"  sitemap urls: {len(sitemap_urls)}")
if generated < 50:
    print("WARNING: generated fewer than 50 pages — CSVs may be incomplete")
    sys.exit(1)
