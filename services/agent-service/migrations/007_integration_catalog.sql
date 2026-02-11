-- Integration Catalog table
CREATE TABLE IF NOT EXISTS integration_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL,  -- ITSM, DevOps, Monitoring, Communication, Cloud, Security, AI
  icon VARCHAR(10),
  description TEXT,
  api_docs_url TEXT,
  auth_types TEXT DEFAULT 'OAuth2,API Key',  -- comma-separated supported auth types
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common integrations
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

-- Add config columns to agent_integrations if not exist
ALTER TABLE agent_integrations ADD COLUMN IF NOT EXISTS config_endpoint TEXT;
ALTER TABLE agent_integrations ADD COLUMN IF NOT EXISTS config_auth_type VARCHAR(50) DEFAULT 'API Key';
ALTER TABLE agent_integrations ADD COLUMN IF NOT EXISTS config_api_key TEXT;
ALTER TABLE agent_integrations ADD COLUMN IF NOT EXISTS is_configured BOOLEAN DEFAULT false;
