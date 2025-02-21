/**
 * Moonlight Logs
 * A simple service to upload and download Moonlight log files, powered by CloudFlare Workers
 */

// @ts-ignore
import indexPage from './index.html';
// @ts-ignore
import resultPage from './result.html';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type MoonlightLogsKVMetadata = { name?: string; type?: string; size?: number; lastModified?: number; uploadedAt?: number };

/**
 * Validates if a given file name is valid or not
 *
 * @param {string} filename
 * @returns {boolean} `true` if the file name is valid, `false` if it's not
 */
function validateFilename(filename: string): boolean {
	if (filename.endsWith('.txt') || filename.endsWith('.log') || filename.endsWith('.dmp')) {
		return true;
	}
	return false;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/') {
			// Options and CORS route
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: {
						Allow: 'GET, POST, DELETE, OPTIONS',
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, POST, DELETE',
						'Access-Control-Allow-Headers': 'Authorization',
						'Access-Control-Max-Age': '86400',
					},
				});
			}

			// Homepage route
			if (request.method === 'GET' && !url.searchParams.has('id')) {
				return new Response(indexPage, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
			}

			// Upload route
			if (request.method === 'POST') {
				const contentType = request.headers.get('Content-Type');

				if (!contentType) {
					return new Response('Missing Content-Type', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				const uuid = crypto.randomUUID();
				let content = null;
				let name = null;
				let type = 'text/plain';

				// Text data
				if (contentType.includes('text/plain')) {
					type = 'text/plain; charset=UTF-8';
					content = await request.arrayBuffer();
					if (url.searchParams.has('name')) {
						name = url.searchParams.get('name');
					}
				}
				// Binary data
				else if (contentType.includes('application/octet-stream')) {
					type = 'application/octet-stream';
					content = await request.arrayBuffer();
					if (url.searchParams.has('name')) {
						name = url.searchParams.get('name');
					}
				} // Form data
				else if (contentType.includes('multipart/form-data')) {
					const formData = await request.formData();
					// @ts-expect-error
					const file: File = formData.get('file');
					type = file.type;
					content = await file.arrayBuffer();
					if (file.name) {
						name = file.name;
					}
				} else {
					return new Response('Unsupported Media Type', { status: 415, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				if (!content) {
					return new Response('Invalid Contents', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// File exeeds size limit
				if (content.byteLength > env.MOONLIGHT_MAX_FILE_SIZE) {
					return new Response('Payload Too Large', { status: 413, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Reject invalid file names
				if (!name || !validateFilename(name)) {
					return new Response('Invalid File Name', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Upload file to KV
				try {
					await env.MOONLIGHT_LOGS.put(uuid, content, {
						expirationTtl: env.MOONLIGHT_EXPIRATION_TTL,
						metadata: { name, type, size: content.byteLength, lastModified: Date.now() },
					});
				} catch (error) {
					console.error(error);
					return new Response('Internal Server Error', { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Generate uploaded file URL
				const redirectURL = new URL(url);
				redirectURL.search = '';
				redirectURL.searchParams.set('id', uuid);
				// Compute expiration date
				const date = new Date(Date.now() + env.MOONLIGHT_EXPIRATION_TTL * 1000);
				// Return page only for browsers
				const accept = request.headers.get('Accept');
				if (accept && accept.includes('text/html')) {
					// Return the success page with link injected into it
					return new Response(resultPage.replaceAll('{{ redirectURL }}', redirectURL.toString()), {
						headers: { 'Content-Type': 'text/html;charset=UTF-8' },
					});
				} else {
					// Return a 201 Created response with URL in header and body
					return new Response(redirectURL.toString(), {
						status: 201,
						headers: {
							Location: redirectURL.toString(),
							Expires: date.toUTCString(),
							'Access-Control-Allow-Origin': '*',
							'Access-Control-Expose-Headers': 'Location',
						},
					});
				}
			}

			// Download route
			if (request.method === 'GET' && url.searchParams.has('id')) {
				const uuid = url.searchParams.get('id');

				// Check for UUID
				if (!uuid) {
					return new Response('Missing UUID', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Check for valid UUID
				if (!uuid.match(UUID_REGEX)) {
					return new Response('Invalid UUID', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Try to fetch the file from KV
				const { value, metadata } = await env.MOONLIGHT_LOGS.getWithMetadata<MoonlightLogsKVMetadata>(uuid, {
					cacheTtl: 60,
					type: 'arrayBuffer',
				});

				// File doesn't exist
				if (value === null) {
					return new Response('File not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Response headers
				const headers = new Headers();
				headers.set('Content-Type', 'text/plain; charset=UTF-8');
				headers.set('Content-Disposition', `attachment; filename="${uuid}.txt"`);
				headers.set('Access-Control-Allow-Origin', '*');

				// File metadata
				if (metadata) {
					// File type
					if (metadata.type) {
						headers.set('Content-Type', metadata.type);
					}

					// File name
					if (metadata.name) {
						headers.set('Content-Disposition', `attachment; filename="${metadata.name}"`);
					}

					// File update date
					if (metadata.lastModified) {
						const lastModified = new Date(metadata.lastModified);
						headers.set('Last-Modified', lastModified.toUTCString());
					}
				}

				return new Response(value, { headers });
			}

			// Delete route
			if (request.method === 'DELETE' && url.searchParams.get('id')) {
				const uuid = url.searchParams.get('id');

				// Check for UUID
				if (!uuid) {
					return new Response('Missing UUID', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Check for valid UUID
				if (!uuid.match(UUID_REGEX)) {
					return new Response('Invalid UUID', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				// Only allow token bearers to use this route
				if (request.headers.get('Authorization') !== 'Bearer ' + env.MOONLIGHT_ADMIN_TOKEN) {
					return new Response('Forbidden', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				try {
					await env.MOONLIGHT_LOGS.delete(uuid);
				} catch (error) {
					console.error(error);
					return new Response('Internal Server Error', { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
				}

				return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
			}

			// Error for other HTTP methods
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { Allow: 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Origin': '*' },
			});
		}

		// // Favicon route
		if (request.method === 'GET' && url.pathname === '/favicon.ico') {
			return fetch('https://moonlight-stream.org/favicon.ico');
		}

		// Default route
		return new Response('Not Found', { status: 404 });
	},
};
