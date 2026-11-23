"""Summarises bench/run_bench.py output into Markdown tables and a CSV.

Usage: python3 -I bench/analyze.py RESULTS.json [OUT_PREFIX]
Reports median and min–max over repetitions; overhead is relative to the
WAFB 0.3.1 configuration without hashing (b031-nohash) at the same size.
"""
import csv, json, statistics as st, sys
from collections import defaultdict

src = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0]
data = json.load(open(src))
R = data["results"]
MiB = 1024 * 1024

groups = defaultdict(list)
for r in R:
    groups[(r["series"], r["mode"], r["totalBytes"], r["entries"], r["chunkBytes"])].append(r)

def med(xs): return st.median(xs) if xs else None
def rng(xs): return f"{min(xs):.1f}–{max(xs):.1f}" if xs else "—"

rows = []
for k, rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][2], kv[0][3], kv[0][4], kv[0][1])):
    series, mode, total, entries, chunk = k
    ms = [x["ms"] for x in rs]
    rows.append(dict(
        series=series, mode=mode, size_MiB=total / MiB, entries=entries, chunk_KiB=chunk / 1024, n=len(rs),
        time_s_median=med(ms) / 1000, time_s_range=rng([m / 1000 for m in ms]),
        throughput_MiBs_median=med([x["throughputMiBs"] for x in rs]),
        output_bytes=rs[0]["outputBytes"], output_overhead_bytes=rs[0]["outputBytes"] - total,
        heap_peak_MiB_median=med([x["heapPeak"] / MiB for x in rs if x.get("heapPeak")]),
        rss_peak_MiB_median=med([x["rendererRssPeak"] / MiB for x in rs if x.get("rendererRssPeak")]),
        states=",".join(sorted({x.get("state", "") for x in rs})),
        verdicts=",".join(sorted({x["verdict"] for x in rs if "verdict" in x})) or "",
    ))

base = {(r["size_MiB"], r["entries"], r["chunk_KiB"]): r["time_s_median"] for r in rows if r["mode"] == "b031-nohash"}
for r in rows:
    b = base.get((r["size_MiB"], r["entries"], r["chunk_KiB"]))
    r["time_vs_b031_nohash"] = (r["time_s_median"] / b) if b else None

with open(prefix + "-summary.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)

def fmt(v, d=1):
    return "—" if v is None else (f"{v:.{d}f}" if isinstance(v, float) else str(v))

lines = [f"# Benchmark summary\n", f"Environment: {json.dumps(data['meta'])}\n"]
for series in sorted({r["series"] for r in rows}):
    lines.append(f"\n## Series {series}\n")
    lines.append("| mode | size MiB | entries | chunk KiB | n | time s (median) | range | MiB/s | × b031-nohash | output overhead B | JS heap peak MiB | renderer RSS peak MiB | state | verify |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        if r["series"] != series: continue
        lines.append("| " + " | ".join([
            r["mode"], fmt(r["size_MiB"], 0), str(r["entries"]), fmt(r["chunk_KiB"], 0), str(r["n"]),
            fmt(r["time_s_median"], 2), r["time_s_range"], fmt(r["throughput_MiBs_median"]),
            fmt(r["time_vs_b031_nohash"], 2), str(r["output_overhead_bytes"]),
            fmt(r["heap_peak_MiB_median"]), fmt(r["rss_peak_MiB_median"]), r["states"], r["verdicts"],
        ]) + " |")
open(prefix + "-summary.md", "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
