# CLAUDE.md - AI Assistant Guide for baruther-blog

## Project Overview

**baruther-blog** is a minimalist, password-protected photo gallery website for sharing images privately. The site is designed for the address "barutherstr. 18" and is intentionally hidden from search engines.

**Target Domain:** baruther-ev.online
**Password:** `baruther`
**Hosting:** GitHub Pages with custom domain

## Tech Stack

| Technology | Purpose |
|------------|---------|
| HTML5 | Document structure |
| CSS3 | Styling with CSS custom properties |
| Vanilla JavaScript (ES6) | Password validation, animations |
| GitHub Pages | Static hosting |
| Custom Domain | DNS via Porkbun registrar |

**No build tools, frameworks, or dependencies are used.** This is a pure static site.

## Project Structure

```
baruther-blog/
├── index.html      # Main HTML document with password screen + gallery
├── style.css       # All styling (4.4 KB)
├── script.js       # Password logic + animations (2.3 KB)
├── robots.txt      # Blocks all search engine crawlers
├── ADIMLAR.md      # Setup instructions (Turkish)
├── CLAUDE.md       # This file - AI assistant guide
└── files.zip       # Archive of source files
```

## File Details

### index.html
- **Password screen:** Fixed overlay requiring authentication
- **Main content:** Gallery section hidden until authenticated
- **Meta tags:** `noindex, nofollow` to prevent search indexing
- **Image placeholders:** Template blocks for adding photos

### style.css
- **CSS Variables (`:root`):**
  - `--primary-bg: #ffffff` (white background)
  - `--primary-text: #1a1a1a` (dark text)
  - `--secondary-text: #666666` (gray text)
  - `--border-color: #e0e0e0` (light borders)
  - `--spacing-unit: 1.5rem`
- **Typography:** Georgia serif for titles, Arial/Helvetica for body
- **Animations:** fadeIn, imageReveal (staggered delays for 10 images), shake
- **Features:** Subtle grain texture overlay, responsive design, hover effects

### script.js
- **Password:** Stored in `CORRECT_PASSWORD` constant (line 2)
- **Authentication:** Uses `sessionStorage` for session persistence
- **Functions:**
  - `checkPassword()` - validates input against stored password
  - `showMainContent()` - reveals gallery after successful auth
- **UX:** Auto-focus on input, shake animation on wrong password

### robots.txt
```
User-agent: *
Disallow: /
```
Blocks all web crawlers from indexing the site.

## Development Workflow

### Local Development
1. Open `index.html` directly in browser
2. Password: `baruther`
3. No build step required - edit files and refresh

### Deployment
1. Commit changes to repository
2. Push to main branch
3. GitHub Pages automatically deploys from root directory
4. Changes visible within minutes

### Adding Photos
1. Prepare images (max 2000px width, JPG format)
2. Upload to repository root
3. Edit `index.html` and add image blocks:
```html
<div class="image-container">
    <img src="your-photo.jpg" alt="">
</div>
```

## Key Conventions

### Code Style
- No semicolons in JavaScript (current style uses them)
- CSS uses kebab-case for class names
- Indentation: 4 spaces
- Comments in English (documentation in Turkish)

### Naming Conventions
- Image files: lowercase, hyphens (e.g., `photo-1.jpg`)
- CSS classes: BEM-like but simplified (e.g., `.password-container`, `.site-title`)
- JavaScript: camelCase for variables and functions

### Privacy First
- **Always** maintain `robots.txt` blocking all crawlers
- **Always** include `<meta name="robots" content="noindex, nofollow">`
- **Never** add analytics, tracking, or external scripts
- Keep password protection functional at all times

## Important Notes for AI Assistants

### DO
- Keep the codebase minimal and dependency-free
- Maintain the existing visual aesthetic (minimalist, clean)
- Preserve password protection functionality
- Test changes work in all modern browsers
- Keep file sizes small for fast loading

### DON'T
- Add npm/package.json or build tools
- Include external dependencies or CDN links
- Remove or weaken privacy features
- Add analytics or tracking scripts
- Change the password without explicit request
- Add complex features that compromise simplicity

### When Making Changes
1. Read the relevant files first
2. Make minimal, focused changes
3. Preserve existing animation timings and styles
4. Test password flow still works
5. Verify responsive design on mobile

## DNS Configuration (Reference)

GitHub Pages IPs for A records:
- 185.199.108.153
- 185.199.109.153
- 185.199.110.153
- 185.199.111.153

CNAME for www: `<username>.github.io`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Site not loading | Check GitHub Pages is enabled, wait for DNS propagation |
| HTTPS errors | Enable "Enforce HTTPS" in GitHub Pages settings |
| Images not showing | Verify filename matches exactly (case-sensitive) |
| Password not working | Check `script.js` line 2 for `CORRECT_PASSWORD` value |
| Animations broken | Check CSS keyframes and class toggling in JS |

## Quick Commands

```bash
# Check git status
git status

# Stage and commit changes
git add -A && git commit -m "Update gallery"

# Push to deploy
git push origin main
```

## Related Documentation

- `ADIMLAR.md` - Step-by-step setup guide (Turkish)
- GitHub Pages docs: https://docs.github.com/en/pages
