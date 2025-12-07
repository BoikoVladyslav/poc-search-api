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
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

// Чорний список (послуги та сміття)
const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'login', 'account', 
    'cart', 'checkout', 'register', 'subscription', 'career', 'job', 'news'
];

// Слова-зв'язки, які ігноруємо при перевірці
const STOP_WORDS = ['the', 'and', 'for', 'with', 'australia', 'best', 'top', 'buy', 'shop', 'online', 'custom', 'personalised'];

// СИНОНІМИ (Щоб "package" знаходило "box")
const SYNONYMS = {
    'package': ['box', 'mailer', 'packaging', 'bundle', 'kit', 'hamper', 'set', 'carton'],
    'sticker': ['decal', 'label', 'vinyl', 'adhesive', 'sign'],
    'decal': ['sticker', 'vinyl', 'transfer'],
    'shirt': ['tee', 't-shirt', 'apparel', 'top', 'clothing'],
    'bag': ['tote', 'pouch', 'sack', 'carrier'],
    'card': ['stationery', 'invite', 'print'],
};

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 AUSTRALIA SEARCH V3: ${AI_PROVIDER.toUpperCase()} | Enhanced Size Detection`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Smart Search</title>
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
        <input type="text" id="keyword" placeholder="Search products (e.g. 'custom bumper stickers')..." onkeypress="if(event.key==='Enter') run()">
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
            progress.style.width = '5%';
            status.textContent = 'Searching...';
            
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
                                    status.textContent = \`Search complete. Found \${count} matches.\`;
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
        send('progress', { msg: 'Google Search (AU)...', done: 0, total: 10 });
        
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        const topUrls = urls.slice(0, 15); // Більше сайтів для перевірки
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--disable-gpu',
                '--blink-settings=imagesEnabled=false'
            ]
        });

        send('progress', { msg: `Scanning ${topUrls.length} sites...`, done: 0, total: topUrls.length });

        // Queue
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

        const workers = Array(CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', {});

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
        
        // Fast fail timeout
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
        await new Promise(r => setTimeout(r, 1000));

        // === 1. ВИГРІБАЄМО ПРИХОВАНІ РОЗМІРИ ===
        // Часто розміри сидять у <select>, які не видно в простому тексті
        const hiddenOptions = await page.evaluate(() => {
            const options = [];
            // Збираємо текст з dropdowns
            document.querySelectorAll('select option').forEach(opt => {
                if(opt.innerText.length > 0 && opt.innerText.length < 50) options.push(opt.innerText);
            });
            // Збираємо текст з кнопок вибору (часто для розмірів)
            document.querySelectorAll('[class*="variant"], [class*="option"], [class*="size"]').forEach(el => {
                if(el.innerText.length > 0 && el.innerText.length < 30) options.push(el.innerText);
            });
            return options.join(', ');
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
                const txt = $(el).html();
                if(!txt) return;
                const data = JSON.parse(txt);
                const items = Array.isArray(data) ? data : [data];
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
            $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .popup').remove();
            
            let body = $('body').html() || '';
            
            // Додаємо знайдені опції розмірів у кінець HTML, щоб AI їх побачив
            if(hiddenOptions) {
                body += `\n`;
            }

            const truncated = body.replace(/\s+/g, ' ').substring(0, 60000);
            if (truncated.length > 500) {
                const aiProducts = await parseWithAI(truncated, url, keyword);
                candidates = [...candidates, ...aiProducts];
            }
        }

        // --- PHASE 3: FILTERING & RANKING ---
        const validProducts = [];

        candidates.forEach(p => {
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            
            const titleLower = p.title.toLowerCase();
            if (BLACKLIST.some(bad => titleLower.includes(bad))) return;

            // SMART MATCHING (З урахуванням синонімів)
            const queryWords = keyword.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(t => t.length > 2 && !STOP_WORDS.includes(t));
            let matchCount = 0;

            queryWords.forEach(qWord => {
                let found = false;
                // 1. Direct match
                if (titleLower.includes(qWord)) found = true;
                // 2. Synonym match
                else if (SYNONYMS[qWord]) {
                    if (SYNONYMS[qWord].some(syn => titleLower.includes(syn))) found = true;
                }
                
                if (found) matchCount++;
            });

            // Логіка пропуску
            let isValid = false;
            if (queryWords.length === 0) isValid = true;
            else if (queryWords.length === 1) isValid = matchCount >= 1;
            else isValid = (matchCount / queryWords.length) >= 0.5; // 50% match

            if (!isValid) return;

            if (!p.price) p.price = 'Check Site';
            validProducts.push(p);
        });

        // --- PHASE 4: SELECT ONE BEST PRODUCT ---
        if (validProducts.length > 0) {
            validProducts.sort((a, b) => {
                let scoreA = 0, scoreB = 0;
                
                // Пріоритет: Ціна + Розмір + Картинка
                if (a.price && a.price !== 'Check Site') scoreA += 3;
                if (b.price && b.price !== 'Check Site') scoreB += 3;
                
                if (a.size) scoreA += 4; // Вищий пріоритет розміру!
                if (b.size) scoreB += 4;
                
                return scoreB - scoreA;
            });

            send('product', { p: validProducts[0] });
        }

    } catch (e) {
        if(page) await page.close().catch(() => {});
    }
}

function extractFromJson(item, list, baseUrl) {
    if (!item.name) return;
    
    let price = null;
    let currency = 'AUD';
    let size = null;
    
    if (item.offers) {
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (offer.price) price = offer.price;
        if (offer.priceCurrency) currency = offer.priceCurrency;
        if (!price && offer.lowPrice) price = offer.lowPrice;
    }
    
    // Improved JSON Size Extraction
    if (item.size) size = item.size;
    else if (item.additionalProperty) {
        const props = Array.isArray(item.additionalProperty) ? item.additionalProperty : [item.additionalProperty];
        // Шукаємо 'Size', 'Dimensions', 'Width'
        const sizeProp = props.find(p => p.name && /size|dim|width|height|depth/i.test(p.name));
        if (sizeProp) size = sizeProp.value;
    }
    
    let image = item.image;
    if (Array.isArray(image)) image = image[0];
    if (typeof image === 'object') image = image.url;

    if (image) {
        list.push({
            title: item.name,
            price: price ? `$${price} ${currency}` : null,
            size: size,
            imageUrl: normalizeUrl(image, baseUrl),
            productUrl: normalizeUrl(item.url || '', baseUrl) || baseUrl
        });
    }
}

async function parseWithAI(html, url, keyword) {
    const prompt = `Extract ONE main product for "${keyword}".
    
    Rules:
    1. SIZE DETECTION: Look for dimensions (mm, cm, inch), paper sizes (A4), variants (S, M, L), or volume (ml, L). Look in dropdown options too.
    2. RELEVANCE: Ensure it matches "${keyword}" (use synonyms like box/package, sticker/decal).
    3. JSON Output: [{"title":"...","price":"...","size":"...","imageUrl":"...","productUrl":"..."}]
    
    HTML Context: ${html}`;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, max_tokens: 2000
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );
            content = resp.data.candidates[0].content.parts[0].text;
        }
        
        const json = content.replace(/```json|```/gi, '').trim();
        const start = json.indexOf('[');
        const end = json.lastIndexOf(']');
        if (start === -1) return [];
        
        const raw = JSON.parse(json.substring(start, end + 1));
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

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    // Нативний запит, без зайвих фільтрів, бо ми налаштували консоль
    const q = encodeURIComponent(`${keyword} buy`);
    
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: key, cx: cx, q: q, num: 10,
                gl: 'au', cr: 'countryAU', safe: 'active'
            }
        });
        
        const blocked = ['facebook', 'youtube', 'pinterest', 'instagram', 'reddit', 'wikipedia', 'linkedin'];
        return (res.data.items || [])
            .map(i => i.link)
            .filter(link => !blocked.some(b => link.includes(b)));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: ${PORT}`));
