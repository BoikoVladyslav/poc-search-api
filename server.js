require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer-core');

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
    <title>Product Search API - Australia</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #333; margin-bottom: 10px; }
        .subtitle { color: #666; margin-bottom: 20px; }
        .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 12px 16px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; }
        input:focus { outline: none; border-color: #007bff; }
        button { padding: 12px 24px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 8px; cursor: pointer; }
        button:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status { padding: 10px; background: #e8f4fd; border-radius: 8px; margin-bottom: 15px; color: #0066cc; }
        .stats { display: flex; gap: 20px; margin-bottom: 20px; }
        .stat { background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; font-size: 14px; }
        .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .product { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s; }
        .product:hover { transform: translateY(-4px); }
        .product img { width: 100%; height: 180px; object-fit: cover; background: #f0f0f0; }
        .product-info { padding: 15px; }
        .product-title { font-size: 14px; color: #333; margin-bottom: 8px; line-height: 1.4; }
        .product-price { font-size: 18px; font-weight: bold; color: #28a745; }
        .product-price.no-price { color: #999; font-size: 14px; }
        .product-link { display: block; margin-top: 10px; color: #007bff; text-decoration: none; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Product Search API</h1>
        <p class="subtitle">Search Australian e-commerce sites in real-time</p>
        <div class="search-box">
            <input type="text" id="keyword" placeholder="Enter product keyword (e.g., bumper stickers)" />
            <button onclick="search()" id="searchBtn">Search</button>
        </div>
        <div id="status" class="status" style="display:none;"></div>
        <div class="stats" id="stats" style="display:none;">
            <div class="stat"><div class="stat-value" id="productCount">0</div><div class="stat-label">Products Found</div></div>
            <div class="stat"><div class="stat-value" id="siteCount">0/0</div><div class="stat-label">Sites Processed</div></div>
        </div>
        <div class="products" id="products"></div>
    </div>
    <script>
        async function search() {
            const keyword = document.getElementById('keyword').value.trim();
            if (!keyword) { alert('Please enter a keyword'); return; }
            const btn = document.getElementById('searchBtn');
            const status = document.getElementById('status');
            const stats = document.getElementById('stats');
            const products = document.getElementById('products');
            btn.disabled = true;
            btn.textContent = 'Searching...';
            status.style.display = 'block';
            stats.style.display = 'flex';
            products.innerHTML = '';
            document.getElementById('productCount').textContent = '0';
            document.getElementById('siteCount').textContent = '0/0';
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
                            try { handleEvent(JSON.parse(line.slice(6))); } catch (e) {}
                        }
                    }
                }
            } catch (e) { status.textContent = 'Error: ' + e.message; }
            btn.disabled = false;
            btn.textContent = 'Search';
        }
        function handleEvent(data) {
            const status = document.getElementById('status');
            const products = document.getElementById('products');
            if (data.type === 'status') status.textContent = data.message;
            if (data.type === 'processing') {
                status.textContent = 'Processing: ' + data.site;
                document.getElementById('siteCount').textContent = data.siteIndex + '/' + data.totalSites;
            }
            if (data.type === 'products') {
                document.getElementById('productCount').textContent = data.totalSoFar;
                data.newProducts.forEach(p => {
                    const price = p.price ? '$' + p.price.toFixed(2) + ' AUD' : 'Price on request';
                    products.innerHTML += '<div class="product"><img src="' + p.imageUrl + '" onerror="this.style.display=\\'none\\'"><div class="product-info"><div class="product-title">' + p.title + '</div><div class="product-price">' + price + '</div><a href="' + p.productUrl + '" target="_blank" class="product-link">View Product →</a></div></div>';
                });
            }
            if (data.type === 'complete') status.textContent = 'Found ' + data.totalProducts + ' products!';
        }
        document.getElementById('keyword').addEventListener('keypress', e => { if (e.key === 'Enter') search(); });
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

    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    let browser = null;

    try {
        console.log(`\n🔍 Searching for: "${keyword}"`);
        sendEvent('status', { message: `Searching for "${keyword}"...` });

        const urls = await googleSearch(keyword);
        console.log(`📋 Found ${urls.length} URLs`);
        sendEvent('status', { message: `Found ${urls.length} sites to scan` });

        if (urls.length === 0) {
            sendEvent('complete', { totalProducts: 0, products: [] });
            return res.end();
        }

        const isWindows = process.platform === 'win32';
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: isWindows 
                ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                : '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--no-zygote'
            ]
        });

        const allProducts = [];
        const seenTitles = new Set();

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`\n📄 [${i + 1}/${urls.length}] Processing: ${url}`);
            sendEvent('processing', { site: url, siteIndex: i + 1, totalSites: urls.length });

            try {
                const html = await fetchPage(browser, url);
                const products = await parseHtmlWithAI(html, url, keyword);

                const newProducts = [];
                for (const product of products) {
                    const normalizedTitle = product.title.toLowerCase().trim();
                    if (!seenTitles.has(normalizedTitle)) {
                        seenTitles.add(normalizedTitle);
                        allProducts.push(product);
                        newProducts.push(product);
                    }
                }

                if (newProducts.length > 0) {
                    console.log(`   ✅ Found ${newProducts.length} new products`);
                    sendEvent('products', { site: url, newProducts, totalSoFar: allProducts.length });
                } else {
                    console.log(`   ⚠️ No products extracted`);
                }
            } catch (error) {
                console.log(`   ❌ Failed: ${error.message}`);
            }
        }

        console.log(`\n✨ Total products: ${allProducts.length}`);
        sendEvent('complete', { keyword, totalProducts: allProducts.length, products: allProducts });

    } catch (error) {
        console.error('Search error:', error.message);
        sendEvent('error', { error: error.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }

    res.end();
});

