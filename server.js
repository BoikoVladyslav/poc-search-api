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

// Blacklist залишаємо, він корисний
const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'login', 'account', 
    'cart', 'checkout', 'register', 'subscription', 'career', 'job', 'news'
];

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 STABLE SEARCH: ${AI_PROVIDER.toUpperCase()} | Auto-Retry Enabled`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Search Debug</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f8fafc; padding: 20px; max-width: 1200px; margin: 0 auto; color: #334155; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 14px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px; outline: none; }
        button { padding: 14px 32px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
        button:disabled { background: #94a3b8; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 13px; color: #64748b; }
        .progress-line { height: 4px; background: #e2e8f0; width: 100%; margin-bottom: 20px; }
        .progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: transform 0.2s; position: relative; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-wrap { height: 220px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f1f5f9; position: relative; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .badge { position: absolute; top: 10px; left: 10px; font-size: 10px; background: rgba(255,255,255,0.9); padding: 4px 8px; border-radius: 4px; border: 1px solid #cbd5e1; font-weight: bold; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #0f172a; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .tag { font-size: 11px; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; color: #475569; font-weight: 500; display: inline-block; margin-bottom: 8px; }
        .price { font-size: 20px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .btn { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid #e2e8f0; }
        .btn:hover { background: #e2e8f0; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Product name..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 found</span></div>
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
            status.textContent = 'Starting...';
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
                    const lines = decoder.decode(value, {stream: true}).split('\\n');
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
                                    const sizeTag = p.size ? \`<div class="tag">📏 \${p.size}</div>\` : '';
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <div class="badge">\${domain}</div>
                                                <img src="\${p.imageUrl}" onerror="this.src='https://placehold.co/400?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                \${sizeTag}
                                                <div class="price">\${p.price}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="btn">View</a>
                                            </div>
                                        </div>\`);
                                }
                                if(data.type === 'done') {
                                    status.textContent = \`Done. Found \${count} items.\`;
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
        send('progress', { msg: 'Google Search...', done: 0, total: 10 });
        
        // 1. ROBUST GOOGLE SEARCH (з авто-повтором)
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            console.log('Google returned 0 results.');
            send('done', { total: 0 });
            return res.end();
        }

        const topUrls = urls.slice(0, 15); // Обробляємо більше сайтів
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--disable-gpu',
                '--blink-settings=imagesEnabled=false'
            ]
        });

        send('progress', { msg: `Found ${topUrls.length} sites. Scanning...`, done: 0, total: topUrls.length });

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
                    // Ignore
                } finally {
                    completed++;
                    send('progress', { msg: `Processing...`, done: completed, total: topUrls.length });
                }
            }
        };

        const workers = Array(CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', {});

    } catch (e) {
        console.error(e);
        send('progress', { msg: 'Server Error: ' + e.message });
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
        await new Promise(r => setTimeout(r, 1000)); // Затримка для JS

        // Витягуємо приховані опції (для розмірів)
        const hiddenOptions = await page.evaluate(() => {
            const opts = [];
            document.querySelectorAll('select option, .variant, .swatch, .size-box').forEach(el => {
                if(el.innerText && el.innerText.length < 30) opts.push(el.innerText);
            });
            return opts.join(', ').substring(0, 500); // Ліміт
        });

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;
        let candidates = [];

        // --- 1. JSON-LD Extraction ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                const items = Array.isArray(json) ? json : [json];
                items.forEach(item => {
                    if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') extractFromJson(item, candidates, baseUrl);
                    if (item['@graph']) item['@graph'].forEach(g => {
                        if (g['@type'] === 'Product') extractFromJson(g, candidates, baseUrl);
                    });
                });
            } catch (e) {}
        });

        // --- 2. AI Fallback ---
        if (candidates.length === 0) {
            $('script, style, noscript, svg, iframe, header, footer, nav, .popup').remove();
            let body = $('body').html() || '';
            
            // Додаємо знайдені розміри в кінець HTML для AI
            if (hiddenOptions) body += `\n`;
            
            const truncated = body.replace(/\s+/g, ' ').substring(0, 60000);
            if (truncated.length > 500) {
                const aiRes = await parseWithAI(truncated, url, keyword);
                candidates = [...candidates, ...aiRes];
            }
        }

        // --- 3. Filter & Sort ---
        const validProducts = [];
        candidates.forEach(p => {
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            
            // Blacklist check
            if (BLACKLIST.some(bad => p.title.toLowerCase().includes(bad))) return;

            // Soft Relevance Check (Якщо слово із запиту зовсім не зустрічається - підозріло, але не видаляємо жорстко)
            // Ми довіряємо AI, який вже відфільтрував треш
            
            if (!p.price) p.price = 'Check Site';
            validProducts.push(p);
        });

        if (validProducts.length > 0) {
            // Сортуємо: Наявність ціни > Наявність розміру > Довжина назви
            validProducts.sort((a, b) => {
                const scoreA = (a.price !== 'Check Site' ? 2 : 0) + (a.size ? 2 : 0);
                const scoreB = (b.price !== 'Check Site' ? 2 : 0) + (b.size ? 2 : 0);
                return scoreB - scoreA;
            });
            // Беремо найкращий
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

    // Size extraction logic
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
1. Ignore services, rentals, courses.
2. EXTRACT SIZE: look for dimensions (mm, cm), capacity (ml, L), paper size (A4), or options (S, M, L).
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

// === ROBUST GOOGLE SEARCH ===
async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    // Спроба 1: Жорсткий пошук (тільки Австралія через налаштування двигуна)
    const queryStrict = encodeURIComponent(`${keyword} buy`);
    
    try {
        // Спочатку пробуємо з параметром cr=countryAU
        console.log('Trying Strict Search...');
        let res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${queryStrict}&num=10&gl=au&cr=countryAU&safe=active`);
        
        // Якщо пусто, пробуємо Fallback (без cr=countryAU, але з site:.au)
        if (!res.data.items || res.data.items.length === 0) {
            console.log('Strict failed. Switching to Fallback...');
            const queryFallback = encodeURIComponent(`${keyword} buy site:.au`);
            res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${queryFallback}&num=10&gl=au&safe=active`);
        }

        const blocked = ['facebook', 'youtube', 'pinterest', 'instagram', 'reddit', 'wikipedia', 'linkedin'];
        return (res.data.items || [])
            .map(i => i.link)
            .filter(link => !blocked.some(b => link.includes(b)));
            
    } catch (e) {
        console.error('Google Search Error:', e.message);
        return [];
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: ${PORT}`));
