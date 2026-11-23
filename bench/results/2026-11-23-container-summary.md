# Benchmark summary

Environment: {"chrome": "153.0.8010.12", "platform": "Linux-6.18.44-fc-v726-x86_64-with-glibc2.39", "cpu_count": 2, "mem_total": 8413835264, "python": "3.13.18", "date": "2026-11-23T14:35:56+0100", "reps": 3, "ablation_date": "2026-11-23T14:40:57+0100"}


## Series A-size

| mode | size MiB | entries | chunk KiB | n | time s (median) | range | MiB/s | × b031-nohash | output overhead B | JS heap peak MiB | renderer RSS peak MiB | state | verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| b031-hash | 64 | 1 | 64 | 3 | 1.55 | 1.5–1.6 | 41.4 | 1.36 | 250 | 3.9 | 204.6 | completed |  |
| b031-nohash | 64 | 1 | 64 | 3 | 1.14 | 1.1–1.3 | 56.2 | 1.00 | 250 | 2.7 | 200.5 | completed |  |
| legacy | 64 | 1 | 64 | 3 | 1.73 | 1.7–1.9 | 36.9 | 1.52 | 3332 | 5.6 | 211.6 | completed |  |
| protected | 64 | 1 | 64 | 3 | 1.93 | 1.7–2.0 | 33.1 | 1.69 | 20650 | 48.4 | 260.5 | completed |  |
| protected-nad | 64 | 1 | 64 | 3 | 1.67 | 1.4–1.8 | 38.4 | 1.46 | 20650 | 45.5 | 257.7 | completed |  |
| b031-hash | 256 | 1 | 64 | 3 | 6.02 | 5.7–6.1 | 42.5 | 1.43 | 250 | 5.8 | 212.0 | completed |  |
| b031-nohash | 256 | 1 | 64 | 3 | 4.20 | 3.9–4.4 | 61.0 | 1.00 | 250 | 3.7 | 204.6 | completed |  |
| legacy | 256 | 1 | 64 | 3 | 6.99 | 6.9–7.3 | 36.6 | 1.66 | 3336 | 7.2 | 218.3 | completed |  |
| protected | 256 | 1 | 64 | 3 | 7.87 | 7.5–7.9 | 32.5 | 1.87 | 69806 | 64.4 | 278.2 | completed |  |
| protected-nad | 256 | 1 | 64 | 3 | 6.29 | 6.1–7.1 | 40.7 | 1.50 | 69806 | 65.0 | 279.4 | completed |  |
| b031-hash | 1024 | 1 | 64 | 3 | 23.15 | 22.9–23.8 | 44.2 | 1.41 | 250 | 10.7 | 222.3 | completed |  |
| b031-nohash | 1024 | 1 | 64 | 3 | 16.41 | 16.3–16.5 | 62.4 | 1.00 | 250 | 4.5 | 211.7 | completed |  |
| legacy | 1024 | 1 | 64 | 3 | 27.41 | 26.4–27.8 | 37.4 | 1.67 | 3341 | 10.6 | 223.4 | completed |  |
| protected | 1024 | 1 | 64 | 3 | 29.52 | 28.5–30.4 | 34.7 | 1.80 | 266419 | 62.8 | 355.8 | completed | verified-complete |
| protected-nad | 1024 | 1 | 64 | 3 | 25.05 | 24.5–26.5 | 40.9 | 1.53 | 266419 | 63.7 | 280.7 | completed |  |

## Series B-entries

| mode | size MiB | entries | chunk KiB | n | time s (median) | range | MiB/s | × b031-nohash | output overhead B | JS heap peak MiB | renderer RSS peak MiB | state | verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| b031-hash | 256 | 1 | 64 | 3 | 5.73 | 5.6–6.0 | 44.7 | 1.36 | 250 | 6.2 | 213.0 | completed |  |
| protected | 256 | 1 | 64 | 3 | 7.87 | 7.1–8.1 | 32.5 | 1.87 | 69806 | 63.3 | 277.5 | completed |  |
| b031-hash | 256 | 16 | 64 | 3 | 5.77 | 5.6–5.9 | 44.4 | — | 1972 | 5.5 | 210.8 | completed |  |
| protected | 256 | 16 | 64 | 3 | 7.73 | 7.5–8.4 | 33.1 | — | 86717 | 59.8 | 276.7 | completed |  |
| b031-hash | 256 | 256 | 64 | 3 | 6.31 | 6.2–7.0 | 40.6 | — | 30124 | 6.7 | 213.7 | completed |  |
| protected | 256 | 256 | 64 | 3 | 10.39 | 10.1–10.9 | 24.6 | — | 357132 | 49.1 | 267.2 | completed |  |
| b031-hash | 256 | 2048 | 64 | 3 | 11.18 | 10.4–11.4 | 22.9 | — | 243676 | 6.6 | 216.5 | completed |  |
| protected | 256 | 2048 | 64 | 3 | 19.65 | 19.1–20.5 | 13.0 | — | 2374006 | 53.8 | 288.8 | completed |  |

## Series C-chunk

| mode | size MiB | entries | chunk KiB | n | time s (median) | range | MiB/s | × b031-nohash | output overhead B | JS heap peak MiB | renderer RSS peak MiB | state | verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| protected | 256 | 1 | 16 | 3 | 8.47 | 8.3–8.7 | 30.2 | — | 69806 | 78.2 | 312.9 | completed |  |
| protected | 256 | 1 | 64 | 3 | 8.24 | 8.0–8.7 | 31.1 | 1.96 | 69806 | 62.6 | 277.6 | completed |  |
| protected | 256 | 1 | 1024 | 3 | 8.02 | 7.9–8.6 | 31.9 | — | 69806 | 53.0 | 259.2 | completed |  |
| protected | 256 | 1 | 8192 | 3 | 8.00 | 8.0–8.4 | 32.0 | — | 69806 | 60.4 | 268.2 | completed |  |

## Series D-rechunk

| mode | size MiB | entries | chunk KiB | n | time s (median) | range | MiB/s | × b031-nohash | output overhead B | JS heap peak MiB | renderer RSS peak MiB | state | verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| age-raw | 256 | 1 | 8192 | 3 | 5.71 | 5.7–5.8 | 44.8 | — | 65720 | 76.3 | 279.4 | completed |  |
| age-rechunk | 256 | 1 | 8192 | 3 | 4.78 | 4.5–5.3 | 53.5 | — | 65720 | 62.8 | 267.9 | completed |  |
| age-raw | 256 | 1 | 32768 | 3 | 6.05 | 6.0–6.2 | 42.3 | — | 65720 | 111.2 | 315.9 | completed |  |
| age-rechunk | 256 | 1 | 32768 | 3 | 4.48 | 4.3–5.2 | 57.1 | — | 65720 | 86.9 | 292.4 | completed |  |
