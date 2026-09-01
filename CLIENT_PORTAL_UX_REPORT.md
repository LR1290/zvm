# ZVM Server — Portal do Cliente UX V2

Data: 2026-09-01  
Escopo: Portal do Cliente do servidor ZVM. Extensão, checkout Cakto, contratos de licença e integrações não foram redesenhados nesta rodada.

## Objetivo

Transformar a área `/cliente` em um painel de autoatendimento mais claro para o cliente final, com prioridade para gerenciamento de números/dispositivos, licença, plano e segurança.

## Refinamentos aplicados

- Navegação compacta por âncoras: Licença, Dispositivos, Segurança e Ajuda.
- CTA de renovação/alteração de plano reduzido para uma faixa contextual, removendo o botão verde excessivamente dominante.
- Gerenciador de dispositivos em largura total, com capacidade da licença, slots usados/livres, barra de ocupação e instruções de troca de número.
- Números brasileiros formatados para leitura (`+55 (DDD) ...`) sem alterar o valor canônico armazenado.
- Cada número virou um card de acesso com estado “Vinculado”, posição do slot e ação explícita “Remover acesso”.
- Remoção ganhou diálogo próprio explicando impacto e reutilização do slot; há fallback nativo caso `<dialog>` não esteja disponível.
- O POST de remoção passa a enviar o telefone exato. O servidor valida se ele ainda pertence à chave e usa o índice apenas como fallback legado, reduzindo risco de remover o item errado se a ordem mudar entre renderização e envio.
- Feedback pós-remoção específico: “Número removido e slot liberado com sucesso.”
- Conta e segurança reorganizadas em ações visuais: senha, e-mail, 2FA e suporte.
- Vincular/trocar/desvincular chave foi movido para “Mais opções da licença”, afastando ações destrutivas do fluxo principal.
- Chave de ativação fica mascarada visualmente e é copiada pelo botão autenticado.
- Estado legado `maxUses = -1` agora aparece como “ZVM Ilimitado”, em vez de “ZVM -1 número(s)”.
- Estados sem chave e sem dispositivos receberam onboarding próprio.
- Layout responsivo e suporte a `prefers-reduced-motion` preservados.

## Referências de UX

A estrutura segue princípios comuns de portais SaaS/CRM de autoatendimento: concentrar assinatura, segurança e gerenciamento de acesso em uma área única, tornar estados e capacidade legíveis e exigir confirmação clara para ações destrutivas. Como referências conceituais foram consultados o Customer Portal da Stripe e a organização de usuários/acessos do Pipedrive. Não houve cópia visual ou dependência dessas plataformas.

## Compatibilidade preservada

- Rota e contrato geral `/cliente/dispositivos/remover` preservados; `index` continua aceito como fallback.
- Sessão do portal e proteção de mesma origem continuam obrigatórias na remoção.
- Persistência de chave continua usando `_writeKeyToDbStrict`.
- Hotfix do Render (request 30 s / headers 30 s / keep-alive 65 s) preservado.
- Logo/e-mail por CID, `EMAIL_REPLY_TO` e tags transacionais do Resend preservados.
- Portal legado/WSM não recebeu o novo layout; apenas o texto compartilhado de FAQ foi atualizado para a nova nomenclatura.

## Validação

Foram renderizados e validados quatro estados isolados do portal:

1. licença 3/3 + 2FA ativo;
2. licença 1/3 + 2FA desativado;
3. conta sem chave;
4. licença legada ilimitada (`maxUses = -1`).

Os HTMLs renderizados foram verificados quanto a IDs duplicados, CSS inválido e sintaxe de todos os scripts inline. Também foram validadas as proteções da rota de remoção e as regressões dos hotfixes de Render/e-mail.

Não foi marcado como teste visual real em Chromium neste ambiente; a validação desta rodada é de renderização HTML, sintaxe, estrutura, segurança e round-trip do pacote.
