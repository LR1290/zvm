#!/usr/bin/env bash
# Operator-only: reads the production "zapvoice" database and streams it into
# an encrypted archive. Never imports data or modifies MongoDB.
set -Eeuo pipefail
umask 077

mode="${1:-}"
if [[ "$mode" != '--preflight' && "$mode" != '--backup' ]]; then
  echo 'Usage: ZVM_BACKUP_CONFIG_FILE=/secure/mongodump.yaml ZVM_BACKUP_PASSPHRASE_FILE=/secure/pass ZVM_BACKUP_DIR=/external/backups bash tools/backup-zapvoice-encrypted.sh --preflight|--backup' >&2
  exit 2
fi

: "${ZVM_BACKUP_CONFIG_FILE:?missing backup config path}"
: "${ZVM_BACKUP_PASSPHRASE_FILE:?missing passphrase file path}"
: "${ZVM_BACKUP_DIR:?missing externally persisted destination directory}"

check_private_file() {
  local f="$1" perm
  [[ -f "$f" && ! -L "$f" && -s "$f" ]] || { echo 'Required private file missing, empty or symlink' >&2; exit 3; }
  perm="$(stat -c '%a' -- "$f")"
  (( (8#$perm & 0077) == 0 )) || { echo 'Private file must have no group/other access (chmod 600)' >&2; exit 3; }
}
check_private_file "$ZVM_BACKUP_CONFIG_FILE"
check_private_file "$ZVM_BACKUP_PASSPHRASE_FILE"

for name in mongodump gpg sha256sum gzip mktemp; do
  command -v "$name" >/dev/null 2>&1 || { echo "Missing required command: $name" >&2; exit 4; }
done
[[ -d "$ZVM_BACKUP_DIR" && -w "$ZVM_BACKUP_DIR" && ! -L "$ZVM_BACKUP_DIR" ]] || { echo 'Destination directory missing, non-writable or symlinked' >&2; exit 4; }
dest="$(realpath -e -- "$ZVM_BACKUP_DIR")"
case "$dest/" in /tmp/*|/var/tmp/*|"$(pwd -P)"/*) echo 'Destination must be externally persisted, outside temp and project directory' >&2; exit 4;; esac

if [[ "$mode" == '--preflight' ]]; then
  printf 'PRE-FLIGHT PASS: tools and protected paths present; no data read or written.\n'
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$dest/zvm-zapvoice-${stamp}.archive.gz.gpg"
[[ ! -e "$final" && ! -e "$final.sha256" ]] || { echo 'Backup already exists (never overwrite)' >&2; exit 5; }
partial="$(mktemp "$dest/.zvm-zapvoice-incomplete.XXXXXXXX.gpg")"
cleanup() { [[ -z "${partial:-}" ]] || rm -f -- "$partial"; }
trap cleanup EXIT

# --config protects URI/credentials from command-line argv inspection.
# No unencrypted archive is written to disk. Pipefail detects both failures.
mongodump --config="$ZVM_BACKUP_CONFIG_FILE" --db=zapvoice --archive --gzip --quiet |
  gpg --batch --yes --no-tty --pinentry-mode loopback --passphrase-file "$ZVM_BACKUP_PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$partial"
[[ -s "$partial" ]] || { echo 'Encrypted backup was empty' >&2; exit 6; }
# Cryptographic decryption and gzip integrity check, NOT a full restore.
gpg --batch --yes --no-tty --pinentry-mode loopback --passphrase-file "$ZVM_BACKUP_PASSPHRASE_FILE" \
  --quiet --decrypt "$partial" | gzip -t

mv -- "$partial" "$final"
partial=''
(cd "$dest" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256")
printf 'Encrypted archive gzip-verified. Full isolated restore is still required.\n'
