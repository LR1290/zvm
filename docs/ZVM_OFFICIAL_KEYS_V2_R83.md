# R83 — KEY V2 na ZVM Automações oficial (preparação isolada)

Data: 2026-11-19. Este checkpoint é uma proposta em branch / PR DRAFT, **não houve deploy, merge, alteração de MongoDB, troca de chaves nem atualização de clientes**.

## Problema na edição oficial
O runtime main emitia chave `zv-xxxxx-xxxxx-xxxxx` usando CSPRNG com rejeição de viés, mas apenas 15 símbolos base36. Vários caminhos de autenticação, uso e portal truncavam licenças a 20/30/32 caracteres. Apenas alterar o gerador produziria falhas reais. A LITE já definiu 256 bits / Base32 / prefixos por produto em um PR ainda isolado.

## Mudança controlada
- Importar **o mesmo** `src/license-product-v2.js` utilizado na branch da LITE, evitando um segundo gerador quase igual.
- A ZVM oficial só aceita `zv2a-` (57 caracteres) com registro de Mongo marcado `extensionProductId=zvm_automacoes`; rejeita `zv2l-` e produtos incorretos. O formato histórico permanece válido, sem migração em massa.
- Corrigir registro/vínculo do Portal, login por chave e senha, V3/V4, uso e cliente legado para **não truncar** 57 caracteres. Validar antes de consultar licença; nunca transformar uma chave malformada noutra chave válida.
- Novas chaves administrativas e de vendas passam pelo mesmo ponto de emissão; renovação **conserva o código anterior**.
- Feature flag `ZVM_OFFICIAL_KEYS_V2_ENABLED=true` é requisito para **emitir** novas chaves V2. Default sem a variável (inclusive na produção atual): **false**, continuar emitindo legadas. A validação de V2 independe da flag, permitindo homologação isolada.
- Cakto/webhook, Banco e contas comerciais não sofrem migração neste checkpoint.

## Homologação obrigatória antes de permitir emissão
1. Executar `node --check server.js`, `node --check src/license-product-v2.js` e `node tests/r83-official-license-v2.test.js`, além do CI de segurança de backend completo.
2. Validar geração, persistência Mongo em banco efêmero, recuperação, cadastro/vinculação, expiração e renovação com formatos antigo e V2 e com produto diferente.
3. Atualizar **o runtime oficial da extensão** (DEV e depois RELEASE) para suportar entrada, transporte, armazenamento e backup de chave 57 caracteres; executar Chromium autorizado e WhatsApp real.
4. Testar a integração Cakto de compra nova, renovação e entrega de e-mail, sem habilitar emissões reais.
5. Não ativar variável em Render comercial sem autorização do proprietário e plano de rollback: desligar flag (novas emissões voltam a ser legadas; V2 existentes continuam válidas).
6. Auditar logs/backup/segredos em claro. A alteração de formato **não** resolve vazamentos de licenças: o desenho Mongo atual usa `data.<chave>` e `portal_users.keyCode`. Qualquer transição para hashes/HMAC exige migração cuidadosa separada.

## Segurança operacional
256 bits aleatórios tornam adivinhação inviável, não impedem roubo de chave legítima. Prefixos são identificação, não autenticação. Não criar bloqueios agressivos para clientes Wi-Fi instável. Não iniciar deploy/merge automaticamente.
