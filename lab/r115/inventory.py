"""Generate byte inventory and reversible literal resource edges from the extension."""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = sorted(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file())
known = set(files)
edges = set()
with open('inventory.csv', 'w', newline='') as output:
    rows = csv.writer(output)
    rows.writerow(['path','bytes','sha256'])
    for name in files:
        raw = (root/name).read_bytes()
        rows.writerow([name,len(raw),hashlib.sha256(raw).hexdigest()])
        if Path(name).suffix not in {'.js','.html','.json','.css','.mjs'}:
            continue
        for value in re.findall(r"""["']([^"'\s<>]{1,220})["']""",raw.decode('utf8')):
            for target in (value.lstrip('/'), (root/name).parent.joinpath(value).resolve().relative_to(root).as_posix() if not value.startswith('/') and (root/name).parent.joinpath(value).resolve().is_relative_to(root) else ''):
                if target in known:
                    edges.add((name,target))
with open('dependency-edges.csv','w',newline='') as output:
    rows = csv.writer(output)
    rows.writerow(['consumer','referenced_file'])
    rows.writerows(sorted(edges))
print(len(files),len(edges))
