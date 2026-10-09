#!/usr/bin/env bash
set -Eeuo pipefail
for bin in bash gpg gzip sha256sum; do command -v "$bin" >/dev/null || { echo "SKIP: missing $bin"; exit 2; }; done
script="$(realpath "$(dirname "$0")/../tools/backup-zapvoice-encrypted.sh")"
root="$(mktemp -d "$HOME/.zvm-fixture-XXXXXXXX")"
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root"/{bin,secrets,dest,gpg}
chmod 700 "$root/gpg"
printf 'uri: mongodb://example.invalid:27017\n' > "$root/secrets/config"
printf 'fixture-only-long-secret\n' > "$root/secrets/passphrase"
chmod 600 "$root/secrets/"*
cat > "$root/bin/mongodump" <<'FAKE'
#!/usr/bin/env bash
set -e
if [[ "${ZVM_TEST_DUMP_FAIL:-}" == 1 ]]; then exit 9; fi
printf 'fake archive test data only' | gzip -c
FAKE
chmod 700 "$root/bin/mongodump"
export PATH="$root/bin:$PATH" GNUPGHOME="$root/gpg" ZVM_BACKUP_CONFIG_FILE="$root/secrets/config" ZVM_BACKUP_PASSPHRASE_FILE="$root/secrets/passphrase" ZVM_BACKUP_DIR="$root/dest"
(cd / && bash "$script" --preflight) | grep -q 'PRE-FLIGHT PASS'
(cd / && bash "$script" --backup) | grep -q 'Encrypted'
archive="$(find "$root/dest" -maxdepth 1 -name '*.gpg' -print -quit)"
[[ -s "$archive" && -s "$archive.sha256" ]] || { echo 'Missing encrypted fixture output'; exit 1; }
(cd "$root/dest" && sha256sum -c "$(basename "$archive").sha256") >/dev/null
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$ZVM_BACKUP_PASSPHRASE_FILE" --quiet --decrypt "$archive" | gzip -dc | grep -q 'fake archive test data only'
chmod 644 "$root/secrets/passphrase"
if (cd / && bash "$script" --preflight) >/dev/null 2>&1; then echo 'Weak passphrase file permissions accepted';exit 1;fi
chmod 600 "$root/secrets/passphrase"
if (cd / && ZVM_TEST_DUMP_FAIL=1 bash "$script" --backup) >/dev/null 2>&1; then echo 'Failed dump accepted';exit 1;fi
[[ "$(find "$root/dest" -maxdepth 1 -name '*.gpg' | wc -l)" == 1 ]] || { echo 'Failed dump created backup';exit 1; }
echo 'R46.51 backup operator: simulated encryption, integrity, permissions and fail-closed — PASS (NO DB)'
