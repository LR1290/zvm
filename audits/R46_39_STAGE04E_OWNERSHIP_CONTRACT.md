# ZVM — R46.39 / Etapa 04E — Contrato único de titularidade (staging)
Data: 2026-10-09. Base protegida: `main` R46.38 (`7b58b35048ea2d107a61893e2de21a5e313028ec`).

## Artefatos adicionados somente à branch audit/r46.39-stability
- `src/portal-license-owner.js` — contrato *não ligado ao runtime*. Usa `portal_users.keyCode` como fonte única de verdade, exige índice único parcial real, usa inserção/atualização atômica sem `findOne` para autorizar titularidade e rejeita index inexistente ou estreito demais.
- `tests/r46-39-portal-license-owner.test.js` — concorrência de duas contas, ausência/erro de índice, rejeição de duplicação, operações sem vínculo, troca de e-mail transacional e rollback simulados.
- `package.json` registra o teste novo no check da branch. Nenhum teste toca dados de clientes.

## Resultados verificáveis
- Implementação equivalente no ambiente local: **23 grupos PASS** no Node v22.16.0 com Mongo simulado; inclui concorrência e rollback.
- Ensaio anterior `R46.39 04D`: **20 verificações do cenário Mongo fictício** e **25 grupos de bloqueio** aprovados no simulador.
- A falta de autorização de staging é bloqueada: a CLI retorna `staging_approval_required` antes de conectar.
- O script de conciliação Cakto sem flag de auditoria é igualmente bloqueado: `cakto_audit_requires_explicit_flag`.

## Riscos que impedem ativação / deploy
- O índice existente `portal_users.keyCode` é **não exclusivo**. Criar o novo índice exige inspeção *read-only* de dados reais para encontrar duplicações/variações de maiúsculas e espaços, resolver conflitos e observar índices legados.
- A troca atual de e-mail usa inserção do novo documento com a mesma chave antes da exclusão do anterior: seria incompatível com índice exclusivo. O contrato experimenta transferência **dentro de transação** e aborta com segurança em caso de conflito; ainda precisa comprovar no MongoDB real se a semântica delete/insert da mesma chave é aceita.
- Atualizar **juntos** registro, vinculação, desvinculação, troca de e-mail, Cakto e limpeza administrativa. Não ativar uma proteção parcial.
- Não configurar nem implantar `src/portal-license-owner.js` na produção antes desses ensaios. O módulo é preparatório, não é correção implantada.
- Depende de MongoDB **staging segregado** com transações, contas e licenças 100% artificiais, teste com Node >=24.20.0, Chromium autenticado e rollback.
- O incidente real de renovação Cakto exige conciliação exclusivamente leitura dos eventos, pagamentos, claims e entitlements. A correção R46.41 remove uma causa reproduzida, não comprova todos os casos.
- Termos R46.40 ainda precisa identificar formalmente o fornecedor (razão social/nome, CPF/CNPJ, endereço de atendimento), conferir checkout/reembolsos com Cakto e obter aprovação jurídica das traduções.

## Resolução
**Não pronto para merge/deploy**. Ao encerrar o preflight R46.39, migrar as rotas e repetir testes em staging. Manter R46.42 candidato separado da branch de auditoria. Main, Render, CWS, env OAuth e licenças reais permanecem intactos.