// ============ FETCH PAGE ============
async function fetchPage(browser, url) {
    const page = await browser.newPage();
    
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Скролимо для lazy-loading
        await page.evaluate(async () => {
            for (let i = 0; i < 5; i++) {
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 200));
            }
        });
        
        await new Promise(r => setTimeout(r, 1500));
        
        const html = await page.content();
        console.log(`   📊 HTML: ${html.length} chars`);
        
        return html;
    } finally {
        await page.close();
    }
}

// ============ GOOGLE SEARCH ============
async function googleSearch(keyword) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    if (!apiKey || !cx) throw new Error('Google API not configured');

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(keyword + ' buy australia')}&num=10&gl=au&cr=countryAU`;
    const response = await axios.get(url);
    if (!response.data.items) return [];

    const blocked = ['reddit.com', 'wikipedia.org', 'youtube.com', 'facebook.com', 'twitter.com', 'pinterest.com', 'ebay.com.au'];
    return response.data.items
        .map(item => item.link)
        .filter(link => !blocked.some(b => link.includes(b)));
}

// ============ AI PARSING ============
async function parseHtmlWithAI(html, url, keyword) {
    // Крок 1: Очистка HTML
    let cleaned = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
        .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Крок 2: Знаходимо контейнер з продуктами
    let productHtml = cleaned;
    
    // Спробуємо знайти main
    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch && mainMatch[1].length > 3000) {
        productHtml = mainMatch[1];
        console.log(`   📦 Found <main>: ${productHtml.length} chars`);
    }
    
    // Або section з products
    if (productHtml.length > 150000) {
        const sectionMatch = cleaned.match(/<section[^>]*>([\s\S]*?)<\/section>/gi);
        if (sectionMatch) {
            const largest = sectionMatch.reduce((a, b) => a.length > b.length ? a : b);
            if (largest.length > 5000) {
                productHtml = largest;
                console.log(`   📦 Found <section>: ${productHtml.length} chars`);
            }
        }
    }

    // Крок 3: Обмежуємо розмір (60k - оптимально для AI)
    const truncated = productHtml.substring(0, 60000);
    console.log(`   📝 Sending ${truncated.length} chars to AI`);

    // Крок 4: Простий чіткий prompt
    const prompt = `Extract all products from this HTML page.
Search: "${keyword}"

Return ONLY a JSON array (no other text):
[{"title":"Product Name","price":19.99,"imageUrl":"/img.jpg","productUrl":"/product"}]

Rules:
- title: product name (required)
- price: number only, or null if not shown
- imageUrl: image src attribute
- productUrl: link href attribute
- Max 30 products
- Return [] if no products

HTML:
${truncated}`;

    // Крок 5: Виклик AI з retry
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            let responseText;
            
            if (AI_PROVIDER === 'openai') {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You extract product data from HTML and return JSON arrays only.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0,
                    max_tokens: 4000
                });
                responseText = completion.choices[0].message.content;
            } else {
                const resp = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                    { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 8000 } }
                );
                responseText = resp.data.candidates[0].content.parts[0].text;
            }

            // Логуємо відповідь
            const preview = responseText.substring(0, 150).replace(/\n/g, ' ');
            console.log(`   🤖 AI[${attempt}]: ${preview}...`);

            // Парсимо JSON
            let jsonStr = responseText;
            
            // Видаляємо markdown
            jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
            
            // Знаходимо масив
            const startIdx = jsonStr.indexOf('[');
            const endIdx = jsonStr.lastIndexOf(']');
            
            if (startIdx === -1 || endIdx === -1) {
                console.log(`   ⚠️ No array brackets found`);
                if (attempt < 2) continue;
                return [];
            }
            
            jsonStr = jsonStr.substring(startIdx, endIdx + 1);
            
            // Виправляємо типові помилки JSON
            jsonStr = jsonStr
                .replace(/,\s*]/g, ']')
                .replace(/,\s*}/g, '}')
                .replace(/'/g, '"')
                .replace(/\n/g, ' ')
                .replace(/\t/g, ' ');

            let products;
            try {
                products = JSON.parse(jsonStr);
            } catch (parseErr) {
                console.log(`   ⚠️ JSON parse error: ${parseErr.message}`);
                if (attempt < 2) continue;
                return [];
            }

            if (!Array.isArray(products)) {
                console.log(`   ⚠️ Result is not an array`);
                if (attempt < 2) continue;
                return [];
            }

            // Нормалізуємо URLs
            const baseUrl = new URL(url).origin;
            
            return products
                .filter(p => p.title && p.title.length > 2)
                .slice(0, 30)
                .map(p => ({
                    title: String(p.title).trim(),
                    price: typeof p.price === 'number' ? p.price : null,
                    currency: 'AUD',
                    imageUrl: normalizeUrl(p.imageUrl, baseUrl),
                    productUrl: normalizeUrl(p.productUrl, baseUrl) || url,
                    supplier: new URL(url).hostname.replace('www.', '')
                }));

        } catch (error) {
            console.log(`   ⚠️ AI attempt ${attempt} error: ${error.message}`);
            if (attempt === 2) return [];
            await new Promise(r => setTimeout(r, 500));
        }
    }
    
    return [];
}

// ============ URL HELPER ============
function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr) return null;
    if (urlStr.startsWith('http')) return urlStr;
    if (urlStr.startsWith('//')) return 'https:' + urlStr;
    if (urlStr.startsWith('/')) return baseUrl + urlStr;
    return baseUrl + '/' + urlStr;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}\nAI: ${AI_PROVIDER}\n`));
