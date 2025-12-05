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
        .product-title { font-size: 14px; color: #333; margin-bottom: 8px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .product-price { font-size: 18px; font-weight: bold; color: #28a745; }
        .product-price.no-price { color: #999; font-size: 14px; }
        .product-link { display: block; margin-top: 10px; color: #007bff; text-decoration: none; font-size: 14px; }
        .product-link:hover { text-decoration: underline; }
        .error { background: #ffe6e6; color: #cc0000; padding: 10px; border-radius: 8px; margin-bottom: 15px; }
        .processing { color: #666; font-style: italic; }
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
        <div id="error" class="error" style="display:none;"></div>
        
        <div class="stats" id="stats" style="display:none;">
            <div class="stat">
                <div class="stat-value" id="productCount">0</div>
                <div class="stat-label">Products Found</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="siteCount">0/0</div>
                <div class="stat-label">Sites Processed</div>
            </div>
        </div>
        
        <div class="products" id="products"></div>
    </div>

    <script>
        async function search() {
            const keyword = document.getElementById('keyword').value.trim();
            if (!keyword) { alert('Please enter a keyword'); return; }
            
            const btn = document.getElementById('searchBtn');
            const status = document.getElementById('status');
            const error = document.getElementById('error');
            const stats = document.getElementById('stats');
            const products = document.getElementById('products');
            
            btn.disabled = true;
            btn.textContent = 'Searching...';
            status.style.display = 'block';
            error.style.display = 'none';
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
                    
                    const text = decoder.decode(value);
                    const lines = text.split('\\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                handleEvent(data);
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) {
                error.textContent = 'Error: ' + e.message;
                error.style.display = 'block';
            }
            
            btn.disabled = false;
            btn.textContent = 'Search';
            status.style.display = 'none';
        }
        
        function handleEvent(data) {
            const status = document.getElementById('status');
            const products = document.getElementById('products');
            
            switch (data.type) {
                case 'status':
                    status.textContent = data.message;
                    break;
                    
                case 'processing':
                    status.innerHTML = '<span class="processing">Processing: ' + data.site + '</span>';
                    document.getElementById('siteCount').textContent = data.siteIndex + '/' + data.totalSites;
                    break;
                    
                case 'products':
                    document.getElementById('productCount').textContent = data.totalSoFar;
                    data.newProducts.forEach(p => {
                        products.innerHTML += createProductCard(p);
                    });
                    break;
                    
                case 'complete':
                    status.textContent = 'Search complete! Found ' + data.totalProducts + ' products.';
                    break;
                    
                case 'error':
                    console.log('Site error:', data.site, data.error);
                    break;
            }
        }
        
        function createProductCard(p) {
            const price = p.price ? '$' + p.price.toFixed(2) + ' AUD' : 'Price on request';
            const priceClass = p.price ? 'product-price' : 'product-price no-price';
            return \`
                <div class="product">
                    <img src="\${p.imageUrl}" onerror="this.src='https://via.placeholder.com/300x180?text=No+Image'" alt="\${p.title}">
                    <div class="product-info">
                        <div class="product-title">\${p.title}</div>
                        <div class="\${priceClass}">\${price}</div>
                        <a href="\${p.productUrl}" target="_blank" class="product-link">View Product →</a>
                    </div>
                </div>
            \`;
        }
        
        document.getElementById('keyword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') search();
        });
    </script>
</body>
</html>
    `);
});

// ============ STREAMING SEARCH ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;

    if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

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

        const allProducts = [];
        const seenTitles = new Set();

        for (let i = 0; i < urls.length; i += 2) {
            const batch = urls.slice(i, i + 2);
            
            const results = await Promise.all(
                batch.map(async (url, j) => {
                    const siteIndex = i + j + 1;
                    console.log(`\n📄 [${siteIndex}/${urls.length}] Processing: ${url}`);
                    sendEvent('processing', { site: url, siteIndex, totalSites: urls.length });

                    try {
                        const html = await fetchWithPuppeteer(url);
                        const products = await parseHtmlWithAI(html, url, keyword);
                        return { url, products, siteIndex };
                    } catch (error) {
                        console.log(`   ❌ Failed: ${error.message}`);
                        return { url, products: [], siteIndex, error: error.message };
                    }
                })
            );

            for (const result of results) {
                if (result.error) {
                    sendEvent('error', { site: result.url, error: result.error });
                    continue;
                }

                const newProducts = [];
                for (const product of result.products) {
                    const normalizedTitle = product.title.toLowerCase().trim();
                    if (!seenTitles.has(normalizedTitle)) {
                        seenTitles.add(normalizedTitle);
                        allProducts.push(product);
                        newProducts.push(product);
                    }
                }

                if (newProducts.length > 0) {
                    console.log(`   ✅ [${result.siteIndex}] Found ${newProducts.length} new products`);
                    sendEvent('products', {
                        site: result.url,
                        newProducts,
                        totalSoFar: allProducts.length
                    });
                }
            }
        }

        console.log(`\n✨ Total products: ${allProducts.length}`);
        sendEvent('complete', {
            keyword,
            totalProducts: allProducts.length,
            products: allProducts
        });

    } catch (error) {
        console.error('Search error:', error.message);
        sendEvent('error', { error: error.message });
    }

    res.end();
});

