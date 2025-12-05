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

const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`\n🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}\n`);

// ============ HTML INTERFACE ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Product Search (Optimized)</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 6px; }
        button { padding: 12px 24px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
        button:disabled { background: #93c5fd; }
        .status { padding: 15px; background: #e0f2fe; color: #0369a1; border-radius: 6px; margin-bottom: 20px; font-family: monospace; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
        .card { background: white; padding: 10px; border-radius: 8px; border: 1px solid #eee; }
        .card img { width: 100%; height: 150px; object-fit: contain; margin-bottom: 10px; }
        .title { font-size: 14px; margin-bottom: 5px; font-weight: 500; height: 40px; overflow: hidden; }
        .price { color: #16a34a; font-weight: bold; }
        .link { display: block; margin-top: 10px; font-size: 13px; color: #2563eb; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🇦🇺 Smart Product Search</h1>
        <div class="search-box">
            <input type="text" id="keyword" placeholder="What are you looking for?" />
            <button onclick="run()" id="btn">Search</button>
        </div>
        <div id="status" class="status" style="display:none"></div>
        <div id="results" class="grid"></div>
    </div>
    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value;
            if(!keyword) return;
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const results = document.getElementById('results');
            
            btn.disabled = true;
            status.style.display = 'block';
            results.innerHTML = '';
            
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
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\\n');
                    
                    for(const line of lines) {
                        if(line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if(data.type === 'status') status.textContent = data.msg;
                                if(data.type === 'product') {
                                    results.innerHTML += \`
                                        <div class="card">
                                            <img src="\${data.p.imageUrl}" onerror="this.src='https://placehold.co/200x150?text=No+Image'">
                                            <div class="title" title="\${data.p.title}">\${data.p.title}</div>
                                            <div class="price">\${data.p.price || 'Check site'}</div>
                                            <a href="\${data.p.productUrl}" target="_blank" class="link">View Product →</a>
                                        </div>
                                    \`;
                                }
                                if(data.type === 'done') {
                                    status.textContent = \`Done! Found \${data.total} products.\`;
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
        send('status', { msg: `Searching Google for "${keyword}"...` });
        
        // Пошук: додаємо -site:ebay -site:amazon щоб фокусуватись на локальних магазинах, якщо треба
        // Але поки лишимо як є, просто фільтруємо
        const urls = await googleSearch(keyword);
        send('status', { msg: `Found ${urls.length} sites. Launching browser...` });

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });

        let totalFound = 0;
        const processedUrls = new Set();

        // Скануємо до 5 сайтів для швидкості
        for (const url of urls.slice(0, 5)) {
            send('status', { msg: `Scanning: ${new URL(url).hostname}...` });
            
            try {
                const html = await fetchPage(browser, url);
                if (!html) continue;

                const products = await parseWithAI(html, url, keyword);
                
                for (const p of products) {
                    // Фільтрація дублікатів по URL
                    if (!processedUrls.has(p.productUrl)) {
                        processedUrls.add(p.productUrl);
                        totalFound++;
                        send('product', { p });
                    }
                }
            } catch (e) {
                console.error(`Error processing ${url}:`, e.message);
            }
        }

        send('done', { total: totalFound });

    } catch (e) {
        send('status', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close();
        res.end();
    }
});

// ============ FETCH PAGE (Optimized) ============
async function fetchPage(browser, url) {
    const page = await browser.newPage();
    try {
        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());
        await page.setViewport({ width: 1440, height: 900 });

        // Блокуємо сміття
        await page.setRequestInterception(true);
        page.on('request', req => {
            const rType = req.resourceType();
            if (['font', 'media', 'stylesheet', 'other'].includes(rType)) req.abort();
            else req.continue();
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Швидкий скрол для lazy loading
        await page.evaluate(async () => {
            await new Promise(resolve => {
                let totalHeight = 0;
                const timer = setInterval(() => {
                    window.scrollBy(0, 500);
                    totalHeight += 500;
                    if(totalHeight >= 4000) { // Скролимо глибше (4000px)
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        // Чекаємо трохи після скролу
        await new Promise(r => setTimeout(r, 1000));

        return await page.content();
    } catch (e) {
        return null;
    } finally {
        await page.close();
    }
}

// ============ AI PARSER (HEAVILY OPTIMIZED) ============
async function parseWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // 1. ВИДАЛЯЄМО СМІТТЯ (Related, Nav, Footer)
    // Це критично для точності результатів
    const badSelectors = [
        'header', 'footer', 'nav', 'script', 'style', 'noscript', 'svg', 'iframe',
        '.related', '.recommendations', '.suggested', '.recent', // Блоки "Схожі товари"
        '.sidebar', '.menu', '.popup', '.modal', '.cookie',
        '[role="navigation"]', '[aria-label*="menu"]'
    ];
    $(badSelectors.join(',')).remove();

    // 2. ОБРОБКА LAZY LOAD KARTINOK
    $('img').each((i, el) => {
        const $el = $(el);
        // Часто src пустий, а справжнє посилання в data-src
        const realSrc = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('data-srcset');
        if (realSrc) $el.attr('src', realSrc.split(' ')[0]);
    });

    // 3. СТИСНЕННЯ HTML (Щоб влізло більше товарів)
    // Ми видаляємо всі атрибути крім src та href
    $('*').each((i, el) => {
        if (el.type !== 'tag') return;
        
        const attribs = el.attribs || {};
        const newAttribs = {};
        
        // Зберігаємо тільки критичні дані
        if (attribs.src) newAttribs.src = attribs.src;
        if (attribs.href) newAttribs.href = attribs.href;
        
        // Зберігаємо клас, бо він може допомогти AI зрозуміти структуру (але скорочуємо)
        // if (attribs.class) newAttribs.class = attribs.class; // Можна включити, якщо AI губиться
        
        el.attribs = newAttribs;
    });

    // Отримуємо чистий HTML
    let cleanHtml = $('body').html() || '';
    
    // Видаляємо зайві пробіли
    cleanHtml = cleanHtml.replace(/\s+/g, ' ').trim();
    
    // Ліміт 55k (GPT-4o-mini дозволяє більше, ніж старі моделі)
    const truncated = cleanHtml.substring(0, 55000);

    const prompt = `
    Analyze this HTML from website "${new URL(url).hostname}". 
    User keyword: "${keyword}".

    Task: Extract valid products that strictly match the keyword.
    
    Rules:
    1. IGNORE "Related products", "You may also like", "Accessories" (unless they match keyword).
    2. IGNORE Navigation links, categories, or blog posts.
    3. PRICE: Must be a number or string (e.g. "$10"). If missing, set null.
    4. IMAGE: Must be a valid URL. If missing, SKIP the item.
    5. URL: Must be a link to the product page.

    Return JSON Array ONLY:
    [{"title":"...","price":"...","imageUrl":"...","productUrl":"..."}]

    HTML Snippet:
    ${truncated}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 4000
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
        })).filter(p => p.imageUrl && p.productUrl && p.title.length > 3);

    } catch (e) {
        console.error('AI Parse Error:', e.message);
        return [];
    }
}

function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    // Додаємо +shop або +buy для кращих результатів
    const q = encodeURIComponent(`${keyword} australia shop`);
    
    return axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=8&gl=au`)
        .then(res => (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube') && !l.includes('pinterest')))
        .catch(() => []);
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || urlStr.startsWith('data:')) return null;
    try {
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        return new URL(urlStr, baseUrl).href;
    } catch { return null; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
