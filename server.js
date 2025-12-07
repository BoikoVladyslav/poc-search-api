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

// Стоп-слова
const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'deposit', 'donation',
    'login', 'account', 'cart', 'checkout', 'register', 'subscription'
];

const STOP_WORDS = ['the', 'and', 'for', 'with', 'australia', 'best', 'top'];

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 SMART SEARCH: ${AI_PROVIDER.toUpperCase()} | Australia Region`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart Search Australia</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f1f5f9; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 14px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px; outline: none; transition: 0.2s; }
        input:focus { border-color: #0ea5e9; }
        button { padding: 14px 32px; background: #0ea5e9; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button:hover { background: #0284c7; }
        button:disabled { background: #cbd5e1; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #64748b; font-weight: 500; }
        .progress-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 24px; }
        .progress-fill { height: 100%; background: #0ea5e9; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: transform 0.2s; position: relative; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-wrap { height: 200px; padding: 15px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f1f5f9; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .badge { position: absolute; top: 10px; right: 10px; font-size: 10px; background: rgba(255,255,255,0.9); padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; color: #64748b; font-weight: bold; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #0f172a; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .size { font-size: 12px; color: #64748b; margin-bottom: 6px; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; display: inline-block; }
        .price { font-size: 18px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .btn-link { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: 600; transition: 0.2s; border: 1px solid #e2e8f0; }
        .btn-link:hover { background: #e2e8f0; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Enter product name..." onkeypress="if(event.key==='Enter') run()">
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
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="badge">\${domain}</div>
                                            <div class="img-wrap">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.src='https://placehold.co/400?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                \${p.size ? \`<div class="size">📐 \${p.size}</div>\` : ''}
                                                <div class="price">\${p.price}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="btn-link">View Product</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = \`Done! Found \${count} products from \${data.sites || 0} sites.\`;
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
    let sitesWithProducts = 0;
    
    try {
        send('progress', { msg: 'Google Search (Australia)...', done: 0, total: 15 });
        
        // 1. Google Search - ОНОВЛЕНО для Австралії
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            send('done', { total: 0, sites: 0 });
            return res.end();
        }

        const topUrls = urls.slice(0, 15);
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-accelerated-2d-canvas', 
                '--disable-gpu',
                '--blink-settings=imagesEnabled=false'
            ]
        });

        send('progress', { msg: `Scanning ${topUrls.length} Australian sites...`, done: 0, total: topUrls.length });

        // 2. Queue Logic
        let completed = 0;
        const queue = [...topUrls];
        const processedSites = new Set(); // Відстежуємо сайти
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                const domain = new URL(url).hostname;
                
                // Пропускаємо якщо вже обробляли цей домен
                if (processedSites.has(domain)) {
                    completed++;
                    continue;
                }
                processedSites.add(domain);
                
                try {
                    const found = await processSite(browser, url, keyword, send);
                    if (found) sitesWithProducts++;
                } catch (e) {
                    // Silent fail
                } finally {
                    completed++;
                    send('progress', { msg: `Processing...`, done: completed, total: topUrls.length });
                }
            }
        };

        const workers = Array(CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', { sites: sitesWithProducts });

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
            if (['image', 'font', 'media', 'stylesheet', 'other'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        await new Promise(r => setTimeout(r, 1000));

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;
        let productsBeforeFilter = [];

        // --- PHASE 1: JSON-LD ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const txt = $(el).html();
                if(!txt) return;
                const data = JSON.parse(txt);
                const items = Array.isArray(data) ? data : [data];
                items.forEach(item => {
                    if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') {
                        extractFromJson(item, productsBeforeFilter, baseUrl);
                    }
                    if (item['@graph']) {
                        item['@graph'].forEach(g => {
                            if (g['@type'] === 'Product') extractFromJson(g, productsBeforeFilter, baseUrl);
                        });
                    }
                });
            } catch (e) {}
        });

        // --- PHASE 2: AI FALLBACK ---
        let useAI = productsBeforeFilter.length === 0;
        
        if (useAI) {
            $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .popup, .hidden, [aria-hidden="true"]').remove();
            
            const body = $('body').html() || '';
            const truncated = body.replace(/\s+/g, ' ').substring(0, 60000);

            if (truncated.length > 500) {
                const aiProducts = await parseWithAI(truncated, url, keyword);
                productsBeforeFilter = [...productsBeforeFilter, ...aiProducts];
            }
        }

        // --- PHASE 3: SMART FILTER ---
        const validProducts = [];

        productsBeforeFilter.forEach(p => {
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            
            const titleLower = p.title.toLowerCase();
            if (BLACKLIST.some(bad => titleLower.includes(bad))) return;

            const queryTokens = keyword.toLowerCase()
                .replace(/[^a-z0-9 ]/g, '')
                .split(' ')
                .filter(t => t.length > 2 && !STOP_WORDS.includes(t));

            if (queryTokens.length === 0) {
                // Empty query - pass all
            } else if (queryTokens.length === 1) {
                const token = queryTokens[0];
                if (!titleLower.includes(token)) {
                    const synonyms = getSynonyms(token);
                    if (!synonyms.some(syn => titleLower.includes(syn))) {
                        return;
                    }
                }
            } else {
                let matchCount = 0;
                queryTokens.forEach(token => {
                    if (titleLower.includes(token)) {
                        matchCount++;
                    } else {
                        const synonyms = getSynonyms(token);
                        if (synonyms.some(syn => titleLower.includes(syn))) {
                            matchCount++;
                        }
                    }
                });

                const threshold = 0.25;
                if ((matchCount / queryTokens.length) < threshold) return;
            }

            if (!p.price) p.price = 'Check Site';
            
            validProducts.push(p);
        });

        // === ОДИН ПРОДУКТ З САЙТУ ===
        if (validProducts.length > 0) {
            // Сортуємо: спочатку з ціною, потім з розміром
            validProducts.sort((a, b) => {
                const aHasPrice = a.price && a.price !== 'Check Site' ? 1 : 0;
                const bHasPrice = b.price && b.price !== 'Check Site' ? 1 : 0;
                if (bHasPrice !== aHasPrice) return bHasPrice - aHasPrice;
                
                const aHasSize = a.size ? 1 : 0;
                const bHasSize = b.size ? 1 : 0;
                return bHasSize - aHasSize;
            });
            
            const bestProduct = validProducts[0];
            send('product', { p: bestProduct });
            return true; // Знайдено продукт
        }
        
        return false; // Не знайдено

    } catch (e) {
        if(page) await page.close().catch(() => {});
        return false;
    }
}

// Синоніми
function getSynonyms(word) {
    const synonymMap = {
        'sticker': ['decal', 'label', 'adhesive', 'vinyl'],
        'decal': ['sticker', 'label', 'graphic'],
        'label': ['sticker', 'tag', 'badge'],
        'card': ['cards', 'cardstock'],
        'banner': ['banners', 'sign', 'signage', 'flag'],
        'print': ['printing', 'printed', 'prints'],
        'custom': ['personalised', 'personalized', 'bespoke', 'customised', 'customized'],
        'vinyl': ['pvc', 'adhesive'],
        'business': ['corporate', 'company', 'commercial'],
        'bumper': ['car', 'vehicle', 'auto'],
        'packaging': ['package', 'packages', 'box', 'boxes'],
        'flyer': ['flyers', 'leaflet', 'brochure'],
        'poster': ['posters', 'print', 'wall art']
    };
    return synonymMap[word] || [];
}

function extractFromJson(item, list, baseUrl) {
    if (!item.name) return;
    
    let price = null;
    let currency = 'AUD';
    let size = null;
    
    // Price
    if (item.offers) {
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (offer.price) price = offer.price;
        if (offer.priceCurrency) currency = offer.priceCurrency;
        if (!price && offer.lowPrice) price = offer.lowPrice;
    }
    
    // Size - шукаємо в різних полях
    if (item.size) {
        size = item.size;
    } else if (item.additionalProperty) {
        const props = Array.isArray(item.additionalProperty) ? item.additionalProperty : [item.additionalProperty];
        const sizeProp = props.find(p => 
            p.name && (p.name.toLowerCase().includes('size') || p.name.toLowerCase().includes('dimension'))
        );
        if (sizeProp) size = sizeProp.value;
    } else if (item.description) {
        // Спробуємо витягти розмір з опису
        const sizeMatch = item.description.match(/(\d+)\s*(x|×)\s*(\d+)\s*(mm|cm|inch|in|")/i);
        if (sizeMatch) {
            size = sizeMatch[0];
        }
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
    const prompt = `Extract e-commerce products from HTML matching "${keyword}".