// ============ GOOGLE SEARCH ============
async function googleSearch(keyword) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
        throw new Error('Google API credentials not configured');
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(keyword)}&num=10&gl=au&cr=countryAU`;
    const response = await axios.get(url);

    if (!response.data.items) return [];

    const blockedDomains = [
        'reddit.com', 'wikipedia.org', 'youtube.com', 'facebook.com',
        'twitter.com', 'instagram.com', 'pinterest.com', 'quora.com',
        'medium.com', 'linkedin.com', 'tiktok.com'
    ];

    const urls = response.data.items
        .map(item => item.link)
        .filter(link => {
            const domain = new URL(link).hostname.toLowerCase();
            return !blockedDomains.some(blocked => domain.includes(blocked));
        });

    console.log(`   🚫 Filtered out ${response.data.items.length - urls.length} non-ecommerce sites`);
    return urls;
}

// ============ FETCH WITH PUPPETEER ============
async function fetchWithPuppeteer(url) {
    const isWindows = process.platform === 'win32';
    const defaultPath = isWindows 
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome-stable';
    
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--single-process',
        '--no-zygote'
    ];

    // Створюємо новий браузер для кожного запиту (стабільніше на Railway)
    const browserInstance = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || defaultPath,
        args
    });

    const page = await browserInstance.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        await new Promise(resolve => setTimeout(resolve, 1500));
        
        await page.evaluate(() => {
            window.scrollTo(0, 3000);
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));

        const html = await page.content();
        console.log(`   📊 Status: ${response?.status() || 0}, HTML: ${html.length} chars`);

        return html;
    } finally {
        await page.close();
        await browserInstance.close();
    }
}

// ============ AI PARSING ============
async function parseHtmlWithAI(html, url, keyword) {
    const cleanedHtml = cleanHtml(html);
    const truncatedHtml = cleanedHtml.substring(0, Math.min(70000, cleanedHtml.length));

    console.log(`   📝 Sending ${truncatedHtml.length} chars to AI`);

    const prompt = `Extract products from this e-commerce page.

SEARCH: "${keyword}"

Extract for each product:
- title: product name
- price: number or null
- currency: "AUD"
- imageUrl: image URL
- productUrl: product link

Return JSON array (max 30 products):
[{"title":"...","price":9.99,"currency":"AUD","imageUrl":"...","productUrl":"..."}]

HTML:
${truncatedHtml}`;

    let responseText;

    try {
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 4000
            });
            responseText = completion.choices[0].message.content.trim();
        } else {
            responseText = await callGemini(prompt);
        }
    } catch (error) {
        console.log(`   ⚠️ AI error: ${error.message}`);
        return [];
    }

    const products = parseAiResponse(responseText);
    const baseUrl = new URL(url).origin;

    return products
        .map(product => {
            let imageUrl = product.imageUrl;
            let productUrl = product.productUrl;

            if (imageUrl?.startsWith('//')) imageUrl = 'https:' + imageUrl;
            else if (imageUrl && !imageUrl.startsWith('http')) imageUrl = baseUrl + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;

            if (productUrl?.startsWith('//')) productUrl = 'https:' + productUrl;
            else if (productUrl && !productUrl.startsWith('http')) productUrl = baseUrl + (productUrl.startsWith('/') ? '' : '/') + productUrl;

            return {
                title: product.title,
                price: product.price || null,
                currency: product.currency || 'AUD',
                imageUrl,
                productUrl,
                supplier: 'Supplier'
            };
        })
        .filter(p => p.title && p.title.length > 3);
}

// ============ GEMINI ============
async function callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8000 }
    });

    return response.data.candidates[0].content.parts[0].text.trim();
}

// ============ CLEAN HTML ============
function cleanHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ============ PARSE RESPONSE ============
function parseAiResponse(responseText) {
    if (!responseText) return [];
    
    let cleaned = responseText
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/gi, '')
        .replace(/^\s*\n/gm, '')
        .trim();

    const startIdx = cleaned.indexOf('[');
    const endIdx = cleaned.lastIndexOf(']');

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        console.log(`   ⚠️ No JSON array found`);
        return [];
    }

    cleaned = cleaned.substring(startIdx, endIdx + 1);

    cleaned = cleaned
        .replace(/,\s*]/g, ']')
        .replace(/,\s*}/g, '}')
        .replace(/'/g, '"')
        .replace(/\n/g, ' ');

    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.log(`   ⚠️ JSON parse error`);
        return [];
    }
}


// ============ START ============
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(` Server: http://localhost:${PORT}`);
    console.log(` AI Provider: ${AI_PROVIDER}`);
    console.log(` Region: Australia\n`);
});


