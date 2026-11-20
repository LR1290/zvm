# SSX 2012 — R109 · Live Sync + administrador isolado

**Status:** branch isolada, sem merge/deploy. Não modifica Google Sheets, Discord, nem licenciamento ZVM.

## Diagnóstico

- `live.enabled=true` com `live.configured=false` e `bridgeVersion=0` não significa conexão ativa.
- Um link `docs.google.com/spreadsheets/d/...` é **uma planilha**, não um Apps Script.
- A fonte pública precisa responder `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=ping` com `ok:true` e `version:8`.
- Não declare sucesso de Live Sync sem `lastSuccess`, revisão, e dados legítimos carregados da fonte pública.

## Layout das rotas

| Caminho | Controle |
|---|---|
| `/hobbies/ssx/ssx2012` | Rankings e fontes públicas, sem painel/moderação administrativa |
| `/hobbies/ssx/ssx2012-alpine-v37-preview` | Igual ao conteúdo público, também sem painéis administrativos |
| `/hobbies/ssx/ssx2012/admin/login` | Formulário de e-mail e senha, sem vínculo com login comercial da ZVM |
| `/hobbies/ssx/ssx2012/admin` | Painel administrativo independente, sem JavaScript, com logout e teste de saúde do Bridge |
| `/hobbies/ssx/ssx2012/admin/editor` | Editor completo legado, protegido por cookie e CSP de origem opaca |
| `/hobbies/ssx/ssx2012/admin/bridge-health` | Ping do Apps Script em HTTPS realizado pelo servidor, sem escrita |
| `/hobbies/ssx/ssx2012/admin/archive` | HTML v36 original completo, somente após autenticação |
| `/hobbies/ssx/ssx2012-v36` | Redirecionamento ao arquivo autenticado |

A sessão expira em até oito horas. Cookie HttpOnly, Secure, SameSite Strict. Segredo HMAC e hash de senha são lidos exclusivamente do servidor.

## Requisitos antes do primeiro deploy

1. O proprietário da planilha instala/atualiza o Apps Script Bridge v8 **na conta oficial**; não alterar a planilha pelo HTML. Preservar `WEB_SUBMISSIONS`, `WEB_ADMIN_LOG`, `DISCORD_RIDER_MAP` e rankings.
2. Verificar a versão da URL `/exec?action=ping`; se não responder `version:8`, não prosseguir.
3. No ambiente do **serviço principal** Render configure:
   - `SSX_PUBLIC_BRIDGE_URL`: URL `https://script.google.com/macros/s/.../exec`, sem query string.
   - `SSX_SITE_ADMIN_EMAIL`: e-mail do administrador.
   - `SSX_SITE_ADMIN_PASSWORD_HASH`: valor `scrypt$<salt hexadecimal>$<hash hexadecimal>`.
   - `SSX_SITE_ADMIN_SESSION_KEY`: chave secreta exclusiva com pelo menos 32 bytes.
4. Gere a senha/segredo em terminal confiável: `node tools/ssx-admin-credentials.cjs`. O script pergunta a senha sem ecoar. Não enviar senha nem segredo pelo chat, commit ou captura.
5. Verifique em pré-produção, com Chromium real e testes de autorização, antes de qualquer deploy manual. Não alterar a configuração principal Render sem janela de manutenção definida.

## Requisitos de homologação

- Anônimo recebe 303 na administração e no arquivo v36.
- HTML público não contém formulários completos ou botões de moderação ativos.
- Login incorreto não gera sessão; POST cross-origin recusado; cookies forjados recusados.
- Login correto abre o painel, o editor só funciona depois da autenticação, `logout` deve limpar o cookie no navegador.
- Verificação de saúde usa somente `action=ping`, exige Bridge v8 ou superior, segue redirecionamento HTTPS apenas entre `script.google.com` e `script.googleusercontent.com` e limita resposta a 32 KiB.
- O editor legado foi mantido isolado por CSP (origem opaca). Sua configuração de sessão pode não persistir entre acessos; o painel principal é a interface administrativa estável.
- Live Sync com URL validada; snapshot offline continua exibido diante de falha.
- Revisões da planilha devem atualizar o público sem escrever, revisar ou alterar valores não autorizados.
- Chromium desktop/mobile sem regressão de navegação.
- Não misturar credenciais ZVM, Discord e SSX; nunca escrever token administrativo nos assets do navegador.

**Limitação:** a existência de `SSX_PUBLIC_BRIDGE_URL` não implanta o Apps Script. Se o Bridge não estiver publicado e funcional, o Live Sync permanece offline apesar do código correto.

## Compatibilidade Chromium: POST de formulário

A página de login e o painel de saída usam `Referrer-Policy: same-origin`. A política anterior `no-referrer` fazia Chromium enviar `Origin: null` em formulários POST mesmo para o próprio host, que era recusado pelo controle contra CSRF. `same-origin` preserva o cabeçalho para o login/logout local sem enviar `Referer` em requisições para origens externas. Não aceitar `Origin: null` nos endpoints administrativos.

Os documentos de rankings e editor legado permanecem em sandbox de origem opaca. Para administrar, abrir diretamente a URL `/hobbies/ssx/ssx2012/admin/login` em uma aba própria. O próprio login e dashboard não carregam scripts remotos.
