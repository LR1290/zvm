# SSX 2012 — R73: interface v38, modalidades e tempo de interação

## Escopo implementado

A R73 introduz **`src/hobbies/ssx/design-v38.css`**, uma folha independente que define o novo sistema de apresentação: paleta, tipografia, ritmo editorial, área de categorias, galeria fotográfica, hierarquia de placares, elementos de seleção, responsividade e transições. É carregada após a folha de compatibilidade por `src/hobbies/ssx/route.js` com a âncora `#ssx-v38-design`.

O bundle original **v36 permanece byte-exato** e conserva o esquema de scores, nomes, flags, fontes, provas e regras de comparação. A folha `alpine-v37.css` continua deliberadamente no servidor para a compatibilidade com os controles do arquivo histórico, o tema claro, o painel Admin, os overlays do v36 e os caminhos de recuperação. Ela **não é uma segunda implementação do design v38** e removê-la sem migrar esses módulos causaria regressões. A substituição completa do mecanismo de dados é um projeto separado e exigiria reconstrução do arquivo de referência.

## Correções de usabilidade

- Barra única e persistente no topo dos resultados com **Board, Wingsuit, Trick It!, Survive It! e Survive sem equipamento** em desktop e mobile.
- Barra não está mais dentro de uma região recolhida e não desaparece ao selecionar Trick It!.
- O mobile apresenta **pelo menos dois botões simultaneamente** em 390px e permite acesso aos cinco por rolagem horizontal.
- As 73 pistas oficiais, as 12 regiões, as oito pistas DEV documentadas e a seção de categorias especiais R72 permanecem independentes.
- As animações são aplicadas apenas a hover/seleção de categoria, expansão do Top 16 e controles de navegação. `prefers-reduced-motion` e `Save-Data` desativam a animação não essencial.

## Otimização mensurável

Antes da R73, a escolha de uma nova pista executava `renderRegionBrowser()`, destruindo toda a galeria e criando novamente os banners, agrupamentos e Top 16. Agora o caminho `updateInlineTrack()` preserva os nós dos banners e substitui apenas o detalhe do Top 16 selecionado. O Chromium de CI registrou **2 ms** em uma seleção sintética de Corkscrew a partir de Red Light (não é uma garantia de desempenho em todos os aparelhos). O teste também exige que a região existente continue sendo o mesmo nó DOM e que a operação seja inferior a 350 ms no executor.

Além disso, a curadoria DEV do bundle imutável fica em cache e uma sincronização redundante foi eliminada do handler das modalidades.

**Limite conhecido:** o HTML original v36 ainda contém um pacote histórico grande, com seu próprio custo de parse, boot e atualização de fontes. Esta versão melhora tempo de interação da galeria; não constitui evidência de redução percentual do download inicial ou do tempo de boot. Qualquer futura mudança para carregar os recordes em blocos deve preservar os checksums, permitir recuperação offline e não mesclar Ozmonet a rankings de modalidades incompatíveis.

## Critérios para publicação

1. GitHub Actions: testes de isolamento v36, sintaxe dos módulos, segurança, fontes e Chromium real aprovados.
2. Screenshots Chromium: 1440px desktop e 390px mobile, cinco modos visíveis, Top 16 do Red Light preservado e sem overflow.
3. Ordem de integridade: a R73 não altera a planilha, o snapshot de 22/08/2026, registros originais, as nacionalidades, links ou o servidor de autenticação ZVM.
4. Deploy Render **manual somente após verificar o SHA exato do merge**; comprovar status LIVE separadamente.
