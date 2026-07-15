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

// Keep this aligned with MAX_TAGS_PER_FIELD in schemas.ts. Importing the
// runtime schema here would pull Zod into the injected content-script bundle.
export const MAX_EXTRACTED_TAGS = 100;

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
  { canonical: 'Bash / Shell Scripting', aliases: ['Bash', 'Shell Scripting'] },
  { canonical: 'Accessibility (WCAG)', aliases: ['WCAG'] },
  { canonical: 'Progressive Web Apps', aliases: ['PWA'] },
  { canonical: 'Service Workers' },
  { canonical: 'WebSockets' },
  { canonical: 'WebRTC' },
  {
    canonical: 'OAuth 2.0 / OpenID Connect',
    aliases: ['OAuth 2.0', 'OpenID Connect', 'OAuth'],
  },
  { canonical: 'REST API Design', aliases: ['REST API'] },
  { canonical: 'GraphQL' },
  { canonical: 'gRPC' },
  { canonical: 'JWT' },
  { canonical: 'Database Design' },
  { canonical: 'Data Modeling' },
  { canonical: 'Query Optimization' },
  { canonical: 'SQL' },
  { canonical: 'Infrastructure as Code', aliases: ['IaC'] },
  { canonical: 'Site Reliability Engineering', aliases: ['SRE'] },
  { canonical: 'CI/CD' },
  { canonical: 'Natural Language Processing', aliases: ['NLP'] },
  { canonical: 'Machine Learning', aliases: ['ML'] },
  { canonical: 'Deep Learning' },
  { canonical: 'Computer Vision' },
  { canonical: 'Data Warehousing' },
  { canonical: 'ETL Pipelines', aliases: ['ETL'] },
  { canonical: 'iOS Development', aliases: ['iOS Development'] },
  { canonical: 'Android Development' },
  { canonical: 'Test-Driven Development', aliases: ['TDD'] },
  { canonical: 'End-to-End Testing', aliases: ['E2E Testing'] },
  { canonical: 'Integration Testing' },
  { canonical: 'Unit Testing' },
  { canonical: 'Zero Trust Architecture', aliases: ['Zero Trust'] },
  { canonical: 'Application Security', aliases: ['AppSec'] },
  { canonical: 'Penetration Testing', aliases: ['Pen Testing'] },
  { canonical: 'SOC 2 Compliance', aliases: ['SOC 2'] },
  { canonical: 'OWASP Top 10', aliases: ['OWASP'] },
  { canonical: 'Encryption' },
  { canonical: 'Networking (TCP/IP)', aliases: ['TCP/IP'] },
  { canonical: 'Embedded Systems' },
  { canonical: 'Distributed Systems' },
  { canonical: 'Microservices' },
  { canonical: 'System Design' },
  { canonical: 'Event-Driven Architecture', aliases: ['Event-Driven'] },
  { canonical: 'Domain-Driven Design', aliases: ['DDD'] },
  { canonical: 'CQRS / Event Sourcing', aliases: ['CQRS'] },
  { canonical: 'High Availability Design', aliases: ['High Availability'] },
  { canonical: 'Design Patterns' },
  { canonical: 'Agile / Scrum', aliases: ['Agile', 'Scrum'] },
  { canonical: 'Project Management' },
  { canonical: 'Incident Response' },
  { canonical: 'Technical Writing' },
  { canonical: 'Mentoring' },
  { canonical: 'Debugging' },
];

