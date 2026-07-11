import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Job Tracker Capture',
    description: 'Review and save visible job postings into Job Tracker.',
    version: '0.1.0',
    permissions: ['activeTab', 'identity', 'scripting', 'storage'],
    host_permissions: ['http://localhost:3000/*', 'https://auth.yjimmy.dev/*'],
    action: {
      default_title: 'Save job to Job Tracker',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
