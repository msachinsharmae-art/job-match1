
UPDATE public.profiles
SET
  cv_summary = $$Sachin Sharma — Product Manager / Business Analyst with 3.5 years of experience delivering B2B SaaS and enterprise platforms.

Core experience:
- End-to-end product ownership: discovery, PRD writing, user story mapping, acceptance criteria, sprint planning, backlog grooming, release management.
- Business analysis: requirements elicitation, stakeholder workshops, gap analysis, BRD/FRD documentation, process mapping (BPMN), user journey mapping, wireframing in Figma/Balsamiq.
- Agile/Scrum delivery as Product Owner: sprint ceremonies, story pointing, velocity tracking, dependency management across cross-functional engineering, design, QA, and data teams.
- Customer-facing: requirements gathering with enterprise customers, demos, UAT coordination, training, post-launch support.

Technical depth:
- SQL (PostgreSQL/MySQL) for product analytics, cohort analysis, funnel queries, ad-hoc reporting.
- API testing & integration design with Postman, REST/JSON, webhooks, basic understanding of OAuth.
- Data tools: Excel/Google Sheets advanced, Mixpanel/Amplitude/GA4 for product analytics, Metabase/Looker dashboards.
- Familiarity with AI/LLM workflows: prompt design, RAG, embeddings, OpenAI/Gemini APIs, building AI-assisted internal tools and automation (n8n, Zapier).

Tools: JIRA, Confluence, Notion, Slack, Figma, Miro, Lucidchart, GitHub.

Domains: SaaS, B2B platforms, fintech, e-commerce, internal tools, workflow automation, AI products.

Strengths: roadmap prioritization (RICE/MoSCoW), OKR setting, customer requirements translation into engineering specs, stakeholder management across C-suite and engineering, A/B testing, KPI definition (activation, retention, NPS, conversion), go-to-market collaboration with sales/marketing.

Education: B.Tech / equivalent. Based in Gurugram (NCR), open to hybrid/remote roles across Delhi NCR.

Looking for: Product Manager, Senior Business Analyst, Product Owner, APM, Technical Product Manager, Platform PM, Growth PM, AI/ML Product Manager roles in SaaS, fintech, B2B, or AI-first companies.$$,
  target_roles = ARRAY[
    'Product Manager','Senior Product Manager','Associate Product Manager','Product Owner',
    'Technical Product Manager','Platform Product Manager','Growth Product Manager','AI Product Manager',
    'Business Analyst','Senior Business Analyst','Lead Business Analyst','Product Analyst',
    'Functional Consultant','Solutions Analyst'
  ],
  target_locations = ARRAY['Gurgaon','Gurugram','Delhi','New Delhi','Noida','NCR','Remote India','Bangalore','Bengaluru','Hybrid'],
  search_keywords = ARRAY[
    'Agile','Scrum','SaaS','B2B','SQL','Postman','REST API','Stakeholder Management','Cross-functional',
    'Customer Requirements','Roadmap','JIRA','Confluence','Figma','PRD','User Stories','Sprint Planning',
    'Backlog','UAT','Wireframing','Mixpanel','Amplitude','GA4','A/B Testing','OKR','RICE','Product Analytics',
    'Fintech','E-commerce','AI','LLM','Prompt Engineering','Workflow Automation','BRD','FRD','Gap Analysis',
    'Process Mapping','BPMN','Stakeholder Workshops','Go-to-market','KPI','Activation','Retention','NPS'
  ],
  min_match_score = 60
WHERE user_id IS NOT NULL;
