#!/usr/bin/env node
/**
 * lab. — générateur du carnet de manips (lab.marill.dev).
 *
 * 1. Liste les dépôts publics du compte qui ont GitHub Pages activé.
 * 2. Sonde chaque page (statut, URL finale, <title>, meta description, og:image).
 * 3. Photographie chaque page avec Chrome (si playwright-core est disponible).
 * 4. Génère dist/ : index.html, 404.html, lab.css, lab.js, assets/, covers/, og.jpg, projects.json.
 *
 * Variables d'environnement :
 *   GITHUB_TOKEN        jeton (fourni par GitHub Actions) : évite la limite de 60 req/h
 *   LAB_OWNER           compte GitHub (défaut : DamienMarill)
 *   LAB_DOMAIN          domaine du labo (défaut : lab.marill.dev)
 *   LAB_FIXTURE         JSON de dépôts à utiliser à la place de l'API (tests)
 *   LAB_PROBE=0         ne pas sonder les pages (build hors-ligne)
 *   LAB_SCREENSHOTS=0   pas de photos ni d'image de partage
 *   CHROME_PATH         exécutable Chrome/Chromium
 */
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const OWNER = process.env.LAB_OWNER || 'DamienMarill';
const DOMAIN = process.env.LAB_DOMAIN || 'lab.marill.dev';
const TOKEN = process.env.GITHUB_TOKEN || '';
const FIXTURE = process.env.LAB_FIXTURE || '';
const PROBE = process.env.LAB_PROBE !== '0';
const SHOTS = process.env.LAB_SCREENSHOTS !== '0';
const TZ = 'Europe/Paris';

const TOPIC_HIDDEN = 'lab-hidden';
const TOPIC_PIN = 'lab-pin';
const FEATURED_COUNT = 3;

// Pastille de langage
const LANG_HUES = {
  typescript: '#3b82f6', javascript: '#eab308', svelte: '#f97316', html: '#f43f5e',
  css: '#a855f7', scss: '#d946ef', python: '#0ea5e9', php: '#6366f1', vue: '#10b981',
  go: '#06b6d4', 'c#': '#8b5cf6', java: '#ef4444', shell: '#84cc16', rust: '#f97316',
  dart: '#14b8a6', astro: '#ec4899',
};
const DEFAULT_HUE = '#71717a';

const STATUS = {
  'en-cours': 'en cours',
  stable: 'stable',
  'en-sommeil': 'en sommeil',
  archivee: 'archivée',
  'hors-ligne': 'hors ligne',
};

// ---------------------------------------------------------------- helpers
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const decodeEntities = (s = '') => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

// Pas d'emoji dans le carnet
const stripEmoji = (s = '') => s
  .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, '')
  .replace(/\s{2,}/g, ' ').trim();

const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
const searchText = (s = '') => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const humanize = (name) => {
  const s = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const fmtDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(new Date(iso));
const fmtDots = (iso) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ }).format(new Date(iso)).replace(/\//g, '.');
const fmtSync = (d) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ })
  .format(d).replace(/\//g, '.').replace(' ', ' · ');
const daysSince = (iso, now) => Math.floor((now - new Date(iso)) / 86400000);

const relative = (iso, now) => {
  const days = daysSince(iso, now);
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (days < 1) return "aujourd'hui";
  if (days < 30) return rtf.format(-days, 'day');
  if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
  return rtf.format(-Math.round(days / 365), 'year');
};

// ---------------------------------------------------------------- 1. dépôts
async function fetchRepos() {
  if (FIXTURE) {
    console.log(`• Dépôts lus depuis ${FIXTURE}`);
    return JSON.parse(await readFile(path.resolve(ROOT, FIXTURE), 'utf8'));
  }
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': `${DOMAIN}-builder`,
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const repos = [];
  for (let page = 1; page < 20; page++) {
    const url = `https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`API GitHub ${res.status} sur ${url} : ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  console.log(`• ${repos.length} dépôts publics trouvés pour ${OWNER}`);
  return repos;
}

// ---------------------------------------------------------------- 2. sonde
const metaContent = (html, attr, value) => {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!new RegExp(`${attr}\\s*=\\s*["']${value}["']`, 'i').test(tag)) continue;
    const c = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
    if (c) return decodeEntities((c[1] ?? c[2] ?? '').trim());
  }
  return '';
};

async function probe(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': `${DOMAIN}-builder`, accept: 'text/html' },
    });
    const html = res.ok ? (await res.text()).slice(0, 200_000) : '';
    let ogImage = metaContent(html, 'property', 'og:image') || metaContent(html, 'name', 'twitter:image');
    if (ogImage) { try { ogImage = new URL(ogImage, res.url).href; } catch { ogImage = ''; } }
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      title: decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()),
      ogTitle: metaContent(html, 'property', 'og:title'),
      description: metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description'),
      ogImage,
    };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, error: String(err?.message || err) };
  }
}

