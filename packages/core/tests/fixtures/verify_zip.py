"""Independent ZIP reader used by the test-suite (Python's zipfile module).

Usage: python3 -I verify_zip.py ARCHIVE [--no-hash]
Prints one JSON object: {"entries": [...], "zip64_eocd": bool, "testzip": null|name}
Each entry: name, size, crc, sha256 (unless --no-hash), flag_bits, extract_version.
"""
import hashlib, json, sys, zipfile

path = sys.argv[1]
no_hash = "--no-hash" in sys.argv[2:]

with open(path, "rb") as fh:
    fh.seek(0, 2)
    end = fh.tell()
    fh.seek(max(0, end - 22 - 20))
    tail = fh.read()
zip64_eocd = b"PK\x06\x07" in tail  # ZIP64 EOCD locator signature

out = {"entries": [], "zip64_eocd": zip64_eocd}
with zipfile.ZipFile(path) as z:
    out["testzip"] = z.testzip()  # reads every entry and checks its CRC
    for info in z.infolist():
        e = {
            "name": info.filename,
            "size": info.file_size,
            "crc": info.CRC,
            "flag_bits": info.flag_bits,
            "extract_version": info.extract_version,
        }
        if not no_hash:
            h = hashlib.sha256()
            with z.open(info) as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            e["sha256"] = h.hexdigest()
        out["entries"].append(e)
print(json.dumps(out))
