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
const CONCURRENCY = 5; // 5 вкладок одночасно (оптимально для швидкості/пам'яті)
const PAGE_TIMEOUT = 15000;
const MAX_SITES = 20; // ⚡ ШУКАЄМО ТЕПЕР 20 САЙТІВ
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

// Blacklist
const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'deposit', 'donation',
    'login', 'account', 'cart', 'checkout', 'register', 'subscription', 'career', 'job'
];

const STOP_WORDS = ['the', 'and', 'for', 'with', 'australia', 'best', 'top', 'buy', 'shop', 'online', 'custom'];

// Synonyms
const SYNONYMS = {
    'package': ['box', 'mailer', 'packaging', 'bundle', 'kit', 'hamper', 'set'],
    'sticker': ['decal', 'label', 'vinyl', 'adhesive'],
    'decal': ['sticker', 'vinyl'],
    'shirt': ['tee', 't-shirt', 'apparel', 'top'],
    'bag': ['tote', 'pouch', 'sack']
};

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 SEARCH V4: ${AI_PROVIDER.toUpperCase()} | Scanning top ${MAX_SITES} sites`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Deep Search (20 Sites)</title>
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
        .badge { position: absolute; top: 10px; left: 10px; font-size: 10px; background: rgba(255,255,255,0.95); padding: 4px 8px; border-radius: 4px; border: 1px solid #cbd5e1; color: #475569; font-weight: bold; text-transform: uppercase; }
        
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #0f172a; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        
        .meta-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; min-height: 24px; }
        .tag { font-size: 11px; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; color: #475569; font-weight: 500; display: flex; align-items: center; gap: 4px; }
        
        .price { font-size: 20px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .btn-link { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 600; transition: 0.2s; border: 1px solid #e2e8f0; }
        .btn-link:hover { background: #e2e8f0; color: #0f172a; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Search (e.g. 'custom mailer boxes')..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 products</span></div>
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
            status.textContent = 'Initializing deep search...';
            
            let count = 0;

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
                                    count++;
                                    counter.textContent = count + ' products';
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    const sizeHtml = p.size ? \`<div class="tag">📏 \${p.size}</div>\` : '';
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <div class="badge">\${domain}</div>
                                                <img src="\${p.imageUrl}" onerror="this.src='https://placehold.co/400?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="meta-row">\${sizeHtml}</div>
                                                <div class="price">\${p.price}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="btn-link">View Product</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = \`Search complete. Processed \${data.total} sites.\`;
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

// ============ API ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    let browser = null;
    try {
        send('progress', { msg: 'Google Deep Search (20 sites)...', done: 0, total: 20 });
        
        // 1. Google Search (fetch 2 pages)
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        // Беремо топ 20
        const topUrls = urls.slice(0, MAX_SITES);
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--disable-gpu',
                '--blink-settings=imagesEnabled=false'
            ]
        });

        send('progress', { msg: `Scanning ${topUrls.length} sites...`, done: 0, total: topUrls.length });

        // 2. Queue Logic
        let completed = 0;
        const queue = [...topUrls];
        const processedDomains = new Set();
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                
                try {
                    const domain = new URL(url).hostname;
                    if (processedDomains.has(domain)) continue;
                    processedDomains.add(domain);
                    
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    // ignore
                } finally {
                    completed++;
                    send('progress', { msg: `Scanning...`, done: completed, total: topUrls.length });
                }
            }
        };

        // Запускаємо потоки
        const workers = Array(CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', { total: completed });

    } catch (e) {
        send('progress', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

async function processSite(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
        await new Promise(r => setTimeout(r, 1000));

        // 1. EXTRACT HIDDEN TEXT (FOR SIZE)
        const hiddenOptions = await page.evaluate(() => {
            const opts = [];
            document.querySelectorAll('select option, .variant, .swatch, .size-box').forEach(el => {
                if(el.innerText && el.innerText.length < 30) opts.push(el.innerText);
            });
            // Також шукаємо в таблицях (Specifications)
            document.querySelectorAll('td, th').forEach(el => {
                if(/size|dim|mm|cm|inch/i.test(el.innerText) && el.innerText.length < 50) opts.push(el.innerText);
            });
            return opts.join(', ').substring(0, 800);
        });

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;
        let candidates = [];

        // --- PHASE 1: JSON-LD ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                const items = Array.isArray(json) ? json : [json];
                items.forEach(item => {
                    const type = item['@type'];
                    if (type === 'Product' || type === 'ItemPage') extractFromJson(item, candidates, baseUrl);
                    if (item['@graph']) item['@graph'].forEach(g => {
                        if (g['@type'] === 'Product') extractFromJson(g, candidates, baseUrl);
                    });
                });
            } catch (e) {}
        });

        // --- PHASE 2: AI FALLBACK ---
        if (candidates.length === 0) {
            $('script, style, noscript, svg, iframe, header, footer, nav, .popup').remove();
            let body = $('body').html() || '';
            
            if (hiddenOptions) body += `\n`;
            
            const truncated = body.replace(/\s+/g, ' ').substring(0, 60000);
            if (truncated.length > 500) {
                const aiRes = await parseWithAI(truncated, url, keyword);
                candidates = [...candidates, ...aiRes];
            }
        }

        // --- PHASE 3: FILTER & SORT ---
        const validProducts = [];
        candidates.forEach(p => {
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            if (BLACKLIST.some(bad => p.title.toLowerCase().includes(bad))) return;

            // SYNONYM AWARE CHECK
            const titleLower = p.title.toLowerCase();
            const queryWords = keyword.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(t => t.length > 2 && !STOP_WORDS.includes(t));
            let matchCount = 0;

            queryWords.forEach(qWord => {
                let found = false;
                if (titleLower.includes(qWord)) found = true;
                else if (SYNONYMS[qWord]) {
                    if (SYNONYMS[qWord].some(syn => titleLower.includes(syn))) found = true;
                }
                if (found) matchCount++;
            });

            // Logic: 50% match required
            let isValid = false;
            if (queryWords.length <= 1) isValid = matchCount >= 1;
            else isValid = (matchCount / queryWords.length) >= 0.5;

            if (!isValid) return;

            if (!p.price) p.price = 'Check Site';
            validProducts.push(p);
        });

        if (validProducts.length > 0) {
            // Sort: Price > Size > Title Length
            validProducts.sort((a, b) => {
                const scoreA = (a.price !== 'Check Site' ? 2 : 0) + (a.size ? 3 : 0); // Розмір важливіший
                const scoreB = (b.price !== 'Check Site' ? 2 : 0) + (b.size ? 3 : 0);
                return scoreB - scoreA;
            });
            send('product', { p: validProducts[0] });
        }

    } catch (e) {
        if(page) await page.close().catch(() => {});
    }
}

function extractFromJson(item, list, baseUrl) {
    if (!item.name || !item.image) return;
    
    let price = null;
    let size = null;

    if (item.offers) {
        const o = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (o.price) price = `$${o.price} ${o.priceCurrency || 'AUD'}`;
        else if (o.lowPrice) price = `$${o.lowPrice} ${o.priceCurrency || 'AUD'}`;
    }

    if (item.size) size = item.size;
    else if (item.additionalProperty) {
        const props = Array.isArray(item.additionalProperty) ? item.additionalProperty : [item.additionalProperty];
        const sp = props.find(p => p.name && /size|dim|width|height/i.test(p.name));
        if (sp) size = sp.value;
    }

    let img = item.image;
    if (Array.isArray(img)) img = img[0];
    if (typeof img === 'object') img = img.url;

    list.push({
        title: item.name,
        price: price,
        size: size,
        imageUrl: normalizeUrl(img, baseUrl),
        productUrl: normalizeUrl(item.url || '', baseUrl) || baseUrl
    });
}

async function parseWithAI(html, url, keyword) {
    const prompt = `Extract ONE main product for "${keyword}".
