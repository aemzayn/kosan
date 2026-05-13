import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Huni',
  description: 'First-class database-per-tenant multi-tenancy for Node.js',
  srcDir: './docs',

  themeConfig: {
    nav: [
      { text: 'Docs', link: '/intro' },
      { text: 'GitHub', link: 'https://github.com/huni-dev/huni' },
    ],

    sidebar: [
      { text: 'Introduction', link: '/intro' },
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Quick Start', link: '/getting-started/quick-start' },
        ],
      },
      {
        text: 'Packages',
        collapsed: false,
        items: [
          { text: '@huni/core', link: '/packages/core' },
          { text: '@huni/sequelize', link: '/packages/sequelize' },
          { text: '@huni/prisma', link: '/packages/prisma' },
          { text: '@huni/drizzle', link: '/packages/drizzle' },
          { text: '@huni/express', link: '/packages/express' },
          { text: '@huni/fastify', link: '/packages/fastify' },
          { text: '@huni/koa', link: '/packages/koa' },
          { text: '@huni/nestjs', link: '/packages/nestjs' },
          { text: '@huni/cli', link: '/packages/cli' },
        ],
      },
      {
        text: 'Examples',
        collapsed: false,
        items: [
          { text: 'Sequelize + Express', link: '/examples/sequelize-express' },
          { text: 'Sequelize + NestJS', link: '/examples/sequelize-nestjs' },
          { text: 'Todo App', link: '/examples/todo-app' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Tenant Resolvers', link: '/guides/tenant-resolvers' },
          { text: 'Lifecycle Hooks', link: '/guides/lifecycle-hooks' },
          { text: 'Credential Encryption', link: '/guides/credential-encryption' },
          { text: 'Observability', link: '/guides/observability' },
          { text: 'Writing an Adapter', link: '/guides/writing-an-adapter' },
        ],
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Docker', link: '/deployment/docker' },
          { text: 'Subdomain Setup', link: '/deployment/subdomain-setup' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/huni-dev/huni' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © ${new Date().getFullYear()} Huni`,
    },

    search: {
      provider: 'local',
    },
  },
})
