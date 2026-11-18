# ZVM LITE R57 — homologação real de MongoDB e chaves (18/11/2026)

**Escopo:** branch isolada feature/zvm-lite-key-v2-isolado-20261118 / PR DRAFT #124. Nenhum deploy, merge, emissão comercial, alteração de licenças ou banco de clientes.

## Testes de ponta a ponta no banco (sem produção)
O novo workflow .github/workflows/zvm-lite-mongo-real-r57.yml executa tests/r57-lite-mongo-real.test.js contra um contêiner MongoDB 7.0 descartável no runner, acessível exclusivamente por mongodb://127.0.0.1:27017/. O arquivo de teste rejeita outras URIs e usa um banco temporário zvm_lite_ci_<aleatório>, descartado ao final. Não há segredos, licenças de clientes ou conexões com Render.

A suíte executa:
1. **Emissão administrativa real:** extrai insertNewAdminKeyStrict e mutateAdminKeyRecordStrict do server.js e os executa contra MongoDB real. Uma nova chave zv2l- entra inativa / pendente de assinatura, rejeita colisões e pode passar por CAS de provisioningStatus e active dentro do banco de testes. O teste confirma separadamente que a rota HTTP administrativa exige ZVM_LITE_V4_CONFIG.ready para ativação; a mutação sintética não serve como bypass de produção.
2. **Acesso por produto:** readLiteLicenseSnapshot só aceita 57 caracteres V2L, sem reconhecer chaves V2A ou registros cacheados.
3. **Concorrência real:** duas tentativas paralelas de usar a única vaga de telefone retornam um sucesso e um limite atingido, com um único telefone gravado.
4. **Revogação:** uma licença LITE bloqueada não aceita novos dispositivos, preservando os registros da edição completa.
5. **Titularidade:** índice único parcial em liteKeyCode rejeita uma segunda conta e preserva a estrutura histórica de keyCode.
6. **Sessões:** revogação de vínculo por e-mail remove somente sessões LITE com authMethod=password.
7. **Primeiro uso:** activateLiteDeferredKeyAtomic inicia o prazo da licença apenas após reivindicação real de telefone. Duas ativações concorrentes produzem um único início; chave bloqueada ou telefone não associado são recusados.

## Correções de servidor
- Novo activateLiteDeferredKeyAtomic em src/lite-license-authority.js, com CAS para active, produto LITE, plano, limite, expireDuration, expiresAt:null e telefone persistido. A resposta é relida do Mongo.
- authorizeExtensionKeySession usa esse helper somente quando expectedProductId === zvm_lite; a edição completa mantém sua rotina de ativação antiga.
- Testes em tests/r57-lite-deferred-route.test.js extraem a função real do login V4 para garantir que o helper legado não é invocado na LITE e que erros do banco não concedem acesso.
- Testes específicos de sintaxe, licença e Node permanecem separados da suíte de Mongo real.

## Evidências verificadas
- MongoDB real R57, SHA 69ff9d9df600e154ada0ef1d736b541674b8f693: **PASS** — https://github.com/mythos52/zvm/actions/runs/44388916629
- Licenciamento especializado R57 no mesmo SHA: **PASS** — https://github.com/mythos52/zvm/actions/runs/44388916692
- A CI global segue FAIL em verificações externas de CSS/composição e navegação móvel (rail de 338px). Não foi declarada aprovada.
- Nenhuma instalação MV3 em navegador do usuário foi executada nesta rodada.

## O que falta para ativar uma chave de verdade
- Estabelecer sob custódia do proprietário uma identidade da extensão RSA/CRX3 estável, com assinador Ed25519 e manifesto correspondente. As identidades R43–R45 de laboratório são temporárias e não substituem essa etapa.
- Homologar o mesmo ID, chave pública, fingerprint, versão e build assinada no servidor de staging, habilitando ZVM_LITE_V4_ENABLED somente depois do pinning completo.
- Validar fluxo HTTP real (admin, login por chave, email/senha, refresh e revogação) no navegador autorizado com WhatsApp Web.
- Corrigir/triagar as falhas globais preexistentes e realizar merge/deploy somente após revisão e liberação deliberada, nunca automático.
- A chave textual pré-gerada em chat anterior permanece inativa e não inserida em produção.
