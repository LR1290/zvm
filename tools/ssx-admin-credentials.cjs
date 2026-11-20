'use strict';
// Run locally on a trusted terminal. Never pass the password via command flags,
// environment variables, files, CI, logs or a chat conversation.
const crypto=require('node:crypto');
const readline=require('node:readline');
function fail(message){console.error(message);process.exitCode=1;}
function hidden(label) {
  return new Promise((resolve,reject)=>{
    const input=process.stdin;
    if(!input.isTTY || typeof input.setRawMode!=='function')return reject(new Error('REQUIRES_LOCAL_INTERACTIVE_TTY'));
    process.stdout.write(label);
    readline.emitKeypressEvents(input);
    input.setRawMode(true);input.resume();
    let value='';
    const stop=(error)=>{
      input.off('keypress',key);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if(error)reject(error);else resolve(value);
    };
    function key(character,meta){
      if(meta?.ctrl&&meta.name==='c')return stop(new Error('CANCELLED'));
      if(meta?.name==='return'||meta?.name==='enter')return stop();
      if(meta?.name==='backspace'){value=value.slice(0,-1);return;}
      if(character && !meta?.ctrl && !meta?.meta && character>=' ' && value.length<512)value+=character;
    }
    input.on('keypress',key);
  });
}
async function main(){
  if(!process.stdin.isTTY)throw new Error('Run this script manually on a trusted computer terminal');
  const first=await hidden('Senha SSX (min. 16 caracteres, entrada oculta): ');
  if(first.length<16 || first.length>512)throw new Error('Password must have between 16 and 512 characters');
  const confirm=await hidden('Confirme a senha (entrada oculta): ');
  const x=Buffer.from(first),y=Buffer.from(confirm);
  if(x.length!==y.length || !crypto.timingSafeEqual(x,y))throw new Error('Passwords do not match');
  const salt=crypto.randomBytes(16),hash=crypto.scryptSync(first,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  const key=crypto.randomBytes(48).toString('hex');
  console.log('\nCopie somente os valores seguintes para Environment Variables do Render:');
  console.log('SSX_SITE_ADMIN_PASSWORD_HASH=scrypt$'+salt.toString('hex')+'$'+hash.toString('hex'));
  console.log('SSX_SITE_ADMIN_SESSION_KEY='+key);
  console.log('\nConfigure separadamente SSX_SITE_ADMIN_EMAIL e SSX_PUBLIC_BRIDGE_URL.');
  console.log('Não armazene estes valores em GitHub, HTML, logs ou capturas de tela.');
}
main().catch(e=>fail('Falha ao gerar credenciais: '+(e.message||'UNKNOWN_ERROR')));
