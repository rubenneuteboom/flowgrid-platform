-- =============================================================================
-- Flowgrid Platform - Seed Data
-- Generated: 2026-02-14
-- =============================================================================

-- =============================================================================
-- AGENTIC PATTERNS (reference data)
-- =============================================================================
INSERT INTO agentic_patterns (id, name, description, use_cases, characteristics, selection_criteria) VALUES
('orchestrator', 'Orchestrator', 'Coordinates multiple agents and workflows',
 ARRAY['Multi-agent coordination', 'Workflow management', 'State orchestration'],
 ARRAY['High-level control', 'Delegates tasks', 'Manages state'],
 'Manages other agents'),
('specialist', 'Specialist', 'Deep domain expertise for specific tasks',
 ARRAY['Expert analysis', 'Domain-specific processing', 'Focused operations'],
 ARRAY['Focused scope', 'Expert knowledge', 'Handles specific tasks'],
 'Deep domain knowledge'),
('coordinator', 'Coordinator', 'Manages handoffs between teams and systems',
 ARRAY['Team coordination', 'Process handoffs', 'Cross-system sync'],
 ARRAY['Routing', 'Load balancing', 'Ensures continuity'],
 'Manages handoffs'),
('gateway', 'Gateway', 'External system integration and API facade',
 ARRAY['API integration', 'External systems', 'Protocol translation'],
 ARRAY['API facade', 'Protocol translation', 'Security boundary'],
 'Talks to external systems'),
('monitor', 'Monitor', 'Observes conditions and alerts on thresholds',
 ARRAY['System monitoring', 'Alerting', 'Threshold detection'],
 ARRAY['Passive observation', 'Threshold-based triggers', 'Escalation'],
 'Watches and alerts'),
('executor', 'Executor', 'Performs automated actions and task execution',
 ARRAY['Task execution', 'Automation', 'Script running'],
 ARRAY['Task execution', 'Scripted workflows', 'Idempotent'],
 'Executes automated actions'),
('analyzer', 'Analyzer', 'Processes data for insights and patterns',
 ARRAY['Data analysis', 'Pattern detection', 'ML insights'],
 ARRAY['Pattern detection', 'ML/analytics', 'Reporting'],
 'Analyzes data/patterns'),
('aggregator', 'Aggregator', 'Combines data from multiple sources',
 ARRAY['Data fusion', 'Multi-source aggregation', 'Unified views'],
 ARRAY['Data fusion', 'Normalization', 'Single view'],
 'Combines multiple data sources'),
('router', 'Router', 'Directs work to appropriate handlers',
 ARRAY['Request routing', 'Load distribution', 'Rule-based dispatch'],
 ARRAY['Rule-based routing', 'Load distribution'],
 'Routes requests to handlers'),
('routing', 'Routing', 'Routes requests to specialized agents based on context',
 ARRAY['Request classification', 'Load balancing', 'Skill-based routing'],
 ARRAY['Context-aware', 'Low latency', 'Stateless'],
 'Routes to other agents'),
('planning', 'Planning', 'Breaks complex tasks into steps, creates execution plans',
 ARRAY['Multi-step tasks', 'Dependency management', 'Goal decomposition'],
 ARRAY['Goal-oriented', 'Creates subtasks', 'Manages state'],
 'Complex multi-step tasks'),
('tool-use', 'Tool Use', 'Interacts with external APIs, databases, services',
 ARRAY['API integration', 'Data retrieval', 'External actions'],
 ARRAY['API-aware', 'Error handling', 'Retry logic'],
 'External system interaction'),
('human-in-loop', 'Human-in-Loop', 'Requires human approval for decisions',
 ARRAY['Approval workflows', 'Sensitive actions', 'Quality review'],
 ARRAY['Escalation', 'Approval gates', 'Audit trail'],
 'Needs human oversight'),
('rag', 'RAG', 'Retrieves context from knowledge bases before responding',
 ARRAY['Knowledge retrieval', 'Context augmentation', 'Document QA'],
 ARRAY['Vector search', 'Context injection', 'Source citation'],
 'Needs knowledge base'),
('reflection', 'Reflection', 'Self-evaluates and improves outputs',
 ARRAY['Quality improvement', 'Error correction', 'Output refinement'],
 ARRAY['Self-critique', 'Iterative', 'Quality scoring'],
 'Output quality critical'),
('guardrails', 'Guardrails', 'Enforces policies, validates inputs/outputs',
 ARRAY['Policy enforcement', 'Content filtering', 'Compliance'],
 ARRAY['Validation', 'Blocking', 'Logging'],
 'Security/compliance critical')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- INTEGRATION CATALOG (20 integrations)
-- =============================================================================
INSERT INTO integration_catalog (name, type, icon, description, api_docs_url) VALUES
('ServiceNow', 'ITSM', '🎫', 'IT Service Management platform for incidents, changes, and CMDB', 'https://developer.servicenow.com'),
('Jira', 'DevOps', '📋', 'Issue tracking and project management', 'https://developer.atlassian.com/cloud/jira'),
('Azure DevOps', 'DevOps', '🔷', 'CI/CD pipelines, repos, and boards', 'https://docs.microsoft.com/azure/devops'),
('GitHub', 'DevOps', '🐙', 'Source control and CI/CD workflows', 'https://docs.github.com/rest'),
('GitLab', 'DevOps', '🦊', 'DevOps platform with CI/CD', 'https://docs.gitlab.com/ee/api'),
('Slack', 'Communication', '💬', 'Team messaging and notifications', 'https://api.slack.com'),
('Teams', 'Communication', '👥', 'Microsoft Teams messaging', 'https://docs.microsoft.com/graph'),
('PagerDuty', 'Monitoring', '🚨', 'Incident management and alerting', 'https://developer.pagerduty.com'),
('Datadog', 'Monitoring', '📊', 'Infrastructure and application monitoring', 'https://docs.datadoghq.com/api'),
('Splunk', 'Monitoring', '🔍', 'Log management and SIEM', 'https://dev.splunk.com'),
('Terraform', 'Cloud', '🏗️', 'Infrastructure as Code', 'https://developer.hashicorp.com/terraform'),
('Kubernetes', 'Cloud', '☸️', 'Container orchestration', 'https://kubernetes.io/docs/reference'),
('AWS', 'Cloud', '☁️', 'Amazon Web Services', 'https://docs.aws.amazon.com'),
('Azure', 'Cloud', '🔵', 'Microsoft Azure cloud platform', 'https://docs.microsoft.com/azure'),
('Vault', 'Security', '🔐', 'HashiCorp secrets management', 'https://developer.hashicorp.com/vault'),
('SonarQube', 'Security', '🛡️', 'Code quality and security scanning', 'https://docs.sonarqube.org/latest/extension-guide/web-api'),
('OpenAI', 'AI', '🤖', 'GPT models and embeddings', 'https://platform.openai.com/docs'),
('Anthropic', 'AI', '🧠', 'Claude AI models', 'https://docs.anthropic.com'),
('Confluence', 'Knowledge', '📚', 'Documentation and knowledge base', 'https://developer.atlassian.com/cloud/confluence'),
('Elasticsearch', 'Monitoring', '🔎', 'Search and analytics engine', 'https://www.elastic.co/guide/en/elasticsearch/reference')
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
    RAISE NOTICE '✅ Seed data inserted successfully!';
END $$;
