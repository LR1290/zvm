# R103 — Roteiro no Chrome autorizado

Use um perfil descartável, uma candidata DEV com identidade e atestado próprios e backend exclusivamente de homologação. Registre versão, ID da extensão, hash da candidata, hora e resultado por cenário. O atestado R96 não cobre esta árvore.

| Cenário | Procedimento | Evidência de aceite |
|---|---|---|
| Login Free | Entrar por senha com conta QA sem chave, suspender o worker e abrir a Biblioteca | Mesma conta, sem senha repetida, plano Free e sem capacidade PRO |
| Reinício e atualização | Fechar todas as janelas, reabrir com mesmo perfil, depois atualizar a candidata mantendo ID | Refresh no servidor antes do primeiro uso após restauração do cofre |
| Interrupção | Desconectar rede, reiniciar, tentar uma operação protegida e reconectar | Bloqueio durante restauração offline, retomada após refresh válido |
| Concorrência | Pausar a resposta do refresh no servidor QA, sair e liberar resposta | Sessão revogada, nenhum reaparecimento após reinício |
| Troca de conta | Alternar usuários QA e conta WhatsApp durante uma operação | Identidade anterior não executa a operação |
| ACK PRO | Em destinatário consentido, interromper callback após despacho e reiniciar | Estado incerto durável, contagem de despacho igual a um, sem replay automático |
| Cota Free | Concorrer no último crédito em dois processos e atrasar uma confirmação | Uma reserva, uma cobrança, confirmação não rebaixada |

## MongoDB
Provisionar cluster exclusivo da COMPLETA QA, usuário zvm_completa_qa_runner com readWrite somente em zvm_completa_qa_r103, rede restrita ao executor e sem roles administrativas. Conferir o identificador do cluster no Atlas antes de definir ZVM_QA_ATLAS_HOST. Injetar ZVM_QA_MONGODB_URI via secret do laboratório. mongoQa valida a configuração local e devolve as duas variáveis que o backend lê. A validação sintática não comprova roles nem isolamento físico. Nenhuma conexão é aberta pelo validador.

Não registrar bearer, senha, conteúdo ou destinatário nos resultados.

## Reproduzir R104

Em uma cópia da R96 verificada, aplicar as sete substituições do inventário R99. Aplicar auth-r103.patch e depois auth-r104.patch na raiz da cópia com patch -p1. Definir ZVM_LAB_SOURCE para o caminho absoluto dessa árvore e executar node --test lab/qa-auth/*.test.cjs a partir do checkout do PR. A identidade assinada da R96 não cobre essas alterações.

O ensaio atlas-race.cjs inicia quatro processos Node, cada um com conexão independente. O supervisor verifica o limite agregado para um sujeito fictício exclusivo da execução. Cada processo confere a role antes da primeira reserva. A aprovação externa do cluster exclusivo continua necessária. O executor exige ZVM_QA_WRITE_APPROVED=exclusive-cluster-verified, além de host e URI de QA. O ensaio deixa os registros sintéticos disponíveis para auditoria.

## Rotas revisadas em R104

| Caminho | Contrato observado | Aceite restante |
|---|---|---|
| Biblioteca, texto e áudio | sendNow verifica plano e guardedInteractiveSend exige reserva antes do WA-JS | Confirmar recibo por tipo no Chrome QA |
| Imagem, vídeo e documento | Mesmo preflight. Mídias compartilham cota, documentos têm contador próprio | Testar anexos, conta ativa e ACK real |
| Resposta rápida | quick-response.send exige plano pago antes de resolver a sequência | Testar o executor e o compositor com contas Free e PRO |
| Agenda | Reserva de scheduleItem bloqueada antes de mutação até existir autoridade no servidor | Limite autoritativo de cinco agendamentos depende de AGENDA-01 |
| Disparos | Recuperação automática só admite atraso pré-despacho com histórico sem indício de efeito | Reinício real do processador e persistência de Pausar/Cancelar |
| Funis e Fluxos | Identidade do WhatsApp verificada contra a execução antes da continuação | Troca de conta durante uma ação já em curso |
| Follow-up | Posse durável antes do despacho e resultado incerto exige revisão mesmo se houver cancelamento | Confirmar persistência ao encerrar a página durante o commit |

Para os testes adicionais do cliente, aplicar r104-client-tests.patch sobre client-integration.test.cjs do kit R99 e executar junto à árvore R104 e ao módulo de quota do backend deste PR, preservando os caminhos relativos do kit.

Aplicar também campaign-r104.patch na cópia R104. O watchdog conserva a evidência positiva de ações anteriores ao persistir o estado incerto de uma campanha interrompida.