const cleanTitle = (raw, repoName) => {
  let t = stripEmoji(raw || '');
  // « Titre | nom_du_repo » → « Titre »
  t = t.replace(/\s*[|·–—-]\s*([^|·–—-]+)$/, (m, tail) => (norm(tail) === norm(repoName) ? '' : m)).trim();
  if (!t || /site not found|404/i.test(t)) return '';
  // Même texte que le nom du dépôt : on ne le garde que s'il est mis en forme (« Cours Strapi + Angular »)
  if (norm(t) === norm(repoName) && !/[A-Z\s]/.test(t)) return '';
  return t;
};

// ---------------------------------------------------------------- 3. navigateur (photos + image de partage)
async function openBrowser() {
  if (!SHOTS) return null;
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch {
    console.log('• playwright-core absent : pas de photos');
    return null;
  }
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) { console.log('• Chrome introuvable : pas de photos'); return null; }
  try {
    return await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--hide-scrollbars'],
      proxy: process.env.LAB_BROWSER_PROXY ? { server: process.env.LAB_BROWSER_PROXY, bypass: 'lab.local' } : undefined,
    });
  } catch (err) {
    console.log(`• Chrome n'a pas démarré (${err.message.split('\n')[0]}) : pas de photos`);
    return null;
  }
}

