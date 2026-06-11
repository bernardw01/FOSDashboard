# Measuring AI Spend Impact: Best Practices and Recommendations

> **Purpose:** Research summary for leadership reviewing whether AI investment is delivering positive business impact.  
> **Audience:** Finance, delivery leadership, and operators building AI cost visibility (including [Feature 017](features/017-ai-platform-usage-fibery-sync.md)).  
> **Date:** 2026-06-09  
> **Teamwork notebook:** [AI spend impact - measurement guide](https://win.godeap.io/app/projects/1615262/notebooks/311786)  
> **Jupyter notebook:** [ai-spend-impact-measurement.ipynb](ai-spend-impact-measurement.ipynb)

---

## Executive summary

Most organizations can answer **"How much are we spending on AI?"** long before they can answer **"Is that spend helping the company?"** Industry data consistently shows a gap between adoption and measurable financial impact: many firms report broad AI usage, but far fewer can tie usage to EBIT, margin, or customer outcomes.

The organizations that answer the impact question well share a common pattern:

1. **Treat AI as a portfolio of investments**, not a single line item (seats, API, infrastructure, training, and rework each behave differently).
2. **Establish baselines before scaling**, using metrics finance already trusts (cycle time, cost per unit, revenue per employee, defect rate).
3. **Connect three layers:** spend and usage signals, operational drivers, and P&L-linked outcomes.
4. **Report on a fixed cadence** with explicit assumptions, confidence levels, and termination criteria.
5. **Separate "efficiency gained" from "value captured"** - especially in professional services, where faster work can reduce billable revenue unless pricing and capacity models change.

This document summarizes those practices and recommends a phased measurement program aligned with harpin's existing systems (Clockify labor, Fibery agreements, FOS Dashboard, and the in-flight AI Usage Data sync).

---

## The core question (and why it is hard)

**"Is my AI spend positively impacting my company?"** is really four questions:

| Sub-question | What "yes" looks like | Common failure mode |
| --- | --- | --- |
| **Visibility** | Total AI cost is known by person, team, platform, and use case | Costs scattered across vendor consoles with no join to people or customers |
| **Allocation** | Spend can be attributed to R&D, internal ops, customer work, or shared platform | All usage lands in "shared IT" with no accountability |
| **Productivity** | Teams measurably do more quality work in the same time | Activity metrics (tokens, sessions, lines accepted) mistaken for value |
| **Business impact** | Efficiency shows up in margin, delivery, retention, or revenue | Productivity gains absorbed by review bottlenecks, QA, or pricing models |

Research and practitioner surveys repeatedly cite the same root causes when ROI proof fails:

- **No pre-deployment baseline** (often cited in ~60% of failed ROI attempts).
- **Low sustained adoption** (tools deployed but only a fraction of the target population uses them consistently).
- **Wrong measurement frame** (judging platform investments on a 12-month payback instead of a multi-year NPV model, or vice versa).
- **Underinvestment in process change** (AI budgets that allocate less than 10% to training, workflow redesign, and governance).

For engineering-heavy organizations, recent DORA and telemetry analyses add a further nuance: **individual throughput can rise while system-level delivery metrics stay flat or worsen** if downstream steps (review, testing, release, incident response) do not adapt. AI acts as an amplifier of existing strengths and weaknesses.

---

## Frameworks organizations actually use

### 1. Outcome-backward model (GitLab / delivery leadership)

Work backward from the business outcome you care about:

```text
Business goal  →  Drivers  →  Indicators  →  Baseline  →  Review cadence
```

**Example (faster customer delivery):**

| Layer | Example |
| --- | --- |
| Business goal | Reduce time from approved scope to production release by 25% |
| Drivers | Development speed, code quality, review efficiency, release automation |
| Indicators | Lead time for changes, deployment frequency, change failure rate, rework rate |
| Baseline | 4-8 weeks measured before expanding AI seat count |
| Cadence | Monthly indicator review; quarterly executive summary |

**Key practice:** Define indicators **before** deployment. Use imperfect proxies (rework %, time in review, escalations per sprint) rather than skipping measurement.

Sources: [GitLab - Connect AI tools to business outcomes](https://about.gitlab.com/the-source/ai/connect-ai-tools-to-business-outcomes-a-3-layer-framework/)

### 2. Total Economic Impact (TEI) / CFO audit trail

Forrester-style TEI and similar CFO guides emphasize:

- **Due diligence baseline** (4-8 weeks minimum) on named workflows.
- **Full cost stack:** licenses, API consumption, integration, security review, training, redirected staff time, and ongoing governance.
- **Benefit categories with confidence weighting:** time savings, revenue growth, cost avoidance, risk reduction, quality improvement (tag each High / Medium / Low).
- **Counterfactual honesty:** if cycle time improved but headcount, overtime, contractor spend, and vendor lines did not change, label savings as *potential* rather than realized.

Sources: [Explore Agentic - AI agent ROI playbook](https://www.exploreagentic.ai/playbooks/ai-agent-roi/), [Iternal - AI ROI quantification](https://iternal.ai/ai-roi-quantification)

### 3. Return on AI Investment (ROAI) - portfolio formula

A practical portfolio-level formula used in enterprise AI governance:

```text
ROAI = (Revenue Attribution + Realized Cost Savings + Risk Mitigation Value)
       / Total AI Investment
```

Where **Total AI Investment** includes:

- Subscription and seat fees (Claude Teams, Copilot, etc.)
- API and inference costs (Anthropic Console, OpenAI Platform)
- Internal platform and automation build cost (loaded labor)
- Training, change management, and security/compliance overhead

Leading organizations pair ROAI with **input metrics** (usage vs outcome correlation, high-impact use case adoption, integration completeness) and **output metrics** (revenue impact, cost per FTE, net revenue per employee, retention).

Sources: [Larridin - Strategic AI Productivity Measurement Framework (PDF)](https://larridin.com/hubfs/Strategic%20AI%20Productivity%20Measurement%20Framework%20V1.1.pdf)

### 4. Technology Business Management (TBM) for cost attribution

TBM Taxonomy 5.x gives finance a standard way to model AI as a **solution type** with lifecycle costs (data prep, training, inference, monitoring, retraining) rather than burying AI in generic SaaS.

Practices that translate well even without full TBM tooling:

- **Cost pools** for API inference, seat subscriptions, and AI engineering labor.
- **Chargeback vs showback:** central budget for foundation (literacy, governance, shared keys); chargeback or showback for incremental use-case spend tied to a business unit or customer.
- **Multi-dimensional tags:** governance tier, customer attribution, environment (prod vs internal).

Sources: [TBM Council - CFO framework for technology value](https://www.tbmcouncil.org/the-cfos-framework-for-technology-value/)

### 5. DORA and engineering delivery (for Claude Code / API-heavy eng)

For AI-assisted software development, mature orgs anchor on **system metrics**, not individual output:

| Metric | Why it matters for AI ROI |
| --- | --- |
| Lead time for changes | End-to-end speed from commit to production |
| Deployment frequency | Whether faster coding reaches customers |
| Change failure rate | Quality tax from AI-generated code |
| Mean time to recovery | Operational resilience under higher change volume |
| Rework / bug rate post-merge | "Verification tax" after AI drafts |

DORA's 2026 ROI work models value flowing: **AI adoption → engineering capabilities → DORA metrics → developer and user experience → financial outcomes**. It also warns that token costs are not stable; agentic workflows can multiply inference cost 5-20x vs simple completion.

**Avoid as primary ROI evidence:** lines of code, raw PR count, tokens consumed, or self-reported "felt productivity" without downstream validation.

Sources: [DORA - ROI of AI-assisted software development](https://dora.dev/ai/roi/report), [Faros - DORA ROI stress test](https://www.faros.ai/blog/dora-ai-roi-calculator-telemetry-inputs)

### 6. Professional services lens (relevant to harpin)

Professional services and consulting firms face a **pricing paradox**: AI compresses hours per engagement, which **reduces revenue** under hourly billing unless the firm captures efficiency elsewhere.

Strong firms track three levers simultaneously:

| Lever | Description | Example signal |
| --- | --- | --- |
| **Time compression** | Fewer hours per standard deliverable | Hours per ticket, matter, or sprint task vs baseline |
| **Capacity addition** | Redeploy saved time to more clients or deeper work | Matters closed or features shipped without headcount growth |
| **Pricing power** | Value-based or fixed fees capture margin from efficiency | Revenue per client, gross margin per engagement type |

Critical metric many firms skip: **billable conversion** - what percentage of time reclaimed by AI becomes billable or customer-visible output vs internal absorption.

Industry surveys note that professional services often scale AI faster than they scale **commercial returns** (efficiency and margin gains lag adoption). Formal ROI measurement remains uncommon (often cited in the high teens percentage of firms).

Sources: [Grant Thornton - 2026 AI Impact Survey (services)](https://www.grantthornton.com/insights/survey-reports/services/2026/services-insights-2026-ai-impact-survey), [Crossing - AI ROI for professional services firms](https://crossing.one/archive/ai-roi-professional-services-firms-2026)

---

## What to measure: a layered model

Think in four layers. Each layer answers a different stakeholder question.

### Layer 1 - Financial inventory (CFO)

**Question:** What is our fully loaded AI spend?

| Cost category | Examples | Notes |
| --- | --- | --- |
| **Seat / subscription** | Claude Teams, enterprise chat plans | Often fixed per user; easy to budget |
| **Variable API** | Anthropic Console, OpenAI org costs | Spikes with automation and agentic use |
| **Embedded product cost** | Customer-facing features calling models | Should tie to product P&L or customer |
| **People cost** | Prompt engineering, integration, governance | Often 2-3x license cost in year one |
| **Hidden cost** | Security review, data handling, rework from bad outputs | Rarely in vendor invoices |

**Best practice:** Single fact table with daily grain, person linkage, and platform dimension (harpin Feature 017 direction).

### Layer 2 - Usage and adoption (engineering and ops)

**Question:** Who uses AI, how intensely, and for what class of work?

| Signal | Use |
| --- | --- |
| Active users / seats | Adoption breadth |
| Cost and tokens per user | Outlier and governance detection |
| Sessions, requests, model mix | Shift toward expensive reasoning models |
| Vendor productivity metrics | Claude Code lines accepted, sessions (leading indicators only) |
| Tool coverage | Multiple tools vs standard stack |

**Best practice:** Compare usage cohorts (heavy vs light adopters) rather than org-wide averages only.

### Layer 3 - Operational drivers (delivery leaders)

**Question:** Are the levers that matter for our goals actually moving?

Choose drivers based on business model:

| Business model | High-value drivers |
| --- | --- |
| **Product / SaaS delivery** | Lead time, defect rate, deployment frequency, support ticket volume |
| **Client services** | Hours per deliverable, utilization, SLA adherence, margin per agreement |
| **Internal enablement** | Cycle time for finance close, hiring throughput, ticket resolution time |

**Best practice:** One **named workflow** per pilot (e.g. "L2 support triage" or "API integration story") with baseline and target documented upfront.

### Layer 4 - P&L and strategic outcomes (executive / board)

**Question:** Did anything meaningful hit the income statement or strategic plan?

| Outcome type | Examples |
| --- | --- |
| **Cost reduction** | Avoided hire, reduced contractor spend, lower support cost per ticket |
| **Revenue** | Faster time-to-market, higher win rate, expanded capacity without headcount |
| **Risk** | Fewer compliance incidents, reduced error rates in regulated workflows |
| **Strategic** | Competitive parity, talent retention, innovation pipeline depth |

**Best practice:** Report **realized** vs **counterfactual** savings in separate columns. Finance partners should sign off on metric definitions before scaling spend.

---

## Metrics that survive scrutiny vs metrics that mislead

### Prefer (outcome-linked or finance-adjacent)

- Cost per resolved support ticket (with quality guardrails)
- Lead time for changes (DORA)
- Hours per standard deliverable type (with quality sampling)
- Gross margin per engagement or product line
- Revenue or billable output per employee
- Defect / rework rate after AI adoption cohort comparison
- Time-to-close for recurring operational cycles
- Customer retention or NPS on AI-touching journeys (where applicable)

### Use with caution (leading indicators)

- Token volume, session count, active minutes
- Lines of code accepted (Claude Code and similar)
- Tasks marked complete in isolation
- Self-reported productivity surveys (useful for adoption, weak alone for ROI)

### Avoid as sole evidence

- "We deployed AI org-wide"
- Total queries or documents processed without quality or outcome linkage
- Vendor case-study ROI percentages without your baselines
- Individual developer speed tests without system-level delivery impact

---

## Measurement operating model

### Baseline discipline

| Step | Recommendation |
| --- | --- |
| Duration | 4-8 weeks minimum for workflow pilots; longer for seasonal businesses |
| Scope | One workflow or team before enterprise-wide claims |
| Control | Compare adopters vs similar non-adopter team where possible |
| Storage | Persist baselines where finance can audit (Fibery, BI, or ledger-adjacent sheets - not ad hoc Slack threads) |

### Reporting cadence

| Audience | Cadence | Content |
| --- | --- | --- |
| Operators | Weekly | Sync health, cost spikes, mapping gaps, top users by spend |
| Delivery leadership | Monthly | Driver metrics vs baseline, cohort comparisons, allocation coverage |
| Executive / finance | Quarterly | ROAI summary, realized vs counterfactual benefits, investment plan adjustments |

**Format that works:** Two-page executive summary - page 1 financial impact (ROI, payback, confidence), page 2 cost stack and assumptions.

### Confidence and governance

Tag each benefit line:

| Confidence | Criteria |
| --- | --- |
| **High** | Linked to audited financial or operational system of record |
| **Medium** | Strong operational proxy with consistent measurement |
| **Low** | Modeled or survey-based; exclude from hard ROI unless sensitivity-labeled |

Define **termination criteria** upfront (e.g. "If lead time has not improved 10% after two quarters at >60% adoption, pause seat expansion and fix workflow bottlenecks").

### Separate investment types

CFOs who split ROI types decide faster:

| Investment type | Appropriate frame |
| --- | --- |
| **Copilot / assistant seats** | Productivity multiplier on loaded labor; short payback if adoption is high |
| **Platform / API for product** | NPV over 2-3 years; tie to product revenue or cost-to-serve |
| **Automation / agents** | TEI on named workflow; include rework and failure costs |
| **Foundation (governance, literacy)** | Portfolio overhead; allocate across units, do not expect direct workflow ROI |

---

## Recommendations for harpin

These recommendations build on systems already in place or planned in this repository.

### Near term (0-3 months): Cost truth and accountability

**Goal:** Answer "how much, where, and who" with audit-ready data.

1. **Complete Feature 017 ingest** for Anthropic and OpenAI into Fibery `AI Usage Data/Usage`, with daily grain and Clockify user linkage.
2. **Populate Actor Mapping** for API keys and service accounts (Phase 0 showed Console message usage is key-centric, not email-centric).
3. **Establish allocation categories** even if initially mostly `Shared / unallocated`:
   - Product development (internal agreements, R&D tags)
   - Customer support (overlap with customer labor hours)
   - Internal ops
   - Shared platform
4. **Monthly spend report** (Fibery view or future FOS panel): total by platform, top 10 actors by cost, unmapped spend %, week-over-week delta.
5. **Finance checklist for fully loaded cost:** add seat invoices and internal labor estimates alongside API rows (vendor APIs rarely capture full TCO).

### Medium term (3-9 months): Link spend to labor and customers

**Goal:** Answer "is spend aligned with where we create value?"

1. **Join AI usage to Clockify `Labor Costs`** by person and week (Feature 017 Phase D direction): compare AI cost per person to billable hours by customer/agreement.
2. **Customer attribution rules:** when a person's dominant labor hours in period W are on Agreement X, tag a configurable share of AI spend (not 100% by default; document assumptions).
3. **Internal vs client split KPI:** `% of AI spend allocated to product development vs customer-attributed vs unallocated` - track unallocated downward over time.
4. **Cohort views:** heavy AI users vs light users on the same team; compare utilization, delivery milestones, or support metrics.

### Long term (9-18 months): Prove impact on delivery and margin

**Goal:** Answer "is the company better off because of AI?"

1. **Pick 2-3 strategic workflows** with executive sponsors (e.g. customer support triage, internal tooling, greenfield feature delivery).
2. **Baseline DORA or equivalent** for engineering workflows; baseline hours-per-deliverable for services work.
3. **Quarterly ROAI review** using the portfolio formula; include sensitivity on API cost (+50%, +200% scenarios for agentic shift).
4. **Pricing and capacity review** for client work: if AI reduces hours per deliverable, decide explicitly whether to capture benefit as margin, volume, or speed - do not assume hourly revenue stays constant.
5. **Optional FOS Dashboard panel** once cache shape is stable: AI spend vs labor cost ratio by agreement type, with historical snapshots per Feature 009 patterns.

### Anti-patterns to avoid internally

- Declaring ROI from Claude Code `lines accepted` or token totals alone.
- Allocating API key spend to a customer without labor or project corroboration.
- Scaling seats before review, QA, or release process can absorb higher code volume.
- Treating subscription and API surfaces as one budget line (they behave differently and need different owners).

---

## Starter scorecard (copy-ready)

Use this as a quarterly leadership review template.

### A. Spend health

| Metric | This quarter | Prior quarter | Target / note |
| --- | --- | --- | --- |
| Total AI spend (USD) | | | |
| Anthropic Console API | | | |
| Claude.ai subscription | | | |
| OpenAI Platform | | | |
| Seat / other subscriptions | | | |
| Unmapped spend (% of total) | | | < 10% |
| Spend per active user (median) | | | |

### B. Adoption

| Metric | This quarter | Prior quarter | Target / note |
| --- | --- | --- | --- |
| Active users (any AI surface) | | | |
| Heavy users (>P75 cost) | | | |
| Teams with >50% seat utilization | | | |

### C. Allocation (harpin-specific)

| Metric | This quarter | Prior quarter | Target / note |
| --- | --- | --- | --- |
| Product development | | | |
| Customer-attributed | | | |
| Internal ops | | | |
| Shared / unallocated | | | Decreasing |

### D. Outcome pilots (fill per workflow)

| Workflow | Baseline | Current | Realized $ impact | Confidence |
| --- | --- | --- | --- | --- |
| Example: L2 support triage | | | | H / M / L |
| Example: Feature delivery (eng) | | | | H / M / L |

### E. Decision log

| Decision | Rationale | Review date |
| --- | --- | --- |
| Continue / expand / pause seat program | | |
| API budget cap adjustment | | |
| Process investment (review automation, QA) | | |

---

## Industry benchmarks (use as sanity checks, not targets)

Benchmarks vary widely by sector, maturity, and measurement honesty. Use ranges to stress-test assumptions, not as guaranteed outcomes.

| Benchmark | Typical range cited | Caveat |
| --- | --- | --- |
| Individual dev task speed (controlled tasks) | 30-55% faster | Does not automatically translate to lead time |
| Org-wide EBIT impact from AI | Minority report >5% contribution | McKinsey-style surveys; self-reported |
| Time to cash-flow positive (enterprise AI programs) | Often 18-24+ months | Depends on investment type |
| Professional services time compression | 20-35% on targeted workflows | Revenue impact depends on pricing model |
| Formal ROI measurement adoption | Often <25% of firms | Most track spend before impact |

---

## References

### Frameworks and guides

- [GitLab - 3-layer framework: AI to business outcomes](https://about.gitlab.com/the-source/ai/connect-ai-tools-to-business-outcomes-a-3-layer-framework/)
- [Larridin - AI ROI measurement framework](https://larridin.com/blog/ai-roi-measurement)
- [Larridin - Strategic AI Productivity Measurement Framework (PDF)](https://larridin.com/hubfs/Strategic%20AI%20Productivity%20Measurement%20Framework%20V1.1.pdf)
- [Iternal - Enterprise AI ROI quantification (CFO guide)](https://iternal.ai/ai-roi-quantification)
- [Iternal - AI cost allocation: chargeback and showback](https://iternal.ai/ai-cost-allocation)
- [Explore Agentic - Measure AI agent ROI](https://www.exploreagentic.ai/playbooks/ai-agent-roi/)
- [TBM Council - CFO framework for technology value](https://www.tbmcouncil.org/the-cfos-framework-for-technology-value/)
- [Value Add VC - Enterprise AI ROI frameworks (2026)](https://valueaddvc.com/blog/how-enterprises-are-calculating-ai-roi-in-2026-the-frameworks-cfos-are-actually-using)

### Engineering and developer AI

- [DORA - ROI of AI-assisted software development](https://dora.dev/ai/roi/report)
- [Faros - Stress-test DORA AI ROI assumptions](https://www.faros.ai/blog/dora-ai-roi-calculator-telemetry-inputs)
- [Index.dev - AI coding assistant ROI and productivity data](https://www.index.dev/blog/ai-coding-assistants-roi-productivity)

### Professional services

- [Grant Thornton - Services insights: 2026 AI impact survey](https://www.grantthornton.com/insights/survey-reports/services/2026/services-insights-2026-ai-impact-survey)
- [Crossing - AI ROI for professional services firms](https://crossing.one/archive/ai-roi-professional-services-firms-2026)

### harpin internal

- [017 - AI platform usage Fibery sync](features/017-ai-platform-usage-fibery-sync.md)
- [017 - Phase 0 gap memo](features/017-phase0-gap-memo.md)
- [005 - Utilization Management Dashboard](features/005-utilization-management-dashboard.md) (labor cost system of record)

---

## Suggested next steps for review meeting

1. **Agree on the primary business model question** for the next 12 months: margin on client delivery, product velocity, or both (different metrics dominate).
2. **Approve Layer 1 completion** (Feature 017 + Actor Mapping + monthly spend report) as prerequisite for any org-wide ROI claim.
3. **Select two pilot workflows** with named owners and baseline start dates.
4. **Assign finance partner** to co-own metric definitions and quarterly ROAI template.
5. **Set explicit unallocated spend target** (e.g. reduce from 100% to <25% within two quarters via mapping and allocation rules).

---

*This document is research and recommendation only. It does not change product requirements or PRD version.*
