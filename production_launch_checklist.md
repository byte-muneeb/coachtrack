# Web App Production Launch Checklist

## 1. Speed & Performance
- [ ] **Compress and Optimize Images:** Convert images to modern formats like WebP or AVIF. Implement responsive image sizing (`srcset`).
- [ ] **Minify Assets:** Minify and bundle JavaScript, CSS, and HTML files to reduce transfer sizes.
- [ ] **Implement Code Splitting:** Split code by route or component to ensure users only download what they need for the initial view.
- [ ] **Set Up a CDN:** Serve static assets (images, fonts, scripts) via a Content Delivery Network like Cloudflare or AWS CloudFront.
- [ ] **Configure Browser Caching:** Set long-lived `Cache-Control` headers for static files and use asset hashing for cache busting.
- [ ] **Enable Text Compression:** Ensure the server compresses text assets using Gzip or Brotli.
- [ ] **Audit Core Web Vitals:** Measure and optimize Largest Contentful Paint (LCP), Interaction to Next Paint (INP), and Cumulative Layout Shift (CLS) using Google Lighthouse.

## 2. Security
- [ ] **Enforce HTTPS:** Secure all traffic with an SSL/TLS certificate.
- [ ] **Set Secure HTTP Headers:** Configure Content Security Policy (CSP), X-Frame-Options, and Strict-Transport-Security (HSTS).
- [ ] **Secure User Authentication:** Use robust token management (e.g., HTTP-only, secure cookies) and implement rate limiting on auth endpoints.
- [ ] **Sanitize Inputs:** Validate and sanitize all user data on the backend to prevent SQL Injection and Cross-Site Scripting (XSS).
- [ ] **Environment Variables:** Never hardcode API keys or database secrets; load them securely via environmental variables.

## 3. Reliability & Monitoring
- [ ] **Error Tracking:** Integrate a tool like Sentry or LogRocket to capture frontend and backend runtime errors automatically.
- [ ] **Performance Monitoring:** Set up an Application Performance Monitoring (APM) tool like Datadog or New Relic to track server response times.
- [ ] **Automated Backups:** Schedule daily, automated backups for your database with verified restoration paths.
- [ ] **Uptime Alerts:** Set up external uptime monitoring (e.g., UptimeRobot or Better Stack) to alert you instantly if the site goes down.

## 4. SEO & Accessibility
- [ ] **Meta Tags & Metadata:** Configure appropriate titles, descriptions, and Open Graph tags for social sharing on every page.
- [ ] **Sitemap and robots.txt:** Generate a dynamic `sitemap.xml` and configure a proper `robots.txt` file for search engine indexers.
- [ ] **Semantic HTML & ARIA:** Use semantic HTML elements and include appropriate ARIA attributes for screen-reader accessibility.
