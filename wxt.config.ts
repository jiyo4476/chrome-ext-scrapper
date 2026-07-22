import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: () => {
    const apiEndpoint =
      import.meta.env.WXT_JOB_TRACKER_API_ENDPOINT?.trim() ||
      'http://jobtracker.local';
    const oauth2Endpoint =
      import.meta.env.WXT_OAUTH2_ENDPOINT?.trim() || 'https://auth.yjimmy.dev';

    return {
      name: 'Job Tracker Capture',
      description: 'Review and save visible job postings into Job Tracker.',
      version: '0.1.0',
      permissions: ['activeTab', 'identity', 'scripting', 'storage'],
      host_permissions: [
        `${new URL(apiEndpoint).origin}/*`,
        `${new URL(oauth2Endpoint).origin}/*`,
      ],
      action: {
        default_title: 'Save job to Job Tracker',
      },
      options_ui: {
        page: 'options.html',
        open_in_tab: true,
      },
    };
  },
});
