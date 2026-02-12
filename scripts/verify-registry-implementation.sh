#!/bin/bash

# ============================================================================
# Agent Registry Implementation Verification Script
# ============================================================================
# This script verifies that all components of the multi-tenant agent registry
# have been properly implemented.
#
# Usage: ./scripts/verify-registry-implementation.sh
# ============================================================================

set -e

echo "🔍 Verifying Agent Registry Implementation"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SUCCESS=0
FAILURES=0

check_file() {
  local file=$1
  local description=$2
  
  if [ -f "$file" ]; then
    echo -e "${GREEN}✓${NC} $description"
    echo "   → $file"
    SUCCESS=$((SUCCESS + 1))
  else
    echo -e "${RED}✗${NC} $description"
    echo "   → $file (NOT FOUND)"
    FAILURES=$((FAILURES + 1))
  fi
}

check_string_in_file() {
  local file=$1
  local search_string=$2
  local description=$3
  
  if [ -f "$file" ] && grep -q "$search_string" "$file"; then
    echo -e "${GREEN}✓${NC} $description"
    SUCCESS=$((SUCCESS + 1))
  else
    echo -e "${RED}✗${NC} $description"
    echo "   → '$search_string' not found in $file"
    FAILURES=$((FAILURES + 1))
  fi
}

check_typescript_compiles() {
  local dir=$1
  local service_name=$2
  
  echo ""
  echo "📦 Checking TypeScript compilation: $service_name"
  
  if [ -d "$dir" ]; then
    cd "$dir"
    if npm run build > /dev/null 2>&1; then
      echo -e "${GREEN}✓${NC} TypeScript compiles without errors"
      SUCCESS=$((SUCCESS + 1))
    else
      echo -e "${RED}✗${NC} TypeScript compilation failed"
      FAILURES=$((FAILURES + 1))
    fi
    cd - > /dev/null
  else
    echo -e "${RED}✗${NC} Directory not found: $dir"
    FAILURES=$((FAILURES + 1))
  fi
}

# ============================================================================
# Check Implementation Files
# ============================================================================

echo "📁 Checking Implementation Files"
echo "---------------------------------"

check_file "services/agent-service/src/index.ts" "Agent service main file"
check_file "services/wizard-service/src/routes/generate.ts" "Wizard code generation"
check_file "infrastructure/nginx/conf.d/routes.conf" "Nginx routes configuration"
check_file "services/agent-service/tests/registry.test.ts" "Registry test suite"

echo ""

# ============================================================================
# Check Registry Endpoints Implementation
# ============================================================================

echo "🌐 Checking Registry Endpoints"
echo "-------------------------------"

check_string_in_file "services/agent-service/src/index.ts" \
  "GET /api/registry/agents" \
  "Registry list endpoint"

check_string_in_file "services/agent-service/src/index.ts" \
  "GET /api/registry/agents/:id" \
  "Registry get agent endpoint"

check_string_in_file "services/agent-service/src/index.ts" \
  "GET /api/registry/agents/search" \
  "Registry search endpoint"

check_string_in_file "services/agent-service/src/index.ts" \
  "POST /api/registry/agents/:id/register" \
  "Registry register endpoint"

check_string_in_file "services/agent-service/src/index.ts" \
  "DELETE /api/registry/agents/:id/unregister" \
  "Registry unregister endpoint"

echo ""

# ============================================================================
# Check Tenant Isolation
# ============================================================================

echo "🔒 Checking Tenant Isolation"
echo "----------------------------"

check_string_in_file "services/agent-service/src/index.ts" \
  "req.tenantId" \
  "Tenant ID extraction from JWT"

check_string_in_file "services/agent-service/src/index.ts" \
  "WHERE a.tenant_id = \$1" \
  "Tenant filtering in SQL queries"

check_string_in_file "services/agent-service/src/index.ts" \
  "config->'deployment'->>'status' = 'running'" \
  "Deployment status filtering"

echo ""

# ============================================================================
# Check Code Generation Updates
# ============================================================================

echo "🔧 Checking Code Generation Updates"
echo "------------------------------------"

check_string_in_file "services/wizard-service/src/routes/generate.ts" \
  "FLOWGRID_REGISTRY_URL" \
  "Registry URL environment variable"

check_string_in_file "services/wizard-service/src/routes/generate.ts" \
  "FLOWGRID_TENANT_ID" \
  "Tenant ID environment variable"

check_string_in_file "services/wizard-service/src/routes/generate.ts" \
  "discoverAgents" \
  "Agent discovery helper function"

check_string_in_file "services/wizard-service/src/routes/generate.ts" \
  "getAgentCard" \
  "Get agent card helper function"

check_string_in_file "services/wizard-service/src/routes/generate.ts" \
  "registerWithRegistry" \
  "Registry registration helper function"

echo ""

# ============================================================================
# Check Nginx Configuration
# ============================================================================

echo "🔀 Checking Nginx Configuration"
echo "--------------------------------"

check_string_in_file "infrastructure/nginx/conf.d/routes.conf" \
  "location /api/registry" \
  "Registry route configuration"

check_string_in_file "infrastructure/nginx/conf.d/routes.conf" \
  "proxy_pass http://agent_service" \
  "Registry proxy to agent service"

echo ""

# ============================================================================
# Check Documentation
# ============================================================================

echo "📚 Checking Documentation"
echo "-------------------------"

check_file "docs/MULTI-TENANT-EXECUTION.md" "Multi-tenant execution design"
check_file "docs/AGENT-REGISTRY-IMPLEMENTATION.md" "Implementation guide"
check_file "docs/IMPLEMENTATION-SUMMARY.md" "Implementation summary"
check_file "docs/AGENT-REGISTRY-QUICK-START.md" "Quick start guide"
check_file "docs/DEPLOYMENT-CHECKLIST.md" "Deployment checklist"

echo ""

# ============================================================================
# Check Test Suite
# ============================================================================

echo "🧪 Checking Test Suite"
echo "----------------------"

check_string_in_file "services/agent-service/tests/registry.test.ts" \
  "describe('Agent Registry API'" \
  "Test suite structure"

check_string_in_file "services/agent-service/tests/registry.test.ts" \
  "GET /api/registry/agents" \
  "List agents test"

check_string_in_file "services/agent-service/tests/registry.test.ts" \
  "should not return agents from other tenants" \
  "Tenant isolation test"

check_string_in_file "services/agent-service/tests/registry.test.ts" \
  "should register agent and set status to running" \
  "Agent registration test"

echo ""

# ============================================================================
# TypeScript Compilation
# ============================================================================

echo "🏗️  Checking TypeScript Compilation"
echo "-----------------------------------"

check_typescript_compiles "services/agent-service" "agent-service"
check_typescript_compiles "services/wizard-service" "wizard-service"

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "========================================="
echo "📊 Verification Summary"
echo "========================================="
echo ""
echo -e "${GREEN}✓ Successful checks: $SUCCESS${NC}"
echo -e "${RED}✗ Failed checks: $FAILURES${NC}"
echo ""

if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}🎉 All checks passed! Implementation is complete.${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Review docs/DEPLOYMENT-CHECKLIST.md"
  echo "2. Run tests: npm test -- registry.test.ts"
  echo "3. Deploy to staging environment"
  exit 0
else
  echo -e "${RED}⚠️  Some checks failed. Please review the output above.${NC}"
  exit 1
fi
