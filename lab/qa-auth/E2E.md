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
