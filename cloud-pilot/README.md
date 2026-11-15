# ZVM Cloud — Piloto privado para uma única pessoa

Projeto isolado da ZVM Desktop e do servidor em produção. Este piloto serve para testar acesso web mobile, autenticação e desempenho do Render.

Limitações explícitas: NÃO envia mensagens; NÃO executa Fluxos/Funis; NÃO agenda campanhas; NÃO integra a API do WhatsApp; NÃO armazena dados no servidor. Rascunhos de demonstração ficam somente no localStorage do navegador.

## Ativação da conta única
O sistema inicia selado até que as variáveis de ambiente PILOT_EMAIL e PILOT_PASSWORD_SCRYPT estejam configuradas. Não registre senhas, tokens nem hashes no GitHub.

Gerar hash da senha em máquina do administrador (senha em variável de ambiente PILOT_PASSWORD):
node -e "const c=require('node:crypto'); const p=process.env.PILOT_PASSWORD; if(!p||p.length<12) process.exit(1); const s=c.randomBytes(16); console.log(s.toString('hex')+':'+c.scryptSync(p,s,32).toString('hex'))"

No Render, use o e-mail autorizado e o hash; envie senha provisória por canal privado. Para revogar, retire as variáveis e reinicie o serviço. O cookie é Secure + HttpOnly + SameSite Strict e sessão em memória (reiniciar desloga todos).

## Deploy Render (separado)
Branch pilot/zvm-cloud-single-user-20261115
Runtime Node
Build: node --check cloud-pilot/server.js && node --check cloud-pilot/public/app.js && node --test cloud-pilot/test/pilot.test.js
Start: node cloud-pilot/server.js
Plano: free, autoDeploy: no

Limitações Render Free: suspende após 15 minutos sem tráfego; filesystem efêmero. Não executar trabalhos 24/7 nem confiar em dados locais. Próxima fase necessita armazenamento durável, fila de execução, integração oficial Meta e testes de consentimento/segurança.

Sem mudanças em zvm.onrender.com, extensão de produção, licenças, WhatsApp de clientes ou MongoDB.