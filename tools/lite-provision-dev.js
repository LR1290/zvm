#!/usr/bin/env node
'use strict';
// ZVM LITE offline identity bootstrap. Does not contact any service.
// Generates a dedicated Chrome RSA identity and independent Ed25519 signer.
// PRIVATE KEY FILES NEVER GO INTO THE REPOSITORY OR A BUILD ZIP.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
function refuse(message){console.error('ZVM LITE:',message);process.exitCode=2;}
function chromeIdFromSpki(spki){
  const digest=crypto.createHash('sha256').update(spki).subarray(0,16);
  return Array.from(digest).map(n=>String.fromCharCode(97+(n>>>4))+String.fromCharCode(97+(n&15))).join('');
}
function provision(out){
  if(!path.isAbsolute(out)) throw new Error('Forneça um caminho absoluto no parâmetro --out.');
  const repo=path.resolve(__dirname,'..');
  const relative=path.relative(repo,out);
  if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) {
    throw new Error('Guarde as chaves fora da pasta do repositório e dos ZIPs de extensão.');
  }
  if(fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('Destino não está vazio. Para evitar sobrescrita, escolha pasta nova.');
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  const crx=crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:0x10001});
  const ed=crypto.generateKeyPairSync('ed25519');
  const chromePublic=crx.publicKey.export({format:'der',type:'spki'});
  const chromePrivate=crx.privateKey.export({format:'pem',type:'pkcs8'});
  const signingPrivate=ed.privateKey.export({format:'pem',type:'pkcs8'});
  const signingPublic=ed.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const devExtensionId=chromeIdFromSpki(chromePublic);
  const keyId='lite-dev-ed25519-v1';
  const files=[
    ['lite-chrome-crx-private.pem',chromePrivate],
    ['lite-build-ed25519-private.pem',signingPrivate],
  ];
  for(const [name,data] of files) fs.writeFileSync(path.join(out,name),data,{flag:'wx',mode:0o600});
  const publicConfig={
    productId:'zvm_lite',
    devExtensionId,
    manifestKey:chromePublic.toString('base64'),
    keyId,
    ed25519PublicSpkiBase64:signingPublic,
    note:'A identidade é privada. Este arquivo contém SOMENTE chaves públicas; não é uma assinatura de build.'
  };
  fs.writeFileSync(path.join(out,'lite-identity-PUBLIC.json'),JSON.stringify(publicConfig,null,2)+'\n',{flag:'wx'});
  const env=[
    'ZVM_LITE_V4_ENABLED=false',
    'ZVM_LITE_DEV_EXTENSION_ID='+devExtensionId,
    'ZVM_LITE_DEV_KEY_ID='+keyId,
    'ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64='+signingPublic,
    'ZVM_LITE_DEV_BUILD_ID=',
    'ZVM_LITE_DEV_BUILD_SHA256=',
    'ZVM_LITE_DEV_VERSION=',
  ].join('\n')+'\n';
  fs.writeFileSync(path.join(out,'lite-server-env-PUBLIC.txt'),env,{flag:'wx'});
  console.log('Identidade LITE criada localmente. Chrome ID:',devExtensionId);
  console.log('Arquivos públicos:',path.join(out,'lite-identity-PUBLIC.json'));
  console.log('Configuração do servidor: ',path.join(out,'lite-server-env-PUBLIC.txt'));
  console.log('AVISO: não envie os arquivos *private.pem para GitHub, Render, clientes ou ChatGPT.');
  console.log('A assinatura CRX3, o digest de build e a homologação MV3 ainda precisam ser realizados.');
}
if(process.argv.length!==4 || process.argv[2]!=='--out') refuse('Uso: node tools/lite-provision-dev.js --out "C:\\ZVM-SEGREDOS-LITE"');
else {try{provision(path.resolve(process.argv[3]));}catch(e){refuse(e.message);}}
