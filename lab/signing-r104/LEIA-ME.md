# Assinatura offline da COMPLETA R104

No Windows do proprietário, extraia este kit em diretório privado fora de Git e OneDrive. Use Python 3 e Node 24. A chave Ed25519 deve permanecer em arquivo local de acesso restrito. O script aceita PEM privado ou PKCS#8 DER em base64, conforme o formato institucional. A chave do manifesto Chrome determina o ID da extensão e é distinta desta chave de atestação.

1. Confirme o SHA-256 do LAB com Get-FileHash. O script aceita somente o ZIP específico desta entrega. Execute inicialmente `py preparar.py CAMINHO_DO_ZIP_LAB`. Confira o ID, buildId e fingerprint exibidos.
2. Na máquina do proprietário, quando o ambiente QA estiver pronto e a janela de homologação começar, execute `py preparar.py CAMINHO_DO_ZIP_LAB --key CAMINHO_DO_ARQUIVO_PRIVADO --out CAMINHO_DE_UM_NOVO_ZIP_DEV.zip`. O comando recebe um caminho e nunca requer o segredo como argumento. O arquivo de saída deve ser novo. O script recalcula a árvore e o manifesto canônico, substitui a metadata antiga, confere a chave pública e usa dev-build-signing.js do HEAD R104. Ele valida o atestado e testa adulteração e expiração antes de empacotar. Registre o SHA do ZIP e a validade exibida.
3. Com Python normal e o pacote cryptography disponível offline, execute `py verify-independent.py CAMINHO_DO_NOVO_ZIP_DEV.zip`. Esse verificador reabre o ZIP, valida CRC, conjunto de arquivos, hashes, identidade e assinatura. Confira também o resultado da autoridade de build no backend QA. A verificação de arquivo não testa autorização do usuário.
4. O pacote preserva a versão 0.9.305 e o ID institucional. Testar a instalação em perfil de QA isolado. Uma atualização automática sobre a mesma versão não está demonstrada. A atestação Ed25519 é interna ao produto. Este fluxo não cria um CRX assinado pela Chrome Web Store.

## Ativação no backend exclusivo de QA

No Admin oficial da COMPLETA do ambiente segregado, gerar uma nova chave PRO de QA com rótulo rastreável, prazo curto, um dispositivo e vínculo à conta de teste conforme a política do painel. Usar somente o registro recém-criado. Na linha dessa chave, habilitar “Acesso DEV”. Guardar o código no cofre do proprietário e registrar apenas o identificador de auditoria e a validade. Conferir a separação de produto e ambiente antes de emitir.

Na configuração de QA, conferir a confiança na chave pública dev-2026-01 e o ID DEV. Submeter o novo descritor ao fluxo normal de login e verificação. Registrar o resultado sanitizado de build-authority e, separadamente, o entitlement retornado e uma ação PRO com destinatário consentido. Um HTTP 200 isolado não comprova os três gates.

No HEAD R104, uma conta Free sem licença recebe devAccess=false. O login de build DEV assinada exige devAccess. O QA Free precisa de uma combinação de canal e conta legitimamente aceita pelo servidor. Não conceder PRO à conta Free para simular esse cenário.

Para Atlas, validar host, rede, projeto exclusivo e role restrita antes de obter aprovação de escrita. Para Chrome, usar perfil que autorize MV3 e a conta WhatsApp de teste. Validar reinício, revogação, atraso ou perda de ACK, ausência de replay e backup/restore. Traces e capturas devem omitir tokens, contatos e conteúdo.
