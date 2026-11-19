# ZVM Automações LITE R74 — Importar, revisar, salvar e reabrir

**Status:** LAB, não assinada, não instalar, não homologada. Data 18/11/2026 (Brasil). Base: R73 LAB. A versão R51 segue como última DEV assinada no servidor de homologação; não houve deploy nem alteração de chaves.

## Defeitos corrigidos

- O validador de importação aceitou até 128 etapas, enquanto `funnelInput()` da autoridade real recusa mais de 100. O limite de importação agora é 100, recusando 101 antes de abrir o editor.
- `saveFunnelDefinition()` conferia somente existência do ID após gravar. A R74 compara todo o conteúdo normalizado de passos, macroetapas, automações e gatilhos, exceto carimbos técnicos de tempo. Quando diverge, recusa falso sucesso e não repete gravação automaticamente.
- A tela agora relê os vínculos de Biblioteca e Fluxos antes de salvar, para detectar alterações desde a abertura do editor. Usa `renderIsCurrent` para não completar salvamento em uma tela substituída.
- Falhas de leitura no pré-salvamento têm aviso visível e captura de erro; não produzem rejeição JS sem tratamento nem limpam a edição não salva.

## Testes R74

- Node VM, serializador real e repositório simulado: 7/7 casos (importação sem escrita, roundtrip, limite 100/101, perda de etapa, perda de automação, conflito de revisão, readback ausente).
- Chromium real com DOM sintético, **sem MV3**: upload `.zfunnel`, editor, salvar e reabrir, vínculo da Biblioteca preservado, bloqueio quando item é removido após abrir editor, bloqueio quando leitura falha, zero pageerrors e nenhuma nova escrita nos casos negativos.
- 249/249 JS válidos; 12/12 CSS parseados; 94 referências explícitas de manifesto e 19 HTML verificadas; ZIP 284 entradas CRC válido.
- Nenhum envio, cancelamento, deploy ou modificação comercial.

## Artefatos

- `ZVM_LITE_R74_FONTE_LAB_NAO_INSTALAR.zip` — 3.418.720 bytes, SHA256 `71dadba56e1e0360fa402ee0c66c9f109322819efc1fdb79bbbb9ae1493425eb`.
- `ZVM_LITE_R74_PATCH_R73_PARA_R74_NAO_INSTALAR.diff` — 6.189 bytes, SHA256 `aaf7ee60e1fd8ea3dd29544454f23ae27e003e59eff202b30d9f00ac579cd824`.
- `ZVM_LITE_R74_RELATORIO_FORENSE_PERSISTENCIA_FUNIS.md` — 6.937 bytes, SHA256 `8e49ada4ff535182b52e47614ffc5194aa61fb1091623df6e5a9bdab3a11870a`.

**Alteração de código:** somente `app/dashboard/features/funnels/runtime.js`. Aviso R73 substituído por R74; removido aviso solto redundante do ZIP anterior. O código-fonte não foi assinado ou colocado em produção.

## Gates

G0 integridade estática PASS para fonte LAB; G1/G2 paridade ZapVoice não comprovada; G3/G4 UI independente parcial; G5 MV3/WhatsApp real pendente; G6 regressão Funis passou em simulação; G7 Render/Mongo/licença inalterados; G8 release reprovada.

**Próximos passos:** autoridade real no Chrome com dados de teste, backup/importação/reabertura após reinício, verificação de referências de Fluxos e Biblioteca, paridade funcional e visual ZapVoice. Não iniciar assinatura/dev deploy até os gates correspondentes passarem.