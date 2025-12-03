require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');


puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());


const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';


let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
}


let browser = null;

console.log(`\n🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}\n`);


app.post('/api/search', async (req, res) => {
    try {
        const { keyword } = req.body;

        if (!keyword) {
            return res.status(400).json({ error: 'Keyword is required' });
        }

        console.log(`\n🔍 Searching for: "${keyword}"`);

        
        const urls = await googleSearch(keyword);
        console.log(`📋 Found ${urls.length} URLs (after filtering)`);

        if (urls.length === 0) {
            return res.json({ keyword, products: [], message: 'No results found' });
        }

        
        const allProducts = [];

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`\n📄 [${i + 1}/${urls.length}] Processing: ${url}`);

            try {
                const products = await parseProductsFromUrl(url);
                console.log(`   ✅ Found ${products.length} products`);
                allProducts.push(...products);
            } catch (error) {
                console.log(`   ❌ Failed: ${error.message}`);
            }
        }

       
        const uniqueProducts = [];
        const seenTitles = new Set();

        for (const product of allProducts) {
            const normalizedTitle = product.title.toLowerCase().trim();
            if (!seenTitles.has(normalizedTitle)) {
                seenTitles.add(normalizedTitle);
                uniqueProducts.push(product);
            }
        }

        console.log(`\n✨ Total products found: ${allProducts.length}`);
        console.log(`✨ After removing duplicates: ${uniqueProducts.length}`);

        res.json({
            keyword,
            totalProducts: uniqueProducts.length,
            products: uniqueProducts
        });

    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});


async function googleSearch(keyword) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
        throw new Error('Google API credentials not configured');
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(keyword)}&num=10`;

    const response = await axios.get(url);

    if (!response.data.items) {
        return [];
    }

    
    const blockedDomains = [
        'reddit.com',
        'wikipedia.org',
        'youtube.com',
        'facebook.com',
        'twitter.com',
        'instagram.com',
        'pinterest.com',
        'quora.com',
        'medium.com',
        'linkedin.com',
        'tiktok.com'
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


async function fetchWithPuppeteer(url) {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    }

    const page = await browser.newPage();

    try {
        
        await page.setViewport({ width: 1920, height: 1080 });

        
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        const response = await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        
        await new Promise(resolve => setTimeout(resolve, 5000));

        const html = await page.content();
        const status = response ? response.status() : 0;

        console.log(`   📊 Status: ${status}, HTML length: ${html.length}`);

        
        if (html.length < 500) {
            throw new Error(`Page too short (${html.length} chars)`);
        }

        return html;
    } finally {
        await page.close();
    }
}


async function parseProductsFromUrl(url) {
    let html;
    try {
        html = await fetchWithPuppeteer(url);
    } catch (error) {
        throw new Error(`Cannot fetch: ${error.message}`);
    }

    const cleanedHtml = cleanHtml(html);

    
    const htmlLength = cleanedHtml.length;
    const startPos = Math.floor(htmlLength * 0.03);
    const endPos = Math.min(startPos + 50000, htmlLength);
    const truncatedHtml = cleanedHtml.substring(startPos, endPos);

    console.log(`   📝 Sending ${truncatedHtml.length} chars to AI`);

    const prompt = `Extract products from this e-commerce HTML. Return ONLY a JSON array.

EXTRACT for each product:
- title: product name
- price: number (e.g. 4.99)
- currency: "USD"
- imageUrl: image URL
- productUrl: product link

SKIP: navigation, categories, banners, icons

HTML:
${truncatedHtml}

IMPORTANT: Return ONLY valid JSON array, maximum 15 products. No explanations.
Example: [{"title":"Product","price":4.99,"currency":"USD","imageUrl":"https://...","productUrl":"/product"}]
If no products, return: []`;

    let responseText;

    if (AI_PROVIDER === 'openai') {
        const completion = await openai.chat.completions.create({
            model: 'gpt-5.1',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_completion_tokens: 4000
        });
        responseText = completion.choices[0].message.content.trim();
    } else {
        responseText = await callGemini(prompt);
    }

    console.log(`   🤖 AI response: ${responseText.substring(0, 200)}...`);

    const products = parseAiResponse(responseText);

    
    const baseUrl = new URL(url).origin;

    
    const processedProducts = products
        .map(product => {
            let imageUrl = product.imageUrl;
            let productUrl = product.productUrl;

            
            if (imageUrl?.startsWith('//')) {
                imageUrl = 'https:' + imageUrl;
            } else if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = baseUrl + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;
            }

            if (productUrl?.startsWith('//')) {
                productUrl = 'https:' + productUrl;
            } else if (productUrl && !productUrl.startsWith('http')) {
                productUrl = baseUrl + (productUrl.startsWith('/') ? '' : '/') + productUrl;
            }

            return {
                title: product.title,
                price: product.price || null,
                currency: product.currency || null,
                imageUrl,
                productUrl,
                supplier: 'Supplier'
            };
        })
        
        .filter(product => {
            
            if (!product.title || product.title.length < 3) return false;

            
            const genericNames = ['sparklesonly', 'ribbon_shape', 'icon', 'logo', 'placeholder', 'image'];
            if (genericNames.some(g => product.title.toLowerCase().includes(g))) return false;

            return true;
        });

    return processedProducts;
}


async function callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('Gemini API key not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8000  
            }
        });

        return response.data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
        console.log(`   ⚠️ Gemini error: ${error.response?.status} - ${error.response?.data?.error?.message || error.message}`);
        throw new Error(`Gemini API failed: ${error.response?.status || error.message}`);
    }
}


function cleanHtml(html) {
    
    let cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

    
    const pricePattern = /\$[\d,.]+|\d+\.\d{2}\s*(USD|EUR|GBP)/gi;
    const prices = cleaned.match(pricePattern) || [];

   
    cleaned = cleaned
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .trim();

    console.log(`   💰 Found ${prices.length} price patterns in HTML`);

    return cleaned;
}


function parseAiResponse(responseText) {
    
    let cleaned = responseText
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/gi, '')
        .trim();

    
    const startIdx = cleaned.indexOf('[');
    const endIdx = cleaned.lastIndexOf(']');

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleaned = cleaned.substring(startIdx, endIdx + 1);
    }

    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        return [];
    } catch (e) {
        console.log(`   ⚠️ JSON parse error: ${e.message}`);
        console.log(`   ⚠️ Attempted to parse: ${cleaned.substring(0, 200)}...`);
        return [];
    }
}


app.get('/', (req, res) => {
    res.json({
        status: 'API is running',
        aiProvider: AI_PROVIDER,
        usage: 'POST /api/search with { "keyword": "your search term" }'
    });
});


process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(`\n Usage: POST http://localhost:${PORT}/api/search`);
    console.log(`   Body: { "keyword": "bumper stickers" }\n`);
});