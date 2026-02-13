# FlowGrid Design — User Guide

## 1. Quickstart

**FlowGrid Design** helps you design AI agent networks for your organization. Describe what you want to automate, and AI designs a team of specialized agents — complete with workflows, skills, and configurations — ready to bring to life.

### Get started in 60 seconds

1. **Sign in** to FlowGrid and open the **Design Wizard**
2. **Select a process** you want to automate (e.g., Incident Management)
3. **Describe your goal** — what should agents handle, and what does success look like?
4. **Watch the AI work** — it proposes agents, generates workflows, and configures everything
5. **Import to Design Studio** — explore, edit, and refine your agent network visually

That's it. You've gone from an idea to a fully designed agent swarm.

---

## 2. Workflow Overview

FlowGrid follows a guided journey from idea to design:

```
Describe → Identify → Review → Generate Flows → Configure → Import
```

There are two main tools:

- **The Design Wizard** walks you through the process step by step. You describe what you want, and AI does the heavy lifting — identifying agents, generating workflows, and creating configurations.
- **The Design Studio** is your visual workspace. After the wizard imports your agents, you can explore them on a network graph, edit their details, manage skills and integrations, and view their workflows.

They work together: the Wizard creates, the Studio refines.

---

## 3. Objects & Concepts

### Agents

Agents are the workers in your network. Each agent has a specific role and responsibilities. FlowGrid recognizes several types:

- **Orchestrator** — The coordinator. It delegates tasks to other agents, manages the overall flow, and makes sure everything runs in the right order. Every agent network typically has one orchestrator.
- **Specialist** — Focused on one job. For example, a "Triage Agent" that classifies incoming incidents, or a "Notification Agent" that sends alerts.
- **Coordinator** — Manages a subset of agents or a specific phase of the process.
- **Monitor** — Watches for events, tracks metrics, or raises alerts when something needs attention.

### Capabilities

Capabilities describe what an agent *can do* — the actions and functions it's equipped to perform. For example, an Incident Triage Agent might have capabilities like "classify incident severity" and "extract affected systems from ticket description."

### Data Objects

Data objects are the pieces of information agents work with. Think of them as the inputs and outputs flowing between agents — things like incident records, approval requests, configuration items, or notification payloads.

### Processes

Processes are the workflows that agents follow. FlowGrid generates visual process flows (based on BPMN, an industry-standard notation) that show:

- Where the workflow starts and ends
- What decisions are made along the way
- Which tasks each agent performs
- How agents hand off work to each other

You don't need to understand BPMN notation — the visual flows are self-explanatory, showing boxes for tasks, diamonds for decisions, and arrows for the flow between them.

### Autonomy Levels

Each agent can operate with different levels of independence:

- **Autonomous** — The agent acts on its own, making decisions and executing tasks without waiting for approval.
- **Supervised** — The agent works independently but its actions are reviewed by humans periodically.
- **Human-in-the-Loop** — The agent prepares recommendations or does preliminary work, but a human must approve before the action is carried out.

### Human-in-the-Loop

Some decisions are too important — or too sensitive — to fully automate. Human-in-the-loop means a person stays involved at critical points. For example:

- A triage agent classifies an incident as Priority 1 → a human confirms before emergency procedures kick in
- An agent drafts a change request → a change manager reviews and approves it

You decide where humans stay involved when you design your agents.

---

## 4. Step-by-Step Instructions

### The Design Wizard

The wizard is an 8-step guided process. A progress bar at the top shows where you are — you can click any completed step to go back and make changes.

#### Step 1: Select a Process

You'll see a dropdown to choose a **Foundation** — this is a pre-existing collection of processes, capabilities, and data objects that describe your organization or domain.

Once you select a foundation, a list of available processes appears below. Click on the process you want to automate (for example, "Incident Management" or "Change Enablement"). The selected process highlights in blue.

Click **Continue →** to proceed.

> **Don't have a foundation yet?** You'll see a link to the Discovery module where you can create one first.

#### Step 2: Define Your Sub-Process

Now you get specific. Fill in four fields:

- **Sub-process Name** — Give it a short, descriptive name (e.g., "Incident Triage & Assignment")
- **What should be automated?** — Describe the workflow in your own words. Be specific about what happens, in what order, and who's involved.
- **Expected Outcome** — What does success look like? (e.g., "Incidents are automatically triaged and assigned to the right team within 5 minutes")
- **Constraints / Requirements** *(optional)* — Any must-haves, like "human approval needed for P1 incidents" or "maximum 3 agents"

**Not sure what to write?** Click the **🎲 Surprise Me** button to have AI generate an example sub-process for your selected process. It's a great way to see what good input looks like.

Click **🤖 Generate Agents** when you're ready.

#### Step 3: Review Proposed Agents

The AI analyzes your description and proposes an agent team. You'll see:

- **Summary stats** — How many agents were identified
- **Agent cards** — Each proposed agent shown as a card with its name, role (orchestrator/specialist), purpose, and key responsibilities

The orchestrator agent is visually distinct (highlighted in red) so you can immediately see which agent coordinates the others.

Review the proposal. If it looks good, click **Review & Edit Agents →** to fine-tune.

#### Step 4: Edit Agents

This is where you take control. Each agent is shown as an editable card where you can:

- Change the agent's **name**
- Adjust its **purpose** and **responsibilities**
- Modify its **pattern** (orchestrator, specialist, coordinator, etc.)

You can also:

- **➕ Add Agent** — Create a new agent from scratch
- **Remove agents** — Delete any that don't fit

Take your time here. The better your agent definitions, the better the generated workflows will be.

When you're happy, click **📊 Approve & Generate Agent Flows**.

