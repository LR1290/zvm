# ZapVoice API Server - by LR1290

Servidor local que substitui a API do ZapVoice, validando qualquer chave como premium.

## Como usar

### 1. Instalar Node.js
Baixe em: https://nodejs.org (versão 18 LTS recomendada)

### 2. Rodar o servidor
```
node server.js
```
O servidor roda na porta 3000 por padrão.

### 3. Para rodar em nuvem (grátis)
Recomendo o Render.com:
- Crie conta em https://render.com
- Novo Web Service > conecte este repositório
- Start command: node server.js
- Sua URL sera algo como: https://zapvoice-api.onrender.com

### 4. Adicionar no patcher
Após ter a URL do servidor, adicione esta linha no script .ps1:
```powershell
$raw = $raw.Replace('oRHdwNnOv8SYwlmL6FGc29WajVmLj9WbuImc', 'SUA_URL_CODIFICADA')
```

Para gerar o codigo da sua URL, use o gerador incluso (gerar-codigo.js):
```
node gerar-codigo.js https://sua-url.com
```
