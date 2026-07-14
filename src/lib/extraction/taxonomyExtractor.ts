interface TaxonomyEntry {
  canonical: string;
  aliases?: readonly string[];
}

interface CompiledTaxonomyEntry {
  canonical: string;
  patterns: RegExp[];
}

export interface ExtractedTaxonomy {
  skills: string[];
  software: string[];
  certifications: string[];
}

// Keep this aligned with MAX_TAGS_PER_FIELD in schemas.ts. Importing that
// runtime module here would pull Zod into the injected content-script bundle.
const MAX_EXTRACTED_TAGS = 100;

const SKILLS: readonly TaxonomyEntry[] = [
  { canonical: 'TypeScript' },
  { canonical: 'JavaScript' },
  { canonical: 'Python' },
  { canonical: 'Kotlin' },
  { canonical: 'Swift' },
  { canonical: 'Scala' },
  { canonical: 'Haskell' },
  { canonical: 'Clojure' },
  { canonical: 'Elixir' },
  { canonical: 'Erlang' },
  { canonical: 'PowerShell' },
  { canonical: 'Ruby' },
  { canonical: 'Rust' },
  { canonical: 'Java' },
  { canonical: 'PHP' },
  { canonical: 'C#' },
  { canonical: 'C++' },
  {
    canonical: 'Bash / Shell Scripting',
    aliases: ['Bash', 'Shell Scripting'],
  },
  { canonical: 'Accessibility (WCAG)', aliases: ['WCAG'] },
  { canonical: 'Progressive Web Apps', aliases: ['PWA'] },
  { canonical: 'Service Workers' },
  { canonical: 'TanStack Query' },
  { canonical: 'TanStack Table' },
  { canonical: 'Tailwind CSS', aliases: ['Tailwind'] },
  { canonical: 'Sass / SCSS', aliases: ['Sass', 'SCSS'] },
  { canonical: 'CSS Modules' },
  { canonical: 'CSS3' },
  { canonical: 'HTML5' },
  { canonical: 'SvelteKit' },
  { canonical: 'Svelte' },
  { canonical: 'Next.js' },
  { canonical: 'Nuxt.js' },
  { canonical: 'Remix' },
  { canonical: 'Angular' },
  { canonical: 'Vue.js', aliases: ['Vue'] },
  { canonical: 'React Native' },
  { canonical: 'React' },
  { canonical: 'Redux' },
  { canonical: 'Zustand' },
  { canonical: 'Webpack' },
  { canonical: 'Rollup' },
  { canonical: 'Vite' },
  { canonical: 'WebSockets' },
  { canonical: 'WebRTC' },
  {
    canonical: 'OAuth 2.0 / OpenID Connect',
    aliases: ['OAuth 2.0', 'OpenID Connect', 'OAuth'],
  },
  { canonical: 'REST API Design', aliases: ['REST API'] },
  { canonical: 'ASP.NET Core', aliases: ['ASP.NET'] },
  { canonical: 'Spring Boot', aliases: ['Spring'] },
  { canonical: 'Ruby on Rails', aliases: ['Rails'] },
  { canonical: 'Express.js', aliases: ['Express'] },
  { canonical: 'Fastify' },
  { canonical: 'NestJS' },
  { canonical: 'Django' },
  { canonical: 'Flask' },
  { canonical: 'FastAPI' },
  { canonical: 'Laravel' },
  { canonical: 'Node.js' },
  { canonical: 'GraphQL' },
  { canonical: 'gRPC' },
  { canonical: 'JWT' },
  { canonical: 'Database Design' },
  { canonical: 'Data Modeling' },
  { canonical: 'Query Optimization' },
  { canonical: 'PostgreSQL', aliases: ['Postgres'] },
  { canonical: 'MySQL' },
  { canonical: 'SQLite' },
  { canonical: 'DynamoDB' },
  { canonical: 'Cassandra' },
  { canonical: 'MongoDB' },
  { canonical: 'Redis' },
  { canonical: 'Elasticsearch' },
  { canonical: 'SQL' },
  { canonical: 'Infrastructure as Code', aliases: ['IaC'] },
  { canonical: 'Site Reliability Engineering', aliases: ['SRE'] },
  { canonical: 'Serverless / Lambda', aliases: ['Serverless', 'Lambda'] },
  { canonical: 'GitHub Actions' },
  { canonical: 'GitLab CI/CD', aliases: ['GitLab CI'] },
  { canonical: 'OpenTelemetry' },
  { canonical: 'Kubernetes', aliases: ['k8s'] },
  { canonical: 'Terraform' },
  { canonical: 'Ansible' },
  { canonical: 'Jenkins' },
  { canonical: 'Prometheus' },
  { canonical: 'Grafana' },
  { canonical: 'Docker' },
  { canonical: 'Helm' },
  { canonical: 'Cloudflare' },
  { canonical: 'Linux' },
  { canonical: 'AWS' },
  { canonical: 'GCP' },
  { canonical: 'Azure' },
  { canonical: 'CI/CD' },
  { canonical: 'Natural Language Processing', aliases: ['NLP'] },
  { canonical: 'Machine Learning', aliases: ['ML'] },
  { canonical: 'Deep Learning' },
  { canonical: 'Computer Vision' },
  { canonical: 'Data Warehousing' },
  { canonical: 'ETL Pipelines', aliases: ['ETL'] },
  { canonical: 'LangChain' },
  { canonical: 'OpenAI API', aliases: ['OpenAI'] },
  { canonical: 'scikit-learn', aliases: ['sklearn'] },
  { canonical: 'PyTorch' },
  { canonical: 'TensorFlow' },
  { canonical: 'Pandas' },
  { canonical: 'NumPy' },
  { canonical: 'BigQuery' },
  { canonical: 'Snowflake' },
  { canonical: 'Airflow' },
  { canonical: 'Spark' },
  { canonical: 'Kafka' },
  { canonical: 'dbt' },
  { canonical: 'iOS Development', aliases: ['iOS'] },
  { canonical: 'Android Development', aliases: ['Android'] },
  { canonical: 'Jetpack Compose' },
  { canonical: 'SwiftUI' },
  { canonical: 'Flutter' },
  { canonical: 'Test-Driven Development', aliases: ['TDD'] },
  { canonical: 'End-to-End Testing', aliases: ['E2E Testing'] },
  { canonical: 'Integration Testing' },
  { canonical: 'Unit Testing' },
  { canonical: 'Playwright' },
  { canonical: 'Cypress' },
  { canonical: 'Selenium' },
  { canonical: 'Vitest' },
  { canonical: 'Jest' },
  { canonical: 'PyTest' },
  { canonical: 'JUnit' },
  { canonical: 'Zero Trust Architecture', aliases: ['Zero Trust'] },
  { canonical: 'Application Security', aliases: ['AppSec'] },
  { canonical: 'Penetration Testing', aliases: ['Pen Testing'] },
  { canonical: 'SOC 2 Compliance', aliases: ['SOC 2'] },
  { canonical: 'OWASP Top 10', aliases: ['OWASP'] },
  { canonical: 'Encryption' },
  { canonical: 'Networking (TCP/IP)', aliases: ['TCP/IP'] },
  { canonical: 'Embedded Systems' },
  { canonical: 'Protocol Buffers', aliases: ['Protobuf'] },
  { canonical: 'Distributed Systems' },
  { canonical: 'Microservices' },
  { canonical: 'System Design' },
  { canonical: 'Event-Driven Architecture', aliases: ['Event-Driven'] },
  { canonical: 'Domain-Driven Design', aliases: ['DDD'] },
  { canonical: 'CQRS / Event Sourcing', aliases: ['CQRS'] },
  { canonical: 'High Availability Design', aliases: ['High Availability'] },
  { canonical: 'Design Patterns' },
  { canonical: 'Git' },
  { canonical: 'Agile / Scrum', aliases: ['Agile', 'Scrum'] },
  { canonical: 'Technical Writing' },
  { canonical: 'Mentoring' },
  { canonical: 'Debugging' },
];

