#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[1/4] wizard-service: ensure no client tenant fallback in protected routes"
! grep -RIn "x-tenant-id\|req\.body\.tenantId\|req\.query\.tenantId" services/wizard-service/src/routes/{analyze.ts,generate.ts,session.ts}

echo "[2/4] wizard-service: ensure session read/delete/update are tenant-scoped"
grep -q "WHERE id = \$1 AND tenant_id = \$2" services/wizard-service/src/services/database.ts
grep -q "DELETE FROM wizard_sessions WHERE id = \$1 AND tenant_id = \$2" services/wizard-service/src/services/database.ts

echo "[3/4] agent-service: ensure JWT auth guard and tenant-scoped read/write"
grep -q "app.use('/api', requireAuth)" services/agent-service/src/index.ts
grep -q "WHERE id = \$1 AND tenant_id = \$2" services/agent-service/src/index.ts
grep -q "DELETE FROM agents WHERE id = \$1 AND tenant_id = \$2" services/agent-service/src/index.ts

echo "[4/4] design-service: ensure /api/design requires auth and tenant-scoped generate-code"
grep -q "app.use('/api/design', requireAuth)" services/design-service/src/index.ts
grep -q "WHERE a.id = \$1 AND a.tenant_id = \$2" services/design-service/src/index.ts

echo "✅ tenant isolation static checks passed"