#### Step 5: Flow Generation

The AI generates a workflow (process flow) for each agent, plus an orchestration flow that ties them all together. You'll see a progress bar as each flow is created.

This step is automatic — just wait for it to complete, then click **Review Agent Flows →**.

#### Step 6: Review Agent Flows

Each agent's workflow is displayed as a visual flow diagram. Use the **tabs** at the top to switch between agents and see each one's workflow.

The flows show:

- Start and end events
- Tasks the agent performs
- Decision points (gateways)
- How the flow branches and converges

These flows are visual — you can see at a glance what each agent does and in what order.

If something doesn't look right, click **← Regenerate** to go back and create new flows. Otherwise, click **✅ Approve All & Configure**.

#### Step 7: Agent Configuration

The AI generates detailed configurations for each agent, including:

- **Skills** — The specific capabilities each agent exposes (following the A2A protocol)
- **Tools** — What systems or services the agent can interact with
- **Interactions** — How agents communicate with each other

Review the configuration cards. When satisfied, click **✅ Approve & Import**.

#### Step 8: Import to Design Studio

You'll see a final summary showing the total number of agents, flows, and skills about to be created.

Click **🚀 Import & Create Swarm** to import everything into the Design Studio.

When the import completes, you'll see a success screen with a link to **🎨 Open Design Module** — click it to start exploring your agent network visually.

---

### The Design Studio

After importing from the wizard (or when returning to an existing design), the Design Studio is your main workspace.

#### Layout

The screen is divided into three areas:

- **Left sidebar** — Filters and agent list
- **Center workspace** — The main content area with multiple tabs
- **Header** — Shows stats (number of agents, relationships) and quick links back to the Wizard

#### Navigating Your Agents

**Filters** at the top of the sidebar let you narrow down what you see:

- **Foundation** — Select which foundation to view
- **Process** — Filter by process
- **Sub-process** — Filter by sub-process

Below the filters, the **Agent list** shows all agents matching your filters. Click any agent to select it and see its details in the main workspace.

The **Progress** section at the bottom of the sidebar shows how many agents are configured, compiled, and deployed.

#### Workspace Tabs

When you select an agent, the main workspace offers these tabs:

- **Overview** — A dashboard for the selected agent showing its name, type, description, stats (skills, capabilities, tools, relations), configuration details, and quick action buttons
- **Graph** — An interactive network visualization showing how agents connect to each other. Nodes represent agents, edges represent relationships. Click any node to select it. Use the legend to toggle different element types on and off.
- **Skills** — View and manage the agent's skills (A2A protocol capabilities). You can add skills manually or click **🤖 Generate with AI** to have them created automatically.
- **Relationships** — See all incoming and outgoing connections for the selected agent — who it delegates to, who reports to it, what data it consumes and produces.
- **Tools** — Manage integrations and external tools the agent connects to (e.g., ServiceNow, email systems, databases). Browse the integration catalog and add what your agent needs.
- **BPMN** — View and edit the agent's workflow in a full BPMN editor. The flows generated by the wizard appear here, and you can modify them directly.
- **A2A Card** — View the agent's A2A protocol card — a structured summary of who the agent is, what it can do, and how other agents can interact with it.

#### Editing an Agent

Select an agent from the sidebar, then:

1. On the **Overview** tab, click **✏️ Edit Description** to update its description
2. Click **⚙️ Configure** in the header to open the full configuration modal, where you can change the agent's name, type, autonomy level, decision authority, value stream, and more
3. Use the **Skills** tab to add, edit, or AI-generate skills
4. Use the **Tools** tab to add integrations

#### Understanding the Network Graph

The **Graph** tab shows your entire agent network as an interactive diagram:

- **Colored nodes** represent different types of elements (agents, capabilities, data objects)
- **Edges** (lines between nodes) show relationships — delegation, data flow, dependencies
- **Click a node** to select it and see its details
- **Use the legend** to toggle visibility of different element types
- The graph auto-layouts to minimize clutter, but you can drag nodes to rearrange

#### Saving Your Work

Changes are saved automatically to the FlowGrid platform as you make them. Your progress is tracked in the sidebar's progress section. The wizard also auto-saves your progress locally, so if you close your browser mid-wizard, you can pick up where you left off (state is kept for 24 hours).

---

## 5. Current Limitations & Workarounds

- **AI output may vary** — The same input can produce slightly different agent designs each time. If the result doesn't match your expectations, regenerate or edit manually in Step 4.
- **Generated flows may need tweaking** — Process flows are AI-generated starting points. Review them in Step 6, and refine them in the Design Studio's BPMN editor after import.
- **Currently a design tool** — FlowGrid Design focuses on designing and configuring agent networks. Runtime execution (actually running the agents) is on the roadmap.
- **Foundation required** — You need at least one Discovery Foundation before using the Design Wizard. Create one via the Discovery module first.
- **Browser-based** — FlowGrid runs in your web browser. For the best experience, use a modern browser (Chrome, Firefox, Safari, Edge) on a desktop or laptop.

---

## 6. What's Coming Next

FlowGrid Design is actively evolving. The current release focuses on the design and configuration phase of agent networks — giving you powerful tools to go from idea to a fully specified agent swarm.

**Coming soon:**

- **Export & sharing** — Export your agent designs as portable specifications that can be shared across teams or imported into other environments
- **Runtime orchestration** — Move from design to execution. Your configured agents will be deployable and runnable directly from the platform
- **Code generation** — Automatically generate implementation code from your agent designs, ready to deploy

*Features and timelines described here are forward-looking and may change. They represent our current direction but are not commitments. We'll keep this guide updated as new capabilities ship.*

---

*© 2026 Flowgrid Platform*
