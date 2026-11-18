# ZVM LITE R59 — homologação isolada e primeira licença DEV real
Data: 18/11/2026 (UTC). Origem: PR #124 / R58 (servidor), extensão LITE R45 (Biblioteca).
Estado: servidor de homologação implantado, primeira licença LITE emitida/ativada no banco isolado. **Login MV3/WhatsApp real ainda não homologado**.

## Ambiente
- GitHub: `mythos52/zvm`, branch `feature/zvm-lite-key-v2-isolado-20261118`; PR #124 permanece DRAFT, sem merge na main.
- Render: `zvm-lite-homolog-20261118`, serviço gratuito `srv-dbv1sf8u01pc73cig79g`, URL `https://zvm-lite-homolog-20261118.onrender.com`, deploy automático OFF.
- Último deploy confirmado live: `dep-dbv1uj5g1s2s73duaelg` (base R58, código do backend da PR).
- MongoDB Atlas: projeto `69b1b463733b2a2b4040eb47`, Cluster0 já existente, banco exclusivo `zvm_lite_staging_20261118`, usuário `zvm_lite_staging_rw_20261118` com `readWrite` apenas nessa base. **Bancos comerciais não modificados**.
- `ZVM_RUNTIME_ENV=staging`; `ZVM_BUILD_ENFORCE=1`; `ZVM_SALES_PAUSED=1`; `ZVM_LITE_V4_ENABLED=true` só no staging. Sem Cakto, Meta, clientes reais, merge ou alteração do `zvm.onrender.com`.

## LITE DEV R46 — integridade
- Fonte: runtime da R45 preservado; as únicas modificações de alvo relevantes foram `manifest.host_permissions` e a classificação CSP do ambiente de staging; identidade `lite-edition` atualizada para R46.
- Versão `0.1.46`, ID Chrome `ongildapieobgiamfjgnnnpelbeamfbk` (RSA 3072 estável desta linha).
- BuildId `zvm-lite-dev-0.1.46-sa1e978746fc3`.
- Fingerprint do runtime `7500e7da86069ddeed32f305cb4ca378108b95502172d1650f7773691cd74f45`.
- Chave Ed25519 de descritor exclusiva da LITE e chave pública SPKI configuradas no Render (sem divulgar a chave privada).
- Assinatura R46 válida até `2026-11-24T21:57:25.969Z`; após isso, nova build/atestado necessária.
- `ZVM-LITE-DEV-R46-HOMOLOGACAO.crx`: 3.451.453 bytes, SHA256 `aba59944378e668bdae9b42d540d654125e1fd6560891f78a1db94a8fe247dc2`.
- `ZVM-LITE-DEV-R46-CARREGAR-SEM-COMPACTACAO.zip`: 3.432.230 bytes, SHA256 `821a7d1e4444a74685c1fe5a2e92488ccf672ac57a4bc1ac62993bf8e057cb5c`.
- CRX3, RSA-SHA256, ID, conteúdo do ZIP e 2 assinaturas Ed25519 aprovados por verificador independente. 273/273 arquivos ZIP com CRC válido, 244/244 scripts JS com sintaxe válida.
- Nenhuma chave privada enviada à extensão, ao GitHub ou ao Render. Chaves do proprietário guardadas em cofre AES-256-GCM separado.

## Licença LITE para teste
- Identificador completo não versionado no Git, para evitar divulgar credencial. Prefixo `zv2l-qsj5...` e sufixo `...gyjjdq`.
- Criada exclusivamente no Mongo de staging, via persistência isolada: `active:true`, `extensionProductId:zvm_lite`, `provisioningStatus:issued`, `planId:LITE_DEV`, 1 telefone e prazo de 14 dias a partir da primeira ativação.
- A leitura de volta do documento confirmou os campos, e o bootstrap do Render após a ativação reportou `Chaves: 1`. Isso valida armazenamento/boot **não** o login completo no navegador.
- O servidor ainda exibe literalmente `zapvoice.store` em um log de boot legado, apesar do valor configurado `MONGODB_DB=zvm_lite_staging_20261118`; pendência cosmética de observabilidade, não prova de escrita no banco `zapvoice`. Corrigir em revisão pontual, sem alterar produção.

## Pendências e cautelas
1. A política do Chromium do laboratório bloqueia carregamento da extensão: ao abrir `chrome-extension://<id>/pages/popup/index.html`, retornou `net::ERR_BLOCKED_BY_CLIENT`, com nenhum service worker. Não contornar. Testar MV3/WhatsApp e autenticação ponta a ponta no Chrome/Opera autorizado do proprietário.
2. O teste HTTP POST externo remoto da sessão não foi autorizado pela ferramenta de segurança; portanto **não afirmar** login comprovado.
3. O Atlas tem regra de rede pré-existente `0.0.0.0/0`; ela NÃO foi criada nem ampliada nesta rodada. Avaliar restrição em auditoria isolada sem afetar outros usuários/serviços.
4. Sem controle comercial, instalação automática, deploy automático, merge, alterações em clientes/produção.
5. Credenciais do Admin e chaves privadas da extensão estão apenas no cofre criptografado entregue ao proprietário; **não** incorporar cofre, senhas, chave de licença completa ou PEM privado ao repositório.

Critério de conclusão de homologação: instalar R46 no Chromium/Opera permitido, abrir WhatsApp autenticado, autenticar pela key LITE, validar refresh/logout, revogação, isolamento e recursos LITE, sem envio indevido de mensagens.
