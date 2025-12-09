require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// === CONFIG ===
const CONCURRENCY = 5;
const PAGE_TIMEOUT = 15000;
const MAX_SITES = 20;
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'deposit', 'donation',
    'login', 'account', 'cart', 'checkout', 'register', 'subscription', 'career', 'job'
];

const STOP_WORDS = ['the', 'and', 'for', 'with', 'australia', 'best', 'top', 'buy', 'shop', 'online', 'custom'];

const SYNONYMS = {
    'package': ['box', 'mailer', 'packaging', 'bundle', 'kit', 'hamper', 'set'],
    'sticker': ['decal', 'label', 'vinyl', 'adhesive'],
    'decal': ['sticker', 'vinyl'],
    'shirt': ['tee', 't-shirt', 'apparel', 'top'],
    'bag': ['tote', 'pouch', 'sack'],
    'banner': ['flag', 'signage', 'sign'],
    'card': ['cards', 'cardstock'],
    'magnet': ['magnets', 'fridge magnet']
};

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 AU SEARCH SPEED-UP: ${AI_PROVIDER.toUpperCase()} | Top ${MAX_SITES}`);

// ============ UI (БЕЗ ЗМІН) ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Product Search</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f8fafc; padding: 20px; max-width: 1200px; margin: 0 auto; color: #334155; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 14px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px; outline: none; transition: 0.2s; }
        input:focus { border-color: #3b82f6; }
        button { padding: 14px 32px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button:hover { background: #2563eb; }
        button:disabled { background: #94a3b8; cursor: not-allowed; }
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #64748b; font-weight: 500; }
        .progress-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 24px; }
        .progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: transform 0.2s; position: relative; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-wrap { height: 220px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f1f5f9; position: relative; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .badge { position: absolute; top: 10px; left: 10px; font-size: 10px; background: rgba(59,130,246,0.9); padding: 4px 8px; border-radius: 4px; color: white; font-weight: bold; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #0f172a; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .meta-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; min-height: 24px; }
        .tag { font-size: 11px; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; color: #475569; font-weight: 500; }
        .price { font-size: 20px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .btn-link { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 600; transition: 0.2s; border: 1px solid #e2e8f0; }
        .btn-link:hover { background: #e2e8f0; color: #0f172a; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Search Australian products..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 products from 0 sites</span></div>
    <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
    <div id="results" class="grid"></div>
    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value;
            if(!keyword) return;
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const counter = document.getElementById('counter');
            const progress = document.getElementById('progress');
            const results = document.getElementById('results');
            btn.disabled = true;
            results.innerHTML = '';
            progress.style.width = '2%';
            status.textContent = 'Searching Australian sites...';
            let productCount = 0;
            let siteCount = 0;
            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ keyword })
                });
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    const chunk = decoder.decode(value, {stream: true});
                    const lines = chunk.split('\\n');
                    for(const line of lines) {
                        if(line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if(data.type === 'progress') {
                                    status.textContent = data.msg;
                                    if(data.total > 0) progress.style.width = Math.round((data.done / data.total) * 100) + '%';
                                }
                                if(data.type === 'product') {
                                    productCount++;
                                    counter.textContent = \`\${productCount} products from \${siteCount} sites\`;
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    const sizeHtml = p.size ? \`<div class="tag">📏 \${p.size}</div>\` : '';
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <div class="badge">\${domain}</div>
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.src='https://placehold.co/400x400/e2e8f0/64748b?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="meta-row">\${sizeHtml}</div>
                                                <div class="price">\${p.price}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="btn-link">View Product</a>
                                            </div>
                                        </div>\`);
                                }
                                if(data.type === 'done') {
                                    status.textContent = \`Complete! Scanned \${data.total} sites.\`;
                                    progress.style.width = '100%';
                                    btn.disabled = false;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {
                status.textContent = 'Error: ' + e.message;
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
    `);
});

