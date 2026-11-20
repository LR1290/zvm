#!/usr/bin/env python3
"""Offline verifier: hashes, manifest canonical mode, source tree, institutional Ed25519. No private key."""
from pathlib import Path
from hashlib import sha256
import base64,json,re,sys,zipfile
import subprocess
if not __debug__:raise RuntimeError('Execute Python sem -O')
p=Path(sys.argv[1])
h=lambda b:sha256(b).hexdigest()
with zipfile.ZipFile(p) as z:
 assert z.testzip() is None,'ZIP CRC failed'
 names=z.namelist();assert len(names)==len(set(names))==359,'unexpected ZIP members'
 assert not any('private-key' in n.lower() or n.lower().endswith('.pem') for n in names),'private material in ZIP'
 raw={n:z.read(n) for n in names}
 integrity=json.loads(raw['app/security/integrity.json']);ident=json.loads(raw['app/security/build-identity.json']);manifest=json.loads(raw['manifest.json'])
 files=integrity['files'];assert len(files)==357
 seen=set()
 for row in files:
  name=row['path'];assert name in raw and name not in seen;seen.add(name)
  data=raw[name]
  if row.get('mode')=='manifest-json-v1':
   manifest_copy=json.loads(data);manifest_copy.pop('key',None);manifest_copy.pop('update_url',None)
   data=json.dumps(manifest_copy,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
  assert h(data)==row['sha256'] and len(data)==row['size'],name
 excluded={'app/security/build-identity.json','app/security/integrity.json'}
 assert seen==set(names)-excluded
 # Reconstruct the exact insertion order used by the MV3 runtime verifier.
 # Dictionary equality ignores key order; SHA-256 of JSON.stringify does not.
 canonical=[]
 for row in sorted(files,key=lambda x:x['path']):
  item={'path':row['path'],'sha256':row['sha256'],'size':row['size']}
  if row.get('mode'):
   item['mode']=row['mode']
  canonical.append(item)
 fp=h(json.dumps({'extensionVersion':manifest['version'],'files':canonical},ensure_ascii=False,separators=(',',':')).encode())
 assert fp==integrity['buildFingerprint']
 tree=h(''.join(f'{n}\0{h(raw[n])}\0{len(raw[n])}\n' for n in sorted(names) if n not in excluded).encode())
 assert tree==ident['sourceTreeSha256']
 assert ident['buildId']==f'zvm-dev-{manifest["version"]}-s{tree[:12]}'
 att=integrity['devAttestation'];desc=att['descriptor']
 assert desc['buildId']==ident['buildId'] and desc['buildFingerprint']==fp and desc['sourceTreeSha256']==tree and desc['protectedFiles']==357
 foundation=raw['app/background/authority/foundation-integrity.js'].decode()
 b64=re.search(r'EXTUI_DEV_ATTESTATION_SPKI_B64="([A-Za-z0-9+/=]+)"',foundation).group(1)
 pinned=Path(__file__).with_name('dev-public.spki.b64').read_text().strip()
 assert b64==pinned
 eid=''.join(chr(97+int(c,16)) for c in h(base64.b64decode(manifest['key']))[:32])
 assert eid==desc['extensionId']=='ckbffcbmanboelbihfkhiahgafnimcho'
 assert manifest['version_name']==ident['versionName']=='0.9.305-dev+R104-QA'
 assert att['keyId']=='dev-2026-01' and desc['createdAt']==ident['createdAt']
 assert desc['channel']==ident['channel']=='dev' and desc['extensionVersion']==manifest['version']
 subprocess.run(['node',str(Path(__file__).with_name('verify-attestation.cjs'))],input=json.dumps(att).encode(),check=True)
 assert manifest['version']=='0.9.305' and ident['channel']=='dev'
 print('PASS: ZIP CRC 359, protected files 357, manifest, build fingerprint, source tree, signed Ed25519')
 print('ZIP_SHA256',h(p.read_bytes()))
 print('BUILD_ID',ident['buildId'])
 print('FINGERPRINT',fp)
 print('EXPIRES_AT',att['expiresAt'])
 print('EXTENSION_ID',eid)
 print('QA_BACKEND', next(v for v in manifest['host_permissions'] if v.endswith('.onrender.com/*')))
