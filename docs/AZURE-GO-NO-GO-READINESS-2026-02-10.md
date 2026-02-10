# FlowGrid Azure Deployment Go/No-Go Readiness Drive (2026-02-10)

Scope: strict go/no-go for three blockers:
1) `/design` runtime stability after static artifact fix
2) tenant-isolation hardening integration/retest in running stack
3) platform-level Azure CI/CD production readiness

Execution constraints honored: no destructive ops, no external push/deploy.

---

## Decision Snapshot

- **Overall decision: NO-GO**
- **Critical blockers remain:** tenant isolation/auth enforcement mismatch in running services; CI/CD deploy-path consistency risk.

---

## A) Go/No-Go Checklist with Explicit Gates

| Gate ID | Gate | Pass Criteria | Evidence Command(s) | Result |
|---|---|---|---|---|
| G1 | `/design` route runtime | `GET /design` and `/design/` return 200 and HTML | `curl -s -o /tmp/design_root.html -w '%{http_code}' http://localhost:8080/design` ; `curl -s -o /tmp/design_root_slash.html -w '%{http_code}' http://localhost:8080/design/` | **PASS** |
| G2 | `/design` static artifact serving | At least one static asset under `/design/assets/*` returns 200 (no missing artifact behavior) | `curl -s -o /tmp/design_asset -w '%{http_code}' http://localhost:8080/design/assets/index.js` | **PASS** |
| G3 | Wizard -> Design import path sanity | Wizard analysis+apply succeeds and apply response includes `redirectUrl: "/design"` | (1) login + csrf token, (2) `POST /api/wizard/analyze-text`, (3) `POST /api/wizard/apply` | **PASS** |
| G4 | Auth boundary: tenant identity separation | Two users from different tenants can log in and `/api/auth/me` reflects different tenant IDs | `POST /api/auth/login` for demo + testcorp, then `GET /api/auth/me` with each token | **PASS** |
| G5 | Agent API auth required | `/api/agents` must reject missing token (401/403) | `curl -s -o /tmp/agents_noauth.json -w '%{http_code}' http://localhost:8080/api/agents` | **FAIL (200)** |
| G6 | Agent API tenant boundary | Cross-tenant read by ID must fail (404/403) | `curl -s -o /tmp/agent_cross_tenant.json -w '%{http_code}' http://localhost:8080/api/agents/33333333-3333-3333-3333-333333333331 -H "Authorization: Bearer <testcorp_token>"` | **FAIL (200)** |
| G7 | Wizard API tenant boundary | Cross-tenant wizard session read must fail (404/403) | `GET /api/wizard/sessions/<demo_session_id>` with testcorp token | **PASS** |
| G8 | Design API auth required | `/api/design/*` must reject missing token | `curl -s -o /tmp/design_noauth.json -w '%{http_code}' http://localhost:8080/api/design/patterns` | **FAIL (200)** |
| G9 | Tenant isolation hardening static checks | Static hardening script passes | `bash scripts/verify-tenant-isolation.sh` | **PASS** |
| G10 | Service build readiness | Key services compile cleanly | `npm run build` in `services/{agent,auth,design,wizard}-service` | **PASS** |
| G11 | Infra config preflight | Compose renders and Bicep compiles | `docker compose config` ; `az bicep build --file infrastructure/azure/main.bicep` | **PASS w/ warning** |
| G12 | Workflow/secret preflight | Required GH secret references are known and workflow health is observable | `grep -R "secrets\." .github/workflows/*.yml`; `gh run list -R rubenneuteboom/flowgrid-platform ...` | **BLOCKED/AT-RISK** |
| G13 | Deploy-path consistency | Single coherent production path for design UI/services | compare `flowgrid-platform` workflows vs `flowgrid-design-v2/.github/workflows/deploy.yml` | **FAIL (inconsistent paths)** |

---

## B) Executed Results (local evidence)

### Blocker 1: `/design` runtime stability
- PASS:
  - `/design` -> 200
  - `/design/` -> 200
  - `/design/assets/index.js` -> 200
  - HTML content returned for root route.

### Blocker 2: Tenant-isolation hardening integration/retest (running stack)
- Mixed outcome:
  - Static hardening script: **PASS** (`scripts/verify-tenant-isolation.sh`)
  - Runtime integration checks: **FAIL (critical)**
    - `/api/agents` without token returned **200** (should be 401/403)
    - Cross-tenant `GET /api/agents/:id` with testcorp token returned **200** with demo-tenant data
    - `/api/design/patterns` without token returned **200** (should be 401/403)
  - Wizard tenant boundary check passed in runtime.
