# ZVM Visual System R4 — 2026-09-02

## Direção de arte
A referência principal desta rodada é o login da extensão ZVM no WhatsApp Web: divisão visual entre uma área de marca/contexto e uma área de ação, superfícies muito escuras, verde ZVM como foco, contraste alto, bordas discretas e pouca ornamentação gratuita.

A intenção não é copiar literalmente a mesma tela em todas as páginas. O servidor passa a compartilhar a mesma linguagem visual, enquanto cada área mantém sua função:

- autenticação: split-screen semelhante à extensão;
- portal do cliente: rail lateral + conteúdo principal, usando a mesma iluminação e superfícies;
- páginas públicas: mesma paleta, nav, cartões e contraste;
- admin: estrutura existente preservada, com acabamento visual atualizado;
- login administrativo: modernizado para a mesma linguagem do ecossistema.

## Alterações executadas

### Login do Cliente
- Removida a aparência de card genérico centralizado.
- Layout desktop em duas áreas, inspirado na extensão.
- Painel esquerdo com gradiente verde profundo e explicação do ecossistema.
- Painel direito com marca ZVM, título, selo de acesso protegido e formulário limpo.
- Inputs e CTAs reestilizados para a mesma densidade do login da extensão.
- Navegação/rodapé ficam fora do foco visual nas telas imersivas de autenticação.

### Cadastro
- Mesma linguagem do login.
- Nome + WhatsApp em linha dupla no desktop.
- Senha + confirmação em linha dupla no desktop.
- E-mail e chave recebem mais espaço e explicação curta.
- Responsivo volta para uma coluna em telas pequenas.
- Nenhum `name` de campo ou endpoint foi alterado.

### Portal do Cliente
- Sidebar preservada, mas transformada em uma rail visual integrada ao fundo.
- Removida a sensação de logo duplicada no cabeçalho principal.
- Cabeçalho principal agora comunica claramente "Minha ZVM / Visão geral".
- Cards recebem superfícies, bordas e raio coerentes com a extensão.
- Update banner, licença, resumo, countdown e ações foram harmonizados.
- Breakpoints revisados para desktop, tablet e mobile.

### Admin
- Estrutura do painel administrativo foi preservada.
- Tabs, sidebar, cards, tabelas e endpoints continuam no mesmo lugar.
- Apenas acabamento visual foi atualizado: superfícies, bordas, raios, densidade e contraste.
- Login administrativo recebeu o mesmo split-screen visual das autenticações ZVM.

### Páginas públicas
- A paleta escura ZVM passa a ser a identidade principal mesmo quando o sistema operacional está configurado em modo claro.
- Navegação, footer e superfícies ficam coerentes com o restante do ecossistema.

## Compatibilidade preservada
- `/cliente/login`
- `/cliente/registro`
- campos do login e cadastro
- formulário/admin `R_ADMIN/login`
- tabs e arquitetura do admin
- `package-lock.json`
- `ZVM_EXTENSION_IDS`
- `admin_audit_logs`
- brand incorporada ao servidor
- remoção do sistema de moderadores

## Build
`2026-09-02-visual-system-r4`

O `/health` deve retornar esse build ID após deploy.

## Sugestões para as próximas rodadas

### P1 — Design system real fora do `server.js`
Hoje muita UI ainda vive como HTML/CSS inline dentro do backend. O próximo salto de manutenção seria separar componentes visuais em arquivos próprios (tokens, componentes, páginas), mantendo o backend responsável pelos dados e rotas. Isso reduz regressões de layout e torna redesigns futuros muito mais seguros.

### P1 — Ícones locais e consistentes
Trocar emojis usados como ícones de interface por um conjunto único de SVGs locais. Isso evita diferenças entre Windows/Chrome/Linux e deixa o produto mais profissional.

### P1 — Gate visual automatizado
Gerar screenshots de login, cadastro, portal e admin a cada release e comparar com a versão anterior. Além do teste de código, isso detecta logo quebrada, overflow, botões sumidos e CSS que voltou para uma versão antiga.

### P2 — Componentes únicos de formulário
Login, cadastro, 2FA, recuperar senha, trocar senha, trocar e-mail e vincular chave ainda compartilham padrões por CSS, mas podem compartilhar também a mesma estrutura de componente.

### P2 — Self-host das fontes
As páginas ainda usam Google Fonts. Hospedar as fontes necessárias junto ao projeto reduz dependência externa e deixa a CSP mais simples e previsível.

### P2 — Portal como shell navegável
A rail do cliente pode evoluir para um shell onde Segurança, Renovações, Licença e Conta abrem dentro do mesmo layout em vez de parecerem páginas independentes.

### P3 — Analytics / áreas legadas
Aplicar o mesmo design system às telas de Analytics e revisar visualmente os caminhos WSM legados de forma isolada, sem misturar funcionalidade antiga com a ZVM moderna.
