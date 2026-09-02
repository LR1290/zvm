# ZVM Admin Redesign — 2026-09-02

## Objetivo
Reestruturar o painel administrativo após rollback, aproximando o visual da linguagem dos painéis de login/cliente da ZVM e criando uma área lateral premium com foco em segurança, renovações e visão rápida da operação.

## O que foi alterado

### 1) Novo layout lateral premium
- Sidebar administrativa expandida e fixa, deixando de depender do hover estreito.
- Bloco de identidade "ZVM Admin" com apresentação premium.
- Cards laterais com visão rápida de:
  - segurança / suspeitas;
  - chaves bloqueadas;
  - renovações expiradas;
  - renovações próximas;
  - usuários do portal;
  - chaves ativas.
- Atalhos rápidos para:
  - aba de usuários;
  - aba de segurança;
  - execução de auditoria.

### 2) Hero principal no conteúdo
- Novo cabeçalho visual dentro do dashboard, alinhado ao estilo premium da ZVM.
- Métricas rápidas em destaque:
  - usuários do portal;
  - chaves ativas;
  - expiradas;
  - suspeitas.

### 3) Sincronização dinâmica dos novos cards
- `doRefresh()` agora atualiza também os contadores do painel lateral e do hero.
- `renderUsersTable()` atualiza badges e também os contadores de usuários do painel lateral e hero.

### 4) Recuperação da marca principal sem depender de `/static`
- `renderStandaloneBrand()` foi alterado para usar marca embutida via data URL.
- Isso ajuda a evitar nova quebra visual de branding em rollback incompleto de assets estáticos.

## Arquivo principal alterado
- `server.js`

## Compatibilidade
- Mantidos os endpoints e a lógica já existentes.
- Mudança focada em UI/UX do admin e robustez visual da marca.
