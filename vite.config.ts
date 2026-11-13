import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	resolve: mode === 'test' ? { conditions: ['browser'] } : undefined,
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// No precompression: the map ships 36k JPEG tiles and gzip/brotli twins would triple them for nothing on a LAN.
			adapter: adapter({ precompress: false })
		})
	]
}));
