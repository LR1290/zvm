# ZVM Automações LITE — homologação V4 independente

**Estado:** PR de engenharia, sem deploy e sem liberação comercial.

## Segurança e protocolo

A LITE usa exclusivamente /extension/lite/v4/session/key, /login, /refresh e /logout.
O servidor exige o registro Mongo com extensionProductId=zvm_lite, plano LITE_*,
ID Chrome exclusivo e descritor de build assinado por Ed25519 independente.

O descritor enviado como signedBuild contém payload e signatureBase64.
O payload contém, nesta ordem: schema, audience, productId, channel, extensionId,
buildId, sha256, keyId, issuedAt, expiresAt.
Valores fixos: schema=zvm-lite-build-v1, audience=zvm-lite-v4-server,
productId=zvm_lite, channel=dev. Validade máxima: sete dias.
A chave pública Ed25519 configurada no servidor valida a assinatura; o servidor
não aceita chaves públicas enviadas pelo cliente.
O clientSecurity exige protocolo 2, DEV, identidade Chrome, versão, buildId,
fingerprint, installationId UUID, requestId único e timestamp recente.
O requestId é consumido no registro Mongo antes de reservar número de telefone.
O token V4 é opaco; apenas seu SHA-256 é persistido no banco.

O entitlement LITE tem productId=zvm_lite, sem CRM, IA ou integrações Meta,
hash de backup próprio e validade de sessão até 12 horas (ou até o atestado
expirar, o que ocorrer primeiro). No refresh são revalidados produto, signer,
build, instalação e licença. Sessões históricas sem produto permanecem da
edição completa. Um token LITE não funciona nas rotas da ZVM completa.

## Provisionar identidade exclusiva, somente no computador do proprietário

Com Node.js instalado, executar fora da árvore de origem:

    node tools/lite-provision-dev.js --out "D:\ZVM-SEGREDOS-LITE"

O script gera duas identidades distintas:
- chave RSA 3072 para assinar o CRX3 Chrome e determinar o ID da extensão LITE;
- chave Ed25519 para assinar exclusivamente os descritores de build LITE.

Nunca enviar arquivos *private.pem ao GitHub, Render, clientes, chats, ZIPs de
instalação ou backups públicos. Aplicar ACL restritiva no Windows.
O script recusa pasta existente não vazia, evitando trocar chaves acidentalmente.
Apenas os artefatos -PUBLIC.json e -PUBLIC.txt são compartilháveis.
Preservar a mesma chave RSA para o ID da extensão não mudar.

## Variáveis no servidor (apenas valores públicos)

    ZVM_LITE_V4_ENABLED=false
    ZVM_LITE_DEV_EXTENSION_ID=<id_do_crx_assinado>
    ZVM_LITE_DEV_KEY_ID=<id_do_signer_ed25519>
    ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64=<spki_publica>
    ZVM_LITE_DEV_BUILD_ID=<build_conferido>
    ZVM_LITE_DEV_BUILD_SHA256=<sha256_conferido>
    ZVM_LITE_DEV_VERSION=<versao_do_manifest>

Deixar o sinalizador em false até concluir todas as etapas. Não adicionar o ID
LITE à allowlist ZVM_EXTENSION_IDS da edição completa.

## Emissão administrativa

Selecionar o produto no Admin antes de gerar key. LITE gera key zv2l- com 256
bits de aleatoriedade e nasce inativa, plano LITE_DEV. Somente depois de signer
e build próprios configurados o Admin permite Liberar. A key completa nunca
ativa a LITE. Renovações pendentes e vendas da Cakto da edição completa não
podem associar uma key LITE.

## Bloqueios de homologação

A fonte LITE R40 localizada na Biblioteca tem installationAllowed=false e
lite-dev-identity.js ainda sem ID ou chave pública. Seu adaptador precisa ser
atualizado para o novo endpoint e para transmitir signedBuild/clientSecurity
sem recorrer à edição completa. O ZIP R40 é uma prévia unpacked, não CRX3.
Nenhuma chave privada oficial nem build com digest aprovado foi criada neste PR.

O Chromium deste ambiente possui política administrativa
ExtensionInstallBlocklist=["*"]. Não contornar. A instalação MV3 e o teste com
WhatsApp autenticado precisam ocorrer em Chrome/Opera autorizado pelo usuário.

Assinatura de descritor não prova sozinha os bytes efetivamente instalados no
navegador. Header Origin pode ser forjado por clientes fora do navegador; não
constitui autenticação criptográfica isoladamente.

## QA e publicação

O CI específico verifica configuração fail-closed, Ed25519, cross-product,
entitlement e integridade da interface Admin sem credenciais de produção.
Os testes gerais da base têm falhas preexistentes de Privacidade/UX móvel
que não devem ser ocultadas ou resolvidas com mudanças de escopo.

Nenhum deploy, merge, modificação de produção ou ativação de licenças reais
deve ocorrer sem homologação, auditoria e ordem explícita do proprietário.
