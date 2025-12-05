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
const CONCURRENCY = 4; // Одночасно відкриваємо 4 вкладки (баланс швидкості і пам'яті)
const PAGE_TIMEOUT = 20000; // Чекаємо сайт до 20 сек (не викидаємо швидко)
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`\n🏎️ PIPELINE MODE: ${AI_PROVIDER.toUpperCase()} | Threads: ${CONCURRENCY}\n`);

// ============ HTML UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>⚡ Pipeline Search</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f3f4f6; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-container { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); margin-bottom: 20px; }
        .input-group { display: flex; gap: 10px; }
        input { flex: 1; padding: 14px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; outline: none; }
        button { padding: 14px 32px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
        button:disabled { background: #93c5fd; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; color: #4b5563; font-size: 14px; font-family: monospace; }
        .progress-container { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; margin-bottom: 20px; }
        .progress-bar { height: 100%; background: #2563eb; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px; }
        .card { background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; height: 100%; transition: transform 0.2s; }
        .card:hover { transform: translateY(-3px); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .img-wrap { height: 160px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 12px; flex: 1; display: flex; flex-direction: column; border-top: 1px solid #f3f4f6; }
        .site-name { font-size: 10px; text-transform: uppercase; color: #6b7280; font-weight: bold; margin-bottom: 4px; }
        .title { font-size: 13px; margin-bottom: 8px; line-height: 1.4; color: #111827; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 16px; font-weight: 700; color: #059669; margin-top: auto; }
        .link { margin-top: 10px; text-align: center; background: #f9fafb; color: #374151; text-decoration: none; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #e5e7eb; }
        .link:hover { background: #f3f4f6; }
    </style>
</head>
<body>
    <div class="search-container">
        <h1>🚀 Pipeline Search</h1>
        <div class="input-group">
            <input type="text" id="keyword" placeholder="Enter product keyword..." onkeypress="if(event.key==='Enter') run()">
            <button onclick="run()" id="btn">Search</button>
        </div>
    </div>
    
    <div class="status-bar">
        <span id="status">Ready</span>
        <span id="stats">0/0 sites</span>
    </div>
    <div class="progress-container"><div class="progress-bar" id="progress"></div></div>
    <div id="results" class="grid"></div>

    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value;
            if(!keyword) return;
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const stats = document.getElementById('stats');
            const progress = document.getElementById('progress');
            const results = document.getElementById('results');
            
            btn.disabled = true;
            results.innerHTML = '';
            progress.style.width = '2%';
            status.textContent = 'Searching...';
            
            let totalProducts = 0;
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
                                
                                if(data.type === 'progress') {
                                    status.textContent = data.msg;
                                    if(data.done && data.total) {
                                        const pct = Math.round((data.done / data.total) * 100);
                                        progress.style.width = pct + '%';
                                        stats.textContent = \`\${data.done}/\${data.total} sites\`;
                                    }
                                }
                                
                                if(data.type === 'product') {
                                    totalProducts++;
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    
                                    // Prepend to show newest first or append? Let's append.
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.src='https://placehold.co/200x200?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="site-name">\${domain}</div>
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${p.price || '?'}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="link">View →</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    const time = ((Date.now() - startTime) / 1000).toFixed(1);
                                    status.textContent = \`✅ Done! Found \${totalProducts} products in \${time}s\`;
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
        
        // 1. Google Search + Browser Launch (Parallel)
        const [browserInstance, urls] = await Promise.all([
            puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--blink-settings=imagesEnabled=false' // Тільки HTML, без картинок (для швидкості)
                ]
            }),
            googleSearch(keyword)
        ]);

        browser = browserInstance;

        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        const totalUrls = Math.min(urls.length, 10); // Беремо топ 10
        const targetUrls = urls.slice(0, totalUrls);
        
        send('progress', { msg: `Scanning ${totalUrls} sites...`, done: 0, total: totalUrls });

        // 2. ЗАПУСК ЧЕРГИ (CONCURRENCY QUEUE)
        // Це головна магія: ми тримаємо рівно 4 вкладки відкритими.
        // Як тільки одна закінчує - беремо наступний сайт.
        
        let completedCount = 0;
        
        // Функція-воркер, яка бере задачі з масиву
        const processNext = async () => {
            while (targetUrls.length > 0) {
                const url = targetUrls.shift(); // Беремо наступний URL
                
                try {
                    // Обробка сайту
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    console.error(`Error ${url}:`, e.message);
                } finally {
                    completedCount++;
                    send('progress', { 
                        msg: `Processed ${completedCount}/${totalUrls}`, 
                        done: completedCount, 
                        total: totalUrls 
                    });
                }
            }
        };

        // Створюємо N воркерів
        const workers = Array(CONCURRENCY).fill(null).map(() => processNext());
        
        // Чекаємо поки всі воркери закінчать роботу
        await Promise.all(workers);

        send('done', {});

    } catch (e) {
        console.error(e);
        send('progress', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

// ============ ОБРОБКА ОДНОГО САЙТУ ============
async function processSite(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        
        // Блокуємо важкі ресурси, але залишаємо скрипти (деякі сайти без них не рендерять товари)
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
            else req.continue();
        });

        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());

        // Timeout 20s - це дасть шанс повільним сайтам
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // Швидкий, але ефективний скрол
        await page.evaluate(async () => {
            // Скролимо 2 рази з паузою, щоб підвантажити Lazy Load
            window.scrollBy(0, 1000);
            await new Promise(r => setTimeout(r, 200)); 
            window.scrollBy(0, 1500);
            await new Promise(r => setTimeout(r, 300));
        });

        const html = await page.content();
        
        // Закриваємо сторінку ДО AI, щоб звільнити пам'ять для іншої вкладки
        await page.close();
        page = null;

        // Парсинг AI
        const products = await parseWithAI(html, url, keyword);
        
        if (products.length > 0) {
            products.forEach(p => send('product', { p }));
        }

    } catch (e) {
        if(page) await page.close().catch(() => {});
        // Не викидаємо помилку наверх, щоб воркер продовжив з наступним сайтом
    }
}

// ============ AI PARSER ============
async function parseWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // Видаляємо сміття
    $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .popup, .cookie').remove();
    
    // Lazy Load Fix: шукаємо data-src і ставимо в src
    $('img').each((i, el) => {
        const $el = $(el);
        const realSrc = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('data-srcset');
        if (realSrc) {
            // Якщо це srcset (url 1x, url 2x), беремо перший
            $el.attr('src', realSrc.split(' ')[0]);
        }
    });

    // Очищаємо HTML від атрибутів крім src/href (стиснення)
    $('*').each((i, el) => {
        if(el.type === 'tag') {
            const attribs = el.attribs || {};
            const newAttribs = {};
            if(attribs.src) newAttribs.src = attribs.src;
            if(attribs.href) newAttribs.href = attribs.href;
            el.attribs = newAttribs;
        }
    });

    let cleanHtml = $('body').html() || '';
    // Відправляємо не більше 40к символів (цього достатньо для ~20-30 товарів)
    const truncated = cleanHtml.replace(/\s+/g, ' ').substring(0, 40000);

    const prompt = `
    Find products for "${keyword}" in HTML.
    Site: ${new URL(url).hostname}.
    Ignore Nav/Footer/Related.
    Format JSON: [{"title":"...","price":"...","imageUrl":"...","productUrl":"..."}]
    HTML: ${truncated}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 3000
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
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10&gl=au`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube') && !l.includes('instagram'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