// ============ SEARCH API ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;
    
    if (!keyword || keyword.trim().length < 2) {
        return res.status(400).json({ error: 'Keyword required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (type, data) => {
        try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch (e) {}
    };

    let browser = null;
    const sentProducts = new Map();
    
    try {
        send('progress', { msg: 'Initializing engines...', pct: 5 });
        
        // 🚀 ОПТИМІЗАЦІЯ 1: Паралельний запуск Google Search та Браузера
        // Ми не чекаємо поки Гугл знайде посилання, щоб відкрити браузер.
        // Це економить близько 2-3 секунд на старті.
        const [urls, browserInstance] = await Promise.all([
            googleSearch(keyword),
            puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas', 
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--blink-settings=imagesEnabled=false' // Блокуємо картинки глобально для швидкості
                ]
            })
        ]);

        browser = browserInstance;
        
        if (urls.length === 0) {
            send('progress', { msg: 'No results from Google', pct: 100 });
            send('done', { sites: 0 });
            return res.end();
        }

        const uniqueUrls = getUniqueDomainUrls(urls, MAX_SITES);
        console.log(`🔗 Processing ${uniqueUrls.length} unique domains`);

        send('progress', { msg: `Found ${uniqueUrls.length} sites. Scanning...`, pct: 10 });

        // Process sites
        let completed = 0;
        const queue = [...uniqueUrls];
        
        const processNext = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                if (!url) continue;
                
                const domain = getDomain(url);
                if (sentProducts.has(domain)) {
                    completed++;
                    continue;
                }

                try {
                    // console.log(`Scanning: ${url}`);
                    const product = await extractProductFromSite(browser, url, keyword);
                    
                    if (product && isValidProduct(product)) {
                        sentProducts.set(domain, true);
                        send('product', { p: product }); // UI чекає 'p'
                    }
                } catch (e) {
                    // console.log(`Error: ${e.message}`);
                }
                
                completed++;
                const pct = Math.round(10 + (completed / uniqueUrls.length) * 85);
                send('progress', { msg: `Scanning sites... (${completed}/${uniqueUrls.length})`, pct });
            }
        };

        const workers = Array(CONCURRENCY).fill(null).map(() => processNext());
        await Promise.all(workers);

        send('progress', { msg: 'Search complete!', pct: 100 });
        send('done', { total: completed, sites: sentProducts.size });

    } catch (e) {
        console.error('❌ API Error:', e);
        send('progress', { msg: 'Error: ' + e.message, pct: 100 });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

// ============ EXTRACT PRODUCT (OPTIMIZED) ============
async function extractProductFromSite(browser, url, keyword) {
    let page = null;
    try {
        page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            // Додали 'other', 'script' (опціонально, але краще залишити скрипти для цін)
            if (['image', 'media', 'font'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        await page.setViewport({ width: 1366, height: 768 }); // Стандартний розмір
        
        await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: PAGE_TIMEOUT 
        });

        // 🚀 ОПТИМІЗАЦІЯ 2: Зменшення затримок
        // networkidle2 вже гарантує, що мережа заспокоїлась. Чекаємо мінімум.
        await new Promise(r => setTimeout(r, 500)); // Було 1500

        // Швидший скрол
        await page.evaluate(async () => {
            window.scrollBy(0, 1000);
            await new Promise(r => setTimeout(r, 200)); // Було 300
            window.scrollBy(0, 1000);
        });

        const hiddenOptions = await page.evaluate(() => {
            try {
                const opts = [];
                document.querySelectorAll('select option, .variant, .swatch, .size-box').forEach(el => {
                    const t = el.innerText || el.textContent;
                    if(t && t.length < 50 && t.length > 1) opts.push(t.trim());
                });
                document.querySelectorAll('td, th').forEach(el => {
                    const t = el.innerText || '';
                    if(/size|dim|mm|cm|inch/i.test(t) && t.length < 100) opts.push(t.trim());
                });
                return [...new Set(opts)].join(', ').substring(0, 800);
            } catch { return ""; }
        });

        const html = await page.content();
        const finalUrl = page.url();
        
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(finalUrl).origin;
        
        // 1. JSON-LD
        const jsonLdProducts = extractJsonLdProducts($, baseUrl);
        
        // 2. AI Parsing (if needed or for better details)
        $('script, style, noscript, svg, iframe, header, footer, nav, .popup, .modal, .cookie').remove();
        let bodyHtml = $('body').html() || '';
        
        if (hiddenOptions) bodyHtml += `\n`;
        
        const cleanedHtml = bodyHtml.replace(/\s+/g, ' ').substring(0, 70000);
        
        let aiProducts = [];
        if (cleanedHtml.length > 500) {
            aiProducts = await parseWithAI(cleanedHtml, finalUrl, keyword);
        }

        const allProducts = [...jsonLdProducts, ...aiProducts];
        if (allProducts.length === 0) return null;

        // Filtering & Sorting (Ваш логіка, без змін)
        const validProducts = allProducts
            .filter(p => {
                if (!p.title || p.title.length < 3) return false;
                if (!p.imageUrl) return false;
                
                const titleLower = p.title.toLowerCase();
                if (BLACKLIST.some(bad => titleLower.includes(bad))) return false;
                
                const keywordLower = keyword.toLowerCase();
                const words = keywordLower.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.includes(w));
                
                let match = false;
                if (words.length === 0) match = true;
                else {
                    match = words.some(w => titleLower.includes(w)) || 
                            words.some(w => SYNONYMS[w] && SYNONYMS[w].some(s => titleLower.includes(s)));
                }
                return match;
            })
            .sort((a, b) => {
                let scoreA = 0, scoreB = 0;
                if (a.price && a.price !== 'Check Site') scoreA += 3;
                if (a.size) scoreA += 2;
                if (b.price && b.price !== 'Check Site') scoreB += 3;
                if (b.size) scoreB += 2;
                return scoreB - scoreA;
            });

        if (validProducts.length === 0) return null;

        const best = validProducts[0];
        return {
            title: best.title.trim(),
            price: best.price || 'Check Site',
            size: best.size || null,
            imageUrl: best.imageUrl,
            productUrl: best.productUrl || finalUrl
        };

    } catch (e) {
        if (page) await page.close().catch(() => {});
        throw e;
    }
}

