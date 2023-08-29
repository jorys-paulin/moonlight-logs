/**
 * Moonlight Logs
 * A simple service to upload and download Moonlight log files, powered by CloudFlare Workers
 */

// @ts-ignore
import indexPage from './index.html';
// @ts-ignore
import resultPage from './result.html';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type MoonlightLogsKVMetadata = { name?: string; type?: string; lastModified?: number };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.endsWith('/')) {
			// Homepage route
			if (request.method === 'GET' && !url.searchParams.has('id')) {
				return new Response(indexPage, { headers: { 'Content-Type': 'text/html' } });
			}

			// Upload route
			if (request.method === 'POST') {
				const contentType = request.headers.get('Content-Type');

				if (!contentType) {
					return new Response('Missing Content-Type', { status: 400 });
				}

				const uuid = crypto.randomUUID();
				let content = null;
				let name = null;
				let type = 'text/plain';

				// Text data
				if (contentType.includes('text/plain')) {
					type = 'text/plain; charset=UTF-8';
					content = await request.arrayBuffer();
					if (url.searchParams.get('name')) {
						name = url.searchParams.get('name');
					}
				}

				// Form data
				if (contentType.includes('multipart/form-data')) {
					const formData = await request.formData();
					// @ts-expect-error
					const file: File = formData.get('file');
					type = file.type;
					content = await file.arrayBuffer();
					if (file.name) {
						name = file.name;
					}
				}

				// Binary data
				if (contentType.includes('application/octet-stream')) {
					type = 'application/octet-stream';
					content = await request.arrayBuffer();
					if (url.searchParams.get('name')) {
						name = url.searchParams.get('name');
					}
				}

				if (!content) {
					return new Response('Invalid Contents', { status: 400 });
				}

				if (content.byteLength > env.MOONLIGHT_MAX_FILE_SIZE) {
					return new Response('Payload Too Large', { status: 413 });
				}

				if (!name) {
					name = uuid + '.txt';
				}

				try {
					await env.MOONLIGHT_LOGS.put(uuid, content, {
						expirationTtl: env.MOONLIGHT_EXPIRATION_TTL,
						metadata: { name, type, lastModified: Date.now() },
					});
				} catch (error) {
					console.error(error);
					return new Response('Internal Server Error', { status: 500 });
				}

				const redirectURL = new URL(url);
				redirectURL.search = '';
				redirectURL.searchParams.set('id', uuid);
				const accept = request.headers.get('Accept');
				if (accept && accept.includes('text/html')) {
					return new Response(resultPage.replaceAll('{{ redirectURL }}', redirectURL.toString()), {
						headers: { 'Content-Type': 'text/html;charset=UTF-8' },
					});
				} else {
					return new Response(redirectURL.toString(), {
						status: 201,
						headers: { Location: redirectURL.toString() },
					});
				}
			}

			// Download route
			if (request.method === 'GET' && url.searchParams.has('id')) {
				const uuid = url.searchParams.get('id');

				// Check for UUID
				if (!uuid) {
					return new Response('Missing UUID', { status: 400 });
				}

				// Check for valid UUID
				if (!uuid.match(UUID_REGEX)) {
					return new Response('Invalid UUID', { status: 400 });
				}

				const { value, metadata } = await env.MOONLIGHT_LOGS.getWithMetadata<MoonlightLogsKVMetadata>(uuid, {
					cacheTtl: 60,
					type: 'arrayBuffer',
				});

				if (value === null) {
					return new Response('File not found', { status: 404 });
				}

				const headers = new Headers();
				headers.set('Content-Type', 'text/plain; charset=UTF-8');

				// File type
				if (metadata && metadata.type) {
					if (metadata.type === 'text/plain') {
						headers.set('Content-Type', 'text/plain; charset=UTF-8');
					} else {
						headers.set('Content-Type', metadata.type);
					}
				}

				// File name
				let filename = uuid + '.txt';
				if (metadata && metadata.name) {
					filename = metadata.name;
				}
				headers.set('Content-Disposition', `attachment; filename="${filename}"`);

				// Last modified metadata
				if (metadata && metadata.lastModified) {
					const lastModified = new Date(metadata.lastModified);
					// @ts-expect-error
					headers.set('Last-Modified', lastModified.toGMTString());
				}

				return new Response(value, { headers });
			}

			// Delete route
			if (request.method === 'DELETE' && url.searchParams.get('id')) {
				const uuid = url.searchParams.get('id');

				// Check for UUID
				if (!uuid) {
					return new Response('Missing UUID', { status: 400 });
				}

				// Check for valid UUID
				if (!uuid.match(UUID_REGEX)) {
					return new Response('Invalid UUID', { status: 400 });
				}

				// Only allow token bearers to use this route
				if (request.headers.get('Authorization') !== 'Bearer ' + env.MOONLIGHT_ADMIN_TOKEN) {
					return new Response('Forbidden', { status: 403 });
				}

				try {
					await env.MOONLIGHT_LOGS.delete(uuid);
				} catch (error) {
					console.error(error);
					return new Response('Internal Server Error', { status: 500 });
				}

				return new Response(null, { status: 204 });
			}
		}

		// // Favicon route
		// if (request.method === 'GET' && url.pathname === '/favicon.ico') {
		// 	return new Response('Not Found', { status: 404 });
		// }

		// Default route
		return new Response('Not Found', { status: 404 });
	},
};
