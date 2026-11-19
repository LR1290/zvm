# ZVM LITE R81 — gate forense de fonte assinada

## Finalidade e escopo

`tools/audit-lite-source.mjs` valida **offline e somente para leitura** uma pasta de extensão LITE MV3 descompactada, sem usar chaves privadas, sem comunicação de rede, sem acessar Render/MongoDB e sem alterar dados do usuário.

Comandos:

```sh
node tools/audit-lite-source.mjs /caminho/para/ZVM_LITE_EXTRAIDA
node tools/audit-lite-source.mjs /caminho/para/ZVM_LITE_EXTRAIDA 2026-11-19T17:00:00.000Z
node --test tests/r81-lite-source-audit.test.mjs
```

**Exit 0:** as verificações implementadas passaram. **Exit 2:** há falhas de conteúdo, assinatura, expiração ou identidade e a fonte **NÃO PODE SER INSTALADA**. **Exit 1:** não foi possível concluir a auditoria.

## Verificações

- ID derivado da chave RSA pública do manifesto e comparado com a identidade LITE e a atestação.
- Manifesto DEV MV3 válido; versão do runtime coerente com a identidade, sem confusão com a ZVM completa.
- Arquivos protegidos presentes com tamanho e SHA-256 correspondentes; `manifest-json-v1` aplica normalização compatível com o runtime.
- Inventário completo: rejeita arquivos inesperados, mesmo quando o fingerprint antigo ainda corresponde ao *registro antigo*. Somente os dois recursos assinados externamente (`integrity.json` e `lite-v4-signed-build.json`) ficam fora da lista de hashes.
- Recalcula o fingerprint dos registros de integridade; verifica assinatura Ed25519 da atestação e do descritor V4 com a chave **pública embutida**.
- Rejeita vinculação errada de build/ID, descritor expirado e links simbólicos. Testes sintéticos cobrem adulteração, remoção, acréscimo de arquivos, assinatura inválida e vencimento.

## Evidência das fontes existentes (19/11/2026)

- **R51 DEV assinada:** gate offline aprovado, 269 arquivos protegidos, nenhum runtime extra. Assinaturas Ed25519 matematicamente válidas contra a chave pública presente na fonte; isso não constitui autorização ativa do servidor.
- **R77 LAB:** gate offline rejeitado: 22 hashes divergentes, 22 tamanhos divergentes, 2 arquivos protegidos ausentes, **15 arquivos extras não protegidos**, marcador DEV do manifesto inválido. O fato de duas assinaturas antigas ainda serem matematicamente válidas **não autentica os novos arquivos**.
- **Chromium do laboratório local:** política administrativa impede carregamento de extensões descompactadas. O QA visual em CI é do **site**, com usuários simulados, não da extensão no WhatsApp real.

## Critérios obrigatórios de release

1. Consolidar uma árvore fonte correta, retirar CSS legado somente após verificar que não há importações necessárias; incluir **todos os arquivos executáveis e assets** na lista atual de integridade.
2. Gerar nova identidade/fingerprint/assinaturas por processo seguro com a identidade LITE autorizada. Nunca incorporar chaves privadas ao ZIP, logs, Git ou chat.
3. Confirmar que o serviço de homologação Render possui a autoridade pública correspondente; só ativar builds assinadas intencionalmente e com deploy manual aprovado.
4. Executar este auditor no pacote exato, não só em um diretório semelhante. Gate offline aprovado é **necessário, mas não suficiente**.
5. Executar teste real MV3/WhatsApp Web em navegador autorizado, incluindo login por chave e senha, reconexão, backup, Fluxos, Funis, Disparos e migração sem perda de dados; registrar evidências.

**Governança:** PR #131 permanece draft/empilhado sobre #129/#124, sem merge, sem deploy ou alteração Atlas nesta rodada. R77 continua **NÃO INSTALAR**.
