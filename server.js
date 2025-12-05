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

// Налаштування для Railway (щоб не вилетіло по пам'яті)
const CONCURRENCY_LIMIT = 5; // Скільки сайтів сканувати одночасно

const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`\n🚀 TURBO MODE ACTIVATED: ${AI_PROVIDER.toUpperCase()}\n`);

// ============ HTML UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>⚡ Turbo Product Search</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #f0f2f5; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-box { display: flex; gap: 10px; margin-bottom: 20px; background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; }
        button { padding: 12px 30px; background: #0066ff; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        button:hover { background: #0052cc; }
        button:disabled { background: #ccc; }
        #status { margin-bottom: 20px; color: #666; font-size: 14px; font-family: monospace; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: transform 0.2s; display: flex; flex-direction: column; }
        .card:hover { transform: translateY(-3px); }
        .img-wrap { height: 180px; background: #f8f9fa; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .card img { width: 100%; height: 100%; object-fit: contain; }
        .info { padding: 12px; flex: 1; display: flex; flex-direction: column; }
        .title { font-size: 14px; margin-bottom: 8px; line-height: 1.4; color: #333; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #00a651; margin-top: auto; }
        .domain { font-size: 11px; color: #999; margin-top: 5px; }
        .link { margin-top: 10px; text-decoration: none; color: white; background: #333; text-align: center; padding: 8px; border-radius: 6px; font-size: 13px; }
    </style>
</head>
<body>
    <h1>⚡ Turbo Search Australia</h1>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Enter product name..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    <div id="status">Ready</div>
    <div id="results" class="grid"></div>

    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value;
            if(!keyword) return;
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const results = document.getElementById('results');
            
            btn.disabled = true;
            btn.innerText = 'Searching...';
            status.innerText = 'Initializing...';
            results.innerHTML = '';
            
            let count = 0;
            const startTime = Date.now();

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
                                
                                if(data.type === 'status') {
                                    status.innerText = data.msg + \` (\${((Date.now()-startTime)/1000).toFixed(1)}s)\`;
                                }
                                if(data.type === 'product') {
                                    count++;
                                    const p = data.p;
                                    results.innerHTML += \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.style.display='none'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${p.price || '?'}</div>
                                                <div class="domain">\${new URL(p.productUrl).hostname.replace('www.','')}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="link">View Product</a>
                                            </div>
                                        </div>
                                    \`;
                                }
                                if(data.type === 'done') {
                                    status.innerText = \`✅ Complete! Found \${count} products in \${((Date.now()-startTime)/1000).toFixed(1)}s\`;
                                    btn.disabled = false;
                                    btn.innerText = 'Search';
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {
                status.innerText = 'Error: ' + e.message;
                btn.disabled = false;
                btn.innerText = 'Search';
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
        send('status', { msg: `🔍 Google Search: "${keyword}"` });
        
        // 1. Паралельний старт: поки шукаємо в Google, вже гріємо браузер
        const [browserInstance, urls] = await Promise.all([
            puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--blink-settings=imagesEnabled=false' // ⚡ ВИМИКАЄМО КАРТИНКИ ГЛОБАЛЬНО
                ]
            }),
            googleSearch(keyword)
        ]);

        browser = browserInstance;
        
        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        send('status', { msg: `🚀 Scanning ${urls.length} sites in parallel...` });

        // 2. Обробка чергами (Concurrency Limit)
        // Railway Starter має мало RAM, тому запускаємо по 5 сайтів одночасно
        const processBatch = async (batchUrls) => {
            const promises = batchUrls.map(url => processSingleUrl(browser, url, keyword, send));
            await Promise.all(promises); // Чекаємо поки вся пачка завершиться
        };

        // Розбиваємо на пачки
        for (let i = 0; i < urls.length; i += CONCURRENCY_LIMIT) {
            const batch = urls.slice(i, i + CONCURRENCY_LIMIT);
            send('status', { msg: `⚡ Processing batch ${Math.ceil((i+1)/5)}...` });
            await processBatch(batch);
        }

        send('done', { total: 'N/A' });

    } catch (e) {
        console.error(e);
        send('status', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

// ============ SINGLE URL PROCESSOR ============
async function processSingleUrl(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        
        // Блокування ресурсів (Super Aggressive)
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            // Блокуємо все крім Document (HTML) і XHR (Fetch)
            if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type)) {
                req.abort(); 
            } else {
                req.continue();
            }
        });

        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());

        // Timeout 15s на все про все
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // ⚡ TURBO SCROLL (Всього 1 секунда!)
        // Нам не треба все, нам треба ПЕРШІ товари швидко
        await page.evaluate(async () => {
            window.scrollBy(0, 1000);
            await new Promise(r => setTimeout(r, 500));
            window.scrollBy(0, 1000);
            await new Promise(r => setTimeout(r, 500));
        });

        const html = await page.content();
        await page.close(); // Закриваємо сторінку одразу, звільняємо пам'ять

        // Парсинг AI (Паралельно з іншими сайтами)
        const products = await parseWithAI(html, url, keyword);
        
        if (products.length > 0) {
            products.forEach(p => send('product', { p }));
        }

    } catch (e) {
        if(page) await page.close().catch(() => {});
        // Не кидаємо помилку, щоб не зупинити інші потоки
        // console.log(`Skipped ${url}: ${e.message}`);
    }
}

// ============ AI PARSER (Fast & Light) ============
async function parseWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // Видаляємо все зайве
    $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .popup').remove();
    
    // Отримуємо тільки src картинок (навіть якщо вони не завантажились браузером, лінка в коді є)
    $('img').each((i, el) => {
        const $el = $(el);
        const realSrc = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('src');
        if (realSrc) $el.attr('src', realSrc);
    });

    // Максимально стискаємо HTML
    let body = $('body').html() || '';
    body = body.replace(/\s+/g, ' ').substring(0, 35000); // 35k символів достатньо для перших 20 товарів

    // Короткий промпт для швидкості
    const prompt = `
    Extract products from HTML for keyword "${keyword}".
    Site: ${new URL(url).hostname}.
    Ignore related items.
    JSON Output: [{"title":"...","price":"...","imageUrl":"...","productUrl":"..."}]
    HTML: ${body}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 2000 // Менше токенів = швидше відповідь
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
        })).filter(p => p.imageUrl && p.productUrl && p.title);

    } catch (e) {
        return [];
    }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || urlStr.startsWith('data:')) return null;
    try {
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        return new URL(urlStr, baseUrl).href;
    } catch { return null; }
}

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    const q = encodeURIComponent(`${keyword} buy australia`);
    // Беремо 10 сайтів
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10&gl=au`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube') && !l.includes('pinterest'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
