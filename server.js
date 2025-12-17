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

const CONCURRENCY = 5;
const PAGE_TIMEOUT = 15000;
const MAX_SITES = 20;
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

const PRIORITY_DOMAINS = [
    'vistaprint.com.au', 'vistaprint.com',
    'snapfish.com.au', 'snapfish.com',
    'stickermule.com', 'canva.com',
    'printplace.com', 'moo.com',
    'zazzle.com.au', 'redbubble.com',
    'officeworks.com.au', 'kmart.com.au',
    'bigw.com.au', 'target.com.au'
];

const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'deposit', 'donation',
    'login', 'account', 'cart', 'checkout', 'register', 'subscription', 'career', 'job'
];

const STOP_WORDS = ['the', 'and', 'for', 'with', 'australia', 'best', 'top', 'buy', 'shop', 'online', 'custom'];

const SYNONYMS = {
    'package': ['box', 'mailer', 'packaging', 'bundle', 'kit', 'hamper', 'set'],
    'sticker': ['decal', 'label', 'vinyl', 'adhesive'],
    'decal': ['sticker', 'vinyl'],
    'shirt': ['tee', 't-shirt', 'apparel', 'top'],
    'bag': ['tote', 'pouch', 'sack'],
    'banner': ['flag', 'signage', 'sign'],
    'card': ['cards', 'cardstock'],
    'magnet': ['magnets', 'fridge magnet']
};

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`API SEARCH STARTED | ${AI_PROVIDER.toUpperCase()}`);

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Product Search</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f8fafc; padding: 20px; max-width: 1200px; margin: 0 auto; color: #334155; }
        .header { background: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .header h1 { margin: 0; font-size: 24px; color: #0f172a; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); margin-bottom: 20px; }
        .input-group { margin-bottom: 15px; }
        .input-group label { display: block; margin-bottom: 5px; font-weight: 600; font-size: 14px; color: #334155; }
        input, textarea { width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; transition: 0.2s; font-family: monospace; }
        input:focus, textarea:focus { border-color: #3b82f6; }
        textarea { resize: vertical; min-height: 80px; }
        .search-row { display: flex; gap: 10px; }
        .search-row input { flex: 1; }
        button { padding: 14px 32px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button:hover { background: #2563eb; }
        button:disabled { background: #94a3b8; cursor: not-allowed; }
        .hint { font-size: 12px; color: #64748b; margin-top: 5px; }
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #64748b; font-weight: 500; }
        .progress-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 24px; }
        .progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: transform 0.2s; position: relative; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-wrap { height: 220px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f1f5f9; position: relative; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .badge { position: absolute; top: 10px; left: 10px; font-size: 10px; background: rgba(241,245,249,0.95); padding: 4px 8px; border-radius: 4px; border: 1px solid #cbd5e1; color: #475569; font-weight: bold; text-transform: uppercase; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #0f172a; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .meta-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; min-height: 24px; }
        .tag { font-size: 11px; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; color: #475569; font-weight: 500; }
        .price { font-size: 20px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .price.unavailable { color: #94a3b8; font-size: 16px; }
        .price-info { display: flex; flex-direction: column; gap: 4px; }
        .price-original { font-size: 12px; color: #94a3b8; text-decoration: line-through; }
        .btn-link { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 600; transition: 0.2s; border: 1px solid #e2e8f0; }
        .btn-link:hover { background: #e2e8f0; color: #0f172a; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Product Search API with Dynamic Margin</h1>
    </div>
    
    <div class="search-box">
        <div class="input-group">
            <label>Product Keyword</label>
            <input type="text" id="keyword" placeholder="e.g., custom stickers">
        </div>
        
        <div class="input-group">
            <label>Margin Thresholds (JSON array)</label>
            <textarea id="thresholds" placeholder='[[500, 100], [1500, 70], [5000, 30]]'>[[500, 100], [1500, 70], [5000, 30]]</textarea>
            <div class="hint">Format: [[max_price, margin_%], ...] - Max 10 thresholds</div>
        </div>
        
        <div class="input-group">
            <label>Default Margin (%)</label>
            <input type="number" id="defaultMargin" value="20" min="0" max="500">
            <div class="hint">Applied when no threshold matches</div>
        </div>
        
        <button onclick="run()" id="btn">Search with Margin</button>
    </div>
    
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 products</span></div>
    <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
    <div id="results" class="grid"></div>

    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value.trim();
            if(!keyword) { alert('Please enter a keyword'); return; }
            
            let thresholds = [];
            try {
                thresholds = JSON.parse(document.getElementById('thresholds').value || '[]');
                if (!Array.isArray(thresholds)) throw new Error('Must be array');
            } catch(e) {
                alert('Invalid thresholds JSON format');
                return;
            }
            
            const defaultMargin = parseFloat(document.getElementById('defaultMargin').value) || 0;
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const counter = document.getElementById('counter');
            const progress = document.getElementById('progress');
            const results = document.getElementById('results');
            
            btn.disabled = true;
            results.innerHTML = '';
            progress.style.width = '2%';
            status.textContent = 'Searching...';
            
            let productCount = 0;

            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ 
                        keyword,
                        margin_thresholds: thresholds,
                        default_margin: defaultMargin
                    })
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
                                    productCount++;
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    const sizeHtml = p.size ? '<div class="tag">📏 ' + p.size + '</div>' : '';
                                    const priceClass = p.finalPrice === 'Not available' || p.finalPrice === 'Check Site' ? 'price unavailable' : 'price';
                                    
                                    let priceHtml = '<div class="' + priceClass + '">' + p.finalPrice + '</div>';
                                    if (p.originalPrice && p.originalPrice !== p.finalPrice) {
                                        priceHtml = '<div class="price-info">' +
                                            '<div class="price-original">Base: ' + p.originalPrice + '</div>' +
                                            '<div class="' + priceClass + '">' + p.finalPrice + '</div>' +
                                            '</div>';
                                    }
                                    
                                    counter.textContent = productCount + ' products found';

                                    results.insertAdjacentHTML('beforeend', 
                                        '<div class="card">' +
                                            '<div class="img-wrap">' +
                                                '<div class="badge">' + domain + '</div>' +
                                                '<img src="' + p.imageUrl + '" loading="lazy" onerror="this.src=\\'https://placehold.co/400x400/e2e8f0/64748b?text=No+Image\\'">' +
                                            '</div>' +
                                            '<div class="info">' +
                                                '<div class="title" title="' + p.title + '">' + p.title + '</div>' +
                                                '<div class="meta-row">' + sizeHtml + '</div>' +
                                                priceHtml +
                                                '<a href="' + p.productUrl + '" target="_blank" class="btn-link">View Product</a>' +
                                            '</div>' +
                                        '</div>');
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = 'Complete! Scanned ' + data.total + ' sites.';
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

// ============ API SEARCH WITH MARGIN ============
app.post('/api/search', async (req, res) => {
    const { keyword, margin_thresholds, default_margin } = req.body;
    
    // Валідація
    if (!keyword || keyword.trim().length < 2) {
        return res.status(400).json({ error: 'Keyword required' });
    }

    // Валідація margin параметрів
    let thresholds = [];
    let defaultMargin = 0;

    if (margin_thresholds) {
        if (!Array.isArray(margin_thresholds)) {
            return res.status(400).json({ error: 'margin_thresholds must be array' });
        }
        if (margin_thresholds.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 thresholds allowed' });
        }
        
        // Валідація структури кожного threshold
        for (const threshold of margin_thresholds) {
            if (!Array.isArray(threshold) || threshold.length !== 2) {
                return res.status(400).json({ error: 'Each threshold must be [max_price, margin_%]' });
            }
            const [maxPrice, margin] = threshold;
            if (typeof maxPrice !== 'number' || typeof margin !== 'number') {
                return res.status(400).json({ error: 'Threshold values must be numbers' });
            }
            if (maxPrice <= 0 || margin < 0) {
                return res.status(400).json({ error: 'Invalid threshold values' });
            }
        }
        
        // Сортуємо thresholds по зростанню max_price для коректної роботи
        thresholds = margin_thresholds.sort((a, b) => a[0] - b[0]);
    }

    if (default_margin !== undefined) {
        if (typeof default_margin !== 'number' || default_margin < 0) {
            return res.status(400).json({ error: 'default_margin must be non-negative number' });
        }
        defaultMargin = default_margin;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (type, data) => {
        try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch (e) {}
    };

    let browser = null;
    const sentProducts = new Map();
    
    try {
        send('progress', { msg: 'Initializing...', done: 0, total: 20 });
        
        const [urls, browserInstance] = await Promise.all([
            googleSearch(keyword),
            puppeteer.launch({
                headless: "new",
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas', 
                    '--disable-gpu',
                    '--disable-web-security',
                    '--blink-settings=imagesEnabled=false'
                ]
            })
        ]);

        browser = browserInstance;
        
        if (urls.length === 0) {
            send('progress', { msg: 'No results found' });
            send('done', { total: 0 });
            return res.end();
        }

        const uniqueUrls = getUniqueDomainUrls(urls, MAX_SITES);
        const { priorityUrls, regularUrls } = sortUrlsByPriority(uniqueUrls);
        const allUrls = [...priorityUrls, ...regularUrls];
        
        send('progress', { msg: `Found ${uniqueUrls.length} sites. Scanning...`, done: 0, total: uniqueUrls.length });

        let completed = 0;
        const queue = [...allUrls];
        
        const processNext = async () => {
            while (queue.length > 0) {
                const urlObj = queue.shift();
                if (!urlObj) continue;
                
                const url = urlObj.url;
                const domain = getDomain(url);
                
                if (sentProducts.has(domain)) {
                    completed++;
                    continue;
                }

                try {
                    const product = await extractProductFromSite(browser, url, keyword);
                    
                    if (product && isValidProduct(product)) {
                        // Застосовуємо маржу
                        const productWithMargin = applyMarginToProduct(product, thresholds, defaultMargin);
                        
                        sentProducts.set(domain, true);
                        send('product', { p: productWithMargin });
                    }
                } catch (e) {}
                
                completed++;
                const pct = Math.round(10 + (completed / uniqueUrls.length) * 85);
                send('progress', { msg: `Scanning sites...`, pct });
            }
        };

        const workers = Array(CONCURRENCY).fill(null).map(() => processNext());
        await Promise.all(workers);

        send('done', { total: completed });

    } catch (e) {
        console.error(e);
        send('progress', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

// ============ MARGIN APPLICATION ============

/**
 * Застосовує маржу до продукту
 */
function applyMarginToProduct(product, thresholds, defaultMargin) {
    const originalPrice = product.price;
    
    // Парсимо ціну
    const parsedPrice = parsePrice(originalPrice);
    
    if (parsedPrice === null) {
        // Ціна не парситься - повертаємо як є
        return {
            ...product,
            originalPrice: originalPrice,
            finalPrice: originalPrice
        };
    }
    
    // Застосовуємо маржу
    const margin = findApplicableMargin(parsedPrice, thresholds, defaultMargin);
    const finalPrice = parsedPrice + (parsedPrice * margin / 100);
    
    // Форматуємо ціну назад
    const currency = extractCurrency(originalPrice);
    const formattedFinalPrice = formatPrice(finalPrice, currency);
    
    return {
        ...product,
        originalPrice: originalPrice,
        finalPrice: formattedFinalPrice,
        appliedMargin: margin
    };
}

/**
 * Знаходить відповідну маржу для ціни
 */
function findApplicableMargin(price, thresholds, defaultMargin) {
    // Thresholds вже відсортовані по зростанню
    for (const [maxPrice, margin] of thresholds) {
        if (price <= maxPrice) {
            return margin;
        }
    }
    
    // Жоден threshold не підійшов
    return defaultMargin;
}

/**
 * Парсить ціну з рядка
 * Повертає число або null
 */
function parsePrice(priceStr) {
    if (!priceStr || typeof priceStr !== 'string') return null;
    
    // Якщо це спеціальні значення
    if (priceStr === 'Check Site' || priceStr === 'Not available') return null;
    
    // Видаляємо "From", валюту, пробіли
    const cleaned = priceStr
        .replace(/from/gi, '')
        .replace(/[^0-9.,]/g, '')
        .trim();
    
    if (!cleaned) return null;
    
    // Конвертуємо в число
    const num = parseFloat(cleaned.replace(',', ''));
    
    return isNaN(num) ? null : num;
}

/**
 * Витягує валюту з рядка ціни
 */
function extractCurrency(priceStr) {
    if (!priceStr) return 'AUD';
    
    if (priceStr.includes('USD')) return 'USD';
    if (priceStr.includes('EUR')) return 'EUR';
    if (priceStr.includes('GBP')) return 'GBP';
    
    return 'AUD'; // За замовчуванням
}

/**
 * Форматує ціну назад у рядок
 */
function formatPrice(price, currency = 'AUD') {
    const rounded = Math.round(price * 100) / 100; // Округлюємо до 2 знаків
    return `$${rounded.toFixed(2)} ${currency}`;
}

// ============ РЕШТА ФУНКЦІЙ (без змін) ============

function sortUrlsByPriority(urls) {
    const priorityUrls = [];
    const regularUrls = [];
    
    urls.forEach(url => {
        const domain = getDomain(url);
        const isPriority = PRIORITY_DOMAINS.some(pd => domain.includes(pd) || pd.includes(domain));
        if (isPriority) priorityUrls.push({ url, isPriority: true });
        else regularUrls.push({ url, isPriority: false });
    });
    
    return { priorityUrls, regularUrls };
}

async function extractProductFromSite(browser, url, keyword) {
    let page = null;
    try {
        page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'other'].includes(type)) req.abort();
            else req.continue();
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: PAGE_TIMEOUT 
        });

        await new Promise(r => setTimeout(r, 200));

        await page.evaluate(async () => {
            window.scrollBy(0, 800);
            await new Promise(r => setTimeout(r, 100));
        });

        const hiddenOptions = await page.evaluate(() => {
            try {
                const opts = [];
                document.querySelectorAll('select option, .variant, .swatch').forEach(el => {
                    const t = el.innerText || el.textContent;
                    if(t && t.length < 40 && t.length > 1) opts.push(t.trim());
                });
                return [...new Set(opts)].slice(0, 10).join(', ');
            } catch { return ""; }
        });

        const html = await page.content();
        const finalUrl = page.url();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(finalUrl).origin;
        
        const jsonLdProducts = extractJsonLdProducts($, baseUrl);
        
        $('script, style, noscript, svg, iframe, header, footer, nav, .popup, .modal').remove();
        let bodyHtml = $('body').html() || '';
        
        if (hiddenOptions) bodyHtml += `\n<div>Available options: ${hiddenOptions}</div>`;
        
        const cleanedHtml = bodyHtml.replace(/\s+/g, ' ').substring(0, 60000);
        
        let aiProducts = [];
        if (jsonLdProducts.length === 0 || cleanedHtml.length > 500) {
            aiProducts = await parseWithAI(cleanedHtml, finalUrl, keyword);
        }

        const allProducts = [...jsonLdProducts, ...aiProducts];
        if (allProducts.length === 0) return null;

        const validProducts = allProducts
            .filter(p => {
                if (!p.title || p.title.length < 3) return false;
                if (!p.imageUrl) return false;
                const titleLower = p.title.toLowerCase();
                if (BLACKLIST.some(bad => titleLower.includes(bad))) return false;
                
                const keywordLower = keyword.toLowerCase();
                const words = keywordLower.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.includes(w));
                
                let match = false;
                if (words.length === 0) match = true;
                else {
                    match = words.some(w => titleLower.includes(w)) || 
                            words.some(w => SYNONYMS[w] && SYNONYMS[w].some(s => titleLower.includes(s)));
                }
                return match;
            })
            .sort((a, b) => {
                let scoreA = 0, scoreB = 0;
                if (a.price && a.price !== 'Check Site' && a.price !== 'Not available') scoreA += 3;
                if (a.size) scoreA += 2;
                if (b.price && b.price !== 'Check Site' && b.price !== 'Not available') scoreB += 3;
                if (b.size) scoreB += 2;
                return scoreB - scoreA;
            });

        if (validProducts.length === 0) return null;

        const best = validProducts[0];
        return {
            title: best.title.trim(),
            price: best.price || 'Check Site',
            size: best.size || null,
            imageUrl: best.imageUrl,
            productUrl: best.productUrl || finalUrl
        };

    } catch (e) {
        if (page) await page.close().catch(() => {});
        throw e;
    }
}

function extractJsonLdProducts($, baseUrl) {
    const products = [];
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            const text = $(el).html();
            if (!text) return;
            const data = JSON.parse(text);
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item['@type'] === 'Product' || (item['@type'] === 'ItemPage' && item.mainEntity)) {
                    const entity = item.mainEntity || item;
                    const p = parseJsonLdProduct(entity, baseUrl);
                    if (p) products.push(p);
                }
                if (item['@graph']) {
                    item['@graph'].forEach(g => {
                        if (g['@type'] === 'Product') {
                            const p = parseJsonLdProduct(g, baseUrl);
                            if (p) products.push(p);
                        }
                    });
                }
            });
        } catch (e) {}
    });
    return products;
}

function parseJsonLdProduct(item, baseUrl) {
    if (!item.name) return null;
    let price = null, size = null, image = null;

    if (item.offers) {
        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
        for (const o of offers) {
            if (o.price) { price = `$${o.price} ${o.priceCurrency || 'AUD'}`; break; }
            if (o.lowPrice) { price = `From $${o.lowPrice} ${o.priceCurrency || 'AUD'}`; break; }
        }
    }

    if (item.size) size = typeof item.size === 'object' ? item.size.name : item.size;
    if (!size && item.additionalProperty) {
        const props = Array.isArray(item.additionalProperty) ? item.additionalProperty : [item.additionalProperty];
        const sp = props.find(p => p.name && /size|dim|width|height/i.test(p.name));
        if (sp) size = sp.value;
    }

    if (item.image) {
        image = Array.isArray(item.image) ? (typeof item.image[0] === 'string' ? item.image[0] : item.image[0]?.url) : (item.image.url || item.image);
    }

    if (!image) return null;
    return { title: item.name, price, size, imageUrl: normalizeUrl(image, baseUrl), productUrl: normalizeUrl(item.url || '', baseUrl) };
}

async function parseWithAI(html, url, keyword) {
    const prompt = `Extract ONE best physical product for "${keyword}" from HTML.
Rules:
1. Ignore services, courses, rentals.
2. Get Size/Dim if possible.
3. If price is $0, return "Not available".
4. Return JSON: [{"title":"...","price":"...","size":"...","imageUrl":"...","productUrl":"..."}]
HTML: ${html}`;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, max_tokens: 800
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] },
                { timeout: 8000 }
            );
            content = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
        }
        
        const jsonStr = content.replace(/```json|```/gi, '').trim();
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        if (start === -1) return [];
        const raw = JSON.parse(jsonStr.substring(start, end + 1));
        const baseUrl = new URL(url).origin;
        return raw.map(p => {
            let price = p.price;
            if (price && (price.includes('$0') || price === '0')) price = 'Not available';
            return {
                title: p.title, price, size: p.size,
                imageUrl: normalizeUrl(p.imageUrl, baseUrl),
                productUrl: normalizeUrl(p.productUrl, baseUrl)
            };
        });
    } catch { return []; }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || typeof urlStr !== 'string' || urlStr.startsWith('data:')) return null;
    try {
        urlStr = urlStr.trim();
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        if (urlStr.startsWith('/')) return new URL(urlStr, baseUrl).href;
        if (!urlStr.startsWith('http')) return new URL(urlStr, baseUrl).href;
        return urlStr;
    } catch { return null; }
}

function getDomain(url) { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } }
function getUniqueDomainUrls(urls, max) {
    const seen = new Set();
    const unique = [];
    for (const url of urls) {
        const d = getDomain(url);
        if (!seen.has(d)) { seen.add(d); unique.push(url); if (unique.length >= max) break; }
    }
    return unique;
}
function isValidProduct(p) { return p && p.title && p.imageUrl && p.productUrl; }

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    const query = `${keyword} buy`;
    
    const fetchPage = async (start) => {
        try {
            const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
                params: { key, cx, q: query, num: 10, start, gl: 'au', cr: 'countryAU' },
                timeout: 6000
            });
            return res.data.items || [];
        } catch { return []; }
    };

    try {
        const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(11)]);
        const all = [...p1, ...p2];
        const blocked = ['facebook', 'youtube', 'pinterest', 'instagram', 'reddit', 'wikipedia', 'linkedin'];
        return all.map(i => i.link).filter(l => !blocked.some(b => l.includes(b)));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
