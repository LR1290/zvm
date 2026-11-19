# ZVM Automações LITE — R71: Envios autenticados e integridade da Agenda

**Data de referência:** 18/11/2026 (America/Sao_Paulo)  
**Origem:** `ZVM_LITE_R70_FONTE_LAB_NAO_INSTALAR.zip`  
**Estado:** **LAB / NÃO INSTALAR / NÃO HOMOLOGADA**. A fonte resultante foi auditada localmente; não é uma CRX3 ou DEV assinada.

## 1. Escopo concluído

A R71 é uma correção localizada em Envios, Agenda e no resumo legado da Shell. Não migra os motores de envio, não aciona qualquer destinatário, não simula paridade comercial com ZapVoice e não altera o servidor. A R51 permanece a última DEV assinada configurada para a homologação no Render.

### Envios — isolamento de conta e aba (P0)

**Antes (R70):** `app/dashboard/lite/sends.js` lia os três registros pela fachada `shell.storageValue()`, sem confirmar explicitamente a mesma geração, escopo de conta e aba WhatsApp antes e depois da leitura. Um snapshot antigo permanecia visível após erro de atualização ou invalidação de sessão em alguns caminhos.

**Agora (R71):** a consulta exige `ExtensionStorage.getMany`, `assertContextCurrent()`, `accountScopeId()` e `shell.resolveWhatsAppTab()`. A leitura é **um lote único de três chaves**, seguido da validação da mesma geração/contexto, escopo do armazenamento e ligação ao WhatsApp. Ausência ou mudança de autoridade falha de forma fechada, sem recorrer a armazenamento local genérico. O estado anterior é retirado imediatamente durante a atualização ou quando a aba/conta/sessão é invalidada. A leitura é limitada a oito segundos; resultados tardios ou de uma tela desmontada são ignorados. Mantida a visualização **somente leitura** sem criar/cancelar/pausar qualquer envio.

Observação: a ausência legítima de um registro ainda pode resultar em zero após contexto/conta terem sido comprovados; erros de leitura ou conteúdo malformado não podem ser convertidos em zero silencioso.

### Agenda — não transformar corrupção em vazio (P0)

**Antes:** `app/content/features/agenda/engine.js` e `app/dashboard/features/agenda/runtime.js` convertiam `list` e `missedHistory` inválidos em `[]`. Além disso, o painel poderia tratar uma exceção de leitura como `schedules=[]` e desenhar contagens zero.

**Agora:** campos persistidos presentes com tipo inválido causam `AGENDA_STORE_CORRUPT`; os campos ausentes em registros antigos seguem compatíveis. O motor recusa processar ou sobrescrever o store até que o problema seja resolvido pela autoridade apropriada. No painel, a falha oculta registros antigos, apresenta aviso de indisponibilidade sem falso zero, impede a abertura do formulário de novo agendamento e bloqueia o controle de criação. Uma leitura posterior válida restaura os controles. A tela de preferências não aborta toda a renderização quando o store está corrompido.

**Limitação:** o teste verificou guarda do motor com dados sintéticos; não usou mensagens, horários e contas reais. A autoridade de mutação em background não foi alterada. Não está demonstrada a completa confiabilidade da Agenda em produção.

### Shell — resíduos de módulos excluídos

- Removidas do resumo herdado as leituras de `EXTUI:extappFollowUpStore` e `EXTUI:extappWebhookStore`.
- Excluído Follow-up da contagem de automações e do painel técnico legado; o quadro de Funis não o apresenta mais como função LITE.
- Não se promoveu o painel Nerd/CRM da versão completa à UX da LITE. As superfícies já isoladas das versões anteriores continuam intactas.

## 2. Testes executados

