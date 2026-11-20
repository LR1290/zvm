"""Python 3 + Node 24, uso offline. Sem --key, calcula somente a identidade."""
import argparse,base64,datetime,hashlib,json,pathlib,subprocess,zipfile,re
p=argparse.ArgumentParser()
p.add_argument('lab',type=pathlib.Path)
p.add_argument('--key',type=pathlib.Path)
p.add_argument('--out',type=pathlib.Path)
a=p.parse_args()
if bool(a.key)!=bool(a.out):p.error('--key e --out devem ser usados juntos')
h=lambda b:hashlib.sha256(b).hexdigest()
def encode(value,sort=False):
    return json.dumps(value,sort_keys=sort,separators=(',',':'),ensure_ascii=False).encode()
if h(a.lab.read_bytes())!='92a50e88103a79504fc2881d44391c4f2017973c3dd6b7d9158a2154a9f03a69':raise ValueError('LAB SHA256 divergente')
with zipfile.ZipFile(a.lab) as z: raw={n:z.read(n) for n in z.namelist()}
ip='app/security/integrity.json'
bp='app/security/build-identity.json'
m=json.loads(raw['manifest.json'])
extid=''.join(chr(97+int(c,16)) for c in h(base64.b64decode(m['key']))[:32])
if extid!='ckbffcbmanboelbihfkhiahgafnimcho':raise ValueError('ID DEV divergente')
theme=pathlib.Path(__file__).with_name('theme-system.js').read_bytes()
if h(theme)!='7c3ebe1355aa02eef021ca04af1ee66fe839a78cf839ebf32fb7c5993a0eebbe':raise ValueError('Tema divergente')
raw['app/shared/core/theme-system.js']=theme
m['version_name']='0.9.305-dev+R113-THEME-QA'
raw['manifest.json']=encode(m)
integrity=json.loads(raw[ip]);identity=json.loads(raw[bp])
tree=hashlib.sha256()
rows=[]
for n in sorted(raw.keys()-{ip,bp}):
    data=raw[n]
    tree.update(f'{n}\0{h(data)}\0{len(data)}\n'.encode())
    row={'path':n}
    if n=='manifest.json':
        data=encode({k:v for k,v in m.items() if k not in ('key','update_url')},True)
    row.update(sha256=h(data),size=len(data))
    # Keep insertion order identical to the runtime's JSON.stringify({path,sha256,size,mode}).
    # Putting mode before sha256 previously signed a fingerprint the browser rejected.
    if n=='manifest.json':row['mode']='manifest-json-v1'
    rows.append(row)
fp=h(encode({'extensionVersion':m['version'],'files':rows}))
bid=f'zvm-dev-{m["version"]}-s{tree.hexdigest()[:12]}'
now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
desc=dict(integrity.pop('devAttestation')['descriptor'],sourceTreeSha256=tree.hexdigest(),buildFingerprint=fp,buildId=bid,createdAt=now)
print(json.dumps(dict(buildId=bid,buildFingerprint=fp,extensionId=extid,protectedFiles=len(rows))))
if a.key:
    completed=subprocess.run(['node',str(pathlib.Path(__file__).with_name('sign.cjs')),str(a.key)],input=encode(desc),stdout=subprocess.PIPE,check=True)
    att=json.loads(completed.stdout)
    integrity.update(files=rows,buildFingerprint=fp,devAttestation=att)
    identity.update(buildId=bid,sourceTreeSha256=tree.hexdigest(),createdAt=now,versionName=m['version_name'],sourceRevision='R113-theme-from-R112-5ebe437')
    raw[ip]=encode(integrity);raw[bp]=encode(identity)
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        for name,content in raw.items():
            target=pathlib.Path(folder)/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(content)
        subprocess.run(['node',str(pathlib.Path(__file__).with_name('runtime-check.cjs')),folder],check=True)
    with zipfile.ZipFile(a.out,'x',compression=zipfile.ZIP_DEFLATED) as z:
        for n in sorted(raw):z.writestr(n,raw[n])
    print('Validade:',att['expiresAt'],'SHA256:',h(a.out.read_bytes()))
