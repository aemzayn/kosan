import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Kosan',
  description: 'First-class database-per-tenant multi-tenancy for Node.js',
  srcDir: './docs',

  themeConfig: {
    nav: [
      { text: 'Docs', link: '/intro' },
      { text: 'GitHub', link: 'https://github.com/kosan-dev/kosan' },
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
          { text: '@kosan/core', link: '/packages/core' },
          { text: '@kosan/sequelize', link: '/packages/sequelize' },
          { text: '@kosan/prisma', link: '/packages/prisma' },
          { text: '@kosan/drizzle', link: '/packages/drizzle' },
          { text: '@kosan/express', link: '/packages/express' },
          { text: '@kosan/fastify', link: '/packages/fastify' },
          { text: '@kosan/koa', link: '/packages/koa' },
          { text: '@kosan/nestjs', link: '/packages/nestjs' },
          { text: '@kosan/cli', link: '/packages/cli' },
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
      { icon: 'github', link: 'https://github.com/kosan-dev/kosan' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © ${new Date().getFullYear()} Kosan`,
    },

    search: {
      provider: 'local',
    },
  },
})
