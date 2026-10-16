#!/bin/sh
set -eu

# -----------------------------------------------------------------------------
# Dynamic UID/GID alignment (LinuxServer.io pattern)
# -----------------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  PTOOLS_UID="${AGENT_TOOL_UID:-${PTOOLS_UID:-1001}}"
  PTOOLS_GID="${AGENT_TOOL_GID:-${PTOOLS_GID:-1001}}"

  # Safety check: PUID/PGID cannot be root
  if [ "$PUID" -eq 0 ] 2>/dev/null || [ "$PGID" -eq 0 ] 2>/dev/null; then
    echo "ERROR: PUID and PGID cannot be 0. Run without setting PUID=0, or use AGENT_TOOL_SANDBOX_ENABLED=true if root operation is required." >&2
    exit 1
  fi

  # Collision check: Prevent pi and pi-tools from sharing the same identity
  if [ "$PUID" -eq "$PTOOLS_UID" ] 2>/dev/null; then
    echo "WARNING: PUID ($PUID) equals PTOOLS_UID ($PTOOLS_UID). Shifting PTOOLS_UID to avoid tool sandbox security collapse." >&2
    PTOOLS_UID=$((PUID + 1))
    PTOOLS_GID=$((PGID + 1))
  fi

  # Align `pi` user if UID/GID changed
  current_pi_uid="$(id -u pi 2>/dev/null || echo "")"
  current_pi_gid="$(id -g pi 2>/dev/null || echo "")"
  if [ -n "$current_pi_uid" ] && [ "$current_pi_uid" != "$PUID" ]; then
    usermod -o -u "$PUID" pi
    chown -R "$PUID" /home/pi/.local /home/pi/.npm 2>/dev/null || true
  fi
  if [ -n "$current_pi_gid" ] && [ "$current_pi_gid" != "$PGID" ]; then
    groupmod -o -g "$PGID" pi
    chown -R ":$PGID" /home/pi/.local /home/pi/.npm 2>/dev/null || true
  fi

  # Align `pi-tools` user if UID/GID changed
  current_tool_uid="$(id -u pi-tools 2>/dev/null || echo "")"
  current_tool_gid="$(id -g pi-tools 2>/dev/null || echo "")"
  if [ -n "$current_tool_uid" ] && [ "$current_tool_uid" != "$PTOOLS_UID" ]; then
    usermod -o -u "$PTOOLS_UID" pi-tools
    chown -R "$PTOOLS_UID" /home/pi-tools 2>/dev/null || true
  fi
  if [ -n "$current_tool_gid" ] && [ "$current_tool_gid" != "$PTOOLS_GID" ]; then
    groupmod -o -g "$PTOOLS_GID" pi-tools
    chown -R ":$PTOOLS_GID" /home/pi-tools 2>/dev/null || true
  fi

  usermod -aG pi-tools pi 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# Mode Selection: Sandbox Mode vs Default Mode
# -----------------------------------------------------------------------------
case "$(printf '%s' "${AGENT_TOOL_SANDBOX_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    # Sandbox mode: keep the server as root so it can setuid/setgid
    # model/user tool children to AGENT_TOOL_UID:GID. Prepare the standard
    # writable mounts here, before Node imports config.ts and tries to create
    # server-private files such as /home/pi/.pi-kot/jwt-secret.
    if [ "$(id -u)" != "0" ]; then
      echo "AGENT_TOOL_SANDBOX_ENABLED=true requires the container to run as root" >&2
      exit 1
    fi

    tool_uid="${PTOOLS_UID:-1001}"
    tool_gid="${PTOOLS_GID:-1001}"
    workspace_path="${WORKSPACE_PATH:-/workspace}"
    kot_data_dir="${KOT_DATA_DIR:-${FORGE_DATA_DIR:-/home/pi/.pi-kot}}"
    pi_config_dir="${PI_CONFIG_DIR:-/home/pi/.pi/agent}"
    tool_home="${AGENT_TOOL_HOME:-/home/pi-tools}"

    mkdir -p "$workspace_path" "$kot_data_dir" "$pi_config_dir" "$tool_home" /opt

    chown root:root "$kot_data_dir"
    chmod u+rwx "$kot_data_dir"
    chown -R root:root "$kot_data_dir"
    chmod -R u+rwX,go-rwx "$kot_data_dir"

    chown root:0 "$workspace_path"
    chmod u+rwx,g+rwx "$workspace_path"
    chown -R root:0 "$workspace_path"
    chmod -R u+rwX,g+rwX,o-rwx "$workspace_path"
    chown -R "$tool_uid:0" "$workspace_path"

    chown root:"$tool_gid" "$pi_config_dir"
    chmod 0750 "$pi_config_dir"

    chown root:"$tool_gid" "$tool_home"
    chmod u+rwx "$tool_home"
    chown -R root:"$tool_gid" "$tool_home"
    chmod -R u+rwX,go-rwx "$tool_home"
    chown -R "$tool_uid:$tool_gid" "$tool_home"

    chown -R "$tool_uid:0" /opt 2>/dev/null || true
    chmod 0775 /opt 2>/dev/null || true

    # Optional extra chown paths specified by operator
    if [ -n "${AGENT_TOOL_SANDBOX_CHOWN_PATHS:-}" ]; then
      for extra_path in $AGENT_TOOL_SANDBOX_CHOWN_PATHS; do
        if [ -e "$extra_path" ]; then
          chown -R "$tool_uid:$tool_gid" "$extra_path" 2>/dev/null || true
        fi
      done
    fi

    exec "$@"
    ;;

  *)
    # Default mode: run as whichever non-root user the runtime selected.
    # When started as root, configure sudoers according to ENABLE_SUDO
    # before gosu drops privileges to pi.
    if [ "$(id -u)" = "0" ]; then
      case "$(printf '%s' "${ENABLE_SUDO:-false}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on|scoped)
          echo "pi ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get, /usr/bin/dpkg" > /etc/sudoers.d/pi
          chmod 0440 /etc/sudoers.d/pi
          ;;
        all|full)
          echo "pi ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/pi
          chmod 0440 /etc/sudoers.d/pi
          ;;
        *)
          rm -f /etc/sudoers.d/pi
          ;;
      esac

      if [ -d /opt ]; then
        chown -R pi:pi /opt 2>/dev/null || true
        chmod 0775 /opt 2>/dev/null || true
      fi

      if [ -d /workspace ]; then
        chown pi:pi /workspace 2>/dev/null || true
      fi

      exec gosu pi "$@"
    fi

    exec "$@"
    ;;
esac
