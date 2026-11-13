<script lang="ts">
	import { thumbHashToRGBA } from 'thumbhash';

	let { hash, class: cls = '' }: { hash: string; class?: string } = $props();

	// A thumbhash decodes to a ~32px image; stretched full-screen it is an
	// inherently soft backdrop — no expensive CSS blur() needed (Pi-friendly).
	function render(canvas: HTMLCanvasElement) {
		try {
			const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
			const { w, h, rgba } = thumbHashToRGBA(bytes);
			canvas.width = w;
			canvas.height = h;
			canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
		} catch {
			// Bad hash: leave the canvas transparent (black stage shows through).
		}
	}
</script>

<canvas class={cls} use:render></canvas>
