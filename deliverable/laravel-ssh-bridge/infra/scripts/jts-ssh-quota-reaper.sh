#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES - Reaper Temps Réel : Quotas Bande Passante & MaxUser
# Déployé sur chaque nœud VPN Ubuntu : /usr/local/sbin/jts-ssh-quota-reaper.sh
# Exécuté toutes les 10s via systemd timer ou boucle systemd sécurisée.
# ==============================================================================
set -euo pipefail

QUOTAS_DIR="/etc/jts/quotas"
MAXUSER_DIR="/etc/jts/maxuser"
USAGE_DIR="/var/lib/jts/usage"
LOG_FILE="/var/log/jts-reaper.log"

mkdir -p "$QUOTAS_DIR" "$MAXUSER_DIR" "$USAGE_DIR"

log_event() {
    printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$1" >> "$LOG_FILE"
}

# 1. Accumulation des compteurs iptables JTS_QUOTA puis remise à zéro atomique
if iptables -L JTS_QUOTA -vxn >/dev/null 2>&1; then
    while read -r uid_val delta_bytes; do
        [ -n "${uid_val:-}" ] || continue
        [ "${delta_bytes:-0}" -gt 0 ] || continue
        uname=$(getent passwd "$uid_val" | cut -d: -f1 || true)
        [ -n "$uname" ] || continue

        usage_file="${USAGE_DIR}/${uname}.bytes"
        prev=0
        if [ -f "$usage_file" ]; then
            prev=$(cat "$usage_file" 2>/dev/null | tr -dc '0-9')
            prev=${prev:-0}
        fi
        echo $((prev + delta_bytes)) > "$usage_file"
    done < <(iptables -L JTS_QUOTA -vxn | awk '/owner UID match/ {
        bytes=$2;
        for (i=1; i<=NF; i++) {
            if ($i == "match" && (i+1)<=NF) {
                uid=$(i+1); gsub(/[^0-9]/, "", uid);
                if (uid != "") print uid, bytes
            }
        }
    }')
    iptables -Z JTS_QUOTA >/dev/null 2>&1 || true
fi

# 2. Application stricte des quotas de bande passante
for qfile in "${QUOTAS_DIR}"/*.conf; do
    [ -e "$qfile" ] || continue
    USERNAME=""
    QUOTA_BYTES=0
    # shellcheck disable=SC1090
    source "$qfile"
    [ -n "$USERNAME" ] || continue
    [ "$QUOTA_BYTES" -gt 0 ] || continue

    used=0
    if [ -f "${USAGE_DIR}/${USERNAME}.bytes" ]; then
        used=$(cat "${USAGE_DIR}/${USERNAME}.bytes" 2>/dev/null | tr -dc '0-9')
        used=${used:-0}
    fi

    if [ "$used" -ge "$QUOTA_BYTES" ]; then
        if passwd -S "$USERNAME" 2>/dev/null | awk '{print $2}' | grep -vq '^L'; then
            usermod -L "$USERNAME" >/dev/null 2>&1 || true
            pkill -TERM -u "$USERNAME" >/dev/null 2>&1 || true
            log_event "QUOTA_EXCEEDED user=${USERNAME} used=${used} quota=${QUOTA_BYTES} -> locked & disconnected"
        fi
    fi
done

# 3. Application stricte de maxuser (même sur tunnels ssh -N sans PTY)
for mfile in "${MAXUSER_DIR}"/*; do
    [ -e "$mfile" ] || continue
    USERNAME=$(basename "$mfile")
    MAX_USER=$(cat "$mfile" 2>/dev/null | tr -dc '0-9')
    MAX_USER=${MAX_USER:-1}
    [ "$MAX_USER" -ge 1 ] || MAX_USER=1

    mapfile -t PIDS < <(pgrep -u "$USERNAME" -x sshd --oldest 2>/dev/null || pgrep -u "$USERNAME" -x sshd 2>/dev/null || true)
    COUNT=${#PIDS[@]}
    if [ "$COUNT" -gt "$MAX_USER" ]; then
        EXCESS=$((COUNT - MAX_USER))
        for ((i=0; i<EXCESS; i++)); do
            PID="${PIDS[$i]}"
            if [ -n "$PID" ]; then
                kill -TERM "$PID" >/dev/null 2>&1 || true
                log_event "MAXUSER_EXCEEDED user=${USERNAME} active=${COUNT} max=${MAX_USER} -> killed pid=${PID}"
            fi
        done
    fi
done
