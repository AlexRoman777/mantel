/** A complete stand-in for `$app/env/private` in tests: every variable is present, unset by default. */
export function privateEnv(values: Record<string, string | undefined> = {}) {
	return {
		DATA_DIR: undefined,
		MAP_DIR: undefined,
		IMMICH_URL: undefined,
		IMMICH_API_KEY: undefined,
		CACHE_CONCURRENCY: undefined,
		IMAGE_CACHE_MAX_GB: undefined,
		IMMICH_UPDATE_POLL_MINUTES: undefined,
		PLAYLIST_REFRESH_MINUTES: undefined,
		MAP_TILE_CONCURRENCY: undefined,
		...values
	};
}
