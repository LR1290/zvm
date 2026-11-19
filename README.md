# ZVM — Automações | Servidor

Repositório **privado e proprietário** do backend ZVM: site, portal do cliente, licenciamento, integrações, rotas da extensão e serviços adjacentes. O aplicativo da extensão publicado na Chrome Web Store **não é servido por este repositório**.

## Estrutura atual

| Caminho | Responsabilidade |
| --- | --- |
| `server.js` | Servidor Node.js, HTTP e rotas de produção |
| `src/` | Módulos de negócio, segurança, portal, Cloud e serviços |
| `assets/` | Recursos estáticos efetivamente usados pelo site |
| `cloud-pilot/` | Componentes específicos do piloto Cloud |
| `zvm-build-registry-v2.json` | Identidades V2 aprovadas do aplicativo comercial e de outras builds suportadas |
| `build-authority.js`, `runtime-config.js` | Política de autorização e validação de ambiente |
| `tests/`, `test/` | Testes de regressão mantidos; não são dados de clientes |
| `tools/` | Operação, auditoria e inspeção |
| `docs/`, `audits/` | Documentação técnica e histórico de incidentes relevantes |
| `.github/workflows/` | CI e verificações de segurança |

**Distribuição da extensão:** novos ZIPs DEV e RELEASE devem permanecer nos artefatos próprios de entrega/homologação e na Chrome Web Store, **não** em `release-assets/`, na raiz do GitHub ou no deploy Node. Os ZIPs legados V740–V746 e seus verificadores congelados foram retirados da árvore atual, mas seu histórico continua recuperável pelos commits antigos, sem manter cópias residuais na branch principal.

## Requisitos

- Node.js **24.22.3** (ou versão compatível com `engines` do `package.json`);
- MongoDB Atlas, conexão configurada por ambiente;
- `npm ci` com `package-lock.json` versionado;
- variáveis reais e segredos **somente no ambiente seguro**, nunca no Git.

Para desenvolvimento local, o `server.js` exige um `zvm.env` válido (ou `DOTENV_CONFIG_PATH` apontando para o arquivo autorizado) fora do controle de versão. `zvm.env.example` documenta as variáveis. Não utilizar banco de clientes em testes.

```bash
npm ci
npm run check
npm start
```

**Observação sobre o CI:** a suíte abrangente `npm run check` possui uma falha histórica de internacionalização em `tests/r46-public-i18n.test.js`, que deve ser resolvida separadamente. Não confundir uma verificação parcial com certificação completa.

## Produção

- Render: `zvm.onrender.com`, serviço `zvm`;
- branch de deploy: `main`;
- **deploy automático desativado**; alterações em GitHub não implantam automaticamente;
- `GET /ready` é o health check configurado;
- o registro comercial V2 está em `zvm-build-registry-v2.json`; a versão 0.9.289 foi acrescentada em 19/11/2026 sem revogar as builds anteriores.

**Não remover entradas antigas do Build Registry apenas por serem versões antigas:** instalações ativas ainda podem precisar delas para login e renovação de sessão. Não desativar `ZVM_BUILD_ENFORCE`, nem utilizar liberação genérica de fingerprints como atalho para publicar.

Procedimento não destrutivo de manutenção: [DEPLOYMENT_CONFIGURATION.md](DEPLOYMENT_CONFIGURATION.md).

## Segurança e privacidade

- extensão comercial: `bdhnikgcdccjabkmbfcakgjkkgdlmgja`;
- identidade DEV separada: `ckbffcbmanboelbihfkhiahgafnimcho`;
- autenticação V4 e Build Authority com verificações de canal, perfil, ID, fingerprint, revogação e licenças;
- preservação de sessões, dados de clientes e condições de dispositivos;
- credenciais, dados pessoais, tokens e chave privada de assinatura **nunca** entram em artefatos de QA nem no Git;
- a compatibilidade V3 legada ainda pode ser necessária e **não** deve ser removida sem auditoria de clientes.

O repositório permanece licenciado conforme [LICENSE](LICENSE) e sujeito à política [SECURITY.md](SECURITY.md).
