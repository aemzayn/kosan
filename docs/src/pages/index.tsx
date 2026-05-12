import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import clsx from 'clsx';
import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/getting-started/installation">
            Get Started →
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = { title: string; description: string };

const features: FeatureItem[] = [
  {
    title: 'Database-per-tenant',
    description:
      'Each tenant gets its own isolated database connection pool — no shared schemas, no cross-tenant data leaks.',
  },
  {
    title: 'ORM-agnostic core',
    description:
      'Use Sequelize or Prisma today. The connection registry, cache, and context propagation are ORM-independent.',
  },
  {
    title: 'Zero prop-drilling',
    description:
      'AsyncLocalStorage puts the tenant context wherever you need it — route handlers, services, utilities — without passing it through every function.',
  },
  {
    title: 'Framework adapters',
    description:
      'Drop-in middleware for Express, Fastify, and Koa. Resolves the tenant on every request and scopes the connection automatically.',
  },
  {
    title: 'Migration orchestrator',
    description:
      'The CLI runs migrations across all active tenants in parallel, with configurable concurrency and per-tenant failure isolation.',
  },
  {
    title: 'Production-ready cache',
    description:
      'LRU eviction and idle-timeout sweeping keep memory bounded. Observability hooks expose pool stats and slow queries.',
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4', styles.feature)}>
      <Heading as="h3">{title}</Heading>
      <p>{description}</p>
    </div>
  );
}

export default function Home(): JSX.Element {
  return (
    <Layout description="First-class database-per-tenant multi-tenancy for Node.js">
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {features.map((props) => (
                <Feature key={props.title} {...props} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
