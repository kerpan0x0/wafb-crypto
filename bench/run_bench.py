"""Drives the in-browser benchmark (packages/web/bench.html) with headless Chrome.

Usage: python3 -I bench/run_bench.py [--quick] [--out results.json]
Requires: the bench build served at http://localhost:4174 (vite preview --config vite.bench.config.ts).

Memory is sampled two ways:
  - JS heap peak inside the page (performance.memory, --enable-precise-memory-info);
  - RSS of the renderer process(es) from the OS, every 50 ms, which also covers
    ArrayBuffer backing stores and WASM memory not counted in the JS heap.
"""
import json, platform, shutil, sys, tempfile, threading, time
import psutil
from playwright.sync_api import sync_playwright

URL = "http://localhost:4174/bench.html"
MiB = 1024 * 1024
quick = "--quick" in sys.argv
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "bench-results.json"
REPS = 1 if quick else 3
MODES = ["b031-nohash", "b031-hash", "legacy", "protected", "protected-nad"]

def plan():
    if quick:
        return [dict(mode=m, totalBytes=16 * MiB, chunkBytes=64 * 1024, entries=1, series="quick") for m in MODES]
    runs = []
    for size in (64 * MiB, 256 * MiB, 1024 * MiB):            # A: size scaling, one entry
        runs += [dict(mode=m, totalBytes=size, chunkBytes=64 * 1024, entries=1, series="A-size") for m in MODES]
    for n in (1, 16, 256, 2048):                               # B: entry-count scaling, fixed total
        runs += [dict(mode=m, totalBytes=256 * MiB, chunkBytes=64 * 1024, entries=n, series="B-entries") for m in ("b031-hash", "protected")]
    for ch in (16 * 1024, 64 * 1024, 1 * MiB, 8 * MiB):        # C: source chunk size
        runs += [dict(mode="protected", totalBytes=256 * MiB, chunkBytes=ch, entries=1, series="C-chunk")]
    return runs

def plan_ablation():
    runs = []
    for ch in (8 * MiB, 32 * MiB):                              # D: rechunk ablation (encryption stage only)
        runs += [dict(mode=m, totalBytes=256 * MiB, chunkBytes=ch, entries=1, series="D-rechunk") for m in ("age-raw", "age-rechunk")]
    return runs

class RssSampler(threading.Thread):
    def __init__(self, browser_pid):
        super().__init__(daemon=True); self.pid = browser_pid; self.peak = 0; self.stop = False
    def run(self):
        root = psutil.Process(self.pid)
        while not self.stop:
            try:
                rss = sum(c.memory_info().rss for c in root.children(recursive=True)
                          if "--type=renderer" in " ".join(c.cmdline()))
                self.peak = max(self.peak, rss)
            except psutil.Error:
                pass
            time.sleep(0.05)

def browser_pid(before):
    new = [p for p in psutil.process_iter(["pid", "name", "cmdline"]) if p.info["pid"] not in before
           and "chrome" in (p.info["name"] or "") and not any("--type=" in a for a in (p.info["cmdline"] or []))]
    return new[0].pid if new else None

results = []
with sync_playwright() as pw:
    runs = plan_ablation() if "--ablation" in sys.argv else plan()
    for rep in range(REPS):
        order = runs if rep % 2 == 0 else list(reversed(runs))   # alternate order across repetitions
        for i, r in enumerate(order):
            before = {p.pid for p in psutil.process_iter()}
            # Persistent on-disk profile: the ephemeral profile used by launch()
            # has a small storage quota (OPFS writes of 1 GiB hit QuotaExceededError).
            profile = tempfile.mkdtemp(prefix="wafb-bench-profile-")
            b = pw.chromium.launch_persistent_context(profile, executable_path="/usr/bin/google-chrome",
                                   args=["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"])
            bp = browser_pid(before)
            page = b.pages[0] if b.pages else b.new_page()
            page.goto(URL)
            page.wait_for_function("window.benchReady === true")
            # warm-up (not recorded): loads WASM, JITs the pipeline
            page.evaluate("p => runBench(p)", dict(r, totalBytes=4 * MiB, verify=False))
            page.evaluate("() => window.gc && window.gc()")
            sampler = RssSampler(bp); sampler.start() if bp else None
            res = page.evaluate("p => runBench(p)", dict(r, verify=(r['mode'] == 'protected' and r.get('series') != 'C-chunk' and r['totalBytes'] >= 1024 * MiB)))
            sampler.stop = True
            res.update(series=r["series"], rep=rep, rendererRssPeak=sampler.peak if bp else None,
                       throughputMiBs=r["totalBytes"] / MiB / (res["ms"] / 1000))
            results.append(res)
            print(json.dumps({k: res[k] for k in ("series", "mode", "totalBytes", "entries", "chunkBytes", "rep", "ms", "throughputMiBs", "outputBytes", "heapPeak", "rendererRssPeak", "state")} | ({"verdict": res.get("verdict"), "verifyMs": res.get("verifyMs")} if "verdict" in res else {})), flush=True)
            b.close()
            shutil.rmtree(profile, ignore_errors=True)

meta = {
    "chrome": None, "platform": platform.platform(), "cpu_count": psutil.cpu_count(),
    "mem_total": psutil.virtual_memory().total, "python": platform.python_version(),
    "date": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "reps": REPS,
}
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"]); meta["chrome"] = b.version; b.close()
json.dump({"meta": meta, "results": results}, open(out, "w"), indent=1)
print("wrote", out)
