#!/bin/sh
# Debug entrypoint for Azure Container Apps

echo "=== DNS Debug Info ==="
echo "--- /etc/resolv.conf ---"
cat /etc/resolv.conf
echo ""
echo "--- Testing DNS for auth-service ---"
nslookup auth-service 2>&1 || echo "nslookup failed"
echo ""
echo "--- Testing DNS for auth-service.internal.salmonfield-b588dc13.westeurope.azurecontainerapps.io ---"
nslookup auth-service.internal.salmonfield-b588dc13.westeurope.azurecontainerapps.io 2>&1 || echo "nslookup failed"
echo ""
echo "=== Starting nginx ==="

# Execute nginx
exec nginx -g "daemon off;"
