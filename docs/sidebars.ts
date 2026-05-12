import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Introduction',
    },
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Packages',
      collapsed: false,
      items: [
        'packages/core',
        'packages/sequelize',
        'packages/prisma',
        'packages/drizzle',
        'packages/express',
        'packages/fastify',
        'packages/koa',
        'packages/nestjs',
        'packages/cli',
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      collapsed: false,
      items: [
        'examples/sequelize-express',
        'examples/todo-app',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/tenant-resolvers',
        'guides/lifecycle-hooks',
        'guides/credential-encryption',
        'guides/observability',
        'guides/writing-an-adapter',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: [
        'deployment/docker',
        'deployment/subdomain-setup',
      ],
    },
  ],
};

export default sidebars;
