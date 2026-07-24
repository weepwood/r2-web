![93c1205d.png](https://image.viki.moe/github/93c1205d.png)

**[中文](./readme.md) | English**

# R2 Web

📁 A lightweight, elegant, pure-browser Cloudflare R2 file manager. Everything happens right in your browser.

> This project was recommended by Ruanyifeng in _[Tech Enthusiast Weekly (Issue 387)][ruanyifeng-weekly]_, many thanks for the support!
>
> Also welcome everyone to try it out and provide valuable feedback to make this tool even better and more user-friendly!

## Live Demo

Follow the [CORS setup guide](#1-configure-r2-bucket-cors) below, then visit **[r2.viki.moe](https://r2.viki.moe)** to start managing your R2 bucket immediately.

## Self-Hosting

Here are some common static hosting platforms for deployment. Click the buttons for one-click deployment:

| Platform         | Quick Deploy                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Vercel           | [![Deploy with Vercel](https://vercel.com/button)][vercel-deploy]                          |
| Netlify          | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)][netlify-deploy]      |
| Cloudflare Pages | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)][cloudflare-deploy] |

Other services can simply deploy the `src` directory. After deployment, remember to update your CORS rules to allow your origin to access the R2 API.

## Feedback

- [GitHub Issues](https://github.com/vikiboss/r2-web/issues) — bug reports, feature requests
- [QQ Group](https://qm.qq.com/q/e47kAlbdsc) — real-time discussion (Group ID: 1091212613)

## Why R2 Web?

**Pain points with traditional solutions:**

- The official Cloudflare console is basic and cumbersome to use, especially for managing large numbers of files (copying, moving, renaming, etc.)
- Third-party desktop clients require installation, painful across platforms
- CLI tools have a steep learning curve, not suited for quick ad-hoc tasks
- Other web tools aren't R2-focused, leaving gaps in features and experience

**What R2 Web solves:**

- Open in a browser and start immediately — zero installation, zero platform friction
- Drag & paste upload with image compression — save bandwidth and time
- PWA support — install to your home screen and use like a native app
- Pure client-side — your data never passes through a third-party server

**Where R2 Web falls short:**

- Very large file uploads (>300 MB) — use rclone or similar tools instead
- Complex permission management — use the official Cloudflare console
- Automated scripts — use the official SDK or CLI
- API integration — no backend; use the official SDK or call the R2 API directly

## Use Cases

- **File management**: Browse directories, rename, move, delete — easily handle large collections of files.
- **File browsing**: Built-in image/video/audio/text preview — quickly inspect content without downloading.
- **Private image hosting**: Drag & paste upload, auto compression, one-click copy as Markdown/HTML.
- **Multiple buckets**: Manually add several buckets from one account and switch between them from the top bar.

## Design Philosophy

- Zero build — source is the artifact, no compilation needed
- Zero framework — native Web APIs first, no framework dependency
- Zero backend — all logic runs in the browser, direct R2 API access
- Minimal aesthetic — black/white/grey + R2 orange, small radius, flat design
- Performance first — lazy loading, debounce/throttle, request caching
- Detail-oriented — smooth animations, immediate feedback, keyboard navigation

## Screenshots

![9392ee.png](https://image.viki.moe/github/9392ee.png)

![ea7dd6.png](https://image.viki.moe/github/ea7dd6.png)

## Feature Overview

| Category            | Details                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **File Management** | Directory browsing, paginated loading, lazy thumbnail loading; sort by name/date/size; rename, move, copy, delete; batch operations     |
| **Multiple Buckets**| Manually add, edit, remove local bucket profiles; top-bar switching; connection, token-scope, and CORS diagnostics                       |
| **File Upload**     | Drag/paste/picker upload; filename templates; automatic image compression before upload                                                   |
| **File Preview**    | Image preview; inline video/audio player; text file preview with syntax highlighting                                                       |
| **Link Copy**       | Direct URL, Markdown, HTML, presigned URL                                                                                                  |
| **Personalization** | Simplified/Traditional Chinese, English, Japanese; dark mode; safe config share link/QR code                                               |
| **PWA**             | Install to desktop, native-like experience                                                                                                |

## Quick Start

### 1. Configure R2 Bucket CORS

In the Cloudflare dashboard, go to R2 → Bucket → Settings → CORS Policy and add:

```json
[
  {
    "AllowedOrigins": ["https://r2.viki.moe"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": [
      "Content-Type",
      "x-amz-copy-source",
      "x-amz-metadata-directive"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Type",
      "Last-Modified"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

> [!TIP]
> For self-hosting, replace `AllowedOrigins` with the exact page origin, for example `https://example.com` or `http://localhost:5500`. Do not include a path or trailing slash.

> [!IMPORTANT]
> CORS only lets the browser read R2 responses. It does not grant an API token access to another bucket. For multiple buckets, the current Access Key must be authorized for every manually added bucket.

### 2. Enter Credentials

Visit [r2.viki.moe](https://r2.viki.moe), enter your R2 credentials, and connect. Credentials are stored only in your browser's localStorage and never uploaded anywhere.

### 3. Start Using

Browse files, drag & drop or press Ctrl+V to upload, right-click any file to rename, copy links, and more.

For image hosting, set a filename template with a hash placeholder and enable image compression for better performance and safety.

See [Multiple Bucket Guide](./docs/multi-bucket.md) for adding buckets and diagnosing CORS or token-scope problems.

## Tips & Tricks

### Filename Template Examples

- `[name]_[hash:6].[ext]` — original name + 6-char hash (default)
- `images/[date:YYYY/MM/DD]/[uuid].[ext]` — date-based directory structure
- `backup/[timestamp]-[name].[ext]` — timestamp-prefixed backup

### Config Share Link

Generate a config share link or QR code to synchronize bucket names and non-sensitive interface settings.

> [!NOTE]
> The link does not contain the Account ID, Access Key ID, or Secret Access Key. The receiving browser must enter its own account credentials.

### Cache Optimization

R2 Web has built-in request caching for common operations like directory listings. For CDN caching, configure cache rules in the Cloudflare dashboard to improve load speeds.

![fca0bf44.png](https://image.viki.moe/github/fca0bf44.png)

## Technical Details

A pure frontend application with no build step — write code and deploy immediately.

**Core technologies:** HTML5/CSS3/ES6+, CSS Layers, native `<dialog>`, native Fetch, Import Maps, WebAssembly

**Dependencies:**

- `aws4fetch` — AWS4 request signing for R2 S3 API
- `dayjs` — date formatting
- `@jsquash/*` — WebAssembly image compression (MozJPEG, OxiPNG, libwebp, libavif)
- `qrcode` — QR code generation

**Not required:** Node.js, Webpack, Vite, React, Vue or any other build tool or framework — keeping the project lightweight and dependency-free.

## Local Development

```bash
git clone https://github.com/vikiboss/r2-web.git
cd r2-web

# Install dependencies (for type hints only)
pnpm install

# Start local dev server
npx serve src
# or
python3 -m http.server 5500 --directory src
```

See [CLAUDE.md](./CLAUDE.md) for the full development guide.

## FAQ

**Q: Are my credentials safe?**

A: Credentials are stored only in your browser's localStorage and are never sent to an application server. Use a non-admin API token limited to the buckets you need. In a multi-bucket setup, add every managed bucket to the token scope.

**Q: Which browsers are supported?**

A: Modern browsers (latest Chrome/Edge/Firefox/Safari). No IE support.

**Q: Where does image compression happen?**

A: Local compression uses WebAssembly and runs entirely in your browser — no files are sent to any third-party server. If you use cloud compression (Tinify), images are sent to Tinify's servers.

**Q: Can I self-host?**

A: Yes — fork the repo, update `AllowedOrigins` in the CORS config to your exact origin, then deploy to any static hosting service.

**Q: What does the config share link contain?**

A: It contains bucket names, display names, custom domains, and interface preferences. It does not contain the Account ID, Access Key ID, or Secret Access Key.

**Q: Why can I not connect after configuring CORS?**

A: First verify that `AllowedOrigins` exactly matches the browser origin. Then verify that the API token is authorized for the target bucket. A token scoped only to the original bucket returns 403 for a newly added bucket, and the browser may surface an unreadable error response as `Failed to fetch`.

**Q: Why is my upload failing?**

A: Check the exact-origin CORS policy, the API token's bucket scope, credential validity, and the 300 MB file-size limit. Use rclone for large files.

## Roadmap

- Continuous UI/UX improvements and more shortcut actions

## Development Story

This project was built with Claude Opus 4.6 via vibe coding — entirely prompt-driven from requirements to implementation. See [plan.md](./plan.md) for the initial architecture and design prompts.

## License

MIT License

[ruanyifeng-weekly]: https://www.ruanyifeng.com/blog/2026/03/weekly-issue-387.html
[vercel-deploy]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvikiboss%2Fr2-web&project-name=r2-web&repository-name=r2-web
[netlify-deploy]: https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2Fvikiboss%2Fr2-web&integrationName=r2-web&integrationSlug=r2-web
[cloudflare-deploy]: https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fvikiboss%2Fr2-web