- Additional evidence of code/runtime mismatch:
  - Source files in repo include auth guards (`app.use('/api', requireAuth)` and `app.use('/api/design', requireAuth)`), but running containers do not enforce these routes, indicating stale/out-of-sync runtime artifacts.

### Blocker 3: Azure CI/CD production readiness
- PASS:
  - Service TypeScript builds succeeded (agent/auth/design/wizard).
  - `docker compose config` renders successfully.
  - Bicep compiles (`az bicep build`) but emits warning:
    - `anonymousPullEnabled` invalid for current type version (BCP037).
- FAIL / BLOCKED:
  - Deploy path consistency issue:
    - `flowgrid-platform` deploys container apps (`design-module` included)
    - `flowgrid-design-v2` has separate Azure Web App deployment workflow
    - This creates drift risk and unclear source of truth for production `/design`.
  - Workflow health from GH run history could not be verified from local CLI output (empty run list in this environment), so recent workflow reliability is **BLOCKED**.

---

## C) Remediation for each FAIL/BLOCKED gate (exact next commands)

### G5 FAIL: Agent API auth not enforced at runtime
**Likely cause:** running container artifact is stale/out-of-sync with current source.

**Remediation:** rebuild and restart runtime from current source, then re-test.

**Next commands:**
```bash
cd /Users/rubenneuteboom/Documents/Projects/flowgrid-platform/infrastructure

docker compose build --no-cache agent-service design-service wizard-service auth-service

docker compose up -d agent-service design-service wizard-service auth-service nginx

# re-test
curl -s -o /tmp/agents_noauth_retest.json -w '%{http_code}\n' http://localhost:8080/api/agents
```
Expected: 401/403.

### G6 FAIL: Cross-tenant data exposure via agent API
**Likely cause:** same stale runtime issue (auth/tenant guards absent in running image).

**Next commands (after rebuild):**
```bash
# using testcorp token
curl -s -o /tmp/agent_cross_tenant_retest.json -w '%{http_code}\n' \
  http://localhost:8080/api/agents/33333333-3333-3333-3333-333333333331 \
  -H "Authorization: Bearer $TC_TOKEN"
```
Expected: 404/403.

### G8 FAIL: Design API auth not enforced
**Likely cause:** same stale runtime issue.

**Next commands (after rebuild):**
```bash
curl -s -o /tmp/design_noauth_retest.json -w '%{http_code}\n' \
  http://localhost:8080/api/design/patterns
```
Expected: 401/403.

### G12 BLOCKED: Workflow health / secret completeness not fully proven locally
**Remediation:** run authenticated GH checks and environment secret inventory check.

**Next commands:**
```bash
gh auth status

gh run list -R rubenneuteboom/flowgrid-platform -L 20 \
  --json databaseId,workflowName,status,conclusion,createdAt,updatedAt

gh secret list -R rubenneuteboom/flowgrid-platform
```
Compare required refs from workflows against actual secret list.

### G13 FAIL: Deploy-path inconsistency (`flowgrid-platform` vs `flowgrid-design-v2`)
**Remediation:** choose one production deploy authority for `/design` and deprecate the other path.

**Next commands (decision + implementation prep):**
```bash
# 1) inventory workflows involved
ls -la /Users/rubenneuteboom/Documents/Projects/flowgrid-platform/.github/workflows
ls -la /Users/rubenneuteboom/Documents/Projects/flowgrid-design-v2/.github/workflows

# 2) document chosen source of truth before edits/deploy
# (no deploy command until explicit approval)
```

---

## D) Interrupt-Worthy Alert Summary (send immediately)

**🚨 NO-GO: Critical tenant isolation regression in running stack**

Runtime checks show **unauthenticated and cross-tenant access** is currently possible:
- `GET /api/agents` without token returned **200**
- cross-tenant `GET /api/agents/:id` returned **200** with another tenant’s data
- `GET /api/design/patterns` without token returned **200**

Static hardening checks pass in source, so this is likely a **runtime artifact drift / stale container** issue. Until runtime is rebuilt and revalidated, deployment should remain **blocked**. Also, `/design` deploy path is split across two repos (Container Apps vs Web App), creating production drift risk.