Rules:
1. Ignore services/courses.
2. EXTRACT SIZE: dimensions (mm, cm), volume (ml), paper (A4), or options (S, M, L).
3. JSON Output: [{"title":"...","price":"...","size":"...","imageUrl":"...","productUrl":"..."}]
Context: ${html}`;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, max_tokens: 1500
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );
            content = resp.data.candidates[0].content.parts[0].text;
        }
        
        const jsonStr = content.replace(/```json|```/gi, '').trim();
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        if (start === -1) return [];
        
        const raw = JSON.parse(jsonStr.substring(start, end + 1));
        const baseUrl = new URL(url).origin;
        
        return raw.map(p => ({
            title: p.title,
            price: p.price,
            size: p.size || null,
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl)
        }));
    } catch { return []; }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || urlStr.startsWith('data:')) return null;
    try {
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        if (urlStr.startsWith('/')) return new URL(urlStr, baseUrl).href;
        if (!urlStr.startsWith('http')) return new URL(urlStr, baseUrl).href;
        return urlStr;
    } catch { return null; }
}

// === GOOGLE SEARCH (2 PAGES = 20 RESULTS) ===
async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    const q = encodeURIComponent(`${keyword} buy`);
    
    // Функція для запиту однієї сторінки
    const fetchPage = async (start) => {
        try {
            const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
                params: {
                    key, cx, q, num: 10, start,
                    gl: 'au', cr: 'countryAU', safe: 'active'
                }
            });
            return res.data.items || [];
        } catch (e) {
            return [];
        }
    };

    try {
        // 1. Пробуємо строгий пошук (Page 1)
        console.log('Fetching Page 1...');
        let results = await fetchPage(1);

        // Якщо пусто - пробуємо fallback (без cr=countryAU)
        if (results.length === 0) {
            console.log('Strict failed. Using Fallback...');
            const fallbackQ = encodeURIComponent(`${keyword} buy site:.au`);
            const fallbackRes = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${fallbackQ}&num=10&gl=au&safe=active`);
            results = fallbackRes.data.items || [];
            
            // Якщо fallback спрацював, беремо і другу сторінку для нього
            if (results.length > 0) {
                const fallbackRes2 = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${fallbackQ}&num=10&start=11&gl=au&safe=active`);
                results = [...results, ...(fallbackRes2.data.items || [])];
            }
        } else {
            // Якщо строгий пошук спрацював, беремо Page 2 строгого пошуку
            console.log('Fetching Page 2...');
            const page2 = await fetchPage(11);
            results = [...results, ...page2];
        }

        const blocked = ['facebook', 'youtube', 'pinterest', 'instagram', 'reddit', 'wikipedia', 'linkedin'];
        return results
            .map(i => i.link)
            .filter(link => !blocked.some(b => link.includes(b)));
            
    } catch (e) {
        console.error('Search error:', e.message);
        return [];
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: ${PORT}`));
