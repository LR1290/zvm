# R105 — Preflight e verificador de assinatura público exclusivo QA da ZVM COMPLETA

> **STATUS: CONFIGURAÇÃO DE LABORATÓRIO, SEM SERVIÇO CRIADO, SEM DEPLOY, SEM CONEXÃO MONGODB.**
> Base: PR DRAFT #140 (`lab/r104-offline-delivery`, commit `7cd53e1b16a60a75dc41ffcfd70e5d445b025bf0`). Esta branch é empilhada, não fazer merge automático.

## Causa técnica confirmada

No `server.js` R104, a flag `ZVM_DEV_SIGNED_BUILDS_ALLOW=1` chama `loadDevBuildSigningConfig` de `dev-build-signing.js`. Esse loader exige, também para verificar atestados, **a chave privada Ed25519** e um token de agente. O usuário já determinou que a chave privada deve permanecer *offline* na máquina do proprietário. Colocá-la no Render seria uma regressão de segurança.

Esta rodada acrescenta um **modo público de verificação restrito a QA**, sem alterar por padrão o loader de produção. Com `ZVM_QA_VERIFY_ONLY=1`, a versão de `server.js` adaptada pelo patch `qa-verifier-only.patch` carrega somente a chave pública e mantém o `ZVM_DEV_SIGNING_SERVICE` desabilitado. Assinar continua tarefa do Windows offline. O patch original `lab/signing-r104/qa-only.patch` mantém um acesso de build DEV à identidade Free de teste, sem conceder entitlement PRO.

## O que os arquivos fazem

| Arquivo | Propósito |
| --- | --- |
| `preflight-qa.cjs` | Validação *offline, read-only* de hostname, banco, credenciais declaradas, ID DEV e ausência de segredos comerciais de produção. Não prova que o Atlas existe ou está isolado. Nunca imprime URI, senha, token ou chave. |
| `start-qa.cjs` | Ponto de entrada opcional que recusa iniciar `server.js` se a configuração QA não passar no preflight. |
| `qa-verifier-only.cjs` | Carrega **somente a chave pública** Ed25519 institucional para verificação no servidor QA, sem capacidade de assinatura. |
| `qa-verifier-only.patch` | Aplica a alternativa pública a `server.js` **apenas no checkout de QA**. Não aplicar a `main` ou Render produção. |
| `*.test.cjs` | Testes com dados artificiais: falhas de configuração, identidade, contaminação por segredos e verificação Ed25519 sem chave privada. |

## Configuração proposta (não executada)

**Render:** serviço web **novo** e exclusivo, nome proposto `zvm-completa-qa-r104`, hostname proposto `zvm-completa-qa-r104.onrender.com` (NÃO EXISTE ainda), autobuild/autodeploy **desligados**, branch de QA revisada derivada deste PR e `node 24`. Não atribuir domínio da produção nem usar os serviços existentes da LITE/piloto. A criação e qualquer deploy exigem autorização específica do proprietário.

**MongoDB Atlas:** projeto/cluster **distintos** do Project 0 e das bases comerciais, configuração `MONGODB_DB=zvm_completa_qa_r103`, usuário `zvm_completa_qa_runner` com **readWrite restrito somente a esse banco**, rede limitada ao executor. A validação local compara valores declarados, mas a prova de isolamento requer consultar o Atlas e confirmar projeto, cluster, hostname, roles e lista de IPs. Não escrever nem criar recurso sem autorização específica. Pode implicar custo de infraestrutura.

**Configuração no serviço novo, apenas após aprovação e provisionamento, usando Secrets do Render (NÃO criar arquivo .env commitado):**

```text
ZVM_QA_SCOPE=zvm-completa-r104
ZVM_QA_PUBLIC_HOSTNAME=zvm-completa-qa-r104.onrender.com
MONGODB_DB=zvm_completa_qa_r103
ZVM_QA_ATLAS_HOST=<HOST_DO_CLUSTER_QA_APROVADO>
MONGODB_URI=<URI_RESTRITA_EXCLUSIVA_QA>
ZVM_QA_FREE_SUBJECT=<HASH_SHA256_CONTA_FREE_QA_VERIFICADA>
ZVM_EXTENSION_IDS=ckbffcbmanboelbihfkhiahgafnimcho
ADMIN_USER=<NOVO_ADMIN_QA>
ADMIN_PASS=<SENHA_EXCLUSIVA_FORTE_QA>
APP_SECRET=<SEGREDO_EXCLUSIVO_QA_32+_CARACTERES>
ZVM_QA_VERIFY_ONLY=1
ZVM_DEV_SIGNED_BUILDS_ALLOW=1
ZVM_DEV_EXTENSION_ID=ckbffcbmanboelbihfkhiahgafnimcho
ZVM_DEV_SIGNING_KEY_ID=dev-2026-01
ZVM_DEV_SIGNING_PUBLIC_KEY_B64=<APENAS_SPKI_PUBLICA_BASE64>
```

**PROIBIDO NO QA:** `ZVM_DEV_SIGNING_PRIVATE_KEY_B64`, `ZVM_DEV_BUILD_AGENT_TOKEN_SHA256` e chaves privadas/tokens reais de produção, `CAKTO_WEBHOOK_SECRET`, segredos Cakto/Meta. Não copiar o grupo inteiro de variáveis da Render de produção. O pré-flight recusará algumas dessas contaminações.

**Procedimento a aplicar no checkout QA, após autorização de provisionamento:**

```sh
# Antes de qualquer deploy, aplicar apenas na branch destinada ao novo serviço:
git apply --check lab/signing-r104/qa-only.patch
git apply lab/signing-r104/qa-only.patch
git apply --check lab/qa-completa-r104/qa-verifier-only.patch
git apply lab/qa-completa-r104/qa-verifier-only.patch
node --test lab/qa-completa-r104/*.test.cjs
node --test lab/signing-r104/qa-free.test.cjs
node --check server.js
node lab/qa-completa-r104/preflight-qa.cjs
# A aprovação de serviço, de segredos isolados e de banco precisa ocorrer antes de iniciar server.js.
```

**Início seguro (somente serviço QA aprovado):** `node lab/qa-completa-r104/start-qa.cjs`.

## Três gates de aceite, independentes

1. **Assinatura:** usar `Assinar.cmd` no Windows, com chave privada offline, hostname QA aprovado, sem alterar produção. Conferir assinatura, SHA-256, ID, fingerprint e validade da build R104-QA. O backend QA **só necessita da chave pública**.
2. **Build authority:** serviço QA deve aceitar a assinatura com chave pública `dev-2026-01`, extensão DEV correta, atestado vigente e build reconhecida. Provar por login V4 e refresh reais, sem desabilitar integridade ou ocultar falhas.
3. **Entitlement:** Free mantém cotas e capacidades Free (não pode `disparos.execute`). PRO QA deve ser emitida **via Admin oficial no ambiente QA**, com acesso DEV, 1 dispositivo, validade curta, sem reutilizar chaves reais; testar capacidades com destinatário consentido.

**QA real ainda pendente:** Chrome MV3 instalado em perfil separado, usuário/WhatsApp consentido, notebook suspenso, serviço worker descarregado, reinício, ACK/reenvio incerto, Free quota real multiprocessos Atlas, Pausar/Cancelar, rollback e restauração de backup. Nada nesta rodada equivale a homologação.

## Proibição operacional

NENHUM merge, alteração de `main`, criação/alteração de serviços Render, conexão/escrita no Atlas ou distribuição de RELEASE. O serviço novo, projeto Atlas e a emissão de KEY requerem autorização específica do proprietário antes de qualquer ação.