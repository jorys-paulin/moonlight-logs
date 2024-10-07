interface Env {
	// Max file size in bytes for file uploads
	MOONLIGHT_MAX_FILE_SIZE: number;

	// Time in seconds before a file expires
	MOONLIGHT_EXPIRATION_TTL: number;

	// Administration token used to authenticate DELETE requests
	MOONLIGHT_ADMIN_TOKEN: string;

	// Binding to the KV namespace used to store files
	MOONLIGHT_LOGS: KVNamespace;
}
