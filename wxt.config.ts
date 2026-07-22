import { defineConfig } from 'wxt';

import {
  DEFAULT_JOB_TRACKER_API_ENDPOINT,
  DEFAULT_OAUTH2_ENDPOINT,
  resolveServiceEndpoint,
} from './src/lib/serviceEndpoints';

export default defineConfig({
  manifest: () => {
    const apiEndpoint = resolveServiceEndpoint(
      import.meta.env.WXT_JOB_TRACKER_API_ENDPOINT,
      DEFAULT_JOB_TRACKER_API_ENDPOINT,
    );
    const oauth2Endpoint = resolveServiceEndpoint(
      import.meta.env.WXT_OAUTH2_ENDPOINT,
      DEFAULT_OAUTH2_ENDPOINT,
    );

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
