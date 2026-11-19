# ZVM Automações LITE — R62 / Extensão R49 — baseline ZapVoice + barra inferior (18/11/2026)

## Classificação e escopo
**NÃO APROVADA para uso comercial ou paridade total com ZapVoice.** Esta rodada corrige a ausência da barra de itens sob o compositor e os desvios confirmados de navegação. Não é homologação MV3/WhatsApp real.

Fontes preservadas: LITE R48 assinada (mesmo ID Chrome), ZapVoice Chrome Web Store 3.18.19.0 CRX original da Biblioteca (45 arquivos), relatório forense ZapVoice 16/11, e ZVM completa 0.9.287 R65 como referência de adaptador, sem copiar código proprietário da ZapVoice.

## Causas reais
1. A LITE invocava `window.__extFindComposeAnchor()` e `window.__extFindComposeInput()` sem definir nenhuma: a implementação anterior estava no módulo PRO composer-writing-tools.js excluído da edição LITE. Resultado: a barra inferior não localizava o campo de mensagem.
2. `composerCompactShortcutsVisible` vinha desativado por ausência de preferência — apesar de ser um recurso de base ZapVoice.
3. A montagem exigia apenas um layout flex-column, eliminando o compositor em CSS grid.
4. A navegação projetada incluía "Respostas Rápidas" como seção independente da LITE e omitia "Envios" e "Agenda" do catálogo visível, em divergência da referência.
5. Ao atualizar a R48, a configuração factory da Sidebar já persistida em schema 37 manteria os pins obsoletos e ocultaria novos itens mesmo após corrigir o catálogo.

## Mudanças
- Novo `app/content/core/lite-composer-locator.js`: adaptador somente leitura para localizar compositor e input via `ExtensionCore.HostAdapter`, limitado à conversa ativa, ignorando diálogos e elementos da própria extensão. Incluído no manifest imediatamente após dom-adapter.js. Não traz assistente de escrita/PRO.
- `quick-shelf.js`: barra visível por padrão **somente se a sessão de licença está autorizada**, preserva opt-out salvo, pode inserir item irmão após o footer em flex-column ou grid, biblioteca limitada aos tipos autorizados, mantém filtros/favoritos/ações sem envio automático.
- `lite-edition.js`, `lite-authority-policy.js`, `section-identity-catalog.js`, `navigation.js`: retirar Respostas Rápidas da navegação/quick action/política de mutação; restaurar Envios/Agenda, manter Itens e fluxo/funil pelo painel e Biblioteca; renomear menu de exportação para ZapSaver, **sem declarar equivalência funcional ainda não testada**.
- Sidebar `schemaVersion=38`: migra **somente** a ordem factory intacta da R48 `items,quick-response,broadcast,flow,funnel,export` para a nova projeção `activity,flow,agenda,export,broadcast,items`; preferências personalizadas são preservadas, mas pins de módulos removidos são filtrados.
- Resíduo justificado: `panel-quick-response-workspace-core.js` fica como dependência de inicialização de `panels.js`; a superfície autônoma e o acesso/mutação `quick_responses` estão bloqueados. Remoção física depende de refatoração e testes da cadeia genérica; não remover às cegas.
- Build independente com a mesma chave RSA/Ed25519 **pré-existente do proprietário**, sem nova identidade Chrome.

## Evidências da rodada
- `node --check`: **245/245** JS/MJS/CJS do runtime final válidos.
- Teste contrato VM: permissões e catálogo LITE, manifesto, funções referenciadas.
- Teste de migração: schema 37 factory → 38, ordem e pins; preservação de personalização (sem inserir pins que o usuário ocultou).
- Chromium 144, DOM sintético: composer flex-column e CSS grid com item salvo `Saudação de teste` e favorito exibidos abaixo do footer; estados não autorizado e preferência desligada mantêm a barra oculta; zero page errors. **Não é WhatsApp real.**
- Arquivos: 274 entradas CRX3, 274 arquivos runtime; +1 módulo em relação à R48, nenhuma exclusão; 12 arquivos modificados no runtime assinados/integridade.
- Verificador de CRX3 validou assinatura RSA-SHA256, ID Chrome e correspondência exata de 274 arquivos.
- Build `0.1.49`, extension ID `ongildapieobgiamfjgnnnpelbeamfbk`, buildId `zvm-lite-dev-0.1.49-sb0215d42cd02`, fingerprint `92694d85efa2cea3beddb03b52a5607be749db1f1e9cec02bcf2430da33ef71a`.
- CRX3 SHA256 `bc4c39d4faba54086270e6553ece48c69b8cb08af2e51a67a137dced1f13acc9` (3.453.696 bytes).
- ZIP manual SHA256 `d67210dad7fc7c4d9b0a2ee699909c17a4437830f0319f37672c6138945edb97` (3.434.508 bytes), CRC íntegro.
- Assinatura DEV até `2026-11-24T22:47:27.855Z`. Cofre privado reutilizado com identidade conferida e pasta temporária destruída após empacotamento.

## Render / Mongo
- Somente staging `zvm-lite-homolog-20261118` (`srv-dbv1sf8u01pc73cig79g`), variáveis `ZVM_LITE_DEV_BUILD_ID`, `ZVM_LITE_DEV_BUILD_SHA256` e `ZVM_LITE_DEV_VERSION` alteradas para R49, sem substituir outras.
- Deploy `dep-dbv2mhjrjlhs73an0c60` confirmado **live**; servidor base PR #124 continua em DRAFT, sem merge/deploy comercial.
- Key já cadastrada no Mongo `zvm_lite_staging_20261118` preservada; NÃO rotacionar. Nenhuma licença/cliente da ZVM completa alterado.

## Limitações bloqueantes
- Chrome/Opera MV3 e WhatsApp autenticado do proprietário **ainda não testados**: política do Chromium de laboratório bloqueia instalação. Não contornar.
- Não foi comprovada paridade completa com ZapVoice 3.18.19/3.18.27 (edição mais nova não obtida em binário): ZapSaver completo, Agenda, Envios, Disparos, Gatilhos, Temas, Backup, Dashboard, persistência, conteúdo de Biblioteca e retomada de Fluxos/Funis precisam de homologação real.
- Nenhum envio de mensagens, extração de contatos, alteração comercial ou bypass de licença foi realizado.
- Usuário declarou a edição **não aprovada** e esse status permanece até validação funcional explícita.
