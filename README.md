# Moonlight Logs

Moonlight Logs is a simple file hosting service to upload and share logs from Moonlight clients.

## Usage

Anyone can upload and download Moonlight log files directly by visiting the site and using the upload form to upload text files to the service.

Once a log is uploaded, a share link will be given which can then be used to download the log back until it expires (by default, after 30 days). This makes it easier to share log files between devices or multiple people.

### Uploading a log

You can upload a log file directly using the form available on the site. The site will check that your file is valid and isn't too large and will upload it.

Once the log is uploaded, you will get a sharable link as well as an expiration date after which the log will be deleted.

> **Log successfully uploaded!**
>
> Your log has been successfully uploaded and is now available at the following address:
> https://logs.moonlight-stream.org/?id=ab92275a-745e-4c35-ad95-83e853803a43
>
> Keep in mind that anyone with this link can download your log file and that it will be deleted after October 24, 2024.

### Downloading a log

You can download log files by simply visiting the URL given when they were uploaded (for example, https://logs.moonlight-stream.org/?id=ab92275a-745e-4c35-ad95-83e853803a43).

If the log file is available, it will be sent and your browser will ask you where to save it on your device.

If the request log file can't be found, or that is has expired, you will get the following error:

> **Log not found**
>
> The log you're looking for doesn't exist or has expired.

## Developers

Moonlight Logs uses plain HTTP for uploading and downloading logs, making it easy to implement it directly inside Moonlight clients.

### Uploading a log

Uploading a log file can be done by making a new request to the endpoint with plain text or multipart form request bodies.

```http
POST /?v=1&name=Moonlight-1582293654.log HTTP/1.1
Host: logs.moonlight-stream.org:443
User-Agent: Moonlight-PC/6.1.0
Content-Type: text/plain
Accept: */*
Content-Length: 21689

Lorem ipsum dolor sit amet consectetur, adipisicing elit. Velit consequuntur sapiente, accusamus pariatur nobis doloremque?
```

```http
HTTP/1.1 201 Created
Location: https://logs.moonlight-stream.org/?id=a1e1ff88-8491-48aa-b13a-a40f1744e38b
Expires: Thu, 24 Oct 2024 12:00:00 GMT

https://logs.moonlight-stream.org/?id=a1e1ff88-8491-48aa-b13a-a40f1744e38b
```

#### Versioning

This endpoint includes a query string parameter for versioning called `v`, used to tell the server which API version the client is compatible with.

The current value for this parameter is `1`, clients should include it in case of breaking API changes in the future.

Should an API version no longer be supported in the future, the server will return a `400` client error response code to the client, like a `410 Gone` for example.

#### Uploading raw text

You can upload raw text directly by making a `POST` request to that endpoint with a `Content-Type` of `text/plain` and with your raw text as the request body.

You can also specify a name for your file to define its filename using the `name` query parameter (for example, `?name=Moonlight-1582293654.log`).

Here's an example of uploading a file as plain text using cURL:

```sh
curl --request POST \
 --url 'https://logs.moonlight-stream.org/?v=1&name=Moonlight-1582293654.log' \
  --header 'Content-Type: text/plain' \
 --data 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Repellendus quaerat nesciunt perferendis vitae, perspiciatis repellat tenetur dolores quibusdam cumque dignissimos. Sequi, aperiam. Eligendi, recusandae placeat ab ratione neque quis magnam.'

curl --request POST \
 --url 'https://logs.moonlight-stream.org/?v=1&name=newestMoonlightTest.log' \
  --header 'Content-Type: text/plain' \
 --data '@newestMoonlightTest.log'
```

Once the request has been processed, the server will return a successful or an error response (see below).

#### Uploading multipart forms

You can also send the log file as part of a multipart form using a `Content-Type` of `multipart/form`, with the file attached to the `file` field. Using this method, the attached file's filename will be used as the log's name. This method is primarily used by the site's upload form.

Here's an example of uploading a file as part of a form using cURL:

```sh
curl --request POST \
 --url 'https://logs.moonlight-stream.org/?v=1' \
  --header 'Content-Type: multipart/form-data' \
 --form 'file=@mis-test.log'
```

Once the request has been processed, the server will return a successful or an error response (see below).

#### Success response

When the log has been successfully uploaded, the server will respond with a `201 Created` status code and include two headers: `Location` with a link to the created log, and `Expires`, which indicates the date after which the log will expire and be deleted.

```http
HTTP/1.1 201 Created
Location: https://logs.moonlight-stream.org/?id=a1e1ff88-8491-48aa-b13a-a40f1744e38b
Expires: Thu, 24 Oct 2024 12:00:00 GMT
```

#### Error responses

Should an error occur while uploading a log, the server may send the following errors and status codes:

- `400 Missing Content-Type`: the request doesn't have a `Content-Type` header
- `400 Invalid Filename`: the log's filename is invalid (it doesn't end with `.log` or `.txt` for example)
- `400 Invalid Contents`: the log file doesn't have any content (empty file) or the content is invalid (not plain text)
- `413 Content Too Large`: the provided log file is too large (default maximum size is 25 MiB)
- `415 Unsupported Media Type`: the MIME type in the request's `Content-Type` is invalid or unsupported
- `500 Internal Server Error`: A server-side error occurred while uploading the log

### Downloading a log

Downloading a log can be done by making a `GET` request to the log's URL. This request will either get the file's contents as a response, or a `404` if the file isn't found or has expired.

Depending on where the log is stored, web servers might send the following headers:

- `Expires`: When the log will expire and be deleted
- `Content-Disposition`: Includes the file's filename

## Deploying

This application can be deployed on Cloudflare using the `wrangler` tool, which needs to have access to a Cloudflare account. You must first create a Cloudflare KV namespace and update the worker's configuration before deploying it.

### Creating the worker

Creating a new worker can be done inside the Cloudflare dashboard in the Workers section.

### KV namespaces

Moonlight Logs uses [Cloudflare KV](https://developers.cloudflare.com/kv/) as data storage to store log files. While it's not meant to store files, it can store up to 25 MiB of data (enough for text log files), and also includes built-in expiration (which automatically cleans old logs).

Workers are linked to a KV namespace via a [binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/) which links the two together and exposes the KV namespace's API though that binding.

Bindings are defined on the Cloudflare dashboard or in the `wrangler.conf` file of this project. Before deploying Moonlight Logs on your own, you should [create a new KV namespace](https://developers.cloudflare.com/kv/get-started/#2-create-a-kv-namespace) and change the binding in `wrangler.conf` to point to that new namespace.

### Deploying the worker

Deploying a worker can be done using the `wrangler deploy` command. For more details, see: https://developers.cloudflare.com/workers/get-started/guide/#4-deploy-your-project
