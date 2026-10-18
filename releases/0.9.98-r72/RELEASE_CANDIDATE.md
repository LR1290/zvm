# Atualização de status: 2026-10-18

- **Chrome Web Store:** pacote 0.9.98 R72 enviado pelo responsável, aprovação/publicação pela loja ainda não verificada.
- **GitHub main:** build exato autorizado via commit `9f10eb0b78a207a81c160f2311b81991efa75ca0`.
- **Render produção:** deploy `dep-dbajt4c9v7es738q9qo0` do mesmo commit confirmado LIVE.
- **Limites da evidência:** sem teste de login/atualização do cliente pós-loja; este repositório não recebeu o ZIP binário.
- **Sem alteração** em licenças individuais, Atlas, Cakto ou configurações de proteção.

---

# ZVM 0.9.98 R72 — candidata Chrome Web Store (NÃO PUBLICAR AINDA)

**Data de preparação:** 2026-10-18  
**Estado:** distribuição BLOQUEADA até homologação e admissão no servidor.  
**Origem:** auditoria e ZIP de release R72 validado localmente.  
**Este commit NÃO inclui o binário ZIP.** A conexão GitHub disponível aceita arquivos de texto/commits, mas não fornece operação de upload de anexos binários de GitHub Releases. Portanto, este registro não equivale a hospedagem da RELEASE.

## Identificação imutável da candidata

- Arquivo: `ZVM_AUTOMACOES_0.9.98_RELEASE_R72_MINIFICADA_CWS_CANDIDATA_NAO_PUBLICAR.zip`
- SHA-256 ZIP: `977c63118f28f61ddb7122961c13efcc38adab3a49bab0a481b72f1647a295af`
- Manifesto: MV3; versão `0.9.98`
- Build ID: `zvm-production-0.9.98-sd358d26e9db0`
- Build fingerprint: `d2e18d57defba2a68f0379db170f98b499e3db688bdcd963b32f03d692421591`
- Source-tree SHA-256: `d358d26e9db021dc85dc285e1d1b87f1fd2ac8b725c1728f8956b3574995b96c`

## Validações locais (não equivalem a execução E2E)

- 316 scripts JS passaram checagem de sintaxe.
- 361/361 entradas de integridade.
- 312 arquivos JS próprios compactados com equivalência de tokens/AST.
- 127 referências de recursos/HTML conferidas.
- Não contém chave privada nem mapas de código-fonte.

## Bloqueadores de publicação

1. A identidade/fingerprint `0.9.98` não constam do registro de builds autorizadas em `main` nesta data.
2. Validar atualização de clientes reais da versão CWS existente, login, refresh e restauração legítima de sessão.
3. Homologar WhatsApp autenticado: Fluxos, Funis, gatilhos da Biblioteca, menções, ACK e deduplicação.
4. Cobrir as lacunas dos contratos funcionais e teste E2E no Opera/Chrome.
5. Confirmar políticas da Chrome Web Store e publicar exclusivamente o ZIP que corresponda ao SHA-256 acima.
6. Hospedar o **arquivo ZIP binário** como asset apropriado no GitHub por meio de uma ferramenta com capacidade de upload de arquivos; não usar esta nota como substituto.

## Isolamento e segurança

Esta referência é separada de `main`; não edita servidor, Render, banco ou registros de autorização. O fingerprint só deve ser autorizado em produção após as verificações acima. Manter builds anteriores válidos durante migração controlada.
