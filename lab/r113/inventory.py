"""Static indicators for triage; occurrences are not runtime event counts."""
import csv,json,re,sys
from pathlib import Path
root=Path(sys.argv[1])
manifest=json.loads((root/'manifest.json').read_text())
phase={n:g['run_at'] for g in manifest['content_scripts'] for n in g['js']}
phase[manifest['background']['service_worker']]='service_worker'
patterns={'listeners':r'\badd(?:Event)?Listener\s*\(', 'timers':r'\bset(?:Timeout|Interval)\s*\(', 'observers':r'\bnew\s+MutationObserver\s*\(', 'rpc':r'\bsendMessage\s*\(', 'indexedDB':r'\bindexedDB\b','dom_queries':r'\bquerySelector(?:All)?\s*\('}
writer=csv.writer(sys.stdout)
writer.writerow(['path','entry','bytes',*patterns])
for p in sorted(root.rglob('*')):
 if p.suffix not in ('.js','.mjs'):continue
 n=p.relative_to(root).as_posix();s=p.read_text()
 writer.writerow([n,phase.get(n,'indirect'),p.stat().st_size,*[len(re.findall(v,s)) for v in patterns.values()]])