Rules:
1. Products for sale only
2. Must relate to "${keyword}"
3. Return JSON array:
   [
     {
       "title": "Product Name",
       "price": "$X AUD" or null,
       "size": "100x50mm" or "A4" or "Small" or null,
       "imageUrl": "https://...",
       "productUrl": "https://..."
     }
   ]
4. SIZE: Extract dimensions (100x50mm, 200x100cm), paper sizes (A4, A5, A3), or size variants (S, M, L, XL, Small, Medium, Large)
5. Absolute URLs only
6. Max 10 products
7. If no products: []

HTML: ${html}`;

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
                { 
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, maxOutputTokens: 3000 }
                },
                { timeout: 10000 }
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
        })).filter(p => p.imageUrl && p.productUrl);
        
    } catch (e) {
        return [];
    }
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

// === GOOGLE SEARCH - ОНОВЛЕНО ДЛЯ АВСТРАЛІЇ ===
async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    // Чистий запит + "buy" для e-commerce
    const q = encodeURIComponent(`${keyword} buy`);
    
    const blocked = [
        'facebook.com', 'youtube.com', 'pinterest.com', 
        'wikipedia.org', 'reddit.com', 'twitter.com',
        'instagram.com', 'tiktok.com', 'linkedin.com'
    ];
    
    try {
        // gl=au - геолокація Австралія
        // cr=countryAU - результати з Австралії
        const res = await axios.get(
            `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10&gl=au&cr=countryAU`
        );
        
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !blocked.some(b => l.includes(b)));
    } catch (e) {
        console.error('Google Search error:', e.message);
        return [];
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
