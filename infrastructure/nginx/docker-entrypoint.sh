#!/bin/sh
# Dynamic entrypoint for Azure Container Apps
# Discovers internal domain and configures nginx for Container Apps environment

echo "=== Container Apps DNS Setup ==="
cat /etc/resolv.conf
echo ""

# Container Apps internal DNS uses: <app>.internal.<env>.<region>.azurecontainerapps.io
# We need to discover the environment domain from the CONTAINER_APP_ENV_DNS_SUFFIX env var
# or fall back to trying short names with the resolver

# Check if we have the environment DNS suffix
if [ -n "$CONTAINER_APP_ENV_DNS_SUFFIX" ]; then
  # Use the official internal format
  INTERNAL_DOMAIN="internal.${CONTAINER_APP_ENV_DNS_SUFFIX}"
  echo "Using Container Apps internal domain: $INTERNAL_DOMAIN"
  
  sed -i "s/auth-service;/auth-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/agent-service;/agent-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/wizard-service;/wizard-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/integration-service;/integration-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/design-module;/design-module.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
  sed -i "s/runtime-service;/runtime-service.${INTERNAL_DOMAIN};/g" /etc/nginx/conf.d/default.conf
else
  # Fallback: keep short names and let resolver handle it
  echo "No CONTAINER_APP_ENV_DNS_SUFFIX found, using short service names"
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
