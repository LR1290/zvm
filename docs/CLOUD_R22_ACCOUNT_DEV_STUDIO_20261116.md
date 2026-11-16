# R22 — ZVM Cloud: autorização DEV por conta + interface Studio
**16/11/2026 • Somente branch de laboratório. NÃO MESCLAR NEM PUBLICAR NO RENDER.**

## Evidência do incidente de UX
O Portal já autentica por e-mail/senha + 2FA e /dev/cloud/ exige mais uma chave DEV. Antes de R22:
- autorização Cloud = `cloud_dev_grants[_id=sessionId]`, com TTL de no máximo 8 horas;
- trocar de sessão, reiniciar o login ou ultrapassar o TTL exigia digitar a mesma chave novamente;
- Cloud publicada usava uma página centralizada, abas horizontais e editores genéricos.

## Implementação R22
**Autorização Cloud**
- A primeira ativação válida cria `cloud_dev_account_grants[_id=SHA256('zvm-cloud-workspace-v1:'+emailCanônico)]` com somente `keyHash` e horários (não guarda chave em texto puro).
- O backend exige a sessão ativa do Portal, inclusive 2FA concluído, antes de acessar a conta; não há acesso anônimo por conhecer o hash.
- Cada ação com privilégio consulta a autorização persistida **e** o registro real da licença `verifyDevKey(email, null, keyHash)`: bloqueio, expiração, revogação do DEV, desvinculação ou troca de licença interrompem o uso. Nunca confiar em uma aprovação antiga sem consultar a origem.
- Ao sair da conta, a autorização Cloud permanece ligada à conta, e reaparece automaticamente no próximo login. **Sessão do Portal permanece com política atual:** login por e-mail/senha pode voltar a ser necessário após expiração/saída/reinício; R22 não criou cookie eterno.
- Botão destrutivo `Desvincular chave DEV` fica apenas em Configurações > Segurança, com confirmação explícita; a revogação é imediata, para todas as sessões daquela conta.
- O limite de tentativas por usuário substitui o limite por sessionId; sessões distintas não permitem zerar a contagem facilmente.
- **Migração controlada:** grants antigos por sessão não são restaurados automaticamente. É necessária **uma última validação** da chave na primeira execução desta versão. Isso evita que grants temporários antigos recriem um vínculo que o usuário revogou explicitamente. A coleção legada `cloud_dev_grants` pode permanecer temporariamente com TTL antigo, sem leituras ou novas gravações; a exclusão definitiva requer backup e janela de manutenção após a nova versão estar homologada.

**Layout Studio/Codex com identidade ZVM**
- Barra superior global; rail lateral fixo de 244px no desktop com seções Painel/Automações/Gestão/Conteúdo/Sistema e perfil da conta no rodapé.
- Botão para recolher a barra a 68px, usando rótulos acessíveis, ícones e preferência local **não sensível** (`zvm-cloud-sidebar-collapsed`). Chaves, cookies ou credenciais não são gravados no `localStorage`.
- Espaço de trabalho ocupa a largura disponível; abaixo de 900px a navegação vira uma faixa horizontal rolável com labels, preservando a usabilidade touch.
- Busca de módulos por `Ctrl+K`, cards e quantidades reais, CRM em quadro interativo R21; sem métricas de envios falsas nem motores de disparos ligados.
- Preserva a correção do Portal R47.15: Cloud solicita token CSRF seguro antes de enviar o formulário para `/cliente/login`; não substitui login, cookies ou 2FA.

## QA realizado no escopo desta branch
- **9/9 cenários simulados de backend**: primeira ativação, sessão nova da mesma conta, outra conta não herda, revogação DEV, rotação de chave, desvinculação em outra sessão e bloqueio sem login.
- **12/12 contratos isolados de interface R20–R22**: navegação, DOM, acesso, CRM UI, mobile, CSP e lógica de preferências. Os 4 testes do arquivo R22 foram exercitados sob um harness de módulos simulado.
- `npm run check` inclui testes R20/R21/R22, incluindo `pilot.test.js` com novos cenários de segunda sessão e revogação. Não há execução integral em Node nem Chromium real neste checkpoint; isso continua obrigatório antes de publicar a Cloud.
- O `main` do servidor e `zvm.onrender.com` não foram alterados pela R22.

## Pendências maiores para paridade completa da extensão
Fluxos/Funis reais, Biblioteca com mídias grandes e vínculos íntegros, backup integral, todas as operações do CRM e Disparos com integração oficial aprovada, filas/execução 24/7, acessibilidade/QA Chromium em desktop e celular. **Nenhum deploy parcial.**
