"""Python 3 + Node 24, uso offline. Sem --key, calcula somente a identidade."""
import argparse,base64,datetime,hashlib,json,pathlib,subprocess,zipfile
p=argparse.ArgumentParser()
p.add_argument('lab',type=pathlib.Path)
p.add_argument('--key',type=pathlib.Path)
p.add_argument('--out',type=pathlib.Path)
a=p.parse_args()
if bool(a.key)!=bool(a.out):p.error('--key e --out devem ser usados juntos')
h=lambda b:hashlib.sha256(b).hexdigest()
def encode(value,sort=False):
    return json.dumps(value,sort_keys=sort,separators=(',',':'),ensure_ascii=False).encode()
if h(a.lab.read_bytes())!='651a54054ad116a44dee5a2d948dd257de3f2b084fa28760a0be52b05a2755f1':raise ValueError('LAB SHA256 divergente')
with zipfile.ZipFile(a.lab) as z: raw={n:z.read(n) for n in z.namelist()}
ip='app/security/integrity.json'
bp='app/security/build-identity.json'
m=json.loads(raw['manifest.json'])
extid=''.join(chr(97+int(c,16)) for c in h(base64.b64decode(m['key']))[:32])
if extid!='ckbffcbmanboelbihfkhiahgafnimcho':raise ValueError('ID DEV divergente')
m['version_name']='0.9.305-dev+R104'
raw['manifest.json']=encode(m)
integrity=json.loads(raw[ip]);identity=json.loads(raw[bp])
tree=hashlib.sha256()
rows=[]
for n in sorted(raw.keys()-{ip,bp}):
    data=raw[n]
    tree.update(f'{n}\0{h(data)}\0{len(data)}\n'.encode())
    row={'path':n}
    if n=='manifest.json':
        row['mode']='manifest-json-v1'
        data=encode({k:v for k,v in m.items() if k not in ('key','update_url')},True)
    row.update(sha256=h(data),size=len(data));rows.append(row)
fp=h(encode({'extensionVersion':m['version'],'files':rows}))
bid=f'zvm-dev-{m["version"]}-s{tree.hexdigest()[:12]}'
now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
desc=dict(integrity.pop('devAttestation')['descriptor'],sourceTreeSha256=tree.hexdigest(),buildFingerprint=fp,buildId=bid,createdAt=now)
print(json.dumps(dict(buildId=bid,buildFingerprint=fp,extensionId=extid,protectedFiles=len(rows))))
if a.key:
    completed=subprocess.run(['node',str(pathlib.Path(__file__).with_name('sign.cjs')),str(a.key)],input=encode(desc),stdout=subprocess.PIPE,check=True)
    att=json.loads(completed.stdout)
    integrity.update(files=rows,buildFingerprint=fp,devAttestation=att)
    identity.update(buildId=bid,sourceTreeSha256=tree.hexdigest(),createdAt=now,versionName=m['version_name'],sourceRevision='e9a8e44867b69079d0a4cf03a3a9d97fb3b134eb')
    raw[ip]=encode(integrity);raw[bp]=encode(identity)
    with zipfile.ZipFile(a.out,'x',compression=zipfile.ZIP_DEFLATED) as z:
        for n in sorted(raw):z.writestr(n,raw[n])
    print('Validade:',att['expiresAt'],'SHA256:',h(a.out.read_bytes()))
