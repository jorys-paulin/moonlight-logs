/**
 * Moonlight Logs
 * A simple service to upload and download Moonlight log files, powered by CloudFlare Workers
 */

/** Regex used to validate UUIDs */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Metadata for logs stored in CloudFlare KV */
type KVMetadata = { name?: string; type?: string; size?: number; lastModified?: number; uploadedAt?: number };

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

/**
 * Base template for pages
 * @param content Contents for the page
 * @param title Title for the page
 * @param description Description for the pahe
 * @returns
 */
function pageTemplate(
	content: string,
	title: string = 'Moonlight Logs',
	description: string = 'This is a small service to upload and download Moonlight logs.'
) {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${title}</title>
		<meta name="description" content="${description}" />
		<meta name="theme-color" content="#434343" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
		<style>
			:root {
				color-scheme: dark;
			}

			* {
				box-sizing: border-box;
			}

			body {
				max-width: 540px;
				margin: 0 auto;
				padding: 1rem;
				font-family: 'Open Sans', sans-serif;
				line-height: 1.5;
				background-color: #121212;
				color: #fff;
			}
		</style>
	</head>
	<body>
		${content}
	</body>
</html>`;
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
				return new Response(
					pageTemplate(
						`<style>
			form {
				display: grid;
				gap: 1rem;
				grid-template-columns: 2fr 1fr;
			}
		</style>
		<h1>Moonlight Logs</h1>
		<p>Moonlight Logs is a simple file hosting service to upload and share logs from Moonlight clients.</p>
		<h2>Upload a new log</h2>
		<p>You can use the following form to upload a log manually. Once uploaded you'll get a link you can use to share the log file.</p>
		<form method="post" enctype="multipart/form-data">
			<input type="file" name="file" id="fileInput" accept=".txt, .log, .dmp" required>
			<button type="submit">Upload</button>
		</form>
		<h2>Download a log</h2>
		<p>You can download a specific log if you know its unique identifier.</p>
		<form>
			<input type="text" name="id" placeholder="ab92275a-745e-4c35-ad95-83e853803a43" required>
			<button type="submit">Download</button>
		</form>
		<script>
			const fileInput = document.querySelector('input#fileInput');
			fileInput.addEventListener('change', (e) => {
				const file = e.target.files[0];
				// Check file size (25 MiB max)
				if (file.size > 26214400) {
					alert('Your selected file is too large, it must be under 25 MiB');
					e.target.value = '';
				}
			});
		</script>`,
						'Moonlight Logs',
						'Moonlight Logs is a simple file hosting service to upload and share logs from Moonlight clients.'
					),
					{ headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
				);
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
					const metadata: KVMetadata = { name, type, size: content.byteLength, lastModified: Date.now(), uploadedAt: Date.now() };
					await env.MOONLIGHT_LOGS.put(uuid, content, {
						expirationTtl: env.MOONLIGHT_EXPIRATION_TTL,
						metadata,
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
					return new Response(
						pageTemplate(
							`<h1>Log successfully uploaded!</h1>
		<p>Your log has been successfully uploaded and is now available at the following address:</p>
		<p><a href="${redirectURL.toString()}">${redirectURL.toString()}</a></p>
		<p>Keep in mind that anyone with this link can download your log file and that it will be deleted in 30 days.</p>
		<p><a href="">Go back to home page</a></p>`,
							'Log successfully uploaded!'
						),
						{
							headers: { 'Content-Type': 'text/html;charset=UTF-8' },
						}
					);
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
				const { value, metadata } = await env.MOONLIGHT_LOGS.getWithMetadata<KVMetadata>(uuid, {
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
