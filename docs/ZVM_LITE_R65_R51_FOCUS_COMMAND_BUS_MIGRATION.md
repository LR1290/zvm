# ZVM Automações LITE — Checkpoint forense R65 / DEV R51 (18/11/2026)

**Status:** candidata DEV **assinada, NÃO HOMOLOGADA**; a decisão do proprietário de não aprovar permanece. Sem merge/deploy comercial.

## Base imutável
- Entrada: instalação R50 assinada, arquivos reais de `/mnt/data/zvm_lite_r50_work/ZVM-LITE-DEV-R50-SIGNED-REV2` (271 arquivos); relatório R64.
- Saída: extensão R51 assinada com os **mesmos 271 arquivos** (0 adições/exclusões, 9 alterados incluindo metadados e assinaturas). Preserve a R50 como referência.
- Branch de checkpoint GitHub: `feature/zvm-lite-key-v2-isolado-20261118`, PR DRAFT #124 no repo `mythos52/zvm`. Não atualizar `main`.

## Correções comprovadas
1. **Modo Fácil sem efeito real**: `app/sidebar/workspace-profile.js` calculava `orderedKeys` mas `primary(...)` ignorava o `workspaceState`. Agora modo focado restringe **temporariamente** os atalhos visíveis ao modelo selecionado, respeita a ordem e ocultação manuais, e não grava modificações destrutivas. Modo desfocado e modelo customizado restauram a mesma visualização salva. Separadores não ficam órfãos na projeção focada.
2. **Migração destrutiva legado pré-schema35**: `app/sidebar/storage.js` apagava incondicionalmente as seleções e ordem para qualquer registro anterior a 35. Removido reset geral. Migrações com correspondência exata de factory existentes permanecem; itens proibidos são filtrados pela allowlist. Testada preservação de pinned/order/updatedAt para layout customizado schema34 e atualização factory schema37→38.
3. **Defense in depth do barramento**: `app/sidebar/command-bus.js` agora aplica `__extLiteAuthorityPolicy.allowCommand` em `register`, `has`, `list`, `state` e `execute` (antes e depois do `canExecute`). `sidebar.*` possui whitelist restrita a comandos locais conhecidos. Entradas CRM/Follow-up/IA/Respostas Rápidas são negadas mesmo por registro direto fora do `CommandHost`.
4. **Estado do tray Automações**: `app/sidebar/lifecycle.js` deixou de consultar `followup.open`/funil histórico e deriva os comandos da lista efetivamente permitida no catálogo LITE.
5. Identidade de edição `0.1.51-dev-r51-owner`, versão do manifesto `0.1.51`, assinatura DEV renovada sem modificar o ID do Chrome.

## QA executado SOBRE A PASTA ASSINADA
- Teste R51 focos + migração customizada: **11 assertions PASS** (inclui falha do mesmo teste sobre R50, reproduzindo o defeito original).
- Teste R51 do barramento: **19 assertions diretas PASS**.
- Integração real com `app/sidebar/command-host-adapter.js`: **11 comandos autorizados registrados**, nenhum proibido.
- Regressão R50 de segurança: **231 checks PASS**.
- Regressão de contratos R49 (**25+ checks PASS**) e de migração schema38 (**PASS**).
- Chromium com **DOM sintético**: 8 contratos de Shell/Sidebar PASS, sem page errors. Novos cenários foco ligado/desligado, ordem custom e hidden pins PASS, sem page errors.
- `node --check`: **242 JS/MJS/CJS PASS** no runtime assinado. **99 referências do manifesto presentes**.
- `lite-owner-dev-build.cjs --verify`: integridade dos arquivos, **2 assinaturas Ed25519**, RSA CRX3 assinado e ID Chrome coerente PASS.
- ZIP instalação: **271/271 arquivos CRC OK** e bytes equivalentes à pasta de runtime assinada.
- **Teste real de carga MV3 BLOQUEADO**: Chromium do laboratório retornou `net::ERR_BLOCKED_BY_CLIENT` ao abrir `chrome-extension://ongildapieobgiamfjgnnnpelbeamfbk/pages/popup/index.html`, sem service worker. **Não houve teste real de WhatsApp Web autenticado** e não foi tentado contornar a política.

## Artefatos / identidade
- Chrome ID: `ongildapieobgiamfjgnnnpelbeamfbk` — preservado em R46–R51.
- Versão: `0.1.51`.
- BuildId: `zvm-lite-dev-0.1.51-s8bb553a734c4`.
- Fingerprint: `6ba5119bedd29fdf9cff37ce32d0817003a53dde5a83064710bfb2f85f270f8a`.
- Assinatura DEV expira em: `2026-11-24T23:22:55.904Z`.
- CRX3: `ZVM-LITE-DEV-R51-FOCO-SIDEBAR-SEGURANCA-ASSINADA.crx`; 3431069 bytes; SHA256 `d35f40bb8a9b7cb791d6139512972b58e6ef11b13f0a137edb78e8873071717a`.
- ZIP: `ZVM-LITE-DEV-R51-FOCO-SIDEBAR-SEGURANCA-INSTALAR.zip`; 3412047 bytes; SHA256 `fee8119b4df10daff64841c212a61684b87e874e6ea9ea3c5d3e34fdfdc8d92b`.
- Diff reconstituível da R50: `ZVM_LITE_R51_PATCH_R50_PARA_R51.diff`; SHA256 `8d38ae2d100809f74c64a0db9d91573220a50dd10c802ef96f2a69b80793692e`.
- Nenhuma chave PEM, `.key`, `.p12` ou cofre privado nos runtimes finais; pasta temporária privada usada para assinar eliminada.

## Servidor / MongoDB
- Render **somente staging**: `srv-dbv1sf8u01pc73cig79g`, URL `https://zvm-lite-homolog-20261118.onrender.com`.
- Variáveis `ZVM_LITE_DEV_VERSION=0.1.51`, `ZVM_LITE_DEV_BUILD_ID` e fingerprint ajustadas. Deploy `dep-dbv373mtlv9c73flv3m0` confirmado `live`.
- Mongo Atlas: `zvm_lite_staging_20261118` — chave LITE pré-existente persistida `active:true`, `provisioningStatus:issued`, sem rotação. Data de expiração do registro atualmente `2026-12-02T22:04:45.301Z`; revisão em leitura direta, **não atesta login no browser**.
- Servidor `zvm.onrender.com`, bases comerciais, licença ZVM completa e PR main preservados.

## Pendências obrigatórias
- Teste MV3 com service worker e WhatsApp Web real no Chrome/Opera do proprietário: abertura Shell, Sidebar, Itens Rápidos, permissões e login V4, troca de conversas.
- Validar paridade ZapVoice observável por recurso (Envios, Agenda, ZapSaver, Funis, Fluxos, Gatilhos, Temas e Backup), com dados de teste e sem envio não consentido.
- O servidor continua exigindo assinatura de build. Após `2026-11-24T23:22:55.904Z`, assinar novo pacote e atualizar staging antes de testar.
- **A R51 permanece candidata DEV NÃO APROVADA para produto e publicação comercial.**