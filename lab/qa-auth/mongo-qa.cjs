// Resolves only the dedicated QA settings. This module never opens a connection.
const database = 'zvm_completa_qa_r103';
function mongoQa(env) {
  const host = env.ZVM_QA_ATLAS_HOST || '';
  if (!/^[a-z0-9-]+\.[a-z0-9]+\.mongodb\.net$/i.test(host)) throw Error('Host Atlas QA obrigatório');
  const uri = new URL(env.ZVM_QA_MONGODB_URI);
  if (uri.protocol !== 'mongodb+srv:' || uri.hostname !== host ||
      uri.pathname !== '/'+database || uri.search || uri.hash ||
      decodeURIComponent(uri.username) !== 'zvm_completa_qa_runner' || !uri.password)
    throw Error('Configuração fora do escopo QA');
  return {MONGODB_URI: uri.href, MONGODB_DB: database};
}
module.exports = {mongoQa};
