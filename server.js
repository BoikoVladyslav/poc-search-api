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

// === НАЛАШТУВАННЯ ===
const MAX_CONCURRENCY = 4; // Обмежимо потоки для стабільності
const PAGE_TIMEOUT = 10000; // 10 сек максимум на сайт

const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';
let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 HYBRID ENGINE: ${AI_PROVIDER} | JSON-LD + AI Fallback`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hybrid Search</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #f4f4f5; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 14px; border: 1px solid #e4e4e7; border-radius: 8px; font-size: 16px; }
        button { padding: 14px 28px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
        button:disabled { background: #93c5fd; }
        
        .status-bar { margin-bottom: 10px; font-size: 13px; color: #71717a; display: flex; justify-content: space-between; }
        .progress-line { height: 4px; background: #e4e4e7; width: 100%; margin-bottom: 20px; border-radius: 2px; overflow: hidden; }
        .progress-fill { height: 100%; background: #2563eb; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #f4f4f5; display: flex; flex-direction: column; transition: transform 0.2s; position: relative; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-box { height: 180px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .badge { position: absolute; top: 10px; right: 10px; background: #f4f4f5; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; color: #71717a; }
        .title { font-size: 14px; font-weight: 500; color: #18181b; margin-bottom: 8px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .btn { margin-top: 12px; display: block; text-align: center; background: #f4f4f5; color: #18181b; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: 500; }
        .btn:hover { background: #e4e4e7; }
        
        /* Debug info */
        .source-tag { font-size: 10px; color: #a1a1aa; margin-top: 5px; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Product name..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 items</span></div>
    <div class="progress-line"><div class="progress-fill" id="progress"></div></div>
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
                                    counter.textContent = count + ' items';
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    const method = data.method || 'AI';
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="badge">\${domain}</div>
                                            <div class="img-box">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.src='https://placehold.co/400?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${p.price}</div>
                                                <div class="source-tag">Via \${method}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="btn">View Product</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = 'Complete';
                                    progress.style.width = '100%';
                                    btn.disabled = false;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {
                status.textContent = e.message;
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
        send('progress', { msg: 'Google Search...', done: 0, total: 10 });
        
        // 1. Google Search
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        const topUrls = urls.slice(0, 10);
        
        // 2. Launch Browser (GLOBAL)
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--blink-settings=imagesEnabled=false' // Блокуємо картинки для швидкості
            ]
        });

        send('progress', { msg: `Scanning ${topUrls.length} sites...`, done: 0, total: topUrls.length });

        // 3. Queue Processor
        let completed = 0;
        const queue = [...topUrls];
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                try {
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    // console.error(`Skipping ${url}`);
                } finally {
                    completed++;
                    send('progress', { 
                        msg: `Scanning...`, 
                        done: completed, 
                        total: topUrls.length 
                    });
                }
            }
        };

        const workers = Array(MAX_CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', {});

    } catch (e) {
        send('progress', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

// ============ CORE PROCESSOR ============
async function processSite(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        
        // Block everything heavy
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet', 'other'].includes(type)) req.abort();
            else req.continue();
        });

        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());

        // Fast Fail
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // Get HTML
        const html = await page.content();
        await page.close();
        page = null; // Free memory immediately

        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;

        // --- STRATEGY 1: JSON-LD (Structured Data) ---
        // Це найшвидший і найточніший метод. Шукаємо готові дані.
        let products = [];
        let method = 'JSON-LD';

        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const data = JSON.parse($(el).html());
                const items = Array.isArray(data) ? data : [data];
                
                items.forEach(item => {
                    // Шукаємо Product або ItemList
                    if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') {
                        extractFromJson(item, products, baseUrl);
                    }
                    if (item['@graph'] && Array.isArray(item['@graph'])) {
                        item['@graph'].forEach(g => {
                            if (g['@type'] === 'Product') extractFromJson(g, products, baseUrl);
                        });
                    }
                });
            } catch (e) {}
        });

        // --- STRATEGY 2: AI FALLBACK ---
        // Якщо JSON-LD не дав результатів, використовуємо AI, але на очищеному HTML
        if (products.length === 0) {
            method = 'AI';
            // Чистимо HTML набагато розумніше
            $('script, style, noscript, svg, iframe, header, footer, nav').remove();
            $('.menu, .sidebar, .popup, .cookie, .related, .recommendations').remove();
            
            // Залишаємо тільки контейнери, де можуть бути товари
            // Видаляємо пусті теги
            $('div, span, p').each((i, el) => {
                if($(el).text().trim().length === 0 && $(el).children().length === 0) $(el).remove();
            });

            // Відновлюємо Lazy Images
            $('img').each((i, el) => {
                const $el = $(el);
                const src = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('src');
                if(src) $el.attr('src', src);
            });

            const body = $('body').html() || '';
            const truncated = body.replace(/\s+/g, ' ').substring(0, 40000);

            if (truncated.length > 500) {
                products = await parseWithAI(truncated, url, keyword);
            }
        }

        // --- FILTER & SEND ---
        const uniqueProducts = new Map();
        
        products.forEach(p => {
            // Валідація
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            
            // Fix Price: Якщо ціна null, пробуємо поставити "Check Site"
            // Але краще викинути, якщо ми хочемо якість
            if (!p.price) p.price = "Check Site"; 

            // Перевірка на ключові слова (м'яка)
            const keywords = keyword.toLowerCase().split(' ').filter(w => w.length > 2);
            const titleLower = p.title.toLowerCase();
            const isRelevant = keywords.some(k => titleLower.includes(k));
            
            // Додаємо тільки релевантні
            if (isRelevant && !uniqueProducts.has(p.productUrl)) {
                uniqueProducts.set(p.productUrl, p);
                send('product', { p, method });
            }
        });

    } catch (e) {
        if(page) await page.close().catch(() => {});
    }
}

// Допоміжна функція для JSON-LD
function extractFromJson(item, list, baseUrl) {
    if (!item.name) return;
    
    let price = null;
    let currency = 'AUD';
    
    // Різні формати ціни в JSON-LD
    if (item.offers) {
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (offer.price) price = offer.price;
        if (offer.priceCurrency) currency = offer.priceCurrency;
        // HighPrice/LowPrice format
        if (!price && offer.lowPrice) price = offer.lowPrice;
    }
    
    let image = item.image;
    if (Array.isArray(image)) image = image[0];
    if (typeof image === 'object' && image.url) image = image.url;

    if (image && item.name) {
        list.push({
            title: item.name,
            price: price ? `$${price} ${currency}` : null,
            imageUrl: normalizeUrl(image, baseUrl),
            productUrl: normalizeUrl(item.url || '', baseUrl) || baseUrl
        });
    }
}

async function parseWithAI(html, url, keyword) {
    const prompt = `
    Analyze HTML from "${url}". Extract products for keyword: "${keyword}".
    
    Rules:
    1. RELEVANCE: Strict. Only items matching "${keyword}". No accessories/parts.
    2. PRICE: Find specific price text (e.g. "$20.00"). If missing, return null.
    3. URL/IMG: Must be valid absolute URLs.

    JSON Output: [{"title":"...","price":"...","imageUrl":"...","productUrl":"..."}]
    
    HTML: ${html}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, max_tokens: 3000
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
    const q = encodeURIComponent(`${keyword} site:.au`); // Шукаємо тільки австралійські домени
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: ${PORT}`));