| Verificação | Resultado | Escopo |
|---|---|---|
| `node --check` | **249/249** | Scripts JS/MJS/CJS em fonte final |
| Análise CSS | **11/11** | CSS sintaticamente parseável |
| Manifesto | **83/83** referências | Existência física, **não** assinatura |
| Páginas HTML | Dashboard 65; Disparos 32; Popup 9; Offscreen 7 | Caminhos internos presentes |
| Contratos herdados R67 | **25/25** | Catálogo, bloqueios de produto, destinos e identidade |
| Envios em Chromium | **8 cenários aprovados**, 0 page errors | Lote de 3 stores, conta/aba, geração, falha de storage, dado inválido, troca de escopo, logout |
| Motor Agenda em Node VM | **8 casos**, 0 mutações | Ausência, compatibilidade, corrupção de tipos, JSON malformado |
| Interface Agenda em Chromium | **2 cenários aprovados**, 0 page errors | Falha fechada e recuperação posterior com store válido |
| WhatsApp Web com extensão MV3 | **Não executado** | Política de Chromium LAB impede instalação, não contornar |
| Envio/pausa/cancelamento real | **Não executado** | Não enviar sem sessão autorizada e critérios de homologação |

## 3. Comparação por bytes

- R70: **282 arquivos de fonte**.
- R71: **282 arquivos de fonte**, sem arquivos adicionados/removidos.
- Alterados (6):
  - `app/content/features/agenda/engine.js`
  - `app/dashboard/features/agenda/runtime.js`
  - `app/dashboard/lite/lite-operations.css`
  - `app/dashboard/lite/sends.js`
  - `app/dashboard/shell/extensions.js`
  - `manifest.json` (rótulo **R71 LAB NÃO INSTALAR**, sem inventar número de release assinado).

**Pacote:** `ZVM_LITE_R71_FONTE_LAB_NAO_INSTALAR.zip`, **3.412.579 bytes**, SHA256 `6fc9c0d5e51848f5d70954fb5ad4f3ad73d2d9cfb1cc3e65fef03a7891e46302`. **283 entradas**, CRC válido (282 arquivos runtime + aviso de não instalar).

**Diff:** `ZVM_LITE_R71_PATCH_R70_PARA_R71_NAO_INSTALAR.diff`, **24.267 bytes**, SHA256 `440a392b8b3b155ba2429535ca5810c05db406caaee19ec2228a89f4747e96e5`.

## 4. Integridade e governança

- `app/security/integrity.json`, `build-identity.json` e `lite-v4-signed-build.json` **não foram regenerados**. O artefato R71 continua intencionalmente inelegível para instalação; contém identidade de segurança obsoleta da R51.
- Nenhuma chave privada, PEM, P12, PFX, `.env` ou cofre foi adicionada.
- Nenhum deploy, alteração de licença, manipulação de MongoDB, Cakto, WPPConnect, produção ou CWS. O PR isolado permanece em DRAFT.
- O visual da LITE não voltou a copiar a Shell da edição completa; a compatibilidade residual de componentes segue pendente.

## 5. Gates

- **G0 custódia**: PASS.
- **G1 organização de recursos**: PARCIAL.
- **G2 comportamento equivalente à ZapVoice**: NÃO COMPROVADO / FAIL.
- **G3 UI/UX independente**: PARCIAL — CSS de compatibilidade e editores antigos ainda remanescentes.
- **G4 segurança e isolamento**: regressões locais PASS; MV3 real PENDENTE.
- **G5 WhatsApp autenticado**: BLOQUEADO na infraestrutura atual.
- **G6 acessibilidade**: PARCIAL.
- **G7 assinatura/staging**: NÃO ALTERADO (R51 permanece válida no staging).
- **G8 publicação**: REPROVADO.

## 6. Próximas etapas recomendadas

1. Validar os formatos e transições reais das filas sob sessão WhatsApp autorizada e garantir que Envios tenha estados operacionais equivalentes à ZapVoice sem permitir comando indevido.
2. Homologar criação, cancelamento, persistência, reabertura e recorrência da Agenda com conta de teste consentida, com foco em mensagens de confirmação tardias.
3. Separar a UI dos editores de Fluxos e Funis do CSS remanescente da ZVM completa; manter funcionamento e estruturas de dados.
4. Verificar ZapSaver, Backup, Gatilhos e controles por módulo com a matriz do Prompt Mestre R67.
5. Apenas após os gates: reemitir assinatura RSA/Ed25519, manifesto de integridade novo, homologar o pacote no Chrome autorizado e atualizar o Render de homologação — sem deploy automático à produção.