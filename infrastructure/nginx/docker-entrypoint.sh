#!/bin/sh
# Dynamic entrypoint for Azure Container Apps
# Discovers internal domain from resolv.conf and generates nginx config

echo "=== Container Apps DNS Setup ==="
cat /etc/resolv.conf
echo ""

# Extract the internal domain from resolv.conf search line
# Format: search <env-id>.svc.cluster.local ...
INTERNAL_DOMAIN=$(grep "^search" /etc/resolv.conf | awk '{print $2}' | head -1)
echo "Internal domain: $INTERNAL_DOMAIN"

# If we have an internal domain, use full FQDNs; otherwise fallback to short names
if [ -n "$INTERNAL_DOMAIN" ]; then
  # Update nginx config with full FQDNs
  sed -i "s/auth-service;/auth-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/agent-service;/agent-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/wizard-service;/wizard-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/integration-service;/integration-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/design-module;/design-module.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  echo "Updated nginx config with domain: $INTERNAL_DOMAIN"
fi

# Use the Container Apps resolver from resolv.conf
RESOLVER=$(grep "^nameserver" /etc/resolv.conf | head -1 | awk '{print $2}')
if [ -n "$RESOLVER" ]; then
  sed -i "s/resolver 100.100.224.10/resolver ${RESOLVER}/g" /etc/nginx/conf.d/default.conf
  echo "Updated resolver to: $RESOLVER"
fi

echo ""
echo "=== Final nginx upstream config ==="
grep "set \$upstream" /etc/nginx/conf.d/default.conf
echo ""
echo "=== Starting nginx ==="

exec nginx -g "daemon off;"
