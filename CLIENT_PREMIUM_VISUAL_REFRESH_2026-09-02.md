# ZVM — Client Premium Visual Refresh — 2026-09-02

## Escopo corrigido
Esta rodada respeita a correção do pedido: o painel administrativo mantém sua estrutura e navegação; nele foram feitos apenas ajustes visuais de paleta/superfícies. A reestruturação com menu lateral premium foi aplicada ao painel do cliente.

## Painel do cliente
- Novo shell com sidebar esquerda fixa em desktop.
- Sidebar inclui Visão geral, Renovações e planos, Segurança, Licença, Senha, E-mail e Suporte.
- Cards laterais mostram plano atual, status/dispositivos e data de renovação/validade quando disponível.
- Em telas menores, a sidebar se adapta e deixa de ser sticky.
- Cards, hero, botões e superfícies receberam cantos, sombras e contraste alinhados à paleta ZVM.

## Login e cadastro
- Paleta migrada para preto/esverdeado ZVM em vez do roxo-azulado anterior.
- Formulário em card premium com fundo em camadas, borda suave e shadow.
- Inputs e CTA principal receberam acabamento mais consistente com o portal.
- O logo continua incorporado no servidor; não depende de `/static`.

## Admin
- Estrutura do admin preservada.
- Sidebar recolhível/hover, abas, tabela, cards e ações permanecem na mesma organização.
- Apenas paleta, superfícies, bordas e arredondamentos foram modernizados para conversar com o restante da ZVM.

## Lockfile
- `package-lock.json` fornecido pelo usuário incluído na raiz.
- lockfileVersion: 3.
- Dependências e `engines` conferem com `package.json`.
- Dockerfile já usa `npm ci --omit=dev` quando o lockfile existe.

## Identificação de deploy
`/health` agora inclui `build: 2026-09-02-client-premium-ui-r3`.

## Validações
- `node --check server.js`: PASS
- `node --check mailer.js`: PASS
- `package-lock.json` parse: PASS
- dependências package/lock: PASS
- engines package/lock: PASS
- estrutura HTML/JS do admin após `</style>`: idêntica ao checkpoint recovered: PASS

Observação: smoke HTTP completo não foi executado neste ambiente porque as dependências npm não estão instaladas localmente na sandbox. O lockfile foi gerado fora da sandbox e conferido estruturalmente.
