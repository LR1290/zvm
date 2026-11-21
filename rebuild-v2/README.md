# ZVM Automações — reconstrução limpa do núcleo

**Laboratório V2 0.1.0 — NÃO é uma versão comercial ou substituta da RELEASE.**

Código escrito do zero, em diretório independente, sem importar código ou ativos da ZVM anterior. Projeto é simples de verificar: sem `node_modules`, bundler, download obrigatório, telemetria ou chamadas externas.

## Teste automatizado
```sh
npm run verify
```

## Teste manual no Chromium/Chrome
1. Acesse `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique **Carregar sem compactação** e selecione a pasta **`extension/`** deste projeto (não a raiz).
3. Abra a janela do service worker da extensão e procure erros.
4. Clique no ícone ZVM Núcleo V2: deve mostrar **Respondendo**, **Íntegras (v1)** e **Automação desativada**.
5. Abra `https://web.whatsapp.com` em uma guia e, com essa guia ativa, clique novamente no ícone: deve mostrar **Ponte ativa** quando o content script carregar.
6. Ative **diagnóstico local**, feche o Chrome inteiramente, reabra-o e confirme se a preferência persiste.

**Atenção:** o painel não autentica e não envia mensagens. Esse comportamento é intencional; não é um substituto comercial.

## Isolamento e governança
- Não instalar por cima da extensão atual e não remover a RELEASE.
- Nenhuma `key` de identidade de extensão está embutida; ID de laboratório será novo.
- Não houve leitura/reuso de arquivos `.js`, CSS ou HTML da extensão anterior.
- Não criar PR de merge para `main` antes de passar nos portões de integração.
- Documentos `docs/ARQUITETURA.md` e `docs/ACEITE.md` definem responsabilidades e bloqueios.

## Registro da primeira execução (21/11/2026)
- Testes Node: **12/12 PASS**.
- Verificação estática: **9 arquivos de extensão, sintaxe PASS**.
- Teste de extensão MV3 completa no Chromium do laboratório: **BLOQUEADO** (service worker não exposto no perfil de automação). Não consta como PASS.
- Persistência em navegador real e integração WhatsApp Web real: **PENDENTES**.
