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
    <title>Product Search API - Australia (Final Fix)</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #333; margin-bottom: 10px; }
        .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 12px 16px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; }
        button { padding: 12px 24px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 8px; cursor: pointer; }
        button:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status { padding: 10px; background: #e8f4fd; border-radius: 8px; margin-bottom: 15px; color: #0066cc; }
        .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
        .product { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .product img { width: 100%; height: 200px; object-fit: contain; background: #fff; padding: 10px; }
        .product-info { padding: 15px; }
        .product-title { font-size: 14px; color: #333; margin-bottom: 8px; font-weight: 500; height: 40px; overflow: hidden; }
        .product-price { font-size: 18px; font-weight: bold; color: #28a745; }
        .product-link { display: block; margin-top: 10px; color: #007bff; text-decoration: none; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Product Search API</h1>
        <div class="search-box">
            <input type="text" id="keyword" placeholder="Enter product keyword..." />
            <button onclick="search()" id="searchBtn">Search</button>
        </div>
        <div id="status" class="status" style="display:none;"></div>
        <div class="products" id="products"></div>
    </div>
    <script>
        async function search() {
            const keyword = document.getElementById('keyword').value.trim();
            if (!keyword) return;
            const btn = document.getElementById('searchBtn');
            const status = document.getElementById('status');
            const products = document.getElementById('products');
            
            btn.disabled = true;
            status.style.display = 'block';
            products.innerHTML = '';
            
            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keyword })
                });
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const lines = decoder.decode(value).split('\\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try { 
                                const data = JSON.parse(line.slice(6));
                                if (data.type === 'status' || data.type === 'processing') status.textContent = data.message || ('Processing: ' + data.site);
                                if (data.type === 'products') {
                                    data.newProducts.forEach(p => {
                                        products.innerHTML += '<div class="product"><img src="' + p.imageUrl + '"><div class="product-info"><div class="product-title">' + p.title + '</div><div class="product-price">' + (p.price || 'N/A') + '</div><a href="' + p.productUrl + '" target="_blank" class="product-link">View →</a></div></div>';
                                    });
                                }
                                if (data.type === 'complete') {
                                    status.textContent = 'Found ' + data.totalProducts + ' products!';
                                    btn.disabled = false;
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) { status.textContent = 'Error: ' + e.message; btn.disabled = false; }
        }
    </script>
</body>
</html>
    `);
});

// ============ STREAMING SEARCH ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    let browser = null;

    try {
        console.log(`\n🔍 Searching for: "${keyword}"`);
        sendEvent('status', { message: `Searching Google for "${keyword}"...` });

        const urls = await googleSearch(keyword);
        sendEvent('status', { message: `Found ${urls.length} sites. Starting scan...` });

        // ЗАПУСК: Використовуємо 'new' headless
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--window-size=1366,768']
        });

        const allProducts = [];
        const seenUrls = new Set(); // Щоб уникнути дублів

        // Скануємо перші 6 сайтів (зменшили з 8 для швидкості)
        const sitesToScan = urls.slice(0, 6);

        for (let i = 0; i < sitesToScan.length; i++) {
            const url = sitesToScan[i];
            console.log(`\n📄 [${i + 1}/${sitesToScan.length}] Scanning: ${url}`);
            sendEvent('processing', { site: url, siteIndex: i + 1, totalSites: sitesToScan.length });

            try {
                const html = await fetchPage(browser, url);
                if (!html) continue;

                const products = await parseHtmlWithAI(html, url, keyword);

                const newProducts = [];
                for (const p of products) {
                    // Фільтрація: має бути ціна або картинка, і унікальний URL
                    if (p.title && !seenUrls.has(p.productUrl)) {
                        seenUrls.add(p.productUrl);
                        allProducts.push(p);
                        newProducts.push(p);
                    }
                }

                if (newProducts.length > 0) {
                    console.log(`   ✅ Found ${newProducts.length} items`);
                    sendEvent('products', { site: url, newProducts, totalSoFar: allProducts.length });
                } else {
                    console.log(`   ⚠️ No valid products found`);
                }
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
            }
        }

        sendEvent('complete', { keyword, totalProducts: allProducts.length });

    } catch (error) {
        console.error('Fatal error:', error);
        sendEvent('error', { error: error.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

// ============ FETCH PAGE (Виправлено) ============
async function fetchPage(browser, url) {
    const page = await browser.newPage();
    try {
        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(userAgent.toString());
        await page.setViewport({ width: 1366, height: 768 });

        // Блокуємо тільки шрифти та медіа, КАРТИНКИ залишаємо (потрібно для аналізу src)
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['font', 'media', 'stylesheet'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Чекаємо networkidle2 (коли мережа заспокоїться)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Скролимо сторінку, щоб завантажити Lazy Load картинки
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= 3000){
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        return await page.content();
    } catch (e) {
        console.log(`   Fetch failed: ${e.message}`);
        return null;
    } finally {
        await page.close();
    }
}

// ============ GOOGLE SEARCH ============
async function googleSearch(keyword) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    if (!apiKey || !cx) return [];
    
    try {
        // Додаємо "buy" до запиту для кращої релевантності
        const query = `${keyword} buy australia`; 
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10&gl=au&cr=countryAU`;
        const response = await axios.get(url);
        
        if (!response.data.items) return [];

        const blocked = ['reddit', 'wiki', 'youtube', 'facebook', 'twitter', 'pinterest', 'instagram', 'tiktok', 'blog', 'news'];
        return response.data.items
            .map(item => item.link)
            .filter(link => !blocked.some(b => link.includes(b)));
    } catch(e) { return []; }
}

// ============ AI PARSING (Повністю виправлено) ============
async function parseHtmlWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // 1. ВИПРАВЛЕННЯ LAZY LOADING
    // Знаходимо картинки, де src пустий, але є data-src
    $('img').each((i, el) => {
        const dataSrc = $(el).attr('data-src') || $(el).attr('data-srcset') || $(el).attr('data-lazy-src');
        if (dataSrc) {
            $(el).attr('src', dataSrc.split(' ')[0]); // беремо першу картинку якщо їх список
        }
    });

    // 2. М'ЯКА ОЧИСТКА (Видалили агресивні фільтри)
    $('script, style, noscript, svg, iframe, header, footer').remove();
    // НЕ видаляємо nav або menu, бо часто товари всередині
    
    // 3. ЗНАХОДЖЕННЯ ОСНОВНОГО КОНТЕНТУ
    // Спробуємо знайти main або схожі контейнери. Якщо немає - беремо body.
    let content = $('main').html() || $('#content').html() || $('.products').html() || $('body').html();
    
    if (!content) return [];

    // Чистимо HTML від зайвих атрибутів, щоб зменшити розмір
    const clean$ = cheerio.load(content);
    clean$('*').each((i, el) => {
        const attribs = el.attribs;
        const keep = ['src', 'href', 'class']; // залишаємо class для контексту
        Object.keys(attribs).forEach(attr => {
            if (!keep.includes(attr)) clean$(el).removeAttr(attr);
        });
    });

    // Обрізаємо до 45000 символів
    const truncated = clean$('body').html().replace(/\s+/g, ' ').trim().substring(0, 45000);
    
    if (truncated.length < 500) {
        console.log(`   ⚠️ Content too short (${truncated.length} chars)`);
        return [];
    }

    console.log(`   📝 Sending ${truncated.length} chars to AI`);

    const prompt = `
    I have an HTML snippet from an Australian online store. 
    User searched for: "${keyword}".
    
    Extract a list of products found in the PRODUCT GRID.
    Do NOT include:
    - Navigation menu items
    - "Related products" or "You might also like"
    - Categories (unless they are the main result)
    - Blog posts

    Return a JSON Array:
    [
      {
        "title": "Exact Product Name",
        "price": "Price string (e.g. $29.99) or null",
        "imageUrl": "Full image URL",
        "productUrl": "Full link URL"
      }
    ]

    Rules:
    1. If a product has no image, SKIP IT.
    2. If a product is clearly just an ad, SKIP IT.
    3. Max 10 items.

    HTML Snippet:
    ${truncated}
    `;

    try {
        let responseText;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a JSON extraction bot. Output strictly valid JSON array.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0,
                max_tokens: 4000
            });
            responseText = completion.choices[0].message.content;
        } else {
             const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );
            responseText = resp.data.candidates[0].content.parts[0].text;
        }

        const jsonStr = responseText.replace(/```json|```/gi, '').trim();
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        if (start === -1 || end === -1) return [];
        
        const rawProducts = JSON.parse(jsonStr.substring(start, end + 1));
        const baseUrl = new URL(url).origin;

        return rawProducts.map(p => ({
            title: p.title,
            price: p.price,
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl)
        })).filter(p => p.imageUrl && p.productUrl); // Ще одна перевірка на наявність даних

    } catch (error) {
        console.log(`   ❌ AI Error: ${error.message}`);
        return [];
    }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr) return null;
    if (urlStr.startsWith('data:')) return null;
    try {
        // Виправляємо "поламані" посилання //example.com
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        return new URL(urlStr, baseUrl).href;
    } catch (e) { return null; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
