<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

{@render children()}


<style>
	:global(html, body) {
		background: #09090b;
	}
</style>