"""Build a local preview page: src/sprint.html + an in-memory mock of window.claude.

Run scripts/seeds.py first. Open preview/index.html through any static server.
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
seed = json.load(open(os.path.join(ROOT, "seed", "all.json"), encoding="utf-8"))
# A few sample rows so the populated views can be checked locally only.
seed["days"] = {"2026-10-19": {"focusMin": 95, "lc": 1, "trainer": 4, "note": "Тестовая заметка"}}
seed["apps"] = {"a1": {"company": "QA Roast", "role": "Junior Full-Stack JS", "source": "Djinni", "appliedAt": "2026-10-12",
                       "status": "screen", "maxRank": 1, "history": [], "nextStep": "Отправить ссылку на Request Desk",
                       "nextDate": "2026-10-17", "notes": "", "updatedAt": 1}}
mock = """
<script>
(() => {
  const SEED = %s;
  const store = new Map();
  for (const [c, docs] of Object.entries(SEED)) for (const [id, d] of Object.entries(docs)) store.set(c + "/" + id, JSON.parse(JSON.stringify(d)));
  const listeners = new Map();
  const snapOf = (c) => {
    const docs = [...store.entries()].filter(([p]) => p.startsWith(c + "/") && p.split("/").length === 2)
      .sort(([a],[b]) => a < b ? -1 : 1).map(([p, d]) => ({ id: p.split("/")[1], exists: true, data: () => d, metadata: {} }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} };
  };
  const notify = (c) => setTimeout(() => (listeners.get(c) || []).forEach((fn) => fn(snapOf(c))), 0);
  let n = 0;
  const docRef = (path) => ({
    id: path.split("/").pop(), path,
    get: async () => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path), metadata: {} }),
    set: async (d) => { store.set(path, JSON.parse(JSON.stringify(d))); notify(path.split("/")[0]); },
    update: async (d) => { if (!store.has(path)) throw { code: "invalid_argument" }; store.set(path, { ...store.get(path), ...JSON.parse(JSON.stringify(d)) }); notify(path.split("/")[0]); },
    delete: async () => { store.delete(path); notify(path.split("/")[0]); },
  });
  const db = {
    doc: docRef,
    collection: (c) => ({
      path: c,
      doc: (id) => docRef(c + "/" + (id || "x" + Date.now().toString(36) + (n++))),
      onSnapshot: (fn) => { if (!listeners.has(c)) listeners.set(c, []); listeners.get(c).push(fn); setTimeout(() => fn(snapOf(c)), 30); return () => {}; },
    }),
  };
  const sample = async (p) => { window.__lastPrompt = p; return { text: "Тестовый разбор недели." }; };
  sample.json = async (p) => { window.__lastPrompt = p; return { score: 3, verdict: "Тестовая оценка", missing: ["пункт"], strong_answer: "Тестовый ответ" }; };
  window.__store = store;
  window.claude = { use: async (name) => name === "db" ? db : name === "sample" ? sample : null };
})();
</script>
""" % json.dumps(seed, ensure_ascii=False)
page = open(os.path.join(ROOT, "src", "sprint.html"), encoding="utf-8").read()
html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
        '</head><body>' + mock + page + '</body></html>')
os.makedirs(os.path.join(ROOT, "preview"), exist_ok=True)
open(os.path.join(ROOT, "preview", "index.html"), "w", encoding="utf-8").write(html)
print("ok", len(html))
