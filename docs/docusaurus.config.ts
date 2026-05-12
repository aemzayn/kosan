import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Huni',
  tagline: 'First-class database-per-tenant multi-tenancy for Node.js',
  favicon: 'img/favicon.ico',

  url: 'https://huni.dev',
  baseUrl: '/',

  organizationName: 'huni',
  projectName: 'huni',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/huni/huni/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Huni',
      logo: {
        alt: 'Huni Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/huni/huni',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/getting-started/installation' },
            { label: 'Core API', to: '/packages/core' },
            { label: 'Guides', to: '/guides/tenant-resolvers' },
          ],
        },
        {
          title: 'Packages',
          items: [
            { label: '@huni/sequelize', to: '/packages/sequelize' },
            { label: '@huni/prisma', to: '/packages/prisma' },
            { label: '@huni/express', to: '/packages/express' },
            { label: '@huni/fastify', to: '/packages/fastify' },
            { label: '@huni/koa', to: '/packages/koa' },
            { label: '@huni/cli', to: '/packages/cli' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/huni/huni' },
            { label: 'npm', href: 'https://www.npmjs.com/org/huni' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Huni. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'json', 'docker'],
    },
    algolia: undefined,
  } satisfies Preset.ThemeConfig,
};

export default config;
