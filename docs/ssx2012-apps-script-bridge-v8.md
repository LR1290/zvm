# SSX 2012 — instalar o Google Apps Script Bridge v8

O arquivo de implementação é [Code.gs](../../integrations/ssx2012/apps-script/Code.gs).
O commit no GitHub **não** cria automaticamente uma implantação no Google Apps Script.

## Instalação controlada

1. Abra a planilha **GLOBAL SSX 2012 TT SHEET 2026** na conta Google que possui permissão para o arquivo.
2. Em **Extensões > Apps Script**, adicione o conteúdo de `Code.gs` ao projeto associado à planilha. Não apague outros scripts existentes sem revisar dependências.
3. Opcionalmente, defina `SPREADSHEET_ID` nas propriedades do script. O Bridge verifica que o ID corresponde a `1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I`.
4. Em **Implantar > Nova implantação > Aplicativo da Web**, escolha a conta executora com acesso à planilha e o público de leitura adequado ao site. **Nunca** coloque tokens de moderação ou credenciais administrativas nesse aplicativo público.
5. Copie a URL real `https://script.google.com/macros/s/.../exec`.
6. Teste `/exec?action=ping`. Aceite apenas JSON contendo `ok:true`, `version:8`, `readOnly:true`.
7. Teste `/exec?action=manifest` e `/exec?action=region&region=ALPS&startRow=1&limit=100` para validar os dados. Siga `data.nextRow` para consultar as demais páginas. As abas regionais atuais possuem mais de 800 linhas.
8. No serviço Render que hospeda a ZVM, defina `SSX_PUBLIC_BRIDGE_URL` com a URL `/exec`, **sem query string**. Reinicie/reimplante o serviço com configuração revisada.
9. Após implantação, abra `/hobbies/ssx/ssx2012/admin/bridge-health` autenticado e verifique status 200.
10. Execute `node --test tests/ssx2012-apps-script-bridge.test.cjs` no checkout e teste carregamento dos rankings públicos comparando com o snapshot local. Não declare Live Sync concluído sem confirmar o protocolo de leitura efetivamente consumido pelo frontend.

## Limites desta versão

- `GET action=ping`: valida acesso à **planilha correta**.
- `GET action=manifest`: enumera as regiões suportadas.
- `GET action=region&region=...&startRow=1&limit=100`: devolve os valores exibidos de uma página de até 100 linhas e das primeiras 19 colunas da aba solicitada; `data.nextRow` permite percorrer todas as linhas. Aceita somente as 11 abas regionais oficiais.
- `POST`: retorna `WRITE_DISABLED` sem mutações.
- O frontend existente pode exigir uma estrutura de payload de sincronização diferente. A implantação e o ping sozinhos **não comprovam** a atualização de recordes.
- Não são criadas ou alteradas as abas de moderação, rankings, Discord ou logs.
- Não publicar esta API se qualquer uma das 19 primeiras colunas das regiões contiver dados privados. Revisar os dados antes de habilitar acesso público.

## Diagnóstico

Se `ping` retornar `OFFICIAL_SPREADSHEET_NOT_CONNECTED`, verifique que o script foi associado à planilha oficial ou que `SPREADSHEET_ID` está correto. Se `ping` retornar outro erro, verifique a autorização e execução do Apps Script.

A autenticação da central administrativa da ZVM/SSX continua separada. O Bridge público é **somente leitura**. A moderação deverá utilizar outro canal autenticado e auditado; não passar credenciais em query string, HTML ou JavaScript público.