async function photograph(browser, items) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    ignoreHTTPSErrors: process.env.LAB_INSECURE === '1',
  });
  await mkdir(path.join(DIST, 'covers'), { recursive: true });
  const queue = items.filter((it) => it.online && !it.cover);
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      const page = await context.newPage();
      try {
        await page.goto(it.url, { waitUntil: 'networkidle', timeout: 25000 })
          .catch(() => page.waitForLoadState('load', { timeout: 10000 }));
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        await page.waitForTimeout(1800);
        const file = `covers/${it.slug}.jpg`;
        await page.screenshot({ path: path.join(DIST, file), type: 'jpeg', quality: 78 });
        it.cover = `/${file}`;
        it.coverKind = 'photo';
        console.log(`  ✓ photo ${it.name}`);
      } catch (err) {
        console.log(`  ✗ photo ${it.name} : ${err.message.split('\n')[0]}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await context.close();
}

// Image de partage (1200×630) : photo du haut de la page générée
async function shareImage(browser) {
  const TYPES = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  await context.route('http://lab.local/**', async (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p.endsWith('/')) p += 'index.html';
    try { await route.fulfill({ body: await readFile(path.join(DIST, p)), contentType: TYPES[p.split('.').pop()] }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  try {
    const page = await context.newPage();
    await page.goto('http://lab.local/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '.top__nav,.annot,.lead,.ledger,.folio{display:none!important}.hero{padding-top:36px!important}' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(DIST, 'og.jpg'), type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log('  ✓ image de partage');
    return true;
  } catch (err) {
    console.log(`  ✗ image de partage : ${err.message.split('\n')[0]}`);
    return false;
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- 4. rendu
const photo = (it, { eager = false } = {}) => (it.cover
  ? `<img src="${esc(it.cover)}" alt="Aperçu de ${esc(it.title)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" width="1280" height="800">`
  : `<span class="placeholder"><span>${esc(it.online ? 'pas de photo' : 'page introuvable')}</span></span>`);

const stamp = (it, extra = '') => `<span class="stamp stamp--${it.status}${extra}">${STATUS[it.status]}</span>`;
const lang = (it) => (it.language ? `<span class="lang" style="--hue:${it.hue}">${esc(it.language)}</span>` : '');
const ext = (href) => (/^https?:/.test(href) ? ' rel="noopener"' : '');

function polaroid(it, i) {
  const href = it.online ? it.href : it.repoUrl;
  return `
<figure class="shot shot--${i + 1}">
  <span class="tape" aria-hidden="true"></span>
  <a class="shot__photo" href="${esc(href)}"${ext(href)} tabindex="-1" aria-hidden="true">${photo(it, { eager: true })}</a>
  <figcaption><a href="${esc(href)}"${ext(href)}><b>manip ${it.num}</b> · ${esc(it.title)}</a>${lang(it)}</figcaption>
  ${i === 0 ? stamp(it, ' shot__stamp') : ''}
</figure>`;
}

function card(it) {
  const href = it.online ? it.href : it.repoUrl;
  const desc = it.description
    ? `<p class="card__desc">${esc(it.description)}</p>`
    : '<p class="card__desc card__desc--empty">Pas encore de notice pour cette manip.</p>';
  const topics = it.topics.length
    ? `<p class="card__topics">${it.topics.map((t) => `<span>#${esc(t)}</span>`).join(' ')}</p>`
    : '';
  return `
<article class="card reveal" data-lang="${esc(it.langSlug)}" data-status="${it.status}" data-search="${esc(it.search)}">
  <span class="tape" aria-hidden="true"></span>
  <div class="card__photo">${photo(it)}${stamp(it, ' card__stamp')}</div>
  <div class="card__body">
    <p class="card__num">manip ${it.num}${lang(it)}</p>
    <h3><a href="${esc(href)}"${ext(href)}>${esc(it.title)}</a></h3>
    ${desc}
    ${topics}
    <dl class="card__meta">
      <div><dt>adresse</dt><dd>${esc(it.online ? it.display : `github.com/${OWNER}/${it.name}`)}</dd></div>
      <div><dt>màj</dt><dd title="${esc(fmtDate(it.pushedAt))}">${esc(it.updatedRel)}</dd></div>
    </dl>
    <p class="card__links">
      <a class="card__go" href="${esc(href)}"${ext(href)} tabindex="-1" aria-hidden="true">${it.online ? 'ouvrir la manip' : 'voir le dépôt'} →</a>
      ${it.online ? `<a class="card__code" href="${esc(it.repoUrl)}" rel="noopener">code source</a>` : ''}
    </p>
  </div>
</article>`;
}

function filters(items) {
  const counts = new Map();
  for (const it of items) {
    if (!it.language) continue;
    const c = counts.get(it.langSlug) || { label: it.language, hue: it.hue, n: 0 };
    c.n++; counts.set(it.langSlug, c);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label))
    .map(([slug, c]) => `<button type="button" class="tab" style="--hue:${c.hue}" data-filter-lang="${esc(slug)}" aria-pressed="false">${esc(c.label)} <span>${c.n}</span></button>`)
    .join('\n');
}

// Logo : « lab » + un ballon penché dont le liquide est le point de Marill.dev
const MARK = '<svg class="brand__flask" viewBox="0 0 22 32" aria-hidden="true" focusable="false">'
  + '<path class="flask__liquid" d="M6.26 18A6.2 6.2 0 1 0 15.74 18Z"/>'
  + '<g transform="rotate(14 11 22)">'
  + '<circle class="flask__bub" cx="11" cy="22" r="2" style="--rest:-23px;--dx:1px"/>'
  + '<circle class="flask__bub" cx="11.6" cy="22.5" r="1.5" style="--rest:-13.5px;--dx:-1px;--d:-1.5s"/>'
  + '<circle class="flask__bub" cx="10.4" cy="23" r="1.1" style="--rest:-4px;--d:-3s"/>'
  + '<path class="flask__glass" d="M7 3V14.5A8.5 8.5 0 1 0 15 14.5V3M5 3H17"/>'
  + '</g></svg>';

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

// ---------------------------------------------------------------- main
async function main() {
  const now = new Date();
  const config = existsSync(path.join(ROOT, 'lab.config.json'))
    ? JSON.parse(await readFile(path.join(ROOT, 'lab.config.json'), 'utf8'))
    : {};
  const overrides = config.repos || {};

  const repos = (await fetchRepos()).filter((r) =>
    r.has_pages && !r.fork &&
    r.name.toLowerCase() !== `${OWNER}.github.io`.toLowerCase() &&
    !(r.topics || []).includes(TOPIC_HIDDEN) &&
    !overrides[r.name]?.hidden);

  // Numérotation stable : par date de création
  repos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const width = Math.max(2, String(repos.length).length);

  const items = [];
  for (const [i, r] of repos.entries()) {
    const o = overrides[r.name] || {};
    let url = `https://${DOMAIN}/${r.name}/`;
    if (r.homepage) {
      try {
        const h = new URL(r.homepage);
        if (!/github\.(io|com)$/.test(h.hostname) && h.hostname !== DOMAIN) url = h.href;
      } catch { /* homepage invalide : on garde l'URL Pages */ }
    }
    const p = PROBE ? await probe(url) : { ok: true, finalUrl: url };
    const final = new URL(p.finalUrl || url);
    const title = o.title || cleanTitle(p.ogTitle, r.name) || cleanTitle(p.title, r.name) || humanize(r.name);
    const description = stripEmoji(o.description || r.description || p.description || '');
    const topics = (r.topics || []).filter((t) => !t.startsWith('lab-'));
    const days = daysSince(r.pushed_at, now);
    const status = !p.ok ? 'hors-ligne' : r.archived ? 'archivee' : days <= 30 ? 'en-cours' : days <= 365 ? 'stable' : 'en-sommeil';
    const language = o.language || r.language || '';

    items.push({
      num: String(i + 1).padStart(width, '0'),
      name: r.name,
      slug: r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title,
      description,
      topics,
      language,
      langSlug: language ? norm(language) || 'autre' : '',
      hue: LANG_HUES[language.toLowerCase()] || DEFAULT_HUE,
      url: p.finalUrl || url,
      href: final.hostname === DOMAIN ? final.pathname : final.href,
      display: (final.hostname + final.pathname).replace(/\/$/, ''),
      repoUrl: r.html_url || `https://github.com/${OWNER}/${r.name}`,
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
      updatedRel: relative(r.pushed_at, now),
      status,
      online: !!p.ok,
      pinned: (r.topics || []).includes(TOPIC_PIN) || !!o.pin,
      cover: o.cover || '',
      ogImage: p.ogImage || '',
      search: searchText([title, r.name, description, language, ...topics].join(' ')),
    });
    console.log(`  ${p.ok ? '●' : '○'} ${r.name.padEnd(28)} ${p.status ?? ''} → ${final.hostname + final.pathname}`);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const browser = await openBrowser();
  if (browser) await photograph(browser, items);
  for (const it of items) {
    if (!it.cover && it.ogImage) { it.cover = it.ogImage; it.coverKind = 'og'; }
  }

  // Ordre d'affichage : dernière activité d'abord
  const byActivity = [...items].sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt));
  const featured = [
    ...byActivity.filter((it) => it.pinned),
    ...byActivity.filter((it) => !it.pinned && it.online),
  ].slice(0, FEATURED_COUNT);

  const langs = new Set(items.map((it) => it.langSlug).filter(Boolean));
  const last = byActivity[0];
  const n = items.length;
  const vars = {
    count: String(n).padStart(2, '0'),
    countLabel: `${n} manip${n > 1 ? 's' : ''}`,
    langCount: String(langs.size).padStart(2, '0'),
    lastDate: last ? esc(fmtDots(last.pushedAt)) : '—',
    lastDateLong: last ? esc(fmtDate(last.pushedAt)) : '',
    lastIso: last ? last.pushedAt : '',
    syncDate: esc(fmtSync(now)),
    domain: DOMAIN,
    owner: OWNER,
    mark: MARK,
  };

  let html = await readFile(path.join(SRC, 'index.html'), 'utf8');
  html = fill(html
    .replace('<!-- @featured -->', featured.map(polaroid).join('\n'))
    .replace('<!-- @filters -->', filters(items))
    .replace('<!-- @cards -->', byActivity.map(card).join('\n')), vars);

  // CSS : jetons du design system Marill.dev (ADN) + identité du labo
  const dsParts = ['colors', 'typography', 'spacing', 'motion'];
  const css = [
    `/* lab. — généré le ${now.toISOString()} */`,
    ...(await Promise.all(dsParts.map((f) => readFile(path.join(SRC, 'ds', `${f}.css`), 'utf8')))),
    await readFile(path.join(SRC, 'lab.css'), 'utf8'),
  ].join('\n');

  const publicData = byActivity.map(({ num, name, title, description, topics, language, url, repoUrl, status, createdAt, pushedAt, cover }) =>
    ({ num, name, title, description, topics, language, url, repo: repoUrl, status, createdAt, pushedAt, cover }));

  await Promise.all([
    writeFile(path.join(DIST, 'index.html'), html.replace('<!-- og:image -->', '')),
    writeFile(path.join(DIST, '404.html'), fill(await readFile(path.join(SRC, '404.html'), 'utf8'), vars)),
    writeFile(path.join(DIST, 'lab.css'), css),
    cp(path.join(SRC, 'lab.js'), path.join(DIST, 'lab.js')),
    cp(path.join(SRC, 'assets'), path.join(DIST, 'assets'), { recursive: true }),
    writeFile(path.join(DIST, 'projects.json'), JSON.stringify({ generatedAt: now.toISOString(), owner: OWNER, manips: publicData }, null, 2)),
    writeFile(path.join(DIST, '.nojekyll'), ''),
  ]);

  // Image de partage générée à partir de la page elle-même
  if (browser) {
    if (await shareImage(browser)) {
      const og = `<meta property="og:image" content="https://${DOMAIN}/og.jpg">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">`;
      await writeFile(path.join(DIST, 'index.html'), html.replace('<!-- og:image -->', og));
    }
    await browser.close();
  }

  console.log(`\n✓ ${n} manips · ${featured.length} au tableau · ${items.filter((i) => i.coverKind === 'photo').length} photos → dist/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
