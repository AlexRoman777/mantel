import { defineEnvVars } from '@sveltejs/kit/env';

// Every variable is optional: Mantel falls back to a default for each one.
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	DATA_DIR: { schema: optional, description: 'Config and cache directory (default ./data)' },
	MAP_DIR: { schema: optional, description: 'Map imagery directory (default DATA_DIR/map)' },
	IMMICH_URL: { schema: optional, description: 'Developer fallback; normally saved from the controller' },
	IMMICH_API_KEY: { schema: optional, description: 'Developer fallback; normally saved from the controller' },
	CACHE_CONCURRENCY: { schema: optional, description: 'Parallel downloads for a confirmed album cache, 1-8' },
	IMAGE_CACHE_MAX_GB: { schema: optional, description: 'Image cache ceiling in GB, 0 = unlimited' },
	IMMICH_UPDATE_POLL_MINUTES: { schema: optional, description: 'Shared album-metadata check interval' },
	PLAYLIST_REFRESH_MINUTES: { schema: optional, description: 'How often source membership is refreshed' },
	MAP_TILE_CONCURRENCY: { schema: optional, description: 'Parallel map tile downloads' },
	PUBLIC_PLAYER_PORT: { public: true, schema: optional, description: 'Published player port' },
	PUBLIC_CONTROL_PORT: { public: true, schema: optional, description: 'Published controller port' }
});
