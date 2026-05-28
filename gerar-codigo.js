// Gerador de codigo para URL do servidor
// Uso: node gerar-codigo.js https://sua-url.com

function D(s) { return s.split('').reverse().join(''); }
function encode(url) {
  const step1 = D(url);
  const step2 = Buffer.from(step1).toString('base64');
  const step3 = D(step2);
  return step3;
}
function decode(s) {
  const step1 = D(s);
  const step2 = Buffer.from(step1, 'base64').toString('utf8');
  const step3 = D(step2);
  return step3;
}

const url = process.argv[2];
if (!url) {
  console.log('Uso: node gerar-codigo.js https://sua-url.com');
  console.log('');
  console.log('Exemplo:');
  console.log('  node gerar-codigo.js https://zapvoice-api.onrender.com');
  process.exit(1);
}

const encoded = encode(url);
console.log('');
console.log('URL:', url);
console.log('Codigo:', encoded);
console.log('Verificacao:', decode(encoded));
console.log('');
console.log('Adicione esta linha no seu patcher .ps1:');
console.log(`$raw = $raw.Replace('oRHdwNnOv8iehBndvl2Yl1CdlNHdtsWZ51yclJndlJnLv5mcl5GZlJnLj9Wb', '${encoded}')`);