const SOFTWARE: readonly TaxonomyEntry[] = [
  { canonical: 'React' },
  { canonical: 'React Native' },
  { canonical: 'Next.js' },
  { canonical: 'Vue.js', aliases: ['Vue'] },
  { canonical: 'Angular' },
  { canonical: 'Svelte' },
  { canonical: 'SvelteKit' },
  { canonical: 'Nuxt.js' },
  { canonical: 'Remix' },
  { canonical: 'Redux' },
  { canonical: 'Zustand' },
  { canonical: 'TanStack Query' },
  { canonical: 'TanStack Table' },
  { canonical: 'Tailwind CSS', aliases: ['Tailwind'] },
  { canonical: 'Sass / SCSS', aliases: ['Sass', 'SCSS'] },
  { canonical: 'Webpack' },
  { canonical: 'Rollup' },
  { canonical: 'Vite' },
  { canonical: 'Node.js' },
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
  { canonical: 'Prisma' },
  { canonical: 'PostgreSQL', aliases: ['Postgres'] },
  { canonical: 'MySQL' },
  { canonical: 'SQLite' },
  { canonical: 'DynamoDB' },
  { canonical: 'Cassandra' },
  { canonical: 'MongoDB' },
  { canonical: 'Redis' },
  { canonical: 'Elasticsearch' },
  { canonical: 'Git' },
  { canonical: 'GitHub' },
  { canonical: 'GitLab' },
  { canonical: 'Bitbucket' },
  { canonical: 'GitHub Actions' },
  { canonical: 'GitLab CI/CD', aliases: ['GitLab CI'] },
  { canonical: 'Docker' },
  { canonical: 'Kubernetes', aliases: ['k8s'] },
  { canonical: 'Helm' },
  { canonical: 'Terraform' },
  { canonical: 'Ansible' },
  { canonical: 'Jenkins' },
  { canonical: 'AWS' },
  { canonical: 'Azure' },
  { canonical: 'GCP', aliases: ['Google Cloud Platform'] },
  { canonical: 'Cloudflare' },
  { canonical: 'Linux' },
  { canonical: 'OpenTelemetry' },
  { canonical: 'Prometheus' },
  { canonical: 'Grafana' },
  { canonical: 'Datadog' },
  { canonical: 'Splunk' },
  { canonical: 'LangChain' },
  { canonical: 'OpenAI API', aliases: ['OpenAI'] },
  { canonical: 'scikit-learn', aliases: ['sklearn'] },
  { canonical: 'PyTorch' },
  { canonical: 'TensorFlow' },
  { canonical: 'Pandas' },
  { canonical: 'NumPy' },
  { canonical: 'Jupyter' },
  { canonical: 'BigQuery' },
  { canonical: 'Snowflake' },
  { canonical: 'Airflow' },
  { canonical: 'Spark' },
  { canonical: 'Kafka' },
  { canonical: 'dbt' },
  { canonical: 'Jetpack Compose' },
  { canonical: 'SwiftUI' },
  { canonical: 'Flutter' },
  { canonical: 'Playwright' },
  { canonical: 'Cypress' },
  { canonical: 'Selenium' },
  { canonical: 'Vitest' },
  { canonical: 'Jest' },
  { canonical: 'PyTest' },
  { canonical: 'JUnit' },
  { canonical: 'Protocol Buffers', aliases: ['Protobuf'] },
  { canonical: 'Jira' },
  { canonical: 'Confluence' },
  { canonical: 'Slack' },
  { canonical: 'VS Code', aliases: ['Visual Studio Code'] },
  { canonical: 'IntelliJ' },
  { canonical: 'Figma' },
  { canonical: 'Notion' },
  { canonical: 'Tableau' },
];

const CERTIFICATIONS: readonly TaxonomyEntry[] = [
  {
    canonical: 'CompTIA Security+',
    aliases: ['Security+', 'CompTIA Security Plus'],
  },
  {
    canonical: 'CompTIA Network+',
    aliases: ['Network+', 'CompTIA Network Plus'],
  },
  { canonical: 'CompTIA A+', aliases: ['A+', 'CompTIA A Plus'] },
  { canonical: 'CISSP' },
  { canonical: 'PMP' },
  { canonical: 'CPA' },
  {
    canonical: 'AWS Certified Solutions Architect',
    aliases: ['AWS Solutions Architect'],
  },
  { canonical: 'AWS Certified Developer' },
  { canonical: 'AWS Certified DevOps Engineer' },
  { canonical: 'Azure Certified' },
  { canonical: 'GCP Certified', aliases: ['Google Cloud Certified'] },
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

function assertExclusiveOwnership(
  taxonomies: readonly (readonly TaxonomyEntry[])[],
): void {
  const owners = new Map<string, number>();
  taxonomies.forEach((entries, taxonomyIndex) => {
    entries.forEach(({ canonical, aliases = [] }) => {
      for (const term of [canonical, ...aliases]) {
        const key = term.toLocaleLowerCase();
        const owner = owners.get(key);
        if (owner !== undefined && owner !== taxonomyIndex) {
          throw new Error(`Taxonomy term has multiple owners: ${term}`);
        }
        owners.set(key, taxonomyIndex);
      }
    });
  });
}

assertExclusiveOwnership([SKILLS, SOFTWARE, CERTIFICATIONS]);

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

function maskTaxonomyMentions(
  description: string,
  entries: readonly CompiledTaxonomyEntry[],
): string {
  return entries.reduce(
    (masked, { patterns }) =>
      patterns.reduce(
        (value, pattern) =>
          value.replace(new RegExp(pattern.source, 'giu'), (match) =>
            ' '.repeat(match.length),
          ),
        masked,
      ),
    description,
  );
}

export function extractTaxonomy(description: string): ExtractedTaxonomy {
  const certifications = matchTaxonomy(description, COMPILED_CERTIFICATIONS);
  // A credential name can contain a platform name (for example, "AWS
  // Certified Solutions Architect" or "Kubernetes Administrator"). Mask the
  // credential phrase before software matching so the credential alone does
  // not fabricate a second category match. Independent platform mentions
  // elsewhere in the description still match normally.
  const descriptionWithoutCertifications = maskTaxonomyMentions(
    description,
    COMPILED_CERTIFICATIONS,
  );

  return {
    skills: matchTaxonomy(description, COMPILED_SKILLS),
    software: matchTaxonomy(
      descriptionWithoutCertifications,
      COMPILED_SOFTWARE,
    ),
    certifications,
  };
}
