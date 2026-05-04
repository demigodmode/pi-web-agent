import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'pi-web-agent',
  description: 'Docs for @demigodmode/pi-web-agent',
  base: '/pi-web-agent/',
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Tools', link: '/tools' },
      { text: 'Presentation', link: '/presentation' },
      { text: 'Self-hosted', link: '/self-hosted-backends' },
      { text: 'Development', link: '/development' },
      { text: 'GitHub', link: 'https://github.com/demigodmode/pi-web-agent' }
    ],
    sidebar: [
      {
        text: 'Docs',
        items: [
          { text: 'Home', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Install', link: '/install' },
          { text: 'Presentation and settings', link: '/presentation' },
          { text: 'Setup modes', link: '/setup-modes' },
          { text: 'Self-hosted backends', link: '/self-hosted-backends' },
          { text: 'Tools', link: '/tools' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Development', link: '/development' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'Releases', link: '/releases' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/demigodmode/pi-web-agent' }
    ]
  }
});