const SOFTWARE: readonly TaxonomyEntry[] = [
  { canonical: 'Jira' },
  { canonical: 'Confluence' },
  { canonical: 'Slack' },
  { canonical: 'Bitbucket' },
  { canonical: 'VS Code', aliases: ['Visual Studio Code'] },
  { canonical: 'IntelliJ' },
  { canonical: 'Figma' },
  { canonical: 'Notion' },
  { canonical: 'Datadog' },
  { canonical: 'Splunk' },
  { canonical: 'Tableau' },
  { canonical: 'GitHub' },
  { canonical: 'GitLab' },
];

const CERTIFICATIONS: readonly TaxonomyEntry[] = [
  { canonical: 'AWS Certified' },
  { canonical: 'Azure Certified' },
  { canonical: 'GCP Certified', aliases: ['Google Cloud Certified'] },
  { canonical: 'CPA' },
  { canonical: 'PMP' },
  { canonical: 'CISSP' },
  { canonical: 'CompTIA' },
  { canonical: 'Kubernetes Administrator', aliases: ['CKA'] },
  { canonical: 'Terraform Associate' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTaxonomy(
  entries: readonly TaxonomyEntry[],
): CompiledTaxonomyEntry[] {
  return entries.map(({ canonical, aliases = [] }) => ({
    canonical,
    patterns: [canonical, ...aliases].map(
      (term) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
          'iu',
        ),
    ),
  }));
}

const COMPILED_SKILLS = compileTaxonomy(SKILLS);
const COMPILED_SOFTWARE = compileTaxonomy(SOFTWARE);
const COMPILED_CERTIFICATIONS = compileTaxonomy(CERTIFICATIONS);

function matchTaxonomy(
  description: string,
  entries: readonly CompiledTaxonomyEntry[],
): string[] {
  return entries
    .filter(({ patterns }) =>
      patterns.some((pattern) => pattern.test(description)),
    )
    .map(({ canonical }) => canonical)
    .slice(0, MAX_EXTRACTED_TAGS);
}

export function extractTaxonomy(description: string): ExtractedTaxonomy {
  return {
    skills: matchTaxonomy(description, COMPILED_SKILLS),
    software: matchTaxonomy(description, COMPILED_SOFTWARE),
    certifications: matchTaxonomy(description, COMPILED_CERTIFICATIONS),
  };
}