// ... (JSON-LD Extraction, AI Parsing, Google Search, Helpers - залишаються без змін логіки, вже виправлені в минулому) ...

function extractJsonLdProducts($, baseUrl) {
    const products = [];
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            const text = $(el).html();
            if (!text) return;
            const data = JSON.parse(text);
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item['@type'] === 'Product' || (item['@type'] === 'ItemPage' && item.mainEntity)) {
                    const entity = item.mainEntity || item;
                    const p = parseJsonLdProduct(entity, baseUrl);
                    if (p) products.push(p);
                }
                if (item['@graph']) {
                    item['@graph'].forEach(g => {
                        if (g['@type'] === 'Product') {
                            const p = parseJsonLdProduct(g, baseUrl);
                            if (p) products.push(p);
                        }
                    });
                }
            });
        } catch (e) {}
    });
    return products;
}

function parseJsonLdProduct(item, baseUrl) {
    if (!item.name) return null;
    let price = null, size = null, image = null;

    if (item.offers) {
        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
        for (const o of offers) {
            if (o.price) { price = `$${o.price} ${o.priceCurrency || 'AUD'}`; break; }
            if (o.lowPrice) { price = `From $${o.lowPrice} ${o.priceCurrency || 'AUD'}`; break; }
        }
    }

    if (item.size) size = typeof item.size === 'object' ? item.size.name : item.size;
    if (!size && item.additionalProperty) {
        const props = Array.isArray(item.additionalProperty) ? item.additionalProperty : [item.additionalProperty];
        const sp = props.find(p => p.name && /size|dim|width|height/i.test(p.name));
        if (sp) size = sp.value;
    }

    if (item.image) {
        image = Array.isArray(item.image) ? (typeof item.image[0] === 'string' ? item.image[0] : item.image[0]?.url) : (item.image.url || item.image);
    }

    if (!image) return null;
    return { title: item.name, price, size, imageUrl: normalizeUrl(image, baseUrl), productUrl: normalizeUrl(item.url || '', baseUrl) };
}

async function parseWithAI(html, url, keyword) {
    const prompt = `Extract ONE best physical product for "${keyword}" from HTML.
Rules:
1. Ignore services, courses, rentals.
2. Get Size/Dim if possible.
3. Return JSON: [{"title":"...","price":"...","size":"...","imageUrl":"...","productUrl":"..."}]
HTML: ${html}`;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, max_tokens: 1000
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );
            content = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
        }
        
        const jsonStr = content.replace(/```json|```/gi, '').trim();
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        if (start === -1) return [];
        const raw = JSON.parse(jsonStr.substring(start, end + 1));
        const baseUrl = new URL(url).origin;
        return raw.map(p => ({
            title: p.title, price: p.price, size: p.size,
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl)
        }));
    } catch { return []; }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || typeof urlStr !== 'string' || urlStr.startsWith('data:')) return null;
    try {
        urlStr = urlStr.trim();
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        if (urlStr.startsWith('/')) return new URL(urlStr, baseUrl).href;
        if (!urlStr.startsWith('http')) return new URL(urlStr, baseUrl).href;
        return urlStr;
    } catch { return null; }
}

function getDomain(url) { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } }
function getUniqueDomainUrls(urls, max) {
    const seen = new Set();
    const unique = [];
    for (const url of urls) {
        const d = getDomain(url);
        if (!seen.has(d)) { seen.add(d); unique.push(url); if (unique.length >= max) break; }
    }
    return unique;
}
function isValidProduct(p) { return p && p.title && p.imageUrl && p.productUrl; }

// Fixed Google Search
async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    const query = `${keyword} buy`; // Removed manual encoding
    
    const fetchPage = async (start) => {
        try {
            const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
                params: { key, cx, q: query, num: 10, start, gl: 'au', cr: 'countryAU' },
                timeout: 8000
            });
            return res.data.items || [];
        } catch { return []; }
    };

    try {
        const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(11)]);
        const all = [...p1, ...p2];
        const blocked = ['facebook', 'youtube', 'pinterest', 'instagram', 'reddit', 'wikipedia', 'linkedin'];
        return all.map(i => i.link).filter(l => !blocked.some(b => l.includes(b)));
    } catch { return []; }
}

// ============ START SERVER ============
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🤖 AI Provider: ${AI_PROVIDER}`);
    console.log(`⚙️ Config: ${CONCURRENCY} workers, ${MAX_SITES} max sites`);
});



